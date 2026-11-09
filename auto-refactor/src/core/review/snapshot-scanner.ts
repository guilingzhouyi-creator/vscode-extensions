/**
 * Module: Review — Snapshot Scan Execution
 * File Path: src/core/review/snapshot-scanner.ts
 * Architecture Role: Connect immutable input to the existing single-file analyzer stage.
 * Dependencies & Triggers: Snapshot port, scan types, and a caller-owned analyzer callback.
 * Responsibilities: Preserve input outcomes and snapshot identity without workspace/cache fallback.
 * Exit Semantics & Design Rationale: Static diagnostics and read coverage convey no gate approval.
 */
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import type { FileExecutionObservation } from './analyzer-execution';
import { captureFileRequirements, collectExecutionCoverage } from './execution-coverage';
import type { FileAnalysisCoverage, FileAnalysisRequirement } from './execution-coverage';
import type { FileMetric, Issue } from '../types';
import { assertSnapshotPath } from './source-snapshot';
import type { SourceSnapshot, SourceSnapshotIdentity, SnapshotRead } from './source-snapshot';

/** Recorded outcome for reading a single path from an immutable source snapshot. */
export interface SnapshotInputObservation {
    readonly path: string;
    readonly kind: SnapshotRead['kind'];
    readonly reason?: string;
}
/** Immutable-snapshot scan output containing issues, metrics, and execution observations. */
export interface SnapshotScanResult {
    readonly source: 'immutable-snapshot';
    readonly identity: SourceSnapshotIdentity;
    readonly inputs: readonly SnapshotInputObservation[];
    readonly issues: readonly Issue[];
    readonly fileMetrics: readonly FileMetric[];
    readonly execution: readonly FileExecutionObservation[];
    readonly coverage: readonly FileAnalysisCoverage[];
}
interface SnapshotScanOptions {
    readonly snapshot: SourceSnapshot;
    readonly requirements: readonly FileAnalysisRequirement[];
    readonly scope?: readonly string[];
    readonly signal?: AbortSignal;
    readonly analyze: (
        path: string,
        content: string,
    ) => Promise<{
        issues: Issue[]; metric: FileMetric | null; execution?: FileExecutionObservation;
    }>;
}
/** Snapshot, exact scope and cancellation shared by read-only input replay. */
export interface SnapshotVisitOptions {
    readonly snapshot: SourceSnapshot;
    readonly scope: readonly string[];
    readonly signal?: AbortSignal;
}

function inputObservation(read: SnapshotRead): SnapshotInputObservation {
    if (read.kind === 'unsupported') {
        return Object.freeze({ path: read.path, kind: read.kind, reason: read.reason });
    }
    return Object.freeze({ path: read.path, kind: read.kind });
}

/**
 * Replay a captured scope through the snapshot port without analysis or workspace fallback.
 * Each visited path yields exactly one observation, including non-text and missing entries.
 *
 * @param options - Snapshot port, validated exact scope and cancellation signal.
 * @param visit - Caller callback receiving the read outcome before the next cooperative yield.
 * @returns One immutable observation per requested path, in scope order.
 */
export async function visitSnapshotInputs(
    options: SnapshotVisitOptions,
    visit: (read: SnapshotRead) => void,
): Promise<readonly SnapshotInputObservation[]> {
    const { snapshot, scope, signal } = options;
    if (new Set(scope).size !== scope.length) throw new Error('Duplicate snapshot scope path');
    for (const path of scope) assertSnapshotPath(path);
    const inputs: SnapshotInputObservation[] = [];
    for (const path of scope) {
        signal?.throwIfAborted();
        const read = snapshot.read(path);
        inputs.push(inputObservation(read));
        visit(read);
        await yieldImmediate(undefined, { signal });
    }
    signal?.throwIfAborted();
    return Object.freeze(inputs);
}

/**
 * Execute only captured text entries and retain explicit observations for every requested path.
 * O(scope + analysis); no file discovery, persistence, warm reuse, or mutable content rereads.
 *
 * @param options - Snapshot, optional exact scope, cancellation signal and isolated analyzer host.
 * @returns Static results with input provenance; completion requires separate capability checks.
 */
export async function executeSnapshotScan(
    options: SnapshotScanOptions,
): Promise<SnapshotScanResult> {
    const { snapshot, signal, analyze } = options;
    const requirements = captureFileRequirements(options.requirements);
    signal?.throwIfAborted();
    const scope = [...(options.scope ?? snapshot.entries.map((entry) => entry.path))];
    if (new Set(scope).size !== scope.length) throw new Error('Duplicate snapshot scope path');
    for (const path of scope) assertSnapshotPath(path);
    const inputs: SnapshotInputObservation[] = [];
    const issues: Issue[] = [];
    const fileMetrics: FileMetric[] = [];
    const execution: FileExecutionObservation[] = [];
    for (const path of scope) {
        signal?.throwIfAborted();
        const read = snapshot.read(path);
        inputs.push(inputObservation(read));
        if (read.kind !== 'text') continue;
        const result = await analyze(path, read.content);
        signal?.throwIfAborted();
        issues.push(...result.issues);
        if (result.metric) fileMetrics.push(result.metric);
        if (result.execution) execution.push(result.execution);
        await yieldImmediate(undefined, { signal });
    }
    signal?.throwIfAborted();
    return Object.freeze({
        source: 'immutable-snapshot', identity: snapshot.identity,
        inputs: Object.freeze(inputs),
        issues: Object.freeze(issues),
        fileMetrics: Object.freeze(fileMetrics),
        execution: Object.freeze(execution),
        coverage: collectExecutionCoverage({ requirements, inputs, execution }),
    });
}
