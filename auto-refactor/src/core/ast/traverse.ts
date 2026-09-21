import type { AnalyzerContext, Issue, FileMetric } from '../types';
import type { NormalizedNode, LanguageAdapter, NodeProjector, ProjectionPolicy } from './multilang';
import { NodeKind } from './multilang';

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
 *   fastPathEnabled, policyFromAnalyzers, and tryCreateProjector build the lazy path.
 * Exit Semantics & Design Rationale: analyzer exceptions become one core:analyzer-error issue
 *   (error severity only under failOnAnalyzerError) instead of aborting the scan;
 *   tryCreateProjector returns null on an ineligible gate or projector failure so the caller
 *   falls back to materialized traversal. One descent replaces N re-walks, inlined scope
 *   frames avoid per-node allocation, and staying TypeScript-free preserves oxc byte parity.
 */

/** An analyzer + its per-file merged context, participating in the shared pass. */
export interface StreamingEntry {
    analyzer: {
        name: string;
        visit?(
            node: NormalizedNode,
            ctx: AnalyzerContext,
            parent: NormalizedNode | undefined,
            grandparent: NormalizedNode | undefined,
            depth: number,
            className: string | null,
            binding: string | null,
        ): void;
        finalize?(ctx: AnalyzerContext): Issue[];
    };
    ctx: AnalyzerContext;
}

/** `typeof` tag detecting analyzer visit()/finalize() methods on entries/projections. */
const TYPEOF_FUNCTION = 'function';

/**
 * Narrow an optional hook to its callable type. Control-flow analysis only narrows a direct
 * `typeof x === 'function'` comparison, so the named tag above needs this explicit predicate.
 */
function isCallable<T extends (...args: never[]) => unknown>(value: T | undefined): value is T {
    return typeof value === TYPEOF_FUNCTION;
}

/**
 * Run the single shared traversal over the normalized tree, dispatching to each entry's
 * `visit` (per node) and `finalize` (once). Analyzers without `visit`/`finalize` are skipped
 * (they are handled by the legacy `analyze` path elsewhere). Per-analyzer errors during
 * `visit`/`finalize` become a single `core:analyzer-error` Issue per analyzer.
 * @param adapter - Language adapter supplying `children()` over the normalized tree.
 * @param root - Normalized SourceFile root; its children are visited but the root itself is
 *   not dispatched.
 * @param entries - Analyzer plus merged-context pairs participating in this pass, dispatched
 *   in array order.
 * @returns Issues emitted by each analyzer's `finalize`, plus at most one analyzer-error issue
 *   per analyzer that threw during `visit` or `finalize`; direct `visit` output is discarded.
 */
export function runStreaming(
    adapter: LanguageAdapter,
    root: NormalizedNode,
    entries: StreamingEntry[],
): Issue[] {
    const issues: Issue[] = [];
    const errored = new Set<string>();

    // Pre-bind visit/finalize once per file: saves the per-node `typeof` check and property
    // lookups on the hot path (significant for many-tiny-files workloads).
    const visits = entries.map((a) =>
        isCallable(a.analyzer.visit) ? a.analyzer.visit.bind(a.analyzer) : null,
    );

    const pushError = (name: string, e: unknown, ctx: AnalyzerContext) => {
        if (errored.has(name)) return; // one error issue per analyzer per file
        errored.add(name);
        const sev = ctx.config.failOnAnalyzerError ? 'error' : 'info';
        issues.push({
            id: `core:analyzer-error:${ctx.filePath}:1`,
            analyzer: name,
            rule: 'analyzer-error',
            severity: sev,
            message: `Analyzer "${name}" threw: ${(e as Error).message}`,
            location: {
                file: ctx.filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 1 },
            },
            detail: { error: String(e) },
        });
    };

    const visitNode = (
        node: NormalizedNode,
        parent: NormalizedNode | undefined,
        grandparent: NormalizedNode | undefined,
        depth: number,
        className: string | null,
        binding: string | null,
    ): void => {
        for (let i = 0; i < visits.length; i++) {
            const v = visits[i];
            if (!v) continue;
            try {
                v(node, entries[i].ctx, parent, grandparent, depth, className, binding);
            } catch (e) {
                pushError(entries[i].analyzer.name, e, entries[i].ctx);
            }
        }

        // Compute the scope frame for this node's children. The scope rules are
        // identical for every adapter (both built-ins were byte-for-byte the same), so the
        // derivation is inlined here with plain local variables — ZERO object allocation
        // per node (previously one `{className, binding}` object per node, ~8.6k/file).
        // Language-specific rules are expressed through the normalized flags only.
        const childDepth = depth + (node.increasesNesting ? 1 : 0);
        let cName = className;
        let cBinding = binding;
        if (node.isClassDefining) {
            cName = node.name ?? className;
            cBinding = null;
        } else if (node.functionLike) {
            cBinding = null;
        } else if (node.introducesBinding) {
            cBinding = node.bindingName ?? binding;
        }

        for (const c of adapter.children(node)) {
            visitNode(c, node, parent, childDepth, cName, cBinding);
        }
    };

    for (const c of adapter.children(root)) {
        visitNode(c, root, undefined, 0, null, null);
    }

    for (const a of entries) {
        if (!isCallable(a.analyzer.finalize)) continue;
        try {
            issues.push(...a.analyzer.finalize(a.ctx));
        } catch (e) {
            pushError(a.analyzer.name, e, a.ctx);
        }
    }
    return issues;
}

/**
 * Structural-metric collector that runs inside the shared pass and produces the per-file
 * `FileMetric`. Top-level detection uses the adapter-precomputed `node.topLevel` flag plus the
 * threaded `parent` (kind === SourceFile), so no explicit source-file reference is needed.
 */
export class FileMetricCollector {
    name = '__metric__' as const;
    functions = 0;
    maxNesting = 0;
    topLevelDeclarations = 0;
    exportedSymbols = 0;
    metric: FileMetric | null = null;

    visit(
        node: NormalizedNode,
        _ctx: AnalyzerContext,
        parent: NormalizedNode | undefined,
        _grandparent: NormalizedNode | undefined,
        depth: number,
        _className: string | null,
        _binding: string | null,
    ): void {
        if (node.functionLike) this.functions++;
        if (depth > this.maxNesting) this.maxNesting = depth;
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
            for (const l of ctx.content.split(/\r\n|\n/)) {
                lines++;
                if (l.trim().length > 0) nonBlankLines++;
            }
        }
        this.metric = {
            file: ctx.filePath,
            lines,
            nonBlankLines,
            functions: this.functions,
            maxNestingDepth: this.maxNesting,
            topLevelDeclarations: this.topLevelDeclarations,
            exportedSymbols: this.exportedSymbols,
        };
        return [];
    }
}

// ---------------------------------------------------------------------------
// Lazy-projection fast path (see docs/02-parsers-and-ast/03-lazy-projection.md §2.3, §2.6).
// traverse.ts stays ts-free: it drives the projector through the language-agnostic
// NodeProjector interface only, so the oxc worker's lazy-typescript benefit is preserved.
// ---------------------------------------------------------------------------

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
 * @returns Issues emitted by each analyzer's `finalize`, plus at most one analyzer-error issue
 *   per analyzer that threw during `visit` or `finalize`; projector exceptions propagate to
 *   the caller so it can fall back to the materialized path.
 */
export function runStreamingProjected(
    projector: NodeProjector,
    entries: StreamingEntry[],
    onNode?: (node: NormalizedNode, caller: string | null) => void,
): Issue[] {
    const issues: Issue[] = [];
    const errored = new Set<string>();

    // Pre-bind visit/finalize once per file (same hot-path savings as runStreaming).
    const visits = entries.map((a) =>
        isCallable(a.analyzer.visit) ? a.analyzer.visit.bind(a.analyzer) : null,
    );

    const pushError = (name: string, e: unknown, ctx: AnalyzerContext) => {
        if (errored.has(name)) return; // one error issue per analyzer per file
        errored.add(name);
        const sev = ctx.config.failOnAnalyzerError ? 'error' : 'info';
        issues.push({
            id: `core:analyzer-error:${ctx.filePath}:1`,
            analyzer: name,
            rule: 'analyzer-error',
            severity: sev,
            message: `Analyzer "${name}" threw: ${(e as Error).message}`,
            location: {
                file: ctx.filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 1 },
            },
            detail: { error: String(e) },
        });
    };

    const rootRaw = projector.root;
    // The root is never dispatched to visits; project it once so top-level children receive a
    // REAL SourceFile projection as `parent` (L/M top-level detection) and as ctx.root.
    const rootProj = projector.project(rootRaw, undefined, undefined);

    const visitRaw = (
        raw: unknown,
        parentRaw: unknown | undefined,
        grandparentRaw: unknown | undefined,
        depth: number,
        className: string | null,
        binding: string | null,
        parentProj: NormalizedNode | undefined,
        grandparentProj: NormalizedNode | undefined,
        caller: string | null,
    ): void => {
        const node = projector.project(raw, parentRaw, grandparentRaw);
        // Scan-wide consumers (the cross-file symbol index) observe the SAME projected nodes the
        // analyzers see; this is the only point where the lazy path has a NormalizedNode in hand.
        if (onNode) onNode(node, caller);
        for (let i = 0; i < visits.length; i++) {
            const v = visits[i];
            if (!v) continue;
            try {
                v(node, entries[i].ctx, parentProj, grandparentProj, depth, className, binding);
            } catch (e) {
                pushError(entries[i].analyzer.name, e, entries[i].ctx);
            }
        }

        // Scope frame for this node's children — byte-identical derivation to runStreaming
        // (the same inlined scope rules, expressed through the projected normalized flags).
        const childDepth = depth + (node.increasesNesting ? 1 : 0);
        let cName = className;
        let cBinding = binding;
        if (node.isClassDefining) {
            cName = node.name ?? className;
            cBinding = null;
        } else if (node.functionLike) {
            cBinding = null;
        } else if (node.introducesBinding) {
            cBinding = node.bindingName ?? binding;
        }

        // Nearest enclosing function-like name, tracked for the scan-wide observer so a call
        // site is attributed to its caller on the lazy path exactly as on the materialized one.
        const cCaller = node.functionLike && typeof node.name === 'string' ? node.name : caller;

        for (const c of projector.forEachChild(raw)) {
            visitRaw(c, raw, parentRaw, childDepth, cName, cBinding, node, parentProj, cCaller);
        }
    };

    for (const c of projector.forEachChild(rootRaw)) {
        visitRaw(c, rootRaw, undefined, 0, null, null, rootProj, undefined, null);
    }

    for (const a of entries) {
        if (!isCallable(a.analyzer.finalize)) continue;
        try {
            issues.push(...a.analyzer.finalize(a.ctx));
        } catch (e) {
            pushError(a.analyzer.name, e, a.ctx);
        }
    }
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
export function policyFromAnalyzers(names: string[]): ProjectionPolicy {
    const set = new Set(names);
    const needComplexity = set.has('complexity');
    const needLiterals = set.has('constants');
    const needNames = needComplexity || set.has('large-file');
    const needPositions = needComplexity || needLiterals;
    // `needSymbols` is scan-wide: the cross-file symbol index consumes declaration names/
    // positions and call names on every scan, independently of which analyzers are enabled.
    // B2b STILL OPEN: the projector's placeholder gate (typescriptAdapter `project`) drops
    // call nodes before this policy is consulted, so the lazy fast path currently yields an
    // empty index and reports builtFrom='projection' instead of faking completeness.
    return { needComplexity, needLiterals, needNames, needPositions, needSymbols: true };
}

/**
 * Routing gate: build the lazy-projection source for one file, or null when the fast path
 * cannot apply (gate off, ineligible analyzers, adapter without project(), or any projector
 * creation failure → caller falls back to the materialized path).
 * @param adapter - Language adapter that may implement `project()`; adapters without it force
 *   the materialized path.
 * @param content - Full UTF-16 source text to parse lazily.
 * @param filePath - File path passed to the adapter for parser/diagnostic context.
 * @param streamingNames - Names of the enabled streaming analyzers; any name outside
 *   FAST_PATH_ANALYZERS rejects the fast path.
 * @param legacyCount - Number of analyzers using the legacy `analyze()` contract; any
 *   positive count rejects the fast path.
 * @returns A projector bound to the content, or null when the gate rejects the file or
 *   `adapter.project` throws; null means the caller must parse and run the materialized path.
 */
export function tryCreateProjector(
    adapter: LanguageAdapter,
    content: string,
    filePath: string,
    streamingNames: string[],
    legacyCount: number,
): NodeProjector | null {
    if (legacyCount > 0) return null;
    if (streamingNames.some((n) => !FAST_PATH_ANALYZERS.has(n))) return null;
    if (!fastPathEnabled()) return null;
    if (!isCallable(adapter.project)) return null;
    try {
        return adapter.project(content, filePath, policyFromAnalyzers(streamingNames));
    } catch {
        return null;
    }
}
