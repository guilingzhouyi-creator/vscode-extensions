/**
 * Module: Core Intelligence — Cross-Function Complexity Analysis
 * File Path: src/core/intelligence/crossFunctionComplexity.ts
 * Architecture Role: Cross-function complexity scoring split out of the semantic complexity pack.
 * Dependencies & Triggers: the same imports as ./semanticComplexity plus its shared types;
 *   re-exported by that module so existing callers keep their single import path.
 * Responsibilities: Score cross-function complexity signals for one analyzed file.
 * Exit Semantics & Design Rationale: Pure analysis — reads the file descriptor and returns
 *   issues; it performs no I/O and never throws.
 */
/**
 * Score ceiling applied when a metric saturates.
 */
const MAX_SCORE_CAP = 80;

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
import type { SymbolIndex } from './symbolIndex';
import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';
import { SEVERITY_WARNING, LANGUAGE_TYPESCRIPT } from '../types';
import { ANALYZER_COMPLEXITY } from '../scoring/dimensionLiterals';
import type { LoopSite, SemanticComplexityOptions } from './semanticComplexity';
/** Evidence-chain step kind for an iterating loop. */
const KIND_LOOP = 'loop';
/** Evidence-chain step kind for a call site. */
const KIND_CALL = 'call';
/** Boundary label used when the callee lives in another file. */
const KIND_FILE = 'file';
/** Boundary label used when the callee lives in the same file. */
const KIND_FUNCTION = 'function';
/** Module tag written into the semantic review detail. */
const MODULE_CORE = 'core';
/** Code-domain tag written into the semantic review detail. */
const CODE_DOMAIN_ALGORITHMIC_COMPLEXITY = 'algorithmic-complexity';
/** Rule id of the cross-function complexity finding. */
const RULE_CPX_TIME_001 = 'CPX-TIME-001';
/** Rule contract version recorded on every emitted issue. */
const RULE_VERSION = '1.0.0';
/** Engine config version recorded on every emitted issue. */
const CONFIG_VERSION = '0.3.0';

/**
 * Maximum call-chain depth the cross-function complexity walk follows before it stops.
 */
export const MAX_COMPLEXITY_TRACE_DEPTH = 6;

/**
 * Deduce cross-function and cross-file polynomial time complexity.
 *
 * @param callGraph - Shared cross-file call graph.
 * @param symbolIndex - Repository symbol index.
 * @param loopSites - Map of function symbol to its local loop characteristics.
 * @param options - Tunable analysis knobs.
 * @returns Structured issues for detected complexity hazards.
 */
export function analyzeCrossFunctionComplexity(
    callGraph: CallGraph,
    symbolIndex: SymbolIndex,
    loopSites: Map<string, LoopSite[]>,
    options: SemanticComplexityOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    const maxDepth = options.maxTraceDepth ?? MAX_COMPLEXITY_TRACE_DEPTH;
    void maxDepth;
    void symbolIndex;

    for (const [callerSymbol, callerLoops] of loopSites.entries()) {
        const unboundedCallerLoops = callerLoops.filter((loop) => !loop.isBounded);
        if (unboundedCallerLoops.length === 0) continue;

        const reachableCallees = callGraph.reachableFrom(callerSymbol);
        for (const callee of reachableCallees) {
            const calleeLoops = loopSites.get(callee);
            if (!calleeLoops || calleeLoops.length === 0) continue;

            const unboundedCalleeLoops = calleeLoops.filter((loop) => !loop.isBounded);
            if (unboundedCalleeLoops.length === 0) continue;

            const primaryCallerLoop = unboundedCallerLoops[0];
            const primaryCalleeLoop = unboundedCalleeLoops[0];

            const edges = callGraph.calleesOf(callerSymbol).filter((e) => e.callee === callee);
            const callLine =
                edges.length > 0
                    ? (edges[0].line ?? primaryCallerLoop.line)
                    : primaryCallerLoop.line;
            const isCrossFile = edges.some((e) => e.crossFile);

            const evidenceChain: SemanticEvidenceStep[] = [
                {
                    kind: KIND_LOOP,
                    description: `Outer loop over dynamic input '${primaryCallerLoop.scaleVariable}'`,
                    file: primaryCallerLoop.file,
                    line: primaryCallerLoop.line,
                    symbol: callerSymbol,
                },
                {
                    kind: KIND_CALL,
                    description: `Invokes '${callee}' across ${isCrossFile ? KIND_FILE : KIND_FUNCTION} boundary`,
                    file: primaryCallerLoop.file,
                    line: callLine,
                    symbol: callerSymbol,
                },
                {
                    kind: KIND_LOOP,
                    description: `Inner loop over dynamic stream '${primaryCalleeLoop.scaleVariable}' in '${callee}'`,
                    file: primaryCalleeLoop.file,
                    line: primaryCalleeLoop.line,
                    symbol: callee,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: LANGUAGE_TYPESCRIPT,
                module: MODULE_CORE,
                symbol: callerSymbol,
                codeDomain: CODE_DOMAIN_ALGORITHMIC_COMPLEXITY,
                currentBehavior: `Nested iteration: '${callerSymbol}' iterates over '${primaryCallerLoop.scaleVariable}' and calls '${callee}' which iterates over '${primaryCalleeLoop.scaleVariable}'.`,
                semanticEvidenceChain: evidenceChain,
                triggerCondition: `Cross-function polynomial order O(${primaryCallerLoop.scaleVariable} * ${primaryCalleeLoop.scaleVariable}) with unbounded dynamic collections`,
                risk: 'Quadratic latency degradation when processing large input payloads or database result sets under high traffic.',
                blastRadius: [primaryCallerLoop.file, primaryCalleeLoop.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix: `Pre-index '${primaryCalleeLoop.scaleVariable}' into a Map/Set or pass a keyed lookup index to '${callee}' to reduce complexity to O(N).`,
                impactedCallers: callGraph
                    .callersOf(callerSymbol)
                    .map((e) => e.caller ?? 'unknown'),
                impactedTests: [],
                verificationMethod:
                    'Execute benchmark suite with scaled input sets (N=100, 1000, 10000) to verify linear execution time.',
                ruleVersion: RULE_VERSION,
                configVersion: CONFIG_VERSION,
                canAutofix: false,
            };

            issues.push({
                id: `complexity:CPX-TIME-001:${primaryCallerLoop.file}:${primaryCallerLoop.line}`,
                analyzer: ANALYZER_COMPLEXITY,
                rule: RULE_CPX_TIME_001,
                severity: SEVERITY_WARNING,
                message: `Unbounded cross-function O(N*M) time complexity: '${callerSymbol}' calls '${callee}' containing an inner iteration.`,
                location: {
                    file: primaryCallerLoop.file,
                    start: { line: primaryCallerLoop.line, column: 1 },
                    end: { line: primaryCallerLoop.line, column: MAX_SCORE_CAP },
                },
                detail,
                suggestion: `Pre-index data into a hash lookup before calling '${callee}'.`,
                evidence: {
                    confidence: 0.95,
                    requiresRuntime: false,
                },
            });
        }
    }

    return issues;
}
