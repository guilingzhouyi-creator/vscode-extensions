/**
 * Module: Core Engine - Governance Rules - Code Logic
 * File Path: src/core/governance/rules/codeLogic.ts
 * Architecture Role: Node-level rule provider called for each AST node by GovernanceAnalyzer
 *     inside the shared traversal pipeline; exports are registered by the governance registry.
 * Dependencies & Triggers: Imports GovernanceRule types from ../types and NodeKind, NormalizedNode
 *     from ../../multilang; runs on scan, CI or daemon passes with governance node rules.
 * Responsibilities: calculateMaxNesting computes maximum control-flow depth with an explicit stack,
 *     skipping nested function scopes; GOV-LOG-001 rejects depth above maxNestingDepth (default 5);
 *     GOV-LOG-002 flags self-forwarding wrappers whose source span is at most three lines;
 *     NUM-PREC-001 detects low-precision rounding and mismatched scaling calculations.
 * Exit Semantics & Design Rationale: checkNode and checkFile return null when clean and a violation
 *     list when a rule fires; never throws, findings are advisory and non-fixable. The iterative
 *     scan avoids recursion overhead on deep ASTs; guard clauses and extraction are advocated
 *     because deep nesting raises cognitive load and pass-through wrappers add indirection.
 */
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';
import { isToolOrTestScript } from '../pathScope';
import type { NormalizedNode } from '../../ast/multilang';
import { NodeKind } from '../../ast/multilang';
import { CODE_NUM_PRECISION_LOSSY, CODE_NUM_UNBOUNDED_CONDITION } from '../../constants/rule-codes';

/** Default nesting-depth threshold for GOV-LOG-001 when `maxNestingDepth` is not configured. */
const DEFAULT_MAX_NESTING_DEPTH = 5;

/** Maximum inclusive source span for a function to count as a trivial pass-through wrapper. */
const MAX_PASSTHROUGH_LINE_COUNT = 3;

const PASSTHROUGH_RE = /return\s+(_?[a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)\s*\(([^)]*)\);?/;

const SCRATCH_NODE_STACK: NormalizedNode[] = [];
const SCRATCH_DEPTH_STACK: number[] = [];

/** Node kinds targeted by trivial pass-through wrapper detection. */
const TARGET_WRAPPER_KINDS: ReadonlySet<string> = new Set([NodeKind.Function, NodeKind.Method]);

/** Return keyword library for pass-through wrapper verification. */
const RETURN_KEYWORDS: ReadonlySet<string> = new Set(['return']);

/** File basenames exempted from lossy precision rounding checks. */
const EXEMPT_PRECISION_FILENAMES: ReadonlySet<string> = new Set(['compact-ledger-store.ts']);

/** Keywords and identifiers triggering lossy precision checks. */
const TOKEN_MATH = 'Math';
const TOKEN_MATH_DOT = 'Math.';
const TOKEN_TO_FIXED = 'toFixed';
const PRECISION_TRIGGER_TOKENS: ReadonlySet<string> = new Set([TOKEN_MATH, TOKEN_TO_FIXED]);
const PRECISION_TEXT_TRIGGERS: readonly string[] = [TOKEN_MATH_DOT, TOKEN_TO_FIXED];

const KEYWORD_RETURN = 'return';

const LOSSY_ROUNDING_RE =
    /\bMath\.(?:round|floor|ceil)\s*\([^()]*(?:\([^()]*\)[^()]*)*\*\s*10(?:\.0)?\s*\)\s*\/\s*10(?:\.0)?\b/;
const MISMATCHED_SCALING_RE =
    /\bMath\.(?:round|floor|ceil)\s*\([^()]*(?:\([^()]*\)[^()]*)*\*\s*100(?:\.0)?\s*\)\s*\/\s*10(?:\.0)?\b/;
const LOSSY_NUMBER_TOFIXED_RE =
    /(?:Number|\+)?\s*(?:[a-zA-Z0-9_.]+|\([^)]*\))\s*\.toFixed\s*\(\s*1\s*\)/;

/**
 * Evaluates whether a node contributes to control-flow nesting depth.
 */
function isNestingNode(child: NormalizedNode): boolean {
    if (child.kind === NodeKind.ControlFlow) return true;
    return Boolean(child.increasesNesting) && child.kind !== NodeKind.Block;
}

/**
 * Pushes non-function child nodes and their computed control-flow depths onto the stack.
 */
function pushChildrenToStack(children: NormalizedNode[], currentDepth: number): void {
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.functionLike) continue;
        const nextDepth = currentDepth + (isNestingNode(child) ? 1 : 0);
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
        if (currentDepth > max) {
            max = currentDepth;
        }

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
        if (maxNesting <= threshold) return null;

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
    },
};

/**
 * Checks whether a line contains the return keyword token using library lookup.
 */
function lineHasReturnKeyword(line: string): boolean {
    if (!line.includes(KEYWORD_RETURN)) return false;
    const tokens = line.split(/[^a-zA-Z0-9_$]+/);
    for (let i = 0; i < tokens.length; i++) {
        if (RETURN_KEYWORDS.has(tokens[i])) return true;
    }
    return false;
}

/**
 * Checks whether any line in the given span contains the return keyword token.
 */
function hasReturnInSpan(lines: string[], startLine: number, endLine: number): boolean {
    const limit = Math.min(endLine, lines.length);
    for (let i = startLine - 1; i < limit; i++) {
        if (lineHasReturnKeyword(lines[i])) return true;
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
    if (!m || !node.name || m[2] !== node.name) return null;

    return {
        ruleId: 'GOV-LOG-002',
        message: `Method \`${node.name}\` appears to be a trivial pass-through wrapper forwarding directly to \`${m[1]}.${m[2]}\`.`,
        line: startLine,
        column: node.start?.column ?? 1,
        suggestion: 'Consider inline usage or document the explicit interception rationale.',
        fixable: false,
    };
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
    textTrigger: KEYWORD_RETURN,
    targetKinds: [NodeKind.Function, NodeKind.Method],
    checkNode(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes(KEYWORD_RETURN)) return null;
        if (!TARGET_WRAPPER_KINDS.has(ctx.node.kind)) return null;

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

/**
 * Determines whether a file path is exempted from precision rounding verification.
 */
function isExemptPrecisionFilePath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
    return EXEMPT_PRECISION_FILENAMES.has(fileName);
}

/**
 * Detects presence of precision calculation triggers via token library lookup.
 */
function lineHasPrecisionTrigger(line: string): { hasMath: boolean; hasToFixed: boolean } {
    let hasMath = false;
    let hasToFixed = false;
    const tokens = line.split(/[^a-zA-Z0-9_$]+/);
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (PRECISION_TRIGGER_TOKENS.has(token)) {
            if (token === 'Math') hasMath = true;
            if (token === 'toFixed') hasToFixed = true;
        }
    }
    return { hasMath, hasToFixed };
}

/**
 * Matches candidate lossy precision rounding expressions against a single line.
 */
function evaluatePrecisionMatch(
    line: string,
    hasMath: boolean,
    hasToFixed: boolean,
): RegExpExecArray | null {
    if (hasMath) {
        const match = LOSSY_ROUNDING_RE.exec(line) ?? MISMATCHED_SCALING_RE.exec(line);
        if (match) return match;
    }
    if (hasToFixed) {
        return LOSSY_NUMBER_TOFIXED_RE.exec(line);
    }
    return null;
}

/**
 * Inspects a single masked code line for lossy precision truncation violations.
 */
function checkPrecisionLine(line: string, lineIndex: number): GovernanceViolation | null {
    if (!line.includes(TOKEN_MATH) && !line.includes(TOKEN_TO_FIXED)) return null;
    const { hasMath, hasToFixed } = lineHasPrecisionTrigger(line);
    if (!hasMath && !hasToFixed) return null;

    const match = evaluatePrecisionMatch(line, hasMath, hasToFixed);
    if (!match) return null;

    return {
        ruleId: 'NUM-PREC-001',
        message:
            `Lossy precision rounding \`${match[0]}\` detected. Calculation path` +
            ' truncates to 0.1 precision or exhibits mismatched scaling.',
        line: lineIndex + 1,
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
    };
}

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
    textTrigger: PRECISION_TEXT_TRIGGERS,
    rationale:
        'Lossy precision rounding (such as * 10 / 10 or toFixed(1)) introduces truncation errors,' +
        ' IEEE 754 drift, and false equivalence in score arbitration.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (isToolOrTestScript(ctx.filePath)) return null;
        if (isExemptPrecisionFilePath(ctx.filePath)) return null;
        if (!ctx.content.includes(TOKEN_MATH_DOT) && !ctx.content.includes(TOKEN_TO_FIXED))
            return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;

        for (let i = 0; i < lines.length; i++) {
            const violation = checkPrecisionLine(lines[i], i);
            if (violation) violations.push(violation);
        }

        return violations.length > 0 ? violations : null;
    },
};

const UNBOUNDED_DEPTH_RE =
    /\bif\s*\(\s*(?:recursionDepth|recursion_depth|callDepth|call_depth)\s*>\s*0\s*\)/;
const UNBOUNDED_BATCH_RE = /\bif\s*\(\s*(?:batchSize|batch_size)\s*>\s*0\s*\)/;
const UNBOUNDED_UPPER_BOUND_RE = /MAX_|<=|</;
const UNBOUNDED_TRIGGER_TEXTS: readonly string[] = [
    'recursionDepth',
    'recursion_depth',
    'callDepth',
    'batchSize',
];

function hasUnboundedTriggers(content: string): boolean {
    return UNBOUNDED_TRIGGER_TEXTS.some(term => content.includes(term));
}

function auditUnboundedLine(line: string, lineIndex: number): GovernanceViolation | null {
    const match = UNBOUNDED_DEPTH_RE.exec(line) ?? UNBOUNDED_BATCH_RE.exec(line);
    if (!match || UNBOUNDED_UPPER_BOUND_RE.test(line)) {
        return null;
    }
    return {
        ruleId: 'NUM-BND-001',
        message:
            `One-sided unbounded condition \`${match[0]}\` detected.` +
            ' Missing paired upper bound or clamp corridor.',
        line: lineIndex + 1,
        column: match.index + 1,
        suggestion:
            'Enforce bidirectional bounds (e.g. depth > 0 && depth <= MAX_DEPTH) or use clamp().',
        fixable: false,
        customDetail: { matchedExpression: match[0] },
        actionable: {
            action: 'apply_guard_clause',
            code: CODE_NUM_UNBOUNDED_CONDITION,
            taxonomy: 'CTRL_FLOW',
            safeToAutomate: false,
            templateSnippet: 'if (val > 0 && val <= MAX_BOUND)',
        },
    };
}

/**
 * NUM-BND-001: Unbounded Numeric Condition Governance.
 * Detects single-sided unbounded conditions on recursion depth, call stack, or batch size
 * that risk stack overflow, DoS, or unbounded resource consumption.
 */
export const UnboundedNumericConditionRule: GovernanceRule = {
    id: 'NUM-BND-001',
    name: 'Unbounded Numeric Condition Governance',
    category: 'code_logic',
    severity: 'warning',
    risk: 'medium',
    textTrigger: UNBOUNDED_TRIGGER_TEXTS,
    rationale:
        'Single-sided numeric checks without paired upper bounds risk unbounded recursion, memory exhaustion, and DoS.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (isToolOrTestScript(ctx.filePath)) return null;
        if (!hasUnboundedTriggers(ctx.content)) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;

        for (let i = 0; i < lines.length; i++) {
            const violation = auditUnboundedLine(lines[i], i);
            if (violation) {
                violations.push(violation);
            }
        }

        return violations.length > 0 ? violations : null;
    },
};
