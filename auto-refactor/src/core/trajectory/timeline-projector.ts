/**
 * Module: Core Trajectory — Streaming Timeline Projector (Multi-Scale Telemetry)
 * File Path: src/core/trajectory/timeline-projector.ts
 * Architecture Role: In-memory dynamic timeline projection engine. Reads raw NDJSON streams
 *   using dual-tier reverse scanning and aggregates temporal/semantic buckets on-demand.
 * Dependencies & Triggers: Consumes eloc-types; called by CLI trajectory-cmd and reporting engines.
 * Responsibilities: Reverse chunk reading, relative rolling window grouping, hybrid score
 *   folding (latest + semantic-weighted + floor/ceiling range), and adaptive idle bucket folding.
 * Exit Semantics & Design Rationale: Bounded O(1) memory, zero persistent disk mutations,
 *   graceful malformed line isolation without throwing unhandled errors.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CompactTrajectoryRecord } from './eloc-types';

/** Standard reverse read chunk size in bytes (64KB). */
const CHUNK_SIZE_KB = 64;
const BYTES_PER_KB = 1024;
const REVERSE_CHUNK_SIZE = CHUNK_SIZE_KB * BYTES_PER_KB;

/** Active ledger filename. */
const FILE_ACTIVE_RUNS = 'active-runs.ndjson';

/** Archive ledger filename. */
const FILE_ARCHIVE_RUNS = 'archive-runs.ndjson';

/** Multiplier factor for standard two-decimal rounding. */
const ROUNDING_FACTOR_TWO_DECIMALS = 100;
const PERCENT_MULTIPLIER = 100;
const ELOC_KILO_SCALE = 1000;
const QED_PRECISION_SCALE = 1000000;
const IDLE_HOURS_SCALE = 10;
const DAYS_PER_WEEK = 7;
const DEFAULT_AUTO_HOUR_WINDOW = 12;

const BUCKET_TYPE_HOUR = 'hour';
const BUCKET_TYPE_DAY = 'day';
const BUCKET_TYPE_COMMIT = 'commit';
const BUCKET_TYPE_AGENT = 'agent';
const BUCKET_PREFIX_HOUR = 'h';
const BUCKET_PREFIX_DAY = 'd';

/** Milliseconds in standard units. */
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;
const MS_PER_DAY = MS_PER_HOUR * HOURS_PER_DAY;

/** Default query time window: past 24 hours in milliseconds. */
export const DEFAULT_SINCE_DURATION_MS = 86400000;

/** Maximum record scan ceiling to guarantee O(1) memory and avoid runaway reads. */
export const DEFAULT_MAX_SCAN_RECORDS = 2000;

/** Minimal duration to trigger idle bucket compression (2 or more empty steps). */
const MIN_IDLE_BUCKET_FOLD_COUNT = 2;

/**
 * Aggregation dimension identifier.
 */
export type TimelineBucketType = 'hour' | 'day' | 'commit' | 'agent';

/**
 * Multiplier dictionary mapping duration string suffixes to millisecond factors.
 */
const DURATION_MULTIPLIERS: Record<string, number> = {
    s: MS_PER_SECOND,
    sec: MS_PER_SECOND,
    m: MS_PER_MINUTE,
    min: MS_PER_MINUTE,
    h: MS_PER_HOUR,
    hr: MS_PER_HOUR,
    hrs: MS_PER_HOUR,
    d: MS_PER_DAY,
    day: MS_PER_DAY,
    days: MS_PER_DAY,
    w: MS_PER_DAY * DAYS_PER_WEEK,
    week: MS_PER_DAY * DAYS_PER_WEEK,
    weeks: MS_PER_DAY * DAYS_PER_WEEK,
};

/**
 * Query options controlling stream projection and windowing.
 */
export interface TimelineProjectionOptions {
    /** Target repository or ledger directory. */
    ledgerDir: string;
    /** Relative duration string (e.g. '30m', '1h', '6h', '24h', '7d') or millisecond offset. */
    since?: string | number;
    /** Explicit cutoff epoch timestamp in ms (overrides since). */
    cutoffTimeMs?: number;
    /** Grouping dimension (hour, day, commit, agent). Defaults to relative 'hour' or 'day'. */
    bucket?: TimelineBucketType;
    /** Maximum number of raw records to process. Defaults to 2000. */
    maxRecords?: number;
    /** Reference anchor time in ms (defaults to Date.now()). */
    referenceNowMs?: number;
}

/**
 * Folded aggregation snapshot for a single timeline or semantic bucket.
 */
export interface TimelineBucketSnapshot {
    /** Bucket identifier (relative window label, commit revision, or agent ID). */
    bucketId: string;
    /** Window start timestamp in ms. */
    startTimeMs: number;
    /** Window end timestamp in ms. */
    endTimeMs: number;
    /** Whether this entry represents folded consecutive idle intervals. */
    isIdleFold: boolean;
    /** Total number of audit runs in this bucket. */
    runsCount: number;
    /** Cumulative processed ELOC throughput. */
    processedEloc: number;
    /** Cumulative changed ELOC. */
    changedEloc: number;
    /** Pure semantic ELOC changed. */
    semanticEloc: number;
    /** Technical debt points added. */
    debtAdded: number;
    /** Technical debt points resolved. */
    debtResolved: number;
    /** Technical debt regressions detected. */
    debtRegressions: number;
    /** Net technical debt yield (points resolved - added) per kELOC semantic. */
    netDebtYield: number;
    /** Final state quality composite score at end of bucket. */
    latestScore: number;
    /** Semantic-weighted mean composite score across runs in bucket. */
    weightedMeanScore: number;
    /** Minimum score observed in bucket. */
    scoreFloor: number;
    /** Maximum score observed in bucket. */
    scoreCeiling: number;
    /** Gate pass rate percentage [0.0, 100.0]. */
    gatePassRate: number;
    /** Mean QED derivative. */
    meanQed: number;
}

/**
 * Full projected timeline summary report.
 */
export interface TimelineProjectionReport {
    /** Reference anchor epoch time in ms. */
    referenceNowMs: number;
    /** Actual cutoff timestamp in ms used for filtering. */
    cutoffTimeMs: number;
    /** Grouping bucket type applied. */
    bucketType: TimelineBucketType;
    /** Total raw valid records evaluated within window. */
    totalSampledRuns: number;
    /** Total malformed/corrupted lines isolated and skipped. */
    malformedLinesCount: number;
    /** Cumulative semantic ELOC in window. */
    totalSemanticEloc: number;
    /** Cumulative net technical debt cleared in window. */
    netDebtCleared: number;
    /** Ordered timeline snapshots (newest to oldest). */
    buckets: TimelineBucketSnapshot[];
}

/**
 * Parses duration string (e.g. '30m', '2h', '24h', '7d') into milliseconds.
 *
 * @param duration Duration string or numerical milliseconds.
 * @returns Parsed duration in milliseconds.
 */
export function parseDurationToMs(duration?: string | number): number {
    if (typeof duration === 'number') {
        return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_SINCE_DURATION_MS;
    }
    if (!duration || typeof duration !== 'string') {
        return DEFAULT_SINCE_DURATION_MS;
    }

    const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)?$/i.exec(duration.trim());
    if (!match) {
        return DEFAULT_SINCE_DURATION_MS;
    }

    const durationQuantity = parseFloat(match[1]);
    const unitKey = (match[2] || 'h').toLowerCase();
    const multiplier = DURATION_MULTIPLIERS[unitKey];
    return multiplier ? Math.round(durationQuantity * multiplier) : DEFAULT_SINCE_DURATION_MS;
}

/**
 * Parses a single NDJSON line and safely accumulates valid records.
 */
function tryParseRecordLine(
    line: string,
    cutoffTimeMs: number,
    accumulator: CompactTrajectoryRecord[],
): { isValid: boolean; reachedCutoff: boolean } {
    try {
        const record = JSON.parse(line) as CompactTrajectoryRecord;
        if (record.t < cutoffTimeMs) {
            return { isValid: true, reachedCutoff: true };
        }
        accumulator.push(record);
        return { isValid: true, reachedCutoff: false };
    } catch {
        return { isValid: false, reachedCutoff: false };
    }
}

/** Query criteria for reading and accumulating trajectory records backwards */
export interface TrajectoryReverseQuery {
    readonly cutoffTimeMs: number;
    readonly maxRecords: number;
    readonly accumulator: CompactTrajectoryRecord[];
}

/** Time boundary and identifier for a timeline bucket */
export interface TimelineBucketBoundary {
    readonly bucketId: string;
    readonly startTimeMs: number;
    readonly endTimeMs: number;
}

/**
 * Asynchronously checks if a file exists without blocking the event loop.
 */
async function checkFileExistsAsync(targetPath: string): Promise<boolean> {
    try {
        await fs.promises.access(targetPath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Parses reverse line slice into accumulator with cutoff checks.
 */
function parseLineBufferReverse(
    lines: string[],
    query: TrajectoryReverseQuery,
    startIndex: number,
    minLineIndex: number = 0,
): { reachedCutoff: boolean; malformedCount: number } {
    let malformedCount = 0;
    for (let i = startIndex; i >= minLineIndex; i--) {
        const line = lines[i].trim();
        if (!line) continue;

        const outcome = tryParseRecordLine(line, query.cutoffTimeMs, query.accumulator);
        if (!outcome.isValid) {
            malformedCount++;
            continue;
        }
        if (outcome.reachedCutoff || query.accumulator.length >= query.maxRecords) {
            return { reachedCutoff: true, malformedCount };
        }
    }
    return { reachedCutoff: false, malformedCount };
}

/**
 * Parses reverse chunk lines in a single buffer segment.
 */
function processChunkTextLines(
    chunkText: string,
    query: TrajectoryReverseQuery,
): { reachedCutoff: boolean; malformedCount: number; leftover: string } {
    const lines = chunkText.split('\n');
    const leftover = lines[0];
    const { reachedCutoff, malformedCount } = parseLineBufferReverse(
        lines,
        query,
        lines.length - 1,
        1,
    );
    return { reachedCutoff, malformedCount, leftover };
}

/**
 * Helper reading archive file chunks in reverse order using seek file descriptors.
 */
async function readArchiveChunksReverse(
    archivePath: string,
    query: TrajectoryReverseQuery,
): Promise<number> {
    let malformedCount = 0;
    let fileHandle: fs.promises.FileHandle | null = null;
    const chunkBuffer = Buffer.alloc(REVERSE_CHUNK_SIZE);

    try {
        const stats = await fs.promises.stat(archivePath);
        if (stats.size === 0) return malformedCount;

        fileHandle = await fs.promises.open(archivePath, 'r');
        let currentFilePosition = stats.size;
        let pendingLineSegment = '';

        while (currentFilePosition > 0 && query.accumulator.length < query.maxRecords) {
            const readSize = Math.min(REVERSE_CHUNK_SIZE, currentFilePosition);
            currentFilePosition -= readSize;

            const { bytesRead } = await fileHandle.read(
                chunkBuffer,
                0,
                readSize,
                currentFilePosition,
            );
            const chunkText = chunkBuffer.toString('utf8', 0, bytesRead) + pendingLineSegment;

            const parseResult = processChunkTextLines(chunkText, query);
            malformedCount += parseResult.malformedCount;
            pendingLineSegment = parseResult.leftover;

            if (parseResult.reachedCutoff) break;
        }

        if (pendingLineSegment.trim() && query.accumulator.length < query.maxRecords) {
            const outcome = tryParseRecordLine(
                pendingLineSegment.trim(),
                query.cutoffTimeMs,
                query.accumulator,
            );
            if (!outcome.isValid) malformedCount++;
        }
    } catch {
        // Ignored: tolerate archive I/O failure on non-critical read
    } finally {
        if (fileHandle) {
            await fileHandle.close().catch(() => {});
        }
    }

    return malformedCount;
}

/**
 * Reads lines in active-runs.ndjson in reverse order.
 */
async function readActiveLedgerReverse(
    activePath: string,
    query: TrajectoryReverseQuery,
): Promise<{ reachedCutoff: boolean; earliestTimestamp: number; malformedCount: number }> {
    let malformedCount = 0;
    let earliestTimestamp = Infinity;

    if (!(await checkFileExistsAsync(activePath))) {
        return { reachedCutoff: false, earliestTimestamp, malformedCount };
    }

    try {
        const activeContent = await fs.promises.readFile(activePath, 'utf8');
        const lines = activeContent.trim().split('\n');
        const parseResult = parseLineBufferReverse(lines, query, lines.length - 1, 0);
        malformedCount += parseResult.malformedCount;

        for (let i = 0; i < query.accumulator.length; i++) {
            earliestTimestamp = Math.min(earliestTimestamp, query.accumulator[i].t);
        }

        if (parseResult.reachedCutoff || query.accumulator.length >= query.maxRecords) {
            return { reachedCutoff: true, earliestTimestamp, malformedCount };
        }
    } catch {
        // Ignored: tolerate active ledger read error on non-critical scan
    }

    return { reachedCutoff: false, earliestTimestamp, malformedCount };
}

/**
 * Reads records backwards using a tiered strategy:
 * 1. Read bounded active-runs.ndjson in memory backwards.
 * 2. If timestamp not covered, reverse chunk read archive-runs.ndjson.
 *
 * @param ledgerDir Trajectory storage directory.
 * @param cutoffTimeMs Minimum timestamp to retrieve.
 * @param maxRecords Max record safety limit.
 * @returns Array of records ordered chronologically (oldest to newest) and malformed lines count.
 * ASYNC-CONCURRENCY: read-only over the ledger; the accumulator is call-local.
 */
export async function readRecordsTieredReverse(
    ledgerDir: string,
    cutoffTimeMs: number,
    maxRecords = DEFAULT_MAX_SCAN_RECORDS,
): Promise<{ records: CompactTrajectoryRecord[]; malformedCount: number }> {
    const rawReverseList: CompactTrajectoryRecord[] = [];
    let malformedCount = 0;

    const query: TrajectoryReverseQuery = {
        cutoffTimeMs,
        maxRecords,
        accumulator: rawReverseList,
    };

    const activePath = path.join(ledgerDir, FILE_ACTIVE_RUNS);
    const activeOutcome = await readActiveLedgerReverse(activePath, query);
    malformedCount += activeOutcome.malformedCount;

    if (activeOutcome.reachedCutoff || rawReverseList.length >= maxRecords) {
        return { records: rawReverseList.reverse(), malformedCount };
    }

    const archivePath = path.join(ledgerDir, FILE_ARCHIVE_RUNS);
    if (
        activeOutcome.earliestTimestamp > cutoffTimeMs &&
        (await checkFileExistsAsync(archivePath))
    ) {
        const archiveMalformedCount = await readArchiveChunksReverse(archivePath, query);
        malformedCount += archiveMalformedCount;
    }

    return { records: rawReverseList.reverse(), malformedCount };
}

/** Intermediate bucket aggregation accumulator. */
interface BucketMetricsAccumulator {
    processedEloc: number;
    changedEloc: number;
    semanticEloc: number;
    debtAdded: number;
    debtResolved: number;
    debtRegressions: number;
    gatePassedCount: number;
    scoreFloor: number;
    scoreCeiling: number;
    qedSum: number;
    weightedScoreSum: number;
    unweightedScoreSum: number;
    latestScore: number;
}

function computeBucketMetricsAccumulator(
    records: CompactTrajectoryRecord[],
): BucketMetricsAccumulator {
    let processedEloc = 0;
    let changedEloc = 0;
    let semanticEloc = 0;
    let debtAdded = 0;
    let debtResolved = 0;
    let debtRegressions = 0;
    let gatePassedCount = 0;
    let scoreFloor = Infinity;
    let scoreCeiling = -Infinity;
    let qedSum = 0;

    let weightedScoreSum = 0;
    let unweightedScoreSum = 0;
    let latestScore = records[0].score.aft;
    let latestTimestamp = -Infinity;

    for (const record of records) {
        const recordSemanticEloc = record.eloc.sem;
        const currentScore = record.score.aft;

        processedEloc += record.eloc.proc;
        changedEloc += record.eloc.chg;
        semanticEloc += recordSemanticEloc;

        debtAdded += record.debt.add;
        debtResolved += record.debt.res;
        debtRegressions += record.debt.reg;

        if (record.gate.pass) {
            gatePassedCount++;
        }

        scoreFloor = Math.min(scoreFloor, currentScore);
        scoreCeiling = Math.max(scoreCeiling, currentScore);
        qedSum += record.score.qed;

        weightedScoreSum += currentScore * recordSemanticEloc;
        unweightedScoreSum += currentScore;

        if (record.t >= latestTimestamp) {
            latestTimestamp = record.t;
            latestScore = currentScore;
        }
    }

    return {
        processedEloc,
        changedEloc,
        semanticEloc,
        debtAdded,
        debtResolved,
        debtRegressions,
        gatePassedCount,
        scoreFloor,
        scoreCeiling,
        qedSum,
        weightedScoreSum,
        unweightedScoreSum,
        latestScore,
    };
}

function createZeroBucketSnapshot(options: {
    bucketId: string;
    startTimeMs: number;
    endTimeMs: number;
    isIdleFold: boolean;
}): TimelineBucketSnapshot {
    return {
        bucketId: options.bucketId,
        startTimeMs: options.startTimeMs,
        endTimeMs: options.endTimeMs,
        isIdleFold: options.isIdleFold,
        runsCount: 0,
        processedEloc: 0,
        changedEloc: 0,
        semanticEloc: 0,
        debtAdded: 0,
        debtResolved: 0,
        debtRegressions: 0,
        netDebtYield: 0,
        latestScore: 0,
        weightedMeanScore: 0,
        scoreFloor: 0,
        scoreCeiling: 0,
        gatePassRate: 0,
        meanQed: 0,
    };
}

function createEmptyBucketSnapshot(boundary: TimelineBucketBoundary): TimelineBucketSnapshot {
    return createZeroBucketSnapshot({
        bucketId: boundary.bucketId,
        startTimeMs: boundary.startTimeMs,
        endTimeMs: boundary.endTimeMs,
        isIdleFold: false,
    });
}

/**
 * Accumulates single bucket metrics with hybrid latest and semantic-weighted score.
 */
function aggregateSingleBucket(
    boundary: TimelineBucketBoundary,
    records: CompactTrajectoryRecord[],
): TimelineBucketSnapshot {
    if (records.length === 0) {
        return createEmptyBucketSnapshot(boundary);
    }

    const acc = computeBucketMetricsAccumulator(records);
    const runsCount = records.length;
    const weightedMeanScore =
        acc.semanticEloc > 0
            ? Math.round((acc.weightedScoreSum / acc.semanticEloc) * ROUNDING_FACTOR_TWO_DECIMALS) /
              ROUNDING_FACTOR_TWO_DECIMALS
            : Math.round((acc.unweightedScoreSum / runsCount) * ROUNDING_FACTOR_TWO_DECIMALS) /
              ROUNDING_FACTOR_TWO_DECIMALS;

    const netDebtPoints = acc.debtResolved - acc.debtAdded;
    const netDebtYield =
        acc.semanticEloc > 0
            ? Math.round(
                  (netDebtPoints / (acc.semanticEloc / ELOC_KILO_SCALE)) *
                      ROUNDING_FACTOR_TWO_DECIMALS,
              ) / ROUNDING_FACTOR_TWO_DECIMALS
            : netDebtPoints;

    const gatePassRate =
        Math.round(
            (acc.gatePassedCount / runsCount) * PERCENT_MULTIPLIER * ROUNDING_FACTOR_TWO_DECIMALS,
        ) / ROUNDING_FACTOR_TWO_DECIMALS;

    const meanQed =
        Math.round((acc.qedSum / runsCount) * QED_PRECISION_SCALE) / QED_PRECISION_SCALE;

    return {
        bucketId: boundary.bucketId,
        startTimeMs: boundary.startTimeMs,
        endTimeMs: boundary.endTimeMs,
        isIdleFold: false,
        runsCount,
        processedEloc: acc.processedEloc,
        changedEloc: acc.changedEloc,
        semanticEloc: acc.semanticEloc,
        debtAdded: acc.debtAdded,
        debtResolved: acc.debtResolved,
        debtRegressions: acc.debtRegressions,
        netDebtYield,
        latestScore: acc.latestScore,
        weightedMeanScore,
        scoreFloor: acc.scoreFloor,
        scoreCeiling: acc.scoreCeiling,
        gatePassRate,
        meanQed,
    };
}

/**
 * Mutable bucket container for semantic grouping.
 */
interface SemanticGroupBucket {
    readonly key: string;
    readonly records: CompactTrajectoryRecord[];
    startMs: number;
    endMs: number;
}

/**
 * Groups records into semantic buckets (commit or agent).
 */
function aggregateSemanticBuckets(
    records: CompactTrajectoryRecord[],
    bucketType: 'commit' | 'agent',
    referenceNowMs: number,
): TimelineBucketSnapshot[] {
    const groupMap = new Map<string, SemanticGroupBucket>();

    for (const record of records) {
        const key = bucketType === 'commit' ? record.rev || 'unknown' : record.agent || 'unknown';
        const existing = groupMap.get(key);
        if (existing) {
            existing.records.push(record);
            existing.startMs = Math.min(existing.startMs, record.t);
            existing.endMs = Math.max(existing.endMs, record.t);
        } else {
            groupMap.set(key, {
                key,
                records: [record],
                startMs: record.t,
                endMs: record.t,
            });
        }
    }

    const snapshots: TimelineBucketSnapshot[] = [];
    for (const group of groupMap.values()) {
        snapshots.push(
            aggregateSingleBucket(
                { bucketId: group.key, startTimeMs: group.startMs, endTimeMs: group.endMs },
                group.records,
            ),
        );
    }

    snapshots.sort((a, b) => b.endTimeMs - a.endTimeMs);
    void referenceNowMs;
    return snapshots;
}

/**
 * Step bucket entry before idle compression.
 */
interface RawStepBucket {
    bucketId: string;
    startTimeMs: number;
    endTimeMs: number;
    records: CompactTrajectoryRecord[];
}

/**
 * Creates folded idle gap placeholder snapshot.
 */
function createIdleFoldSnapshot(startTimeMs: number, endTimeMs: number): TimelineBucketSnapshot {
    const idleDurationHours =
        Math.round(((endTimeMs - startTimeMs) / MS_PER_HOUR) * IDLE_HOURS_SCALE) / IDLE_HOURS_SCALE;
    return createZeroBucketSnapshot({
        bucketId: `[ ${idleDurationHours}h idle gap ]`,
        startTimeMs,
        endTimeMs,
        isIdleFold: true,
    });
}

interface IdleFlushOptions {
    readonly idleCount: number;
    readonly startTimeMs: number;
    readonly endTimeMs: number;
    readonly prevBucket?: RawStepBucket;
    readonly destinationBuckets: TimelineBucketSnapshot[];
}

/**
 * Flushes pending idle sequence into folded summary or individual empty bucket.
 */
function flushPendingIdle(options: IdleFlushOptions): void {
    const { idleCount, startTimeMs, endTimeMs, prevBucket, destinationBuckets } = options;
    if (idleCount >= MIN_IDLE_BUCKET_FOLD_COUNT) {
        destinationBuckets.push(createIdleFoldSnapshot(startTimeMs, endTimeMs));
        return;
    }
    if (idleCount === 1 && prevBucket) {
        destinationBuckets.push(
            aggregateSingleBucket(
                {
                    bucketId: prevBucket.bucketId,
                    startTimeMs: prevBucket.startTimeMs,
                    endTimeMs: prevBucket.endTimeMs,
                },
                [],
            ),
        );
    }
}

/**
 * Folds idle bucket sequences into compact gap summaries.
 */
function aggregateIdleIntervals(rawStepBuckets: RawStepBucket[]): TimelineBucketSnapshot[] {
    const foldedSnapshots: TimelineBucketSnapshot[] = [];
    let idleRunCount = 0;
    let idleStartTimeMs = 0;
    let idleEndTimeMs = 0;

    for (let index = 0; index < rawStepBuckets.length; index++) {
        const stepBucket = rawStepBuckets[index];
        if (stepBucket.records.length === 0) {
            if (idleRunCount === 0) {
                idleEndTimeMs = stepBucket.endTimeMs;
            }
            idleStartTimeMs = stepBucket.startTimeMs;
            idleRunCount++;
            continue;
        }

        flushPendingIdle({
            idleCount: idleRunCount,
            startTimeMs: idleStartTimeMs,
            endTimeMs: idleEndTimeMs,
            prevBucket: rawStepBuckets[index - 1],
            destinationBuckets: foldedSnapshots,
        });
        idleRunCount = 0;
        foldedSnapshots.push(
            aggregateSingleBucket(
                {
                    bucketId: stepBucket.bucketId,
                    startTimeMs: stepBucket.startTimeMs,
                    endTimeMs: stepBucket.endTimeMs,
                },
                stepBucket.records,
            ),
        );
    }

    const last = rawStepBuckets[rawStepBuckets.length - 1];
    flushPendingIdle({
        idleCount: idleRunCount,
        startTimeMs: idleStartTimeMs,
        endTimeMs: idleEndTimeMs,
        prevBucket: last,
        destinationBuckets: foldedSnapshots,
    });

    return foldedSnapshots;
}

interface RelativeTimeAggregationOptions {
    readonly records: CompactTrajectoryRecord[];
    readonly referenceNowMs: number;
    readonly cutoffTimeMs: number;
    readonly bucketStepMs: number;
    readonly bucketLabelPrefix: string;
}

/**
 * Partitions relative time intervals and folds consecutive idle buckets.
 */
function aggregateRelativeTimeBuckets(
    options: RelativeTimeAggregationOptions,
): TimelineBucketSnapshot[] {
    const { records, referenceNowMs, cutoffTimeMs, bucketStepMs, bucketLabelPrefix } = options;
    const totalSteps = Math.max(1, Math.ceil((referenceNowMs - cutoffTimeMs) / bucketStepMs));
    const rawStepBuckets: RawStepBucket[] = [];

    for (let stepIndex = 0; stepIndex < totalSteps; stepIndex++) {
        const stepEndTimeMs = referenceNowMs - stepIndex * bucketStepMs;
        const stepStartTimeMs = stepEndTimeMs - bucketStepMs;
        const offsetIndex = stepIndex + 1;
        const bucketId = `-${offsetIndex}${bucketLabelPrefix}`;
        rawStepBuckets.push({
            bucketId,
            startTimeMs: stepStartTimeMs,
            endTimeMs: stepEndTimeMs,
            records: [],
        });
    }

    for (const record of records) {
        if (record.t < cutoffTimeMs || record.t > referenceNowMs) continue;
        const deltaFromReferenceNowMs = referenceNowMs - record.t;
        const bucketIndex = Math.min(
            totalSteps - 1,
            Math.floor(deltaFromReferenceNowMs / bucketStepMs),
        );
        if (bucketIndex >= 0 && bucketIndex < rawStepBuckets.length) {
            rawStepBuckets[bucketIndex].records.push(record);
        }
    }

    return aggregateIdleIntervals(rawStepBuckets);
}

/**
 * Projects raw ledger streams into multi-scale dynamic timeline snapshots.
 *
 * @param options Projection query options.
 * @returns Unified timeline report with buckets and metrics.
 * ASYNC-CONCURRENCY: awaited by its caller and never re-entered; no shared state crosses an
 * await.
 */
export async function projectTimelineReport(
    options: TimelineProjectionOptions,
): Promise<TimelineProjectionReport> {
    const referenceNowMs = options.referenceNowMs ?? Date.now();
    const durationMs = parseDurationToMs(options.since);
    const cutoffTimeMs = options.cutoffTimeMs ?? referenceNowMs - durationMs;
    const maxRecords = options.maxRecords ?? DEFAULT_MAX_SCAN_RECORDS;

    let bucketType = options.bucket;
    if (!bucketType) {
        bucketType =
            durationMs <= MS_PER_HOUR * DEFAULT_AUTO_HOUR_WINDOW
                ? BUCKET_TYPE_HOUR
                : BUCKET_TYPE_DAY;
    }

    const { records, malformedCount } = await readRecordsTieredReverse(
        options.ledgerDir,
        cutoffTimeMs,
        maxRecords,
    );

    let buckets: TimelineBucketSnapshot[] = [];
    if (bucketType === BUCKET_TYPE_COMMIT || bucketType === BUCKET_TYPE_AGENT) {
        buckets = aggregateSemanticBuckets(records, bucketType, referenceNowMs);
    } else if (bucketType === BUCKET_TYPE_HOUR) {
        buckets = aggregateRelativeTimeBuckets({
            records,
            referenceNowMs,
            cutoffTimeMs,
            bucketStepMs: MS_PER_HOUR,
            bucketLabelPrefix: BUCKET_PREFIX_HOUR,
        });
    } else {
        buckets = aggregateRelativeTimeBuckets({
            records,
            referenceNowMs,
            cutoffTimeMs,
            bucketStepMs: MS_PER_DAY,
            bucketLabelPrefix: BUCKET_PREFIX_DAY,
        });
    }

    let totalSemanticEloc = 0;
    let netDebtCleared = 0;
    for (const record of records) {
        totalSemanticEloc += record.eloc.sem;
        netDebtCleared += record.debt.res - record.debt.add;
    }

    return {
        referenceNowMs,
        cutoffTimeMs,
        bucketType,
        totalSampledRuns: records.length,
        malformedLinesCount: malformedCount,
        totalSemanticEloc,
        netDebtCleared,
        buckets,
    };
}
