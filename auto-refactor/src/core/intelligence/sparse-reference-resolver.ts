/**
 * Module: Core Engine — Sparse Reference Resolver (Call-Graph Bridge)
 * File Path: src/core/intelligence/sparse-reference-resolver.ts
 * Architecture Role: Adapter turning a cross-file call graph into the bounded reference set the
 *   sparse reference replay planner needs. The planner lives in the AST layer and must not import
 *   the intelligence layer, so the direction is inverted here: intelligence owns the call graph
 *   and hands the planner a resolver closure.
 * Dependencies & Triggers: Consumes CallGraph from ./callGraph and the SparseReferenceAnchor /
 *   SparseReferenceResolver contracts from ../ast/sparse-reference-replay; used by Praxis callers.
 * Responsibilities:
 *   1. Rank the call sites of one symbol so the most significant references survive the cap.
 *   2. Emit at most `limit` anchors with file, line, caller and symbol populated.
 *   3. Prefer cross-file call sites, because same-file callers already sit inside the window.
 * Exit Semantics & Design Rationale: Pure derivation, no I/O, no throws. Cross-file edges rank
 *   first: a same-file caller is usually re-audited by the window anyway, so spending the budget on
 *   it would hide the one caller the window cannot reach. Ties are broken by file then line so the
 *   reference set is deterministic across runs and machines.
 */

import type { CallGraph, CallGraphEdge } from './callGraph';
import type {
    SparseReferenceAnchor,
    SparseReferenceResolver,
} from '../ast/sparse-reference-replay';

/** Rank weight for a call site living in another file. */
const CROSS_FILE_RANK = 2;

/** Rank weight for a same-file call site. */
const SAME_FILE_RANK = 1;

/** Deterministic tie-breaker comparing two edges by file then line. */
function compareEdges(edgeA: CallGraphEdge, edgeB: CallGraphEdge): number {
    if (edgeA.callerFile !== edgeB.callerFile) {
        return edgeA.callerFile < edgeB.callerFile ? -1 : 1;
    }
    return (edgeA.line ?? 0) - (edgeB.line ?? 0);
}

/** Convert one call-graph edge into the planner's sparse reference shape. */
function toAnchor(edge: CallGraphEdge, symbol: string): SparseReferenceAnchor {
    return {
        file: edge.callerFile,
        line: edge.line ?? 1,
        caller: edge.caller,
        symbol,
    };
}

/**
 * Build a resolver that keeps the most significant external call sites of a symbol.
 *
 * @param callGraph - Call graph built from the scan's shared symbol index.
 * @returns Resolver closure suitable for `SrSwaReplayRequest.resolveReferences`.
 */
export function createCallGraphReferenceResolver(callGraph: CallGraph): SparseReferenceResolver {
    return (symbol: string, limit: number): readonly SparseReferenceAnchor[] => {
        if (limit <= 0) return [];
        const edges = callGraph.callersOf(symbol).slice();
        edges.sort((edgeA, edgeB) => {
            const rankA = edgeA.crossFile ? CROSS_FILE_RANK : SAME_FILE_RANK;
            const rankB = edgeB.crossFile ? CROSS_FILE_RANK : SAME_FILE_RANK;
            return rankB - rankA || compareEdges(edgeA, edgeB);
        });
        const anchors: SparseReferenceAnchor[] = [];
        for (let i = 0; i < edges.length && anchors.length < limit; i++) {
            anchors.push(toAnchor(edges[i], symbol));
        }
        return anchors;
    };
}

/**
 * List the files a sparse reference set touches, in first-seen order.
 *
 * @param anchors - Reference anchors returned by a resolver.
 * @returns Distinct file paths.
 */
export function referenceFiles(anchors: readonly SparseReferenceAnchor[]): string[] {
    const files: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < anchors.length; i++) {
        const file = anchors[i].file;
        if (seen.has(file)) continue;
        seen.add(file);
        files.push(file);
    }
    return files;
}
