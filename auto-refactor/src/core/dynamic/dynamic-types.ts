/**
 * Module: Dynamic Analysis Plane — Telemetry Contracts & Dynamic Risk Quantification
 * File Path: src/core/dynamic/dynamic-types.ts
 * Architecture Role: Single source of truth for the Dynamic Analysis Plane (DAP) data contracts;
 *   formalizes dynamic metric vectors Q_d = f(L, T, M, C, E), dynamic risk formula
 *   D_i = B_i * F_i * R_i * V_i, and the standardized DynamicEvidenceDTO ingestion format.
 * Dependencies & Triggers: Imports nothing; consumed by telemetry-ingestor, dynamic-quality-scorer,
 *   and feedback fusion engine.
 * Responsibilities:
 *   1. Define telemetry metrics: Latency (L), Throughput (T), Memory (M), Concurrency (C),
 *      and Execution Evidence (E).
 *   2. Define DynamicQualityVector Q_d and its default balancing weights.
 *   3. Define DynamicRiskParams and DynamicIssueRisk for runtime hotspot risk quantification.
 *   4. Define DynamicEvidenceDTO for agnostic telemetry ingestion (benchmarks, coverage, profilers).
 * Exit Semantics & Design Rationale: Pure types and constants; bounded scores [0.0, 100.0] and
 *   normalized risks [0.0, 10.0]; zero side-effects.
 */

/**
 * Latency metrics (L) capturing response duration and tail SLAs.
 */
export interface LatencyMetric {
    /** 50th percentile (median) latency in milliseconds */
    p50Ms: number;
    /** 95th percentile latency in milliseconds */
    p95Ms: number;
    /** 99th percentile (tail) latency in milliseconds */
    p99Ms: number;
    /** Target p99 SLA budget in milliseconds (default: 16.67ms for 60 FPS UI/game, or 100ms for services) */
    budgetMs?: number;
}

/**
 * Throughput metrics (T) measuring operations capacity.
 */
export interface ThroughputMetric {
    /** Realized throughput in operations per second */
    opsPerSec: number;
    /** Target baseline operations per second */
    targetOpsPerSec?: number;
}

/**
 * Memory stability metrics (M) capturing allocation rate and GC pressure.
 */
export interface MemoryStabilityMetric {
    /** Peak heap memory usage in bytes */
    peakHeapBytes: number;
    /** Allocation velocity in bytes per second */
    allocationRateBytesPerSec: number;
    /** Number of garbage collection pause events */
    gcPauseCount: number;
    /** Total cumulative garbage collection pause time in milliseconds */
    gcTotalPauseMs: number;
    /** Measured progressive memory leak in bytes */
    detectedLeakBytes?: number;
}

/**
 * Concurrency and lock contention metrics (C).
 */
export interface ConcurrencyMetric {
    /** Number of lock acquisition wait events */
    lockWaitCount: number;
    /** Total cumulative lock wait duration in milliseconds */
    totalLockWaitMs: number;
    /** Flag indicating whether thread deadlock / livelock was detected */
    deadlockDetected: boolean;
    /** Contention ratio: lock wait time / total CPU time (0.0 to 1.0) */
    contentionRatio: number;
}

/**
 * Execution evidence metrics (E) capturing invocation frequency and code coverage.
 */
export interface ExecutionEvidenceMetric {
    /** Total runtime invocation count */
    callCount: number;
    /** Average invocations per hour in production / benchmark conditions */
    invocationsPerHour: number;
    /** Line code coverage percentage (0.0 to 100.0) */
    lineCoveragePct: number;
    /** Branch code coverage percentage (0.0 to 100.0) */
    branchCoveragePct: number;
    /** Size of dataset processed during invocation */
    activeDatasetsProcessed?: number;
}

/**
 * Five-dimensional dynamic quality vector Q_d = (L, T, M, C, E).
 * Scaled between 0.0 and 100.0.
 */
export interface DynamicQualityVector {
    /** L: Latency Stability */
    L: number;
    /** T: Throughput Capacity */
    T: number;
    /** M: Memory & GC Stability */
    M: number;
    /** C: Concurrency & Lock Safety */
    C: number;
    /** E: Execution Evidence Depth */
    E: number;
}

/**
 * Dimension keys for the dynamic quality vector.
 */
export type DynamicQualityAxis = keyof DynamicQualityVector;

/**
 * Canonical ordered list of dynamic quality axes.
 */
export const ALL_DYNAMIC_QUALITY_AXES: readonly DynamicQualityAxis[] = [
    'L',
    'T',
    'M',
    'C',
    'E',
] as const;

/**
 * Balanced default weights for the dynamic quality vector (sum = 1.0).
 */
export const DEFAULT_DYNAMIC_WEIGHTS: Readonly<Record<DynamicQualityAxis, number>> = {
    L: 0.25,
    T: 0.2,
    M: 0.25,
    C: 0.15,
    E: 0.15,
};

/**
 * Parameters for evaluating runtime hotspot dynamic risk:
 * D_i = B_i * F_i * R_i * V_i
 */
export interface DynamicRiskParams {
    /** B_i: Behavioral blast radius (1.0 <= B_i <= 5.0), default 2.0 */
    behavioralScope?: number;
    /** Realized invocations per hour used to compute F_i */
    invocationsPerHour?: number;
    /** Explicit F_i: Frequency factor (0.1 <= F_i <= 10.0) */
    frequencyFactor?: number;
    /** R_i: Resource consumption multiplier (1.0 <= R_i <= 10.0), e.g. CPU or GC % */
    resourceConsumption?: number;
    /** V_i: Business value sensitivity (1.0 <= V_i <= 5.0), e.g. 5.0 for transaction path */
    businessSensitivity?: number;
}

/**
 * Quantified dynamic risk evaluation for an individual hotspot or runtime trace.
 */
export interface DynamicIssueRisk {
    hotspotId: string;
    targetSymbol?: string;
    filePath?: string;
    line?: number;
    /** B_i: Behavioral scope */
    B: number;
    /** F_i: Logarithmic invocation frequency factor */
    F: number;
    /** R_i: Resource consumption */
    R: number;
    /** V_i: Business sensitivity */
    V: number;
    /** Raw dynamic risk: D_i = B_i * F_i * R_i * V_i */
    rawRisk: number;
    /** Normalized risk on standard scale [0.0, 10.0] */
    normalizedRisk: number;
    /** Evidence confidence (0.0 if purely hypothetical, 1.0 if backed by runtime traces) */
    evidenceConfidence: number;
}

/**
 * Ingestible runtime telemetry snapshot schema.
 */
export interface DynamicEvidenceDTO {
    /** Observation capture timestamp (epoch ms) */
    timestamp: number;
    /** Host environment identifier (e.g. production, ci_benchmark, load_test) */
    environment?: string;
    /** Latency measurements */
    latency?: Partial<LatencyMetric>;
    /** Throughput measurements */
    throughput?: Partial<ThroughputMetric>;
    /** Memory stability measurements */
    memory?: Partial<MemoryStabilityMetric>;
    /** Concurrency measurements */
    concurrency?: Partial<ConcurrencyMetric>;
    /** Code coverage & execution metrics */
    execution?: Partial<ExecutionEvidenceMetric>;
    /** Hotspot traces identifying performance sinks */
    hotspots?: Array<{
        symbol: string;
        file: string;
        line?: number;
        invocations: number;
        cpuSharePct: number;
        memoryAllocBytes?: number;
        avgLatencyMs?: number;
        businessSensitivity?: number;
    }>;
}
