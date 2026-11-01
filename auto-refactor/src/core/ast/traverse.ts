/**
 * Module: Core Engine — Multiplexed AST Traversal and Projection Routing
 * File Path: src/core/ast/traverse.ts
 * Architecture Role: language-agnostic orchestration layer between adapters/projectors and
 *   streaming analyzers; owns the one shared descent and the lazy-projection fast-path gate.
 * Dependencies & Triggers: imports AnalyzerContext/Issue/FileMetric from ./types and NodeKind/
 *   NormalizedNode/LanguageAdapter/NodeProjector/ProjectionPolicy from ./multilang; called per
 *   file by analyzer.ts/worker.ts, keyed by cacheKey.ts, and reused by complexity/constants/
 *   governance/largeFile legacy analyze paths.
 * Responsibilities: runStreaming dispatches visit/finalize and isolates analyzer errors;
 *   FileMetricCollector derives line/nesting/function/top-level/export counts;
 *   runStreamingProjected mirrors the contract over NodeProjector; FAST_PATH_ANALYZERS,
 *   fastPathEnabled, policyFromAnalyzers, and tryCreateProjector build the lazy path; both entry
 *   points prune out-of-window subtrees through sparse-ast-hopper when a line span is supplied.
 * Exit Semantics & Design Rationale: analyzer exceptions become one core:analyzer-error issue
 *   (error severity only under failOnAnalyzerError) instead of aborting the scan;
 *   tryCreateProjector returns null on an ineligible gate or projector failure so the caller
 *   falls back to materialized traversal. One descent replaces N re-walks, inlined scope
 *   frames avoid per-node allocation, and staying TypeScript-free preserves oxc byte parity.
 *   Subtree pruning is limited to nodes whose whole extent lies outside the audited span, so a
 *   pruned branch can never have carried an in-window finding.
 */

import type { AnalyzerContext, Issue, FileMetric } from '../types';
import type { NormalizedNode, LanguageAdapter, NodeProjector, ProjectionPolicy } from './multilang';
import { NodeKind } from './multilang';
import { computeEffectiveCodeDensity } from '../scoring/effectiveDensity';
import type { SparseHopperStats } from './sparse-ast-hopper';
import {
    createSparseHopperStats,
    isSubtreePrunable,
    shouldDispatchNode,
} from './sparse-ast-hopper';

const SEVERITY_ERROR = 'error';
const SEVERITY_INFO = 'info';
const RULE_ANALYZER_ERROR = 'analyzer-error';
const ANALYZER_COMPLEXITY = 'complexity';
const ANALYZER_CONSTANTS = 'constants';
const ANALYZER_LARGE_FILE = 'large-file';

/**
 * Signature for streaming visit and leave AST hooks.
 */
export type StreamingVisitHook = (
    node: NormalizedNode,
    ctx: AnalyzerContext,
    parent: NormalizedNode | undefined,
    grandparent: NormalizedNode | undefined,
    depth: number,
    className: string | null,
    binding: string | null,
) => void;

/** An analyzer + its per-file merged context, participating in the shared pass. */
export interface StreamingEntry {
    analyzer: {
        name: string;
        visit?: StreamingVisitHook;
        /**
         * Post-order hook: called after recursing into children (reverse order of visit).
         * Optional — analyzers that don't need post-order traversal skip it (zero overhead).
         */
        leave?: StreamingVisitHook;
        finalize?(ctx: AnalyzerContext): Issue[];
        /** When true, the analyzer is exempt from window-based pruning and observes all nodes. */
        exemptFromPruning?: boolean;
    };
    ctx: AnalyzerContext;
    /** Optional entry-level exemption flag from window-based pruning. */
    exemptFromPruning?: boolean;
}

/** `typeof` tag detecting analyzer visit()/finalize() methods on entries/projections. */
const TYPEOF_FUNCTION = 'function';

/**
 * Narrow an optional hook to its callable type. Control-flow analysis only narrows a direct
 * `typeof x === 'function'` comparison, so the named tag above needs this explicit predicate.
 */
function isCallable<T extends (...args: never[]) => unknown>(
    candidateFn: T | undefined,
): candidateFn is T {
    return typeof candidateFn === TYPEOF_FUNCTION;
}

function resolveChildScopeName(node: NormalizedNode, className: string | null): string | null {
    return node.isClassDefining ? (node.name ?? className) : className;
}

function resolveChildScopeBinding(node: NormalizedNode, binding: string | null): string | null {
    if (node.isClassDefining || node.functionLike) {
        return null;
    }
    return node.introducesBinding ? (node.bindingName ?? binding) : binding;
}

type NodeHookFn = NonNullable<StreamingEntry['analyzer']['visit']>;
type ErrorReporter = (analyzerName: string, err: unknown, ctx: AnalyzerContext) => void;

interface ActiveHook {
    fn: NodeHookFn;
    ctx: AnalyzerContext;
    name: string;
}

/** Threaded traversal scope values for hook invocation, grouping environment parameters. */
interface TraversalScope {
    readonly depth: number;
    readonly className: string | null;
    readonly binding: string | null;
    readonly parent?: NormalizedNode;
    readonly grandparent?: NormalizedNode;
}

function dispatchHooks(
    active: ActiveHook[],
    node: NormalizedNode,
    scope: TraversalScope,
    pushError: ErrorReporter,
): void {
    for (let i = 0; i < active.length; i++) {
        const hook = active[i];
        try {
            hook.fn(node, hook.ctx, scope.parent, scope.grandparent, scope.depth, scope.className, scope.binding);
        } catch (error) {
            pushError(hook.name, error, hook.ctx);
        }
    }
}

interface TraversalDispatchContext {
    readonly active: ActiveHook[];
    readonly exempt: ActiveHook[];
    readonly pushError: ErrorReporter;
}

function dispatchPhaseHooks(
    dispatchCtx: TraversalDispatchContext,
    node: NormalizedNode,
    scope: TraversalScope,
    shouldDispatch: boolean,
): void {
    if (shouldDispatch && dispatchCtx.active.length > 0) {
        dispatchHooks(dispatchCtx.active, node, scope, dispatchCtx.pushError);
    }
    if (dispatchCtx.exempt.length > 0) {
        dispatchHooks(dispatchCtx.exempt, node, scope, dispatchCtx.pushError);
    }
}

/**
 * Partition streaming entries into active and exempt visit hooks.
 *
 * @param entries - Analyzer plus context entries participating in this pass.
 * @returns Partitioned active and exempt visit hooks.
 */
function collectVisitHooks(entries: readonly StreamingEntry[]): {
    active: ActiveHook[];
    exempt: ActiveHook[];
} {
    const active: ActiveHook[] = [];
    const exempt: ActiveHook[] = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!isCallable(entry.analyzer.visit)) continue;
        const hook: ActiveHook = {
            fn: entry.analyzer.visit.bind(entry.analyzer),
            ctx: entry.ctx,
            name: entry.analyzer.name,
        };
        if (entry.exemptFromPruning || entry.analyzer.exemptFromPruning) {
            exempt.push(hook);
        } else {
            active.push(hook);
        }
    }
    return { active, exempt };
}

/**
 * Partition streaming entries into active and exempt leave hooks in reverse array order.
 *
 * @param entries - Analyzer plus context entries participating in this pass.
 * @returns Partitioned active and exempt leave hooks.
 */
function collectLeaveHooks(entries: readonly StreamingEntry[]): {
    active: ActiveHook[];
    exempt: ActiveHook[];
} {
    const active: ActiveHook[] = [];
    const exempt: ActiveHook[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!isCallable(entry.analyzer.leave)) continue;
        const hook: ActiveHook = {
            fn: entry.analyzer.leave.bind(entry.analyzer),
            ctx: entry.ctx,
            name: entry.analyzer.name,
        };
        if (entry.exemptFromPruning || entry.analyzer.exemptFromPruning) {
            exempt.push(hook);
        } else {
            active.push(hook);
        }
    }
    return { active, exempt };
}

/**
 * Invoke finalize on each participating analyzer, accumulating issues and capturing exceptions.
 *
 * @param entries - Participating streaming entries.
 * @param issues - Target issues array.
 * @param pushError - Sink for analyzer exceptions.
 */
function finalizeStreamingEntries(
    entries: readonly StreamingEntry[],
    issues: Issue[],
    pushError: ErrorReporter,
): void {
    for (const entry of entries) {
        if (!isCallable(entry.analyzer.finalize)) continue;
        try {
            issues.push(...entry.analyzer.finalize(entry.ctx));
        } catch (error) {
            pushError(entry.analyzer.name, error, entry.ctx);
        }
    }
}

/**
 * Create a single analyzer error issue when a visit or finalize hook throws.
 *
 * @param name - Analyzer name.
 * @param error - Caught exception.
 * @param ctx - Active analyzer context.
 * @returns Diagnostic Issue record.
 */
function createAnalyzerErrorIssue(name: string, error: unknown, ctx: AnalyzerContext): Issue {
    const sev = ctx.config.failOnAnalyzerError ? SEVERITY_ERROR : SEVERITY_INFO;
    return {
        id: `core:analyzer-error:${ctx.filePath}:1`,
        analyzer: name,
        rule: RULE_ANALYZER_ERROR,
        severity: sev,
        message: `Analyzer "${name}" threw: ${(error as Error).message}`,
        location: {
            file: ctx.filePath,
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 },
        },
        detail: { error: String(error) },
    };
}

/** Options for configuring the streaming AST traversal pass. */
export interface RunStreamingOptions {
    readonly lineBounds?: readonly [number, number];
    readonly hopperStats?: SparseHopperStats;
}

/**
 * Run the single shared traversal over the normalized tree, dispatching to each entry's
 * `visit` (per node) and `finalize` (once). Analyzers without `visit`/`finalize` are skipped
 * (they are handled by the legacy `analyze` path elsewhere). Per-analyzer errors during
 * `visit`/`finalize` become a single `core:analyzer-error` Issue per analyzer.
 *
 * When `lineBounds` is supplied the sparse hopper prunes every subtree whose complete extent sits
 * outside the window: such a subtree cannot contain a finding inside the audited span, so skipping
 * it removes work without removing evidence. Nodes without materialized positions are never
 * pruned, and nodes that merely wrap the window are still dispatched so scope context survives.
 * @param adapter - Language adapter supplying `children()` over the normalized tree.
 * @param root - Normalized SourceFile root; its children are visited but the root itself is
 *   not dispatched.
 * @param entries - Analyzer plus merged-context pairs participating in this pass, dispatched
 *   in array order.
 * @param options - Optional 1-based [first, last] audited span or structured traversal options.
 * @returns Issues emitted by each analyzer's `finalize`, plus at most one analyzer-error issue
 *   per analyzer that threw during `visit` or `finalize`; direct `visit` output is discarded.
 */
export function runStreaming(
    adapter: LanguageAdapter,
    root: NormalizedNode,
    entries: StreamingEntry[],
    options?: readonly [number, number] | RunStreamingOptions,
): Issue[] {
    const issues: Issue[] = [];
    const errored = new Set<string>();
    const isOptionsObject = Boolean(options && !Array.isArray(options));
    const structuredOpts = isOptionsObject ? (options as RunStreamingOptions) : undefined;
    const lineBounds = Array.isArray(options) ? options : structuredOpts?.lineBounds;
    const stats = structuredOpts?.hopperStats ?? createSparseHopperStats();
    const window = lineBounds ? { startLine: lineBounds[0], endLine: lineBounds[1] } : undefined;

    const { active: activeVisits, exempt: exemptVisits } = collectVisitHooks(entries);
    const { active: activeLeaves, exempt: exemptLeaves } = collectLeaveHooks(entries);

    const pushError = (name: string, error: unknown, ctx: AnalyzerContext) => {
        if (errored.has(name)) return;
        errored.add(name);
        issues.push(createAnalyzerErrorIssue(name, error, ctx));
    };

    const visitDispatch: TraversalDispatchContext = {
        active: activeVisits,
        exempt: exemptVisits,
        pushError,
    };
    const leaveDispatch: TraversalDispatchContext = {
        active: activeLeaves,
        exempt: exemptLeaves,
        pushError,
    };

    const visitNode = (
        node: NormalizedNode,
        scope: TraversalScope,
    ): void => {
        const prunable = isSubtreePrunable(node, window);
        if (prunable) {
            stats.pruned += 1;
            if (exemptVisits.length === 0) {
                return;
            }
        }

        const shouldDispatch = !prunable && shouldDispatchNode(node, window);
        if (shouldDispatch) {
            stats.visited += 1;
        }

        dispatchPhaseHooks(visitDispatch, node, scope, shouldDispatch);

        const childDepth = scope.depth + (node.increasesNesting ? 1 : 0);
        const cName = resolveChildScopeName(node, scope.className);
        const cBinding = resolveChildScopeBinding(node, scope.binding);
        const childScope: TraversalScope = {
            depth: childDepth,
            className: cName,
            binding: cBinding,
            parent: node,
            grandparent: scope.parent,
        };

        for (const childNode of adapter.children(node)) {
            visitNode(childNode, childScope);
        }

        dispatchPhaseHooks(leaveDispatch, node, scope, shouldDispatch);
    };

    const rootScope: TraversalScope = {
        depth: 0,
        className: null,
        binding: null,
        parent: root,
        grandparent: undefined,
    };
    for (const childNode of adapter.children(root)) {
        visitNode(childNode, rootScope);
    }

    finalizeStreamingEntries(entries, issues, pushError);
    return issues;
}

/**
 * Structural-metric collector that runs inside the shared pass and produces the per-file
 * `FileMetric`. Top-level detection uses the adapter-precomputed `node.topLevel` flag plus the
 * threaded `parent` (kind === SourceFile), so no explicit source-file reference is needed.
 */
export class FileMetricCollector {
    name = '__metric__' as const;
    exemptFromPruning = true;
    functions = 0;
    maxNesting = 0;
    topLevelDeclarations = 0;
    exportedSymbols = 0;
    metric: FileMetric | null = null;

    visit(
        node: NormalizedNode,
        _ctx: AnalyzerContext,
        parent?: NormalizedNode,
        _grandparent?: NormalizedNode,
        depth?: number,
        _className?: string | null,
        _binding?: string | null,
    ): void {
        const currentDepth = depth ?? 0;
        if (node.functionLike) this.functions++;
        if (currentDepth > this.maxNesting) this.maxNesting = currentDepth;
        if (parent && parent.kind === NodeKind.SourceFile && node.topLevel) {
            this.topLevelDeclarations++;
            if (node.exported) this.exportedSymbols++;
        }
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        // The engine precomputes line stats once per file (ctx.lineStats); fall back to
        // the old split-based counting only for contexts built outside the pipeline (direct
        // `analyze()` calls), keeping the produced values byte-identical either way.
        let lines: number;
        let nonBlankLines: number;
        if (ctx.lineStats) {
            lines = ctx.lineStats.lines;
            nonBlankLines = ctx.lineStats.nonBlankLines;
        } else {
            lines = 0;
            nonBlankLines = 0;
            for (const lineText of ctx.content.split(/\r\n|\n/)) {
                lines++;
                if (lineText.trim().length > 0) nonBlankLines++;
            }
        }
        const density = ctx.content ? computeEffectiveCodeDensity(ctx.content) : null;
        this.metric = {
            file: ctx.filePath,
            lines,
            nonBlankLines,
            functions: this.functions,
            maxNestingDepth: this.maxNesting,
            topLevelDeclarations: this.topLevelDeclarations,
            exportedSymbols: this.exportedSymbols,
            effectiveDensity: density ? density.effectiveDensity : undefined,
            tspr: density?.tspr,
            por: density?.por,
            columnDensity: density?.columnDensity,
            compositeDensity: density?.compositeDensity,
            tokensPerEloc: density?.tokensPerEloc,
        };
        return [];
    }
}

// ---------------------------------------------------------------------------
// Lazy-projection fast path (see docs/02-parsers-and-ast/03-lazy-projection.md §2.3, §2.6).
// traverse.ts stays ts-free: it drives the projector through the language-agnostic
// NodeProjector interface only, so the oxc worker's lazy-typescript benefit is preserved.
// ---------------------------------------------------------------------------

/** Threaded scope values for one hook invocation, kept in one object to shorten signatures. */
interface ProjectedScope {
    readonly depth: number;
    readonly className: string | null;
    readonly binding: string | null;
    readonly parentProj: NormalizedNode | undefined;
    readonly grandparentProj: NormalizedNode | undefined;
}

/**
 * Dispatch one projected node to a set of bound hooks.
 *
 * @param hooks - Bound visit or leave hooks for this pass.
 * @param node - Projected node under consideration.
 * @param scope - Threaded scope values for the hook contract.
 * @param pushError - Error sink turning a hook exception into one analyzer-error issue.
 */
function dispatchProjectedHooks(
    hooks: ActiveHook[],
    node: NormalizedNode,
    scope: ProjectedScope,
    pushError: ErrorReporter,
): void {
    if (hooks.length === 0) return;
    dispatchHooks(
        hooks,
        node,
        {
            parent: scope.parentProj,
            grandparent: scope.grandparentProj,
            depth: scope.depth,
            className: scope.className,
            binding: scope.binding,
        },
        pushError,
    );
}

interface ProjectedDispatchContext {
    readonly active: ActiveHook[];
    readonly exempt: ActiveHook[];
    readonly pushError: ErrorReporter;
}

function dispatchProjectedPhaseHooks(
    dispatchCtx: ProjectedDispatchContext,
    node: NormalizedNode,
    scope: ProjectedScope,
    shouldDispatch: boolean,
): void {
    if (shouldDispatch && dispatchCtx.active.length > 0) {
        dispatchProjectedHooks(dispatchCtx.active, node, scope, dispatchCtx.pushError);
    }
    if (dispatchCtx.exempt.length > 0) {
        dispatchProjectedHooks(dispatchCtx.exempt, node, scope, dispatchCtx.pushError);
    }
}

/**
 * Resolve the effective caller identifier when descending into a child scope.
 *
 * @param node - Normalized node whose scope is being entered.
 * @param fallbackCaller - Current enclosing caller if the node does not establish a function scope.
 * @returns Updated function name or fallback.
 */
function resolveChildCaller(node: NormalizedNode, fallbackCaller: string | null): string | null {
    if (node.functionLike && typeof node.name === 'string') {
        return node.name;
    }
    return fallbackCaller;
}

/**
 * Run the shared traversal over a LAZY projection source (no materialized normalized tree).
 *
 * Mirrors `runStreaming` exactly: identical visit dispatch (per analyzer, errors become a
 * single core:analyzer-error Issue), identical threaded scope derivation
 * (isClassDefining/functionLike/introducesBinding → className/binding) and identical
 * finalize phase. The ONLY difference is the descent source:
 *   - runStreaming:        adapter.children(normalizedNode)   (materialized children arrays)
 *   - runStreamingProjected: projector.forEachChild(raw)      (raw-driven lazy/subtree descent)
 *
 * Contract (docs/02-parsers-and-ast/03-lazy-projection.md §2.3):
 *   - `projector.project(raw, parentRaw, grandparentRaw)` is called ONCE per visit and may
 *     return the shared OTHER_PLACEHOLDER singleton (or, in Mode B, a cached subtree node).
 *   - `projector.forEachChild(raw)` yields raw children in materialized order with the same
 *     skip rules; for Mode B function-like nodes it yields the subtree's raw children, so the
 *     engine's visit and complexity's re-walk share the SAME projected objects.
 *   - The root raw node is projected once (real SourceFile projection) and handed to
 *     top-level children as `parent` — L/M detect top-level via parent.kind === SourceFile.
 *
 * Any projector exception propagates to the caller, which falls back to parse()+runStreaming()
 * (never crashes — the routing gate in analyzer.ts/worker.ts owns that fallback).
 * @param projector - Lazy projection source built by `tryCreateProjector`; supplies `root`,
 *   `project` and `forEachChild` for raw-driven descent.
 * @param entries - Analyzer plus merged-context pairs participating in this pass, dispatched
 *   in array order.
 * @param onNode - Optional scan-wide node observer (cross-file symbol index); called once per
 *   projected node, in traversal order.
 * @param lineBounds - Optional 1-based [first, last] audited span enabling subtree pruning.
 * @param hopperStats - Optional counters receiving visited/pruned node totals for this pass.
 * @returns Issues emitted by each analyzer's `finalize`, plus at most one analyzer-error issue
 *   per analyzer that threw during `visit` or `finalize`; projector exceptions propagate to
 *   the caller so it can fall back to the materialized path.
 */
export function runStreamingProjected(
    projector: NodeProjector,
    entries: StreamingEntry[],
    onNode?: (node: NormalizedNode, caller: string | null) => void,
    lineBounds?: readonly [number, number],
    hopperStats?: SparseHopperStats,
): Issue[] {
    const issues: Issue[] = [];
    const errored = new Set<string>();
    const stats = hopperStats ?? createSparseHopperStats();
    const window = lineBounds ? { startLine: lineBounds[0], endLine: lineBounds[1] } : undefined;

    const { active: activeVisits, exempt: exemptVisits } = collectVisitHooks(entries);
    const { active: activeLeaves, exempt: exemptLeaves } = collectLeaveHooks(entries);

    const pushError = (name: string, error: unknown, ctx: AnalyzerContext) => {
        if (errored.has(name)) return;
        errored.add(name);
        issues.push(createAnalyzerErrorIssue(name, error, ctx));
    };

    const visitProjectedDispatch: ProjectedDispatchContext = {
        active: activeVisits,
        exempt: exemptVisits,
        pushError,
    };
    const leaveProjectedDispatch: ProjectedDispatchContext = {
        active: activeLeaves,
        exempt: exemptLeaves,
        pushError,
    };

    const rootRaw = projector.root;
    // The root is never dispatched to visits; project it once so top-level children receive a
    // REAL SourceFile projection as `parent` (L/M top-level detection) and as ctx.root.
    const rootProj = projector.project(rootRaw, undefined, undefined);

    const visitRaw = (
        raw: unknown,
        parentRaw: unknown | undefined,
        grandparentRaw: unknown | undefined,
        scope: ProjectedScope,
        caller: string | null,
    ): void => {
        const node = projector.project(raw, parentRaw, grandparentRaw);
        const prunable = isSubtreePrunable(node, window);
        if (prunable) {
            stats.pruned += 1;
            if (exemptVisits.length === 0) {
                return;
            }
        }

        const shouldDispatch = !prunable && shouldDispatchNode(node, window);
        if (shouldDispatch) {
            stats.visited += 1;
        }

        if (onNode && (shouldDispatch || exemptVisits.length > 0)) {
            onNode(node, caller);
        }

        dispatchProjectedPhaseHooks(visitProjectedDispatch, node, scope, shouldDispatch);

        const childDepth = scope.depth + (node.increasesNesting ? 1 : 0);
        const cName = resolveChildScopeName(node, scope.className);
        const cBinding = resolveChildScopeBinding(node, scope.binding);
        const cCaller = resolveChildCaller(node, caller);
        const childScope: ProjectedScope = {
            depth: childDepth,
            className: cName,
            binding: cBinding,
            parentProj: node,
            grandparentProj: scope.parentProj,
        };

        for (const childRaw of projector.forEachChild(raw)) {
            visitRaw(childRaw, raw, parentRaw, childScope, cCaller);
        }

        dispatchProjectedPhaseHooks(leaveProjectedDispatch, node, scope, shouldDispatch);
    };

    const rootScope: ProjectedScope = {
        depth: 0,
        className: null,
        binding: null,
        parentProj: rootProj,
        grandparentProj: undefined,
    };
    for (const childRaw of projector.forEachChild(rootRaw)) {
        visitRaw(childRaw, rootRaw, undefined, rootScope, null);
    }

    finalizeStreamingEntries(entries, issues, pushError);
    return issues;
}

/**
 * Built-in streaming analyzers eligible for the lazy-projection fast path
 * (docs/02-parsers-and-ast/03-lazy-projection.md §2.6). Custom/legacy analyzers (pure
 * `analyze()` contract, or a streaming analyzer outside this set) force the materialized path
 * — they may need the full tree.
 */
export const FAST_PATH_ANALYZERS = new Set([
    'constants',
    'large-file',
    'complexity',
    'dependency-graph',
    'secrets',
    'architecture',
    'performance',
    'comments',
    'hygiene',
    'naming',
]);

/**
 * AR_FASTPATH gate (docs/02-parsers-and-ast/03-lazy-projection.md §2.6; enabled by default).
 * The lazy-projection fast path is the DEFAULT; `AR_FASTPATH=0` remains the explicit
 * safety-valve / A-B-baseline switch back to the materialized path.
 *
 * @returns True unless AR_FASTPATH is exactly the string '0'; an unset or any other value
 *   keeps the lazy-projection fast path enabled.
 */
export function fastPathEnabled(): boolean {
    return process.env.AR_FASTPATH !== '0';
}

/**
 * Derive the projection policy from the ENABLED streaming analyzer names
 * (docs/02-parsers-and-ast/03-lazy-projection.md §2.2 consumption matrix). FileMetricCollector
 * always runs, so topLevel/exported are unconditionally projected by the adapters.
 * @param names - Enabled streaming analyzer names; membership decides which optional
 *   projection flags are requested.
 * @returns A ProjectionPolicy whose flags are the union of the requirements of the named
 *   analyzers: complexity needs complexity/name/position data, constants needs literals and
 *   positions, and large-file needs names only.
 */
export function getPolicyFromAnalyzers(names: string[]): ProjectionPolicy {
    const set = new Set(names);
    const needComplexity = set.has(ANALYZER_COMPLEXITY);
    const needLiterals = set.has(ANALYZER_CONSTANTS);
    const needNames = needComplexity || set.has(ANALYZER_LARGE_FILE);
    const needPositions = needComplexity || needLiterals;
    // `needSymbols` is scan-wide: the cross-file symbol index consumes declaration names/
    // positions and call names on every scan, independently of which analyzers are enabled.
    // Call expressions are preserved across the lazy fast path so projection feeds the
    // repository-intelligence symbol index and call-graph edges with high fidelity.
    return { needComplexity, needLiterals, needNames, needPositions, needSymbols: true };
}

/** Backward-compatible alias for getPolicyFromAnalyzers. */
export const policyFromAnalyzers = getPolicyFromAnalyzers;

/**
 * Routing gate: build the lazy-projection source for one file, or null when the fast path
 * cannot apply (gate off, ineligible analyzers, adapter without project(), or any projector
 * creation failure → caller falls back to the materialized path).
 * @param adapter - Language adapter that may implement `project()`; adapters without it force
 *   the materialized path.
 * @param content - Full UTF-16 source text to parse lazily.
 * @param filePath - File path passed to the adapter for parser/diagnostic context.
 * @param rest - Tuple carrying streaming analyzer names and legacy analyzer count.
 * @returns A projector bound to the content, or null when the gate rejects the file or
 *   `adapter.project` throws; null means the caller must parse and run the materialized path.
 */
export function tryCreateProjector(
    adapter: LanguageAdapter,
    content: string,
    filePath: string,
    ...rest: [streamingNames: string[], legacyCount: number]
): NodeProjector | null {
    const [streamingNames, legacyCount] = rest;
    if (legacyCount > 0) return null;
    if (streamingNames.some((analyzerName) => !FAST_PATH_ANALYZERS.has(analyzerName))) return null;
    if (!fastPathEnabled()) return null;
    if (!isCallable(adapter.project)) return null;
    try {
        return adapter.project(content, filePath, getPolicyFromAnalyzers(streamingNames));
    } catch {
        return null;
    }
}
