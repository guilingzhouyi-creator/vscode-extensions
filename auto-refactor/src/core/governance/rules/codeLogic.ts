/**
 * Module: Core Engine - Governance Rules - Code Logic
 * File Path: src/core/governance/rules/codeLogic.ts
 * Architecture Role: Node-level rule provider called for each AST node by GovernanceAnalyzer
 *     inside the shared traversal pipeline; exports are registered by the governance registry.
 * Dependencies & Triggers: Imports GovernanceRule types from ../types and NodeKind, NormalizedNode
 *     from ../../multilang; runs on scan, CI or daemon passes with governance node rules.
 * Responsibilities: calculateMaxNesting computes maximum control-flow depth with an explicit stack,
 *     skipping nested function scopes; GOV-LOG-001 rejects depth above maxNestingDepth (default 5);
 *     GOV-LOG-002 flags self-forwarding wrappers whose source span is at most three lines.
 * Exit Semantics & Design Rationale: checkNode returns null when clean and a violation list when a
 *     rule fires; it never throws, and both rules are advisory and non-fixable. The iterative scan
 *     avoids recursion overhead on deep ASTs; guard clauses and extraction are advocated because
 *     deep nesting raises cognitive load and pass-through wrappers add indirection.
 */
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';
import { isToolOrTestScript } from '../pathScope';
import type { NormalizedNode } from '../../ast/multilang';
import { NodeKind } from '../../ast/multilang';
import { CODE_NUM_PRECISION_LOSSY } from '../../constants/rule-codes';

/** Default nesting-depth threshold for GOV-LOG-001 when `maxNestingDepth` is not configured. */
const DEFAULT_MAX_NESTING_DEPTH = 5;

/** Maximum inclusive source span for a function to count as a trivial pass-through wrapper. */
const MAX_PASSTHROUGH_LINE_COUNT = 3;

const PASSTHROUGH_RE = /return\s+(_?[a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)\s*\(([^)]*)\);?/;

const SCRATCH_NODE_STACK: NormalizedNode[] = [];
const SCRATCH_DEPTH_STACK: number[] = [];

/**
 * Pushes non-function child nodes and their computed control-flow depths onto the stack.
 */
function pushChildrenToStack(children: NormalizedNode[], currentDepth: number): void {
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.functionLike) continue;
        const isNestingControl =
            child.kind === NodeKind.ControlFlow ||
            (Boolean(child.increasesNesting) && child.kind !== NodeKind.Block);
        const nextDepth = currentDepth + (isNestingControl ? 1 : 0);
        SCRATCH_NODE_STACK.push(child);
        SCRATCH_DEPTH_STACK.push(nextDepth);
    }
}

/**
 * Iteratively calculates maximum control-flow nesting depth within a function scope.
 * Uses an explicit flat stack to eliminate call-stack recursion overhead and heap allocations.
 */
function calculateMaxNesting(rootNode: NormalizedNode): number {
    const rootChildren = rootNode.children;
    if (!rootChildren || rootChildren.length === 0) return 0;

    let max = 0;
    const nodeStack = SCRATCH_NODE_STACK;
    const depthStack = SCRATCH_DEPTH_STACK;
    nodeStack.length = 0;
    depthStack.length = 0;

    pushChildrenToStack(rootChildren, 0);

    while (nodeStack.length > 0) {
        const currentNode = nodeStack.pop()!;
        const currentDepth = depthStack.pop()!;
        if (currentDepth > max) max = currentDepth;

        if (currentNode.children) {
            pushChildrenToStack(currentNode.children, currentDepth);
        }
    }

    return max;
}

/**
 * GOV-LOG-001: Excessive Control Flow Nesting (SIM-CMP-001 generalized).
 * Limits nested if/for/while depth to <= 5 levels.
 */
export const ExcessiveNestingRule: GovernanceRule = {
    id: 'GOV-LOG-001',
    name: 'Control Flow Nesting Depth Constraint',
    category: 'code_logic',
    severity: 'warning',
    risk: 'medium',
    rationale:
        'Deeply nested control flows (> 5 levels) create high cognitive load and increase defect risk.',
    isFixable: false,
    targetKinds: [NodeKind.Function, NodeKind.Method],
    checkNode(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.node.functionLike) return null;
        if (isToolOrTestScript(ctx.filePath)) return null;

        const maxNesting = calculateMaxNesting(ctx.node);
        const threshold = ctx.ctx.options?.maxNestingDepth ?? DEFAULT_MAX_NESTING_DEPTH;

        if (maxNesting > threshold) {
            const fnName = ctx.node.name ?? ctx.binding ?? 'anonymous';
            return [
                {
                    ruleId: 'GOV-LOG-001',
                    message: `Function \`${fnName}\` has excessive control flow nesting depth of ${maxNesting} (threshold: ${threshold}).`,
                    line: ctx.node.start?.line ?? 1,
                    column: ctx.node.start?.column ?? 1,
                    suggestion:
                        'Refactor with guard clauses (early returns) or extract nested logic into sub-functions.',
                    fixable: false,
                    customDetail: { maxNesting, threshold },
                },
            ];
        }
        return null;
    },
};

const KEYWORD_RETURN = 'return';

/**
 * Checks whether any line in the given span contains the return keyword.
 */
function hasReturnInSpan(lines: string[], startLine: number, endLine: number): boolean {
    const limit = Math.min(endLine, lines.length);
    for (let i = startLine - 1; i < limit; i++) {
        if (lines[i].includes(KEYWORD_RETURN)) return true;
    }
    return false;
}

/**
 * Evaluates whether a function body matches a trivial forwarding pass-through wrapper.
 */
function extractPassThroughViolation(
    node: NormalizedNode,
    masked: string[],
    startLine: number,
    endLine: number,
): GovernanceViolation | null {
    const body = masked.slice(startLine - 1, endLine).join(' ');
    const m = body.match(PASSTHROUGH_RE);
    if (m && node.name && m[2] === node.name) {
        return {
            ruleId: 'GOV-LOG-002',
            message: `Method \`${node.name}\` appears to be a trivial pass-through wrapper forwarding directly to \`${m[1]}.${m[2]}\`.`,
            line: startLine,
            column: node.start?.column ?? 1,
            suggestion: 'Consider inline usage or document the explicit interception rationale.',
            fixable: false,
        };
    }
    return null;
}

/**
 * GOV-LOG-002: Empty / Pass-through Wrapper Governance (SIM-WRP-001 generalized).
 * Flags trivial wrapper functions that add no value.
 */
export const VacuousWrapperRule: GovernanceRule = {
    id: 'GOV-LOG-002',
    name: 'Vacuous Pass-through Wrapper Governance',
    category: 'code_logic',
    severity: 'info',
    risk: 'low',
    rationale:
        'Vacuous wrapper methods that purely forward calls without validation or translation add unnecessary indirection.',
    isFixable: false,
    targetKinds: [NodeKind.Function, NodeKind.Method],
    checkNode(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes(KEYWORD_RETURN)) return null;
        if (ctx.node.kind !== NodeKind.Method && ctx.node.kind !== NodeKind.Function) return null;

        const startLine = ctx.node.start?.line;
        const endLine = ctx.node.end?.line;
        if (!startLine || !endLine) return null;

        const lineCount = endLine - startLine + 1;
        if (lineCount > MAX_PASSTHROUGH_LINE_COUNT) return null;
        if (!hasReturnInSpan(ctx.masked, startLine, endLine)) return null;

        const violation = extractPassThroughViolation(ctx.node, ctx.masked, startLine, endLine);
        return violation ? [violation] : null;
    },
};

const LOSSY_ROUNDING_RE =
    /\bMath\.(?:round|floor|ceil)\s*\([^()]*(?:\([^()]*\)[^()]*)*\*\s*10(?:\.0)?\s*\)\s*\/\s*10(?:\.0)?\b/;
const MISMATCHED_SCALING_RE =
    /\bMath\.(?:round|floor|ceil)\s*\([^()]*(?:\([^()]*\)[^()]*)*\*\s*100(?:\.0)?\s*\)\s*\/\s*10(?:\.0)?\b/;
const LOSSY_NUMBER_TOFIXED_RE =
    /(?:Number|\+)?\s*(?:[a-zA-Z0-9_.]+|\([^)]*\))\s*\.toFixed\s*\(\s*1\s*\)/;

/**
 * NUM-PREC-001: Lossy Precision Truncation Governance.
 * Detects low-precision rounding (such as Math.round(... * 10) / 10 or Number(...toFixed(1)))
 * and mismatched scaling in calculations, which causes truncation errors and IEEE 754 drift.
 */
export const LossyPrecisionRoundingRule: GovernanceRule = {
    id: 'NUM-PREC-001',
    name: 'Lossy Precision Truncation Governance',
    category: 'code_logic',
    severity: 'warning',
    risk: 'medium',
    rationale:
        'Lossy precision rounding (such as * 10 / 10 or toFixed(1)) introduces truncation errors,' +
        ' IEEE 754 drift, and false equivalence in score arbitration.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (isToolOrTestScript(ctx.filePath)) return null;
        if (ctx.filePath.includes('compact-ledger-store.ts')) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let match = LOSSY_ROUNDING_RE.exec(line);
            if (!match) {
                match = MISMATCHED_SCALING_RE.exec(line);
            }
            if (!match) {
                match = LOSSY_NUMBER_TOFIXED_RE.exec(line);
            }
            if (match) {
                violations.push({
                    ruleId: 'NUM-PREC-001',
                    message:
                        `Lossy precision rounding \`${match[0]}\` detected. Calculation path` +
                        ' truncates to 0.1 precision or exhibits mismatched scaling.',
                    line: i + 1,
                    column: match.index + 1,
                    suggestion:
                        'Use standard 0.01 precision rounding (such as SCORE_ROUNDING = 100)' +
                        ' or explicit tolerance bound.',
                    fixable: false,
                    customDetail: {
                        matchedExpression: match[0],
                    },
                    actionable: {
                        action: 'align_numeric_precision',
                        code: CODE_NUM_PRECISION_LOSSY,
                        taxonomy: 'NUM_PREC',
                        safeToAutomate: true,
                        templateSnippet: 'Math.round(val * 100) / 100 + 0',
                        targetArguments: {
                            matchedExpression: match[0],
                            standardPrecision: 0.01,
                        },
                    },
                });
            }
        }

        return violations.length > 0 ? violations : null;
    },
};
