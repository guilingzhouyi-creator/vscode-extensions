/**
 * Module: Core Profiler — System Load Governor & Scale-Adaptive Steering
 * File Path: src/core/profiler/loadGovernor.ts
 * Architecture Role: Runtime resource governor for the profiler layer; a synchronous decision
 *   helper that grades project scale and emits concurrency/throttle policy, not an analyzer.
 * Dependencies & Triggers: Node `os` (cpus, loadavg) and `process.memoryUsage()`; constructed
 *   by callers that need governance settings before dispatching deep passes during a scan.
 * Responsibilities: Classify file counts into MICRO/STANDARD/ENTERPRISE/MASSIVE; sample RSS,
 *   heap used/total, CPU count, and the 1-minute load average; flag memory or CPU constraint
 *   against configurable 600 MB RSS / 450 MB heap defaults; return maxDeepConcurrency,
 *   yieldIntervalMs, throttleDeepTrack, and a human-readable reason; provide a setImmediate
 *   based async yield helper for cooperative multitasking.
 * Exit Semantics & Design Rationale: getScaleGrade, sampleMetrics, and evaluatePolicy are
 *   throw-free; memory pressure dominates CPU pressure and clamps concurrency to 1, trading
 *   throughput for stability so constrained hosts degrade gracefully instead of hitting heap
 *   exhaustion or GC latency spikes. yieldEventLoop resolves on the next event-loop tick and
 *   never rejects, so it cannot abort a scan.
 */

import * as os from 'os';

/** Default RSS ceiling in MiB before the governor flags memory pressure. */
const DEFAULT_RSS_THRESHOLD_MB = 600;

/** Default heap-used ceiling in MiB before the governor flags memory pressure. */
const DEFAULT_HEAP_THRESHOLD_MB = 450;

/** Bytes in one kibibyte (KiB), the 1024 base for the byte-to-MiB conversion below. */
const BYTES_PER_KIBIBYTE = 1024;

/** Bytes in one mebibyte (MiB), derived so the 1024 scale factor stays defined once. */
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;

/** Exclusive upper bound for the MICRO grade: file counts below this many files stay MICRO. */
const MICRO_MAX_FILES = 50;

/** Inclusive upper bound for the STANDARD grade: counts up to this many files are STANDARD. */
const STANDARD_MAX_FILES = 500;

/** Inclusive upper bound for the ENTERPRISE grade: counts up to this many files are ENTERPRISE. */
const ENTERPRISE_MAX_FILES = 5000;

/** Baseline deep-pass concurrency before the scale grade overrides it. */
const DEFAULT_MAX_DEEP_CONCURRENCY = 4;

/** Baseline cooperative yield cadence in milliseconds before the scale grade overrides it. */
const DEFAULT_YIELD_INTERVAL_MS = 15;

/** Cooperative yield cadence in milliseconds for MICRO projects (fastest cadence). */
const MICRO_YIELD_INTERVAL_MS = 50;

/** Deep-pass concurrency cap for STANDARD projects. */
const STANDARD_MAX_DEEP_CONCURRENCY = 4;

/** Cooperative yield cadence in milliseconds for STANDARD projects. */
const STANDARD_YIELD_INTERVAL_MS = 25;

/** Deep-pass concurrency cap for ENTERPRISE projects. */
const ENTERPRISE_MAX_DEEP_CONCURRENCY = 6;

/** Cooperative yield cadence in milliseconds for ENTERPRISE projects. */
const ENTERPRISE_YIELD_INTERVAL_MS = 10;

/** Deep-pass concurrency cap for MASSIVE projects. */
const MASSIVE_MAX_DEEP_CONCURRENCY = 8;

/** Cooperative yield cadence in milliseconds for MASSIVE projects. */
const MASSIVE_YIELD_INTERVAL_MS = 5;

/** Cooperative yield cadence in milliseconds when memory pressure clamps concurrency to 1. */
const MEMORY_PRESSURE_YIELD_INTERVAL_MS = 5;

/**
 * Project scale buckets used to steer deep-pass concurrency.
 *
 * MICRO covers fewer than 50 files, STANDARD covers 50-500, ENTERPRISE covers
 * 501-5000, and MASSIVE covers everything above 5000.
 */
export type GovernorScaleGrade = 'MICRO' | 'STANDARD' | 'ENTERPRISE' | 'MASSIVE';

/**
 * Point-in-time process and host resource sample.
 *
 * Memory figures are rounded mebibytes. `isMemoryConstrained` is true when RSS
 * exceeds the governor's RSS threshold or heap use exceeds its heap threshold;
 * `isCpuConstrained` is true when the 1-minute load average exceeds 85% of the
 * available CPU count.
 */
export interface SystemResourceMetrics {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    cpuCount: number;
    loadAvg1m: number;
    isMemoryConstrained: boolean;
    isCpuConstrained: boolean;
}

/**
 * Effective throttling policy for one scan decision.
 *
 * `maxDeepConcurrency` caps parallel deep passes, `yieldIntervalMs` is the
 * cooperative yield cadence, `throttleDeepTrack` asks the caller to throttle the
 * DeepTrack stage, and `reason` is a human-readable explanation. Memory pressure
 * dominates CPU pressure when both are present.
 */
export interface GovernancePolicy {
    scaleGrade: GovernorScaleGrade;
    maxDeepConcurrency: number;
    yieldIntervalMs: number;
    throttleDeepTrack: boolean;
    reason: string;
}

/**
 * Grades project scale and derives resource-aware concurrency limits.
 *
 * Computations are synchronous and side-effect free, reading only `process` and
 * `os` counters, so calls are reentrant and instances are safe to share while
 * the readonly thresholds stay untouched.
 *
 * @param rssThresholdMb - RSS ceiling in MiB before memory pressure is flagged.
 * @param heapThresholdMb - Heap-used ceiling in MiB before memory pressure is flagged.
 */
export class LoadGovernor {
    private readonly rssThresholdMb: number;
    private readonly heapThresholdMb: number;

    constructor(
        rssThresholdMb: number = DEFAULT_RSS_THRESHOLD_MB,
        heapThresholdMb: number = DEFAULT_HEAP_THRESHOLD_MB,
    ) {
        this.rssThresholdMb = rssThresholdMb;
        this.heapThresholdMb = heapThresholdMb;
    }

    /**
     * Determine project scale grade based on file count.
     *
     * Boundaries are fixed: below 50 files is MICRO, up to 500 is STANDARD, up to
     * 5000 is ENTERPRISE, and anything above is MASSIVE.
     *
     * @param fileCount - Number of files in the project; counts below 50 (including zero)
     *                    map to MICRO.
     * @returns The matching scale grade.
     */
    getScaleGrade(fileCount: number): GovernorScaleGrade {
        if (fileCount < MICRO_MAX_FILES) return 'MICRO';
        if (fileCount <= STANDARD_MAX_FILES) return 'STANDARD';
        if (fileCount <= ENTERPRISE_MAX_FILES) return 'ENTERPRISE';
        return 'MASSIVE';
    }

    /**
     * Sample current memory and CPU metrics.
     *
     * Reads `process.memoryUsage()` and `os.loadavg()` synchronously. The load
     * average is unavailable on some platforms and falls back to 0, and a CPU
     * count of at least 1 is assumed.
     *
     * @returns Resource snapshot with rounded MiB figures and pressure flags.
     */
    sampleMetrics(): SystemResourceMetrics {
        const mem = process.memoryUsage();
        const rssMb = Math.round(mem.rss / BYTES_PER_MEBIBYTE);
        const heapUsedMb = Math.round(mem.heapUsed / BYTES_PER_MEBIBYTE);
        const heapTotalMb = Math.round(mem.heapTotal / BYTES_PER_MEBIBYTE);
        const cpuCount = os.cpus().length || 1;
        const loadAvg = typeof os.loadavg === 'function' ? os.loadavg()[0] || 0 : 0;

        const isMemoryConstrained =
            rssMb > this.rssThresholdMb || heapUsedMb > this.heapThresholdMb;
        const isCpuConstrained = loadAvg > cpuCount * 0.85;

        return {
            rssMb,
            heapUsedMb,
            heapTotalMb,
            cpuCount,
            loadAvg1m: Number(loadAvg.toFixed(2)),
            isMemoryConstrained,
            isCpuConstrained,
        };
    }

    /**
     * Evaluate governance policy given project scale and live system pressure.
     *
     * Starts from the scale-specific concurrency and yield defaults, then clamps
     * concurrency to 1 under memory pressure or roughly halves it (floored, never
     * below 1) under CPU pressure; memory pressure takes precedence when both
     * are detected.
     *
     * @param fileCount - Number of files used to pick the baseline scale grade.
     * @returns Effective policy; never throws and always returns a value.
     */
    evaluatePolicy(fileCount: number): GovernancePolicy {
        const grade = this.getScaleGrade(fileCount);
        const metrics = this.sampleMetrics();

        let maxDeepConcurrency = DEFAULT_MAX_DEEP_CONCURRENCY;
        let yieldIntervalMs = DEFAULT_YIELD_INTERVAL_MS;
        let throttleDeepTrack = false;
        let reason = `Normal governance for ${grade} scale`;

        switch (grade) {
            case 'MICRO':
                maxDeepConcurrency = 1;
                yieldIntervalMs = MICRO_YIELD_INTERVAL_MS;
                break;
            case 'STANDARD':
                maxDeepConcurrency = Math.min(
                    STANDARD_MAX_DEEP_CONCURRENCY,
                    Math.max(1, metrics.cpuCount - 1),
                );
                yieldIntervalMs = STANDARD_YIELD_INTERVAL_MS;
                break;
            case 'ENTERPRISE':
                maxDeepConcurrency = Math.min(
                    ENTERPRISE_MAX_DEEP_CONCURRENCY,
                    Math.max(2, metrics.cpuCount - 1),
                );
                yieldIntervalMs = ENTERPRISE_YIELD_INTERVAL_MS;
                break;
            case 'MASSIVE':
                maxDeepConcurrency = Math.min(
                    MASSIVE_MAX_DEEP_CONCURRENCY,
                    Math.max(2, metrics.cpuCount - 2),
                );
                yieldIntervalMs = MASSIVE_YIELD_INTERVAL_MS;
                break;
        }

        if (metrics.isMemoryConstrained) {
            throttleDeepTrack = true;
            maxDeepConcurrency = 1;
            yieldIntervalMs = MEMORY_PRESSURE_YIELD_INTERVAL_MS;
            reason = `Memory pressure detected (RSS=${metrics.rssMb}MB, Heap=${metrics.heapUsedMb}MB); throttling DeepTrack`;
        } else if (metrics.isCpuConstrained) {
            maxDeepConcurrency = Math.max(1, Math.floor(maxDeepConcurrency / 2));
            reason = `CPU pressure detected (Load=${metrics.loadAvg1m}/${metrics.cpuCount}); reducing concurrency`;
        }

        return {
            scaleGrade: grade,
            maxDeepConcurrency,
            yieldIntervalMs,
            throttleDeepTrack,
            reason,
        };
    }

    /**
     * Cooperative multitasking helper: yields control back to event loop if execution
     * slice exceeded.
     *
     * The returned promise is resolved through `setImmediate`, so awaiting it lets
     * queued macrotasks run before the caller resumes. The helper is reentrant,
     * holds no locks, and never rejects.
     *
     * @returns Promise resolved on the next event-loop tick.
     */
    async yieldEventLoop(): Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
    }
}
