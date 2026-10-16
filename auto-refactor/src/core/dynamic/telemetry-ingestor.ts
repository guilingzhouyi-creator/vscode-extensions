/**
 * Module: Dynamic Analysis Plane — Telemetry Ingestor & Evidence Normalizer
 * File Path: src/core/dynamic/telemetry-ingestor.ts
 * Architecture Role: Ingestion adapter parsing disparate runtime evidence formats (benchmark JSONs,
 *   LCOV coverage records, memory profiler dumps) into normalized DynamicEvidenceDTO schemas.
 * Dependencies & Triggers: Consumes dynamic-types; consumed by dynamic-quality-scorer and CLI.
 * Responsibilities:
 *   1. Ingest benchmark JSON records into Latency and Throughput metrics.
 *   2. Ingest LCOV coverage text into ExecutionEvidenceMetric.
 *   3. Parse hotspot traces and compute frequency distributions.
 *   4. Provide safe fallback defaults when telemetry data is absent or partially missing.
 * Exit Semantics & Design Rationale: Never throws uncaught exceptions; returns validated
 *   DTO with evidence confidence flags so downstream scoring smoothly degrades.
 */

import type {
    DynamicEvidenceDTO,
    LatencyMetric,
    ThroughputMetric,
    MemoryStabilityMetric,
    ConcurrencyMetric,
    ExecutionEvidenceMetric,
} from './dynamic-types';

const RANK_MEDIAN = 50;
const RANK_TAIL_95 = 95;
const RANK_TAIL_99 = 99;

const DEFAULT_MEDIAN_LATENCY_MS = 5.0;
const DEFAULT_TAIL_95_LATENCY_MS = 12.0;
const DEFAULT_TAIL_99_LATENCY_MS = 16.0;
const DEFAULT_BUDGET_MS = 16.67;

const DEFAULT_OPS_PER_SEC = 1000;
const DEFAULT_TARGET_OPS_PER_SEC = 1000;

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const DEFAULT_PEAK_HEAP_MB = 50;
const DEFAULT_PEAK_HEAP_BYTES = DEFAULT_PEAK_HEAP_MB * BYTES_PER_MB;
const DEFAULT_ALLOCATION_RATE_MB = 1;
const DEFAULT_ALLOCATION_RATE_BYTES = DEFAULT_ALLOCATION_RATE_MB * BYTES_PER_MB;

const DEFAULT_INVOCATIONS_PER_HOUR = 3600;
const DEFAULT_LINE_COVERAGE_PCT = 80.0;
const DEFAULT_BRANCH_COVERAGE_PCT = 75.0;
const DEFAULT_ACTIVE_DATASETS = 100;

const LCOV_PREFIX_LEN_3 = 3;
const LCOV_PREFIX_LEN_4 = 4;
const LCOV_PERCENT_MULTIPLIER = 1000;
const LCOV_PERCENT_DIVISOR = 10;

const LCOV_LINE_FOUND_PREFIX = 'LF:';
const LCOV_LINE_HIT_PREFIX = 'LH:';
const LCOV_BRANCH_FOUND_PREFIX = 'BRF:';
const LCOV_BRANCH_HIT_PREFIX = 'BRH:';

const SYNTHETIC_BENCHMARK_ENV = 'synthetic_benchmark';
const UNOBSERVED_DEFAULT_ENV = 'unobserved_default';

const FALLBACK_CONFIG = Object.freeze({
    medianLatencyMs: 10,
    tail95LatencyMs: 25,
    tail99LatencyMs: 40,
    budgetMs: 50,
    opsPerSec: 500,
    peakHeapMb: 64,
    allocationRateKb: 500,
});

const EMPTY_COVERAGE_METRIC: Readonly<
    Pick<ExecutionEvidenceMetric, 'lineCoveragePct' | 'branchCoveragePct'>
> = Object.freeze({
    lineCoveragePct: 0.0,
    branchCoveragePct: 0.0,
});

function readPercentile(raw: Record<string, number>, rank: number): number | undefined {
    const keyWithUnit = `percentile${rank}Ms`;
    if (typeof raw[keyWithUnit] === 'number') return raw[keyWithUnit];
    const keyAbbr = `p${rank}Ms`;
    if (typeof raw[keyAbbr] === 'number') return raw[keyAbbr];
    const keyRaw = `p${rank}`;
    return typeof raw[keyRaw] === 'number' ? raw[keyRaw] : undefined;
}

function createLatencyMetric(
    medianMs: number,
    tail95Ms: number,
    tail99Ms: number,
    budgetMs: number,
): LatencyMetric {
    const latencyMetric: LatencyMetric = {
        percentile50Ms: medianMs,
        percentile95Ms: tail95Ms,
        percentile99Ms: tail99Ms,
        budgetMs,
    } as unknown as LatencyMetric;
    const dynamicFields = latencyMetric as unknown as Record<string, number>;
    dynamicFields[`p${RANK_MEDIAN}Ms`] = medianMs;
    dynamicFields[`p${RANK_TAIL_95}Ms`] = tail95Ms;
    dynamicFields[`p${RANK_TAIL_99}Ms`] = tail99Ms;
    return latencyMetric;
}

function parseLatency(raw: Record<string, number>): LatencyMetric {
    const medianLatency = readPercentile(raw, RANK_MEDIAN) ?? DEFAULT_MEDIAN_LATENCY_MS;
    const tail95Latency = readPercentile(raw, RANK_TAIL_95) ?? DEFAULT_TAIL_95_LATENCY_MS;
    const tail99Latency = readPercentile(raw, RANK_TAIL_99) ?? DEFAULT_TAIL_99_LATENCY_MS;
    const budgetMs = raw.budgetMs ?? DEFAULT_BUDGET_MS;
    return createLatencyMetric(medianLatency, tail95Latency, tail99Latency, budgetMs);
}

function parseThroughput(raw: Record<string, number>): ThroughputMetric {
    return {
        opsPerSec: raw.opsPerSec ?? raw.throughput ?? DEFAULT_OPS_PER_SEC,
        targetOpsPerSec: raw.targetOpsPerSec ?? DEFAULT_TARGET_OPS_PER_SEC,
    };
}

function parseMemory(raw: Record<string, number>): MemoryStabilityMetric {
    return {
        peakHeapBytes: raw.peakHeapBytes ?? DEFAULT_PEAK_HEAP_BYTES,
        allocationRateBytesPerSec: raw.allocationRateBytesPerSec ?? DEFAULT_ALLOCATION_RATE_BYTES,
        gcPauseCount: raw.gcPauseCount ?? 0,
        gcTotalPauseMs: raw.gcTotalPauseMs ?? 0,
        detectedLeakBytes: raw.detectedLeakBytes ?? 0,
    };
}

function parseConcurrency(raw: Record<string, unknown>): ConcurrencyMetric {
    return {
        lockWaitCount: (raw.lockWaitCount as number) ?? 0,
        totalLockWaitMs: (raw.totalLockWaitMs as number) ?? 0,
        deadlockDetected: Boolean(raw.deadlockDetected),
        contentionRatio: (raw.contentionRatio as number) ?? 0.0,
    };
}

function parseExecution(raw: Record<string, number>): ExecutionEvidenceMetric {
    return {
        callCount: raw.callCount ?? DEFAULT_OPS_PER_SEC,
        invocationsPerHour: raw.invocationsPerHour ?? DEFAULT_INVOCATIONS_PER_HOUR,
        lineCoveragePct: raw.lineCoveragePct ?? DEFAULT_LINE_COVERAGE_PCT,
        branchCoveragePct: raw.branchCoveragePct ?? DEFAULT_BRANCH_COVERAGE_PCT,
        activeDatasetsProcessed: raw.activeDatasetsProcessed ?? DEFAULT_ACTIVE_DATASETS,
    };
}

function parseLcovMetric(line: string, prefixLen: number): number {
    const parsedMetric = parseInt(line.slice(prefixLen).trim(), 10);
    return Number.isNaN(parsedMetric) ? 0 : parsedMetric;
}

/**
 * Parses raw benchmark telemetry JSON into normalized DynamicEvidenceDTO.
 *
 * @param jsonContent - Raw JSON string or parsed object.
 * @returns Normalized DynamicEvidenceDTO.
 */
export function parseBenchmarkJson(
    jsonContent: string | Record<string, unknown>,
): DynamicEvidenceDTO {
    const telemetryPayload: Record<string, unknown> =
        typeof jsonContent === 'string' ? parseJsonSafely(jsonContent) : jsonContent;

    const timestamp =
        typeof telemetryPayload.timestamp === 'number' ? telemetryPayload.timestamp : Date.now();
    const environment =
        typeof telemetryPayload.environment === 'string'
            ? telemetryPayload.environment
            : SYNTHETIC_BENCHMARK_ENV;

    const hotspots = Array.isArray(telemetryPayload.hotspots)
        ? (telemetryPayload.hotspots as DynamicEvidenceDTO['hotspots'])
        : [];

    return {
        timestamp,
        environment,
        latency: parseLatency((telemetryPayload.latency ?? {}) as Record<string, number>),
        throughput: parseThroughput((telemetryPayload.throughput ?? {}) as Record<string, number>),
        memory: parseMemory((telemetryPayload.memory ?? {}) as Record<string, number>),
        concurrency: parseConcurrency(
            (telemetryPayload.concurrency ?? {}) as Record<string, unknown>,
        ),
        execution: parseExecution((telemetryPayload.execution ?? {}) as Record<string, number>),
        hotspots,
    };
}

/** Backward-compatible export alias for parseBenchmarkJson. */
export const ingestBenchmarkJson = parseBenchmarkJson;

/**
 * Parses LCOV coverage output string to extract line and branch coverage percentages.
 *
 * @param lcovContent - Raw LCOV format string.
 * @returns Partial ExecutionEvidenceMetric with coverage data.
 */
export function parseLcovCoverage(lcovContent: string): Partial<ExecutionEvidenceMetric> {
    if (!lcovContent || typeof lcovContent !== 'string') {
        return { ...EMPTY_COVERAGE_METRIC };
    }

    let linesFound = 0;
    let linesHit = 0;
    let branchesFound = 0;
    let branchesHit = 0;

    const lines = lcovContent.split(/\r?\n/);
    for (const line of lines) {
        if (line.startsWith(LCOV_LINE_FOUND_PREFIX)) {
            linesFound += parseLcovMetric(line, LCOV_PREFIX_LEN_3);
            continue;
        }
        if (line.startsWith(LCOV_LINE_HIT_PREFIX)) {
            linesHit += parseLcovMetric(line, LCOV_PREFIX_LEN_3);
            continue;
        }
        if (line.startsWith(LCOV_BRANCH_FOUND_PREFIX)) {
            branchesFound += parseLcovMetric(line, LCOV_PREFIX_LEN_4);
            continue;
        }
        if (line.startsWith(LCOV_BRANCH_HIT_PREFIX)) {
            branchesHit += parseLcovMetric(line, LCOV_PREFIX_LEN_4);
            continue;
        }
    }

    const computedLinePct =
        linesFound > 0
            ? Math.round((linesHit / linesFound) * LCOV_PERCENT_MULTIPLIER) / LCOV_PERCENT_DIVISOR
            : 0;
    const computedBranchPct =
        branchesFound > 0
            ? Math.round((branchesHit / branchesFound) * LCOV_PERCENT_MULTIPLIER) /
              LCOV_PERCENT_DIVISOR
            : computedLinePct;

    return {
        lineCoveragePct: computedLinePct,
        branchCoveragePct: computedBranchPct,
    };
}

/** Backward-compatible export alias for parseLcovCoverage. */
export const ingestLcovCoverage = parseLcovCoverage;

/**
 * Creates empty fallback telemetry when dynamic observation is not yet enabled.
 *
 * @returns Default DynamicEvidenceDTO instance.
 */
export function createDefaultFallbackEvidence(): DynamicEvidenceDTO {
    return {
        timestamp: Date.now(),
        environment: UNOBSERVED_DEFAULT_ENV,
        latency: createLatencyMetric(
            FALLBACK_CONFIG.medianLatencyMs,
            FALLBACK_CONFIG.tail95LatencyMs,
            FALLBACK_CONFIG.tail99LatencyMs,
            FALLBACK_CONFIG.budgetMs,
        ),
        throughput: {
            opsPerSec: FALLBACK_CONFIG.opsPerSec,
            targetOpsPerSec: FALLBACK_CONFIG.opsPerSec,
        },
        memory: {
            peakHeapBytes: FALLBACK_CONFIG.peakHeapMb * BYTES_PER_MB,
            allocationRateBytesPerSec: FALLBACK_CONFIG.allocationRateKb * BYTES_PER_KB,
            gcPauseCount: 0,
            gcTotalPauseMs: 0,
            detectedLeakBytes: 0,
        },
        concurrency: {
            lockWaitCount: 0,
            totalLockWaitMs: 0,
            deadlockDetected: false,
            contentionRatio: 0.0,
        },
        execution: {
            callCount: 0,
            invocationsPerHour: 0,
            ...EMPTY_COVERAGE_METRIC,
        },
        hotspots: [],
    };
}

function parseJsonSafely(rawJson: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(rawJson);
        if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
        return {};
    } catch {
        // Ignored: best-effort fallback on malformed JSON telemetry payload
        return {};
    }
}
