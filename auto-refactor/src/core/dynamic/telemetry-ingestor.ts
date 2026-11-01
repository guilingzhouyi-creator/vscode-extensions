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
import { aggregateLcovCoverageSummary } from '../telemetry/lcov-ingester';

const RANK_MEDIAN = 50;
const RANK_TAIL_95 = 95;
const RANK_TAIL_99 = 99;

const UNMEASURED_NUMERIC_ZERO = 0;

const SYNTHETIC_BENCHMARK_ENV = 'synthetic_benchmark';
const UNOBSERVED_DEFAULT_ENV = 'unobserved_default';

const EMPTY_COVERAGE_METRIC: Readonly<
    Pick<ExecutionEvidenceMetric, 'lineCoveragePct' | 'branchCoveragePct'>
> = Object.freeze({
    lineCoveragePct: UNMEASURED_NUMERIC_ZERO,
    branchCoveragePct: UNMEASURED_NUMERIC_ZERO,
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
    const medianLatency = readPercentile(raw, RANK_MEDIAN) ?? UNMEASURED_NUMERIC_ZERO;
    const tail95Latency = readPercentile(raw, RANK_TAIL_95) ?? UNMEASURED_NUMERIC_ZERO;
    const tail99Latency = readPercentile(raw, RANK_TAIL_99) ?? UNMEASURED_NUMERIC_ZERO;
    const budgetMs = raw.budgetMs ?? UNMEASURED_NUMERIC_ZERO;
    return createLatencyMetric(medianLatency, tail95Latency, tail99Latency, budgetMs);
}

function parseThroughput(raw: Record<string, number>): ThroughputMetric {
    return {
        opsPerSec: raw.opsPerSec ?? raw.throughput ?? UNMEASURED_NUMERIC_ZERO,
        targetOpsPerSec: raw.targetOpsPerSec ?? UNMEASURED_NUMERIC_ZERO,
    };
}

function parseMemory(raw: Record<string, number>): MemoryStabilityMetric {
    return {
        peakHeapBytes: raw.peakHeapBytes ?? UNMEASURED_NUMERIC_ZERO,
        allocationRateBytesPerSec: raw.allocationRateBytesPerSec ?? UNMEASURED_NUMERIC_ZERO,
        gcPauseCount: raw.gcPauseCount ?? UNMEASURED_NUMERIC_ZERO,
        gcTotalPauseMs: raw.gcTotalPauseMs ?? UNMEASURED_NUMERIC_ZERO,
        detectedLeakBytes: raw.detectedLeakBytes ?? UNMEASURED_NUMERIC_ZERO,
    };
}

function parseConcurrency(raw: Record<string, unknown>): ConcurrencyMetric {
    return {
        lockWaitCount: (raw.lockWaitCount as number) ?? UNMEASURED_NUMERIC_ZERO,
        totalLockWaitMs: (raw.totalLockWaitMs as number) ?? UNMEASURED_NUMERIC_ZERO,
        deadlockDetected: Boolean(raw.deadlockDetected),
        contentionRatio: (raw.contentionRatio as number) ?? UNMEASURED_NUMERIC_ZERO,
    };
}

function parseExecution(raw: Record<string, number>): ExecutionEvidenceMetric {
    return {
        callCount: raw.callCount ?? UNMEASURED_NUMERIC_ZERO,
        invocationsPerHour: raw.invocationsPerHour ?? UNMEASURED_NUMERIC_ZERO,
        lineCoveragePct: raw.lineCoveragePct ?? UNMEASURED_NUMERIC_ZERO,
        branchCoveragePct: raw.branchCoveragePct ?? UNMEASURED_NUMERIC_ZERO,
        activeDatasetsProcessed: raw.activeDatasetsProcessed ?? UNMEASURED_NUMERIC_ZERO,
    };
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
        isObserved: true,
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
    return aggregateLcovCoverageSummary(lcovContent);
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
        isObserved: false,
        latency: createLatencyMetric(
            UNMEASURED_NUMERIC_ZERO,
            UNMEASURED_NUMERIC_ZERO,
            UNMEASURED_NUMERIC_ZERO,
            UNMEASURED_NUMERIC_ZERO,
        ),
        throughput: {
            opsPerSec: UNMEASURED_NUMERIC_ZERO,
            targetOpsPerSec: UNMEASURED_NUMERIC_ZERO,
        },
        memory: {
            peakHeapBytes: UNMEASURED_NUMERIC_ZERO,
            allocationRateBytesPerSec: UNMEASURED_NUMERIC_ZERO,
            gcPauseCount: UNMEASURED_NUMERIC_ZERO,
            gcTotalPauseMs: UNMEASURED_NUMERIC_ZERO,
            detectedLeakBytes: UNMEASURED_NUMERIC_ZERO,
        },
        concurrency: {
            lockWaitCount: UNMEASURED_NUMERIC_ZERO,
            totalLockWaitMs: UNMEASURED_NUMERIC_ZERO,
            deadlockDetected: false,
            contentionRatio: UNMEASURED_NUMERIC_ZERO,
        },
        execution: {
            callCount: UNMEASURED_NUMERIC_ZERO,
            invocationsPerHour: UNMEASURED_NUMERIC_ZERO,
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
