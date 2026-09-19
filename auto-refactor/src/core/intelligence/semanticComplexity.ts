export { analyzeCrossFunctionComplexity } from './crossFunctionComplexity';
export { MAX_COMPLEXITY_TRACE_DEPTH } from './crossFunctionComplexity';

/**
 * Module: Core Intelligence — Spatiotemporal Complexity Semantic Analyzer
 * File Path: src/core/intelligence/semanticComplexity.ts
 * Architecture Role: Graph- and AST-driven semantic reasoning engine for time, space, and
 *   lifecycle complexity; derives composite polynomial order across multi-file call chains.
 * Dependencies & Triggers: Imports CallGraph and SymbolIndex from ./callGraph and ./symbolIndex,
 *   core types (Issue, SemanticReviewDetail, SemanticEvidenceStep); invoked during complexity
 *   review and post-scan report finalization.
 * Responsibilities: Differentiate bounded collections from unbounded dynamic input streams;
 *   trace cross-function/cross-file polynomial loops (CPX-TIME-001); detect hot-path transient
 *   allocations (CPX-SPACE-001); detect unbounded recursion cycles (CPX-REC-001); detect
 *   amplification hazards like nested I/O or serialization in call chains (CPX-AMP-001).
 * Exit Semantics & Design Rationale: Pure in-memory graph walk without disk I/O or throwing;
 *   returns structured Issue records conforming strictly to the Section VII result schema.
 */

import type { CallGraph } from './callGraph';
import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';

/** Threshold of call depth when tracing polynomial cross-function complexity. */

/** Maximum collection size considered bounded/small-scale (e.g. enum/options). */
export const BOUNDED_COLLECTION_MAX_SIZE = 16;

/**
 * Descriptor of a loop or traversal site within a function.
 */
export interface LoopSite {
    file: string;
    line: number;
    symbol: string;
    isBounded: boolean;
    scaleVariable: string;
    hasTransientAllocation: boolean;
    hasBlockingIo: boolean;
}

/**
 * Options controlling semantic complexity deduction.
 */
export interface SemanticComplexityOptions {
    checkCrossFunctionComplexity?: boolean;
    distinguishBoundedCollections?: boolean;
    maxTraceDepth?: number;
}

/**
 * Identify whether an input scale variable or expression is statically bounded.
 *
 * @param expr - Expression or identifier text being iterated.
 * @returns True when the collection is a known small enum, fixed config, or slice.
 */
export function isBoundedCollection(expr: string): boolean {
    const trimmed = expr.trim();
    if (/^(?:Object\.(?:keys|values|entries)|\[.*\]|enum|CONFIG_[A-Z0-9_]+)/.test(trimmed)) {
        return true;
    }
    if (/\b(?:take|slice|limit)\s*\(\s*(?:[1-9]|1[0-6])\s*\)/.test(trimmed)) {
        return true;
    }
    return false;
}

/**
 * Detect recursion cycles in the call graph that lack verified termination bounds.
 *
 * @param callGraph - Cross-file call graph.
 * @param recursiveSymbolsWithGuards - Set of symbol names verified to have depth guards.
 * @returns Issues reporting unverified recursion cycles (CPX-REC-001).
 */
export function detectUnboundedRecursion(
    callGraph: CallGraph,
    recursiveSymbolsWithGuards: Set<string>,
): Issue[] {
    const issues: Issue[] = [];
    const allEdges = callGraph.edges();

    const adj = new Map<string, Array<{ callee: string; file: string; line: number | null }>>();
    for (const edge of allEdges) {
        if (!edge.caller) continue;
        const list = adj.get(edge.caller) ?? [];
        list.push({ callee: edge.callee, file: edge.callerFile, line: edge.line });
        adj.set(edge.caller, list);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const stack: string[] = [];

    function dfs(u: string): void {
        visited.add(u);
        inStack.add(u);
        stack.push(u);

        const neighbors = adj.get(u) ?? [];
        for (const { callee, file, line } of neighbors) {
            if (!visited.has(callee)) {
                dfs(callee);
            } else if (inStack.has(callee)) {
                const cycleStartIndex = stack.indexOf(callee);
                const cycle = stack.slice(cycleStartIndex).concat(callee);
                const cycleKey = cycle.join(' -> ');

                const hasGuard = cycle.some((sym) => recursiveSymbolsWithGuards.has(sym));
                if (!hasGuard) {
                    const primaryLine = line ?? 1;
                    const evidence: SemanticEvidenceStep[] = cycle.map((sym, idx) => ({
                        kind: 'call',
                        description: `Step ${idx + 1}: calls '${sym}'`,
                        file,
                        line: primaryLine,
                        symbol: sym,
                    }));

                    const detail: SemanticReviewDetail = {
                        language: 'typescript',
                        module: 'core',
                        symbol: u,
                        codeDomain: 'recursion-lifecycle',
                        currentBehavior: `Mutual recursive invocation cycle: ${cycleKey}`,
                        semanticEvidenceChain: evidence,
                        triggerCondition:
                            'Cyclic call path detected without verifiable base-case depth guard',
                        risk: 'Potential call-stack exhaustion (StackOverflowError) under pathological or cyclic input graphs.',
                        blastRadius: [file],
                        isDeterministic: true,
                        requiresManualConfirm: true,
                        suggestedFix:
                            'Introduce an explicit depth accumulator parameter with termination threshold, or rewrite using an iterative worklist.',
                        impactedCallers: callGraph.callersOf(u).map((e) => e.caller ?? 'unknown'),
                        impactedTests: [],
                        verificationMethod:
                            'Test with deep tree or cyclic data structures to verify graceful termination.',
                        ruleVersion: '1.0.0',
                        configVersion: '0.3.0',
                        canAutofix: false,
                    };

                    issues.push({
                        id: `complexity:CPX-REC-001:${file}:${primaryLine}`,
                        analyzer: 'complexity',
                        rule: 'CPX-REC-001',
                        severity: 'error',
                        message: `Potential unbounded recursion cycle: ${cycleKey}`,
                        location: {
                            file,
                            start: { line: primaryLine, column: 1 },
                            end: { line: primaryLine, column: 80 },
                        },
                        detail,
                        suggestion:
                            'Convert to iterative stack loop or pass a bounded depth counter.',
                        evidence: {
                            confidence: 0.9,
                            requiresRuntime: false,
                        },
                    });
                }
            }
        }

        stack.pop();
        inStack.delete(u);
    }

    for (const caller of adj.keys()) {
        if (!visited.has(caller)) {
            dfs(caller);
        }
    }

    return issues;
}

/**
 * Detect complexity amplification hazards where I/O or heavy allocations happen inside loops.
 *
 * @param loopSites - Map of function symbol to its local loop sites.
 * @returns Issues for complexity amplification (CPX-AMP-001 and CPX-SPACE-001).
 */
export function detectComplexityAmplification(loopSites: Map<string, LoopSite[]>): Issue[] {
    const issues: Issue[] = [];

    for (const [symbol, sites] of loopSites.entries()) {
        for (const site of sites) {
            if (site.isBounded) continue;

            if (site.hasBlockingIo) {
                const evidence: SemanticEvidenceStep[] = [
                    {
                        kind: 'loop',
                        description: `Iteration over dynamic scale variable '${site.scaleVariable}'`,
                        file: site.file,
                        line: site.line,
                        symbol,
                    },
                    {
                        kind: 'io',
                        description: 'Synchronous I/O or network call triggered per iteration',
                        file: site.file,
                        line: site.line,
                        symbol,
                    },
                ];

                const detail: SemanticReviewDetail = {
                    language: 'typescript',
                    module: 'core',
                    symbol,
                    codeDomain: 'io-amplification',
                    currentBehavior: `Executing synchronous blocking I/O or serialization per loop iteration over '${site.scaleVariable}'.`,
                    semanticEvidenceChain: evidence,
                    triggerCondition: 'I/O operation located inside unbounded iteration body',
                    risk: 'Multiplies disk/network latency by collection cardinality N, freezing worker thread.',
                    blastRadius: [site.file],
                    isDeterministic: true,
                    requiresManualConfirm: false,
                    suggestedFix:
                        'Batch I/O operations outside the loop or buffer into a batch write.',
                    impactedCallers: [],
                    impactedTests: [],
                    verificationMethod:
                        'Profile I/O operation count under varying collection sizes.',
                    ruleVersion: '1.0.0',
                    configVersion: '0.3.0',
                    canAutofix: false,
                };

                issues.push({
                    id: `complexity:CPX-AMP-001:${site.file}:${site.line}`,
                    analyzer: 'complexity',
                    rule: 'CPX-AMP-001',
                    severity: 'warning',
                    message: `Complexity amplification hazard: synchronous I/O executed inside loop over '${site.scaleVariable}'.`,
                    location: {
                        file: site.file,
                        start: { line: site.line, column: 1 },
                        end: { line: site.line, column: 80 },
                    },
                    detail,
                    suggestion: 'Refactor to batch read/write before or after the loop.',
                    evidence: {
                        confidence: 0.95,
                        requiresRuntime: false,
                    },
                });
            }

            if (site.hasTransientAllocation) {
                const evidence: SemanticEvidenceStep[] = [
                    {
                        kind: 'loop',
                        description: `Unbounded iteration over '${site.scaleVariable}'`,
                        file: site.file,
                        line: site.line,
                        symbol,
                    },
                    {
                        kind: 'allocation',
                        description: 'Transient heap object or collection cloned inside loop',
                        file: site.file,
                        line: site.line,
                        symbol,
                    },
                ];

                const detail: SemanticReviewDetail = {
                    language: 'typescript',
                    module: 'core',
                    symbol,
                    codeDomain: 'memory-allocation',
                    currentBehavior: `Repeated transient object/array allocation in hot loop over '${site.scaleVariable}'.`,
                    semanticEvidenceChain: evidence,
                    triggerCondition: 'Heap allocation inside unbounded loop path',
                    risk: 'Excessive garbage collection thrashing and memory retention spikes.',
                    blastRadius: [site.file],
                    isDeterministic: true,
                    requiresManualConfirm: false,
                    suggestedFix: 'Hoist buffer/object allocation outside loop and reset in-place.',
                    impactedCallers: [],
                    impactedTests: [],
                    verificationMethod: 'Check heap allocations with memory profiler.',
                    ruleVersion: '1.0.0',
                    configVersion: '0.3.0',
                    canAutofix: false,
                };

                issues.push({
                    id: `complexity:CPX-SPACE-001:${site.file}:${site.line}`,
                    analyzer: 'complexity',
                    rule: 'CPX-SPACE-001',
                    severity: 'warning',
                    message: `Unbounded transient allocation: heap memory allocated repeatedly in loop over '${site.scaleVariable}'.`,
                    location: {
                        file: site.file,
                        start: { line: site.line, column: 1 },
                        end: { line: site.line, column: 80 },
                    },
                    detail,
                    suggestion: 'Hoist allocation outside the loop and clear/reuse the instance.',
                    evidence: {
                        confidence: 0.9,
                        requiresRuntime: false,
                    },
                });
            }
        }
    }

    return issues;
}
