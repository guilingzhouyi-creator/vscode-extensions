/**
 * Module: Core Engine - Cross-file Call Graph (Repository Intelligence consumer)
 * File Path: src/core/intelligence/callGraph.ts
 * Architecture Role: The call-graph view over the shared symbol index: it turns the call
 *     references the single traversal already collected into resolved caller -> callee edges, so
 *     reviewers (error propagation, data flow, impact analysis) walk the graph instead of parsing
 *     files again
 * Dependencies & Triggers: `SymbolIndex` from ./symbolIndex; built by the scanner after the
 *     per-file traversal completes and published as `summary.callGraph`
 * Responsibilities: Join call sites to their defining files, mark unresolved (external/stdlib)
 *     calls instead of dropping or inventing a target, expose `calleesOf`/`callersOf` and a
 *     cycle-safe `reachableFrom` walk, and report coverage counters
 * Exit Semantics & Design Rationale: Pure in-memory derivation - no I/O, no throwing, deterministic
 *     ordering (names sorted, edges by caller then file then line). Caller attribution is honest:
 *     a call site whose enclosing declaration the adapter did not materialize keeps `caller: null`
 *     and is counted as unattributed rather than being attached to an arbitrary symbol; in the same
 *     spirit an unresolvable callee keeps `calleeFile: null` and is counted as unresolved instead
     of
 *     being silently dropped, because a silently dropped call is a false negative in every
 *     downstream propagation question.
 */
import type { SymbolIndex } from './symbolIndex';

/** One resolved (or explicitly unresolved) caller -> callee edge. */
export interface CallGraphEdge {
    /** Enclosing declaration of the call site, or null when the traversal could not attribute it.
     */
    caller: string | null;
    /** File the call site lives in. */
    callerFile: string;
    /** Called name, reduced to its final segment. */
    callee: string;
    /** File owning the resolved definition, or null when the callee is unresolved. */
    calleeFile: string | null;
    /** 1-based call line, or null when no position was materialized. */
    line: number | null;
    /** True when the callee's definition lives in another file (or in several files). */
    crossFile: boolean;
    /** True when at least one definition was found for the callee. */
    resolved: boolean;
    /** Number of definitions the name resolved to (>1 means an ambiguous target). */
    definitionCount: number;
}

/** Coverage counters for the published call graph. */
export interface CallGraphStats {
    /** Distinct attributed callers. */
    callers: number;
    /** Distinct callee names, resolved or not. */
    callees: number;
    /** Total edges. */
    edges: number;
    /** Edges whose callee resolved to at least one definition. */
    resolvedEdges: number;
    /** Edges whose callee resolved to nothing (external, stdlib, dynamic). */
    unresolvedEdges: number;
    /** Edges crossing a file boundary. */
    crossFileEdges: number;
    /** Edges whose enclosing declaration was materialized. */
    attributedEdges: number;
    /** Traversal provenance copied from the symbol index. */
    builtFrom: string;
}

const TRACE_LIMIT = 10000;

/**
 * Cross-file call graph derived from a symbol index.
 *
 * Construction is a single linear pass over the index's names; no file is read and no AST is
 * rebuilt, so callers can build it per scan without touching the hot path.
 */
export class CallGraph {
    private readonly allEdges: CallGraphEdge[] = [];

    private readonly indexed = new Set<string>();

    private builtFrom = 'materialized';

    /**
     * Build the graph from a filled symbol index.
     *
     * @param index - The shared symbol index (definitions plus call references).
     */
    constructor(index: SymbolIndex) {
        const called = index.calledNames();
        const names = [...new Set([...index.names(), ...called])].sort();
        for (const name of names) {
            const { definitions, references } = index.resolve(name);
            const calleeFile = definitions.length > 0 ? definitions[0].file : null;
            for (const reference of references) {
                this.allEdges.push({
                    caller: reference.caller ?? null,
                    callerFile: reference.file,
                    callee: name,
                    calleeFile,
                    line: reference.line,
                    crossFile: calleeFile === null ? false : calleeFile !== reference.file,
                    resolved: definitions.length > 0,
                    definitionCount: definitions.length,
                });
            }
        }
        this.allEdges.sort(
            (a, b) =>
                (a.caller ?? '').localeCompare(b.caller ?? '') ||
                a.callerFile.localeCompare(b.callerFile) ||
                (a.line ?? 0) - (b.line ?? 0) ||
                a.callee.localeCompare(b.callee),
        );
        this.builtFrom = index.stats().builtFrom;
    }

    /**
     * List every edge, deterministically ordered.
     *
     * @returns A copy of the edge list.
     */
    edges(): CallGraphEdge[] {
        return [...this.allEdges];
    }

    /**
     * List the edges where a given declaration is the caller.
     *
     * @param caller - Enclosing declaration name.
     * @returns Matching edges.
     */
    calleesOf(caller: string): CallGraphEdge[] {
        return this.allEdges.filter((edge) => edge.caller === caller);
    }

    /**
     * List the edges where a given name is called.
     *
     * @param callee - Called name.
     * @returns Matching edges.
     */
    callersOf(callee: string): CallGraphEdge[] {
        return this.allEdges.filter((edge) => edge.callee === callee);
    }

    /**
     * Walk every callee reachable from a declaration, breadth-first and cycle-safe.
     *
     * @param caller - Declaration to start from.
     * @returns Reachable callee names in discovery order, excluding the start name.
     */
    reachableFrom(caller: string): string[] {
        const seen = new Set<string>([caller]);
        const order: string[] = [];
        const queue: string[] = [caller];
        while (queue.length > 0 && order.length < TRACE_LIMIT) {
            const current = queue.shift() as string;
            for (const edge of this.calleesOf(current)) {
                if (seen.has(edge.callee)) continue;
                seen.add(edge.callee);
                order.push(edge.callee);
                if (edge.resolved) queue.push(edge.callee);
            }
        }
        return order;
    }

    /**
     * Coverage counters for the report summary.
     *
     * @returns Aggregate statistics.
     */
    stats(): CallGraphStats {
        const callers = new Set<string>();
        const callees = new Set<string>();
        let resolvedEdges = 0;
        let crossFileEdges = 0;
        let attributedEdges = 0;
        for (const edge of this.allEdges) {
            callees.add(edge.callee);
            if (edge.caller !== null) {
                callers.add(edge.caller);
                attributedEdges += 1;
            }
            if (edge.resolved) resolvedEdges += 1;
            if (edge.crossFile) crossFileEdges += 1;
        }
        return {
            callers: callers.size,
            callees: callees.size,
            edges: this.allEdges.length,
            resolvedEdges,
            unresolvedEdges: this.allEdges.length - resolvedEdges,
            crossFileEdges,
            attributedEdges,
            builtFrom: this.builtFrom,
        };
    }
}
