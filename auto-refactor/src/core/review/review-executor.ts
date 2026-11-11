/**
 * Module: Review — Unified Immutable Execution
 * File Path: src/core/review/review-executor.ts
 * Architecture Role: Reuse Scanner and dual tracks for snapshot-bound analysis facts.
 * Dependencies & Triggers: Immutable inputs, actual invocation coverage and existing dual tracks.
 * Responsibilities: Await deep analysis and compensate missing whole-file required executions.
 * Exit Semantics & Design Rationale: Completion describes static file work, never gate authority,
 *     complete repository graph coverage, runtime measurements or a signed quality receipt.
 */
import type { Scanner } from '../analyzer';
import { executeDualTrack } from '../pipeline/dualTrackPipeline';
import type { DiffFileInput, DualTrackOptions } from '../pipeline/dualTrackPipeline';
import type { FileMetric, Issue } from '../types';
import type { FileExecutionObservation } from './analyzer-execution';
import {
    captureFileRequirements,
    collectReviewPassCoverage,
    fileAnalyzerKey,
} from './execution-coverage';
import type { FileAnalysisCoverage, FileAnalysisRequirement } from './execution-coverage';
import type { ReviewFailure } from './review-contracts';
import { createReviewExecution } from './review-execution';
import type { ReviewExecution } from './review-execution';
import { visitSnapshotInputs } from './snapshot-scanner';
import type { SnapshotInputObservation, SnapshotScanResult } from './snapshot-scanner';
import { assertSnapshotPath } from './source-snapshot';
import type { SourceSnapshot } from './source-snapshot';
import { captureReviewConfiguration } from './review-configuration';
import type { ReviewConfigurationIdentity } from './review-configuration';
import { SemanticSnapshotBuilder } from './semantic-snapshot';
import type { SemanticGraphSnapshot } from './semantic-snapshot';

/** Diff context selects speculative work; new bytes always come from the snapshot. */
export interface ReviewChange {
    readonly path: string;
    readonly oldContent: string;
    readonly lineBounds?: readonly [number, number];
}
/** Caller policy fixes the exact scope and required file experts before asynchronous work. */
export interface ReviewRequest {
    readonly requestId: string;
    readonly scope?: readonly string[];
    readonly requirements?: readonly FileAnalysisRequirement[];
    readonly changes?: readonly ReviewChange[];
}
/** Each review owns its scanner; mutable graph injection is deliberately absent. */
export interface ReviewRuntime {
    readonly scanner: Scanner;
    readonly options?: Omit<DualTrackOptions, 'graph' | 'onExecution'>;
}
/** Static execution facts, retaining all passes separately from their reduced coverage. */
export interface SnapshotReviewResult extends SnapshotScanResult {
    readonly requestId: string;
    readonly completion: ReviewExecution;
    /** Independent structural observations bound to this snapshot and actual configuration. */
    readonly semanticGraph: SemanticGraphSnapshot;
    readonly tracks: Readonly<{
        fast: 'pending' | 'complete' | 'failed';
        deep: 'pending' | 'complete' | 'failed';
    }>;
}
interface ExecutionState {
    inputs: readonly SnapshotInputObservation[];
    execution: FileExecutionObservation[];
    issues: Issue[];
    deepIssues: Issue[];
    confirmedIssues: Issue[];
    replaced: Set<string>;
    metrics: Map<string, FileMetric>;
    tracks: { fast: 'pending' | 'complete' | 'failed'; deep: 'pending' | 'complete' | 'failed' };
    failure?: ReviewFailure;
    cancelled: boolean;
}

function captureChanges(changes: readonly ReviewChange[], scope: readonly string[]) {
    const paths = new Set(scope);
    const captured = new Map<string, ReviewChange>();
    for (const change of changes) {
        assertSnapshotPath(change.path);
        if (!paths.has(change.path)) throw new Error('Review change is outside snapshot scope');
        if (captured.has(change.path)) throw new Error('Duplicate review change path');
        if (typeof change.oldContent !== 'string')
            throw new Error('Review old content must be text');
        const bounds = change.lineBounds;
        if (
            bounds &&
            (!Number.isSafeInteger(bounds[0]) ||
                !Number.isSafeInteger(bounds[1]) ||
                bounds[0] < 1 ||
                bounds[1] < bounds[0])
        )
            throw new Error('Invalid review line window');
        captured.set(
            change.path,
            Object.freeze({
                path: change.path,
                oldContent: change.oldContent,
                lineBounds: bounds ? Object.freeze([bounds[0], bounds[1]] as const) : undefined,
            }),
        );
    }
    return captured;
}

function requiredCompensation(
    coverage: readonly FileAnalysisCoverage[],
    execution: readonly FileExecutionObservation[],
): Set<string> {
    const wholeFile = new Set<string>();
    for (const pass of execution) {
        if (pass.lineBounds) continue;
        for (const analyzer of pass.analyzers) {
            if (analyzer.calls > 0 && analyzer.status === 'complete') {
                wholeFile.add(fileAnalyzerKey(pass.path, analyzer.analyzer));
            }
        }
    }
    const missing = new Set<string>();
    for (const fact of coverage) {
        if (fact.status !== 'supported' && fact.status !== 'degraded') continue;
        const key = fileAnalyzerKey(fact.path, fact.analyzer);
        if (!wholeFile.has(key)) missing.add(key);
    }
    return missing;
}

async function compensateRequiredFiles(context: {
    runtime: ReviewRuntime;
    state: ExecutionState;
    inputs: readonly DiffFileInput[];
    requirements: readonly FileAnalysisRequirement[];
}): Promise<void> {
    const { runtime, state, inputs, requirements } = context;
    const missing = requiredCompensation(
        collectReviewPassCoverage({
            requirements,
            inputs: state.inputs,
            execution: state.execution,
        }),
        state.execution,
    );
    const activeAnalyzers = new Set<string>();
    for (const input of inputs) {
        activeAnalyzers.clear();
        for (const requirement of requirements) {
            if (missing.has(fileAnalyzerKey(input.filePath, requirement.analyzer))) {
                activeAnalyzers.add(requirement.analyzer);
            }
        }
        if (activeAnalyzers.size === 0) continue;
        runtime.scanner.getConfig().signal?.throwIfAborted();
        const result = await runtime.scanner.runAnalyzers(
            input.filePath,
            input.newContent,
            undefined,
            { activeAnalyzers, observeExecution: true },
        );
        for (const analyzer of result.execution?.analyzers ?? []) {
            if (analyzer.status === 'complete' && analyzer.calls > 0) {
                state.replaced.add(fileAnalyzerKey(input.filePath, analyzer.analyzer));
            }
        }
        state.confirmedIssues.push(...result.issues);
        if (result.metric) state.metrics.set(input.filePath, result.metric);
        if (result.execution) state.execution.push(result.execution);
    }
}

function orderedIssues(issues: readonly Issue[]): readonly Issue[] {
    const unique = new Map<string, Issue>();
    for (const issue of issues) {
        const key = JSON.stringify([
            issue.id,
            issue.analyzer,
            issue.rule,
            issue.location,
            issue.message,
            issue.severity,
        ]);
        if (!unique.has(key)) unique.set(key, issue);
    }
    return Object.freeze(
        [...unique.entries()]
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([, issue]) => issue),
    );
}

async function readReviewFiles(context: {
    snapshot: SourceSnapshot;
    scope: readonly string[];
    changes: ReadonlyMap<string, ReviewChange>;
    semantic: SemanticSnapshotBuilder;
    state: ExecutionState;
    signal?: AbortSignal;
}): Promise<DiffFileInput[]> {
    const inputs: DiffFileInput[] = [];
    context.state.inputs = await visitSnapshotInputs(
        { snapshot: context.snapshot, scope: context.scope, signal: context.signal },
        async (read) => {
            if (read.kind !== 'text') return;
            await context.semantic.observe(read.path, read.content);
            const change = context.changes.get(read.path);
            inputs.push({
                filePath: read.path,
                newContent: read.content,
                oldContent: change?.oldContent ?? read.content,
                lineBounds: change?.lineBounds,
            });
        },
    );
    return inputs;
}

async function runReviewTracks(context: {
    runtime: ReviewRuntime;
    state: ExecutionState;
    inputs: DiffFileInput[];
    requirements: readonly FileAnalysisRequirement[];
}): Promise<void> {
    const { runtime, state, inputs } = context;
    const signal = runtime.scanner.getConfig().signal;
    const tracks = await executeDualTrack(runtime.scanner, inputs, {
        ...runtime.options,
        graph: undefined,
        onExecution: (event) => {
            state.execution.push(event.execution);
            if (event.metric) state.metrics.set(event.execution.path, event.metric);
        },
    });
    state.tracks.fast = 'complete';
    state.issues.push(...tracks.fastVerdict.issues);
    const deep = await tracks.deepPromise;
    state.tracks.deep = 'complete';
    state.deepIssues.push(...deep.deepIssues);
    signal?.throwIfAborted();
    await compensateRequiredFiles(context);
    signal?.throwIfAborted();
}

function recordReviewFailure(state: ExecutionState, error: unknown, signal?: AbortSignal): void {
    state.cancelled = signal?.aborted === true;
    state.failure = {
        code: state.cancelled ? 'REVIEW_CANCELLED' : 'REVIEW_EXECUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
    };
    if (state.cancelled) return;
    if (state.tracks.fast === 'pending') state.tracks.fast = 'failed';
    else if (state.tracks.deep === 'pending') state.tracks.deep = 'failed';
}

function finishSemanticReview(context: {
    snapshot: SourceSnapshot;
    scope: readonly string[];
    runtime: ReviewRuntime;
    configuration: ReviewConfigurationIdentity;
    semantic: SemanticSnapshotBuilder;
    state: ExecutionState;
}): { graph: SemanticGraphSnapshot; superseded: boolean } {
    const { snapshot, scope, runtime, configuration, semantic, state } = context;
    const current = captureReviewConfiguration(runtime.scanner.getConfig(), runtime.options);
    const superseded =
        configuration.status === 'bound' &&
        (current.status !== 'bound' || current.value !== configuration.value);
    const paths = new Set(snapshot.entries.map((entry) => entry.path));
    const fullScope = paths.size === scope.length && scope.every((file) => paths.has(file));
    const reason = superseded
        ? 'configuration-changed'
        : state.cancelled
          ? 'cancelled'
          : !fullScope
            ? 'partial-scope'
            : configuration.status !== 'bound'
              ? 'configuration-unavailable'
              : undefined;
    const graph = semantic.seal(
        { snapshot: snapshot.identity, configuration },
        state.inputs,
        reason,
    );
    return { graph, superseded };
}

/**
 * Execute captured bytes through existing fast/deep tracks, then finish missing required calls.
 * Inputs and requirements are detached before the first await. Repeated bounded observations
 * remain separate and never establish whole-file coverage by their union or call count.
 * @param request - Exact input scope, explicit diff context and required analyzer policy.
 * @param snapshot - Immutable source; no workspace discovery or source reread is permitted.
 * @param runtime - Fresh nonpersistent scanner and cooperative dual-track collaborators.
 * @returns Snapshot-bound static results with explicit completion, failure and cancellation.
 */
export async function executeReview(
    request: ReviewRequest,
    snapshot: SourceSnapshot,
    runtime: ReviewRuntime,
): Promise<SnapshotReviewResult> {
    if (!request.requestId?.trim()) throw new Error('Review request ID is required');
    if (runtime.scanner.getConfig().sparseRouting === true) {
        throw new Error('Snapshot review requires the complete configured analyzer plan');
    }
    const requestId = request.requestId;
    const scope = [...(request.scope ?? snapshot.entries.map((entry) => entry.path))];
    const changes = captureChanges(request.changes ?? [], scope);
    const configured = runtime.scanner.beginSnapshotAnalysis();
    const requirements = captureFileRequirements(request.requirements ?? configured);
    const capturedRuntime = { scanner: runtime.scanner, options: { ...runtime.options } };
    const configuration = captureReviewConfiguration(
        runtime.scanner.getConfig(),
        capturedRuntime.options,
    );
    const semantic = new SemanticSnapshotBuilder();
    const signal = runtime.scanner.getConfig().signal;
    const state: ExecutionState = {
        inputs: [],
        execution: [],
        issues: [],
        deepIssues: [],
        confirmedIssues: [],
        metrics: new Map(),
        replaced: new Set(),
        tracks: { fast: 'pending', deep: 'pending' },
        cancelled: false,
    };
    try {
        const inputs = await readReviewFiles({ snapshot, scope, changes, state, signal, semantic });
        await runReviewTracks({ runtime: capturedRuntime, state, inputs, requirements });
    } catch (error) {
        recordReviewFailure(state, error, signal);
    }
    const coverage = collectReviewPassCoverage({
        requirements,
        inputs: state.inputs,
        execution: state.execution,
    });
    const generation = finishSemanticReview({
        snapshot,
        scope,
        runtime: capturedRuntime,
        configuration,
        semantic,
        state,
    });
    const retainedIssues = state.issues.filter(
        (issue) => !state.replaced.has(fileAnalyzerKey(issue.location.file, issue.analyzer)),
    );
    return Object.freeze({
        requestId,
        source: 'immutable-snapshot',
        identity: snapshot.identity,
        inputs: state.inputs,
        issues: orderedIssues([...retainedIssues, ...state.confirmedIssues, ...state.deepIssues]),
        fileMetrics: Object.freeze([...state.metrics.values()]),
        execution: Object.freeze(state.execution),
        coverage,
        tracks: Object.freeze(state.tracks),
        semanticGraph: generation.graph,
        completion: createReviewExecution({
            reviewId: requestId,
            coverage,
            tracks: state.tracks,
            termination: state.cancelled
                ? 'cancelled'
                : generation.superseded
                  ? 'superseded'
                  : undefined,
            failures: state.failure ? [state.failure] : undefined,
        }),
    });
}
