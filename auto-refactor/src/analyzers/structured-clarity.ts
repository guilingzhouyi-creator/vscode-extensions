/**
 * Module: Static Analysis Engine — Structured Clarity Exemption Evaluator
 * File Path: src/analyzers/structured-clarity.ts
 * Architecture Role: Evaluates functions for structured clarity, shallow branching depth, and
 *   explicit dispatch patterns to grant elastic cyclomatic complexity exemptions.
 * Dependencies & Triggers: ../core/types, ../core/multilang; called by ComplexityAnalyzer.
 * Responsibilities: Compute maximum control-flow nesting depth, inspect docstrings for
 *   contract annotations (@structured-dispatch, @state-machine), and compute relaxed thresholds.
 * Exit Semantics & Design Rationale: Pure AST and text analysis; never throws and performs no I/O.
 *   Prevents harmful forced decomposition of clean, readable state machines and dispatch tables.
 */
import type { AnalyzerContext } from '../core/types';
import type { NormalizedNode } from '../core/multilang';
import { NodeKind } from '../core/multilang';

/** Number of preceding lines inspected for JSDoc or structured dispatch contract markers. */
const JSDOC_LOOKAHEAD_LINES = 10;

/**
 * Result of structured clarity analysis on a function-like node.
 */
export interface StructuredClarityResult {
    /** Maximum branch/control-flow nesting depth inside the function. */
    maxDepth: number;
    /** Whether the function qualifies for structured clarity relaxation. */
    isStructurallyClear: boolean;
    /** Effective warning threshold after relaxation. */
    effectiveWarn: number;
    /** Effective failure threshold after relaxation. */
    effectiveFail: number;
    /** Rationale describing why relaxation was granted or denied. */
    rationale?: string;
}

/**
 * Compute the maximum control-flow nesting depth inside a function node.
 * Does not descend into child function-like nodes.
 * Excludes redundant Block containers to measure true control-flow branch depth.
 *
 * @param node - Function node being analyzed.
 * @param currentDepth - Current nesting depth in traversal.
 * @returns Maximum nesting depth observed.
 */
function computeMaxBranchDepth(node: NormalizedNode, currentDepth = 0): number {
    let max = currentDepth;
    const kids = node.children;
    if (!kids) return max;
    for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.functionLike) continue;
        const isNestingControl =
            c.kind === NodeKind.ControlFlow ||
            (Boolean(c.increasesNesting) && c.kind !== NodeKind.Block);
        const nextDepth = isNestingControl ? currentDepth + 1 : currentDepth;
        const childMax = computeMaxBranchDepth(c, nextDepth);
        if (childMax > max) max = childMax;
    }
    return max;
}

/**
 * Check if the function declaration has documentation or structured contract annotation.
 *
 * @param content - Entire source file text.
 * @param startLine - Starting line number of the function (1-based).
 * @returns Contract presence and explicit dispatch annotation indicators.
 */
function inspectFunctionContract(
    content: string,
    startLine: number,
): { hasContract: boolean; isExplicitDispatch: boolean } {
    if (!content || startLine <= 1) return { hasContract: false, isExplicitDispatch: false };
    const lines = content.split('\n');
    const checkStart = Math.max(0, startLine - JSDOC_LOOKAHEAD_LINES);
    const preceding = lines.slice(checkStart, startLine - 1).join('\n');

    const isExplicitDispatch =
        /@(?:structured-dispatch|state-machine|table-dispatch|flat-dispatch)/i.test(preceding);
    const hasDocComment = /\/\*\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|##/.test(preceding);

    return {
        hasContract: isExplicitDispatch || hasDocComment,
        isExplicitDispatch,
    };
}

/**
 * Evaluate structured clarity for a function-like node.
 * Functions with shallow control flow (maxDepth <= 2) and contract documentation
 * receive elastic threshold relaxation to avoid harmful forced refactoring.
 *
 * @param node - Normalized AST node of the function being analyzed.
 * @param ctx - Analyzer context carrying source content and options.
 * @param baseWarn - Configured cyclomatic complexity warning threshold.
 * @param baseFail - Configured cyclomatic complexity failure threshold.
 * @returns Structured clarity evaluation result with elastic thresholds.
 */
export function evaluateStructuredClarity(
    node: NormalizedNode,
    ctx: AnalyzerContext,
    baseWarn: number,
    baseFail: number,
): StructuredClarityResult {
    const maxDepth = computeMaxBranchDepth(node, 0);
    const startLine = node.start?.line ?? 1;
    const { hasContract, isExplicitDispatch } = inspectFunctionContract(ctx.content, startLine);

    if (maxDepth <= 2 && hasContract) {
        const multiplier = isExplicitDispatch ? 2.0 : 1.5;
        const effectiveWarn = Math.round(baseWarn * multiplier);
        const effectiveFail = Math.round(baseFail * multiplier);
        return {
            maxDepth,
            isStructurallyClear: true,
            effectiveWarn,
            effectiveFail,
            rationale: isExplicitDispatch
                ? 'Annotated structured dispatch: threshold relaxed by 100%'
                : 'Documented shallow control-flow: threshold relaxed by 50%',
        };
    }

    return {
        maxDepth,
        isStructurallyClear: false,
        effectiveWarn: baseWarn,
        effectiveFail: baseFail,
    };
}

/** Cyclomatic complexity value at or above which the hint is critical. */
const CRITICAL_COMPLEXITY_THRESHOLD = 30;

/** Cyclomatic complexity value at or above which the hint is high. */
const HIGH_COMPLEXITY_THRESHOLD = 20;

/** Number of tips shown for high complexity tier. */
const HIGH_COMPLEXITY_TIP_COUNT = 3;

/** Optimization guidance tips for reducing cyclomatic complexity. */
const OPTIMIZATION_TIPS: readonly string[] = [
    'Extract deeply nested branches into small, well-named helper functions.',
    'Replace nested conditionals with early returns / guard clauses.',
    'Replace long switch/if-else chains with a lookup table (map/object/strategy).',
    'Decompose boolean expressions and repeated conditionals into named predicates.',
];

/**
 * Format an actionable optimization hint based on cyclomatic complexity.
 *
 * @param cc - Measured cyclomatic complexity score.
 * @returns Guidance string suggesting decomposition strategies.
 */
export function formatOptimizationHint(cc: number): string {
    if (cc >= CRITICAL_COMPLEXITY_THRESHOLD) {
        return `Critical complexity. ${OPTIMIZATION_TIPS.join(' ')}`;
    }
    if (cc >= HIGH_COMPLEXITY_THRESHOLD) {
        return `High complexity. ${OPTIMIZATION_TIPS.slice(0, HIGH_COMPLEXITY_TIP_COUNT).join(' ')}`;
    }
    return `Moderate complexity. ${OPTIMIZATION_TIPS.slice(0, 2).join(' ')}`;
}
