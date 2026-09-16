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
import type { NormalizedNode } from '../../multilang';
import { NodeKind } from '../../multilang';

/** Default nesting-depth threshold for GOV-LOG-001 when `maxNestingDepth` is not configured. */
const DEFAULT_MAX_NESTING_DEPTH = 5;

/** Maximum inclusive source span for a function to count as a trivial pass-through wrapper. */
const MAX_PASSTHROUGH_LINE_COUNT = 3;

/**
 * Iteratively calculates maximum control-flow nesting depth within a function scope.
 * Uses an explicit stack to eliminate call-stack recursion overhead on deep ASTs.
 */
function calculateMaxNesting(rootNode: NormalizedNode): number {
    let max = 0;
    const stack: Array<{ node: NormalizedNode; depth: number }> = [];

    for (const child of rootNode.children || []) {
        if (!child.functionLike) {
            const nextDepth = child.kind === NodeKind.ControlFlow || child.increasesNesting ? 1 : 0;
            stack.push({ node: child, depth: nextDepth });
        }
    }

    while (stack.length > 0) {
        const current = stack.pop()!;
        if (current.depth > max) max = current.depth;

        for (const child of current.node.children || []) {
            if (child.functionLike) continue; // nested functions are measured in their own scope
            const nextDepth =
                current.depth +
                (child.kind === NodeKind.ControlFlow || child.increasesNesting ? 1 : 0);
            stack.push({ node: child, depth: nextDepth });
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
    checkNode(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.node.functionLike) return null;

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
    checkNode(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (ctx.node.kind !== NodeKind.Method && ctx.node.kind !== NodeKind.Function) return null;

        const startLine = ctx.node.start?.line;
        const endLine = ctx.node.end?.line;
        if (!startLine || !endLine) return null;

        const lineCount = endLine - startLine + 1;
        if (lineCount <= MAX_PASSTHROUGH_LINE_COUNT) {
            const body = ctx.masked.slice(startLine - 1, endLine).join(' ');
            // Detect `return this.target.func(args)` or `return _inner.func(args)`
            const PASSTHROUGH_RE = /return\s+(_?[a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)\s*\(([^)]*)\);?/;
            const m = body.match(PASSTHROUGH_RE);
            if (m && ctx.node.name && m[2] === ctx.node.name) {
                return [
                    {
                        ruleId: 'GOV-LOG-002',
                        message: `Method \`${ctx.node.name}\` appears to be a trivial pass-through wrapper forwarding directly to \`${m[1]}.${m[2]}\`.`,
                        line: startLine,
                        column: ctx.node.start?.column ?? 1,
                        suggestion:
                            'Consider inline usage or document the explicit interception rationale.',
                        fixable: false,
                    },
                ];
            }
        }
        return null;
    },
};
