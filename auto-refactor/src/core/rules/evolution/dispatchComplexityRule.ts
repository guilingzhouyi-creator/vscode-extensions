/**
 * Module: Core Rules — Evolution: Monolithic Dispatcher Complexity Rule
 * File Path: src/core/rules/evolution/dispatchComplexityRule.ts
 * Architecture Role: Implements detection for ARCH-DISP-001, identifying oversized switch or
 *   if-else branching dispatchers that tightly couple domain logic.
 * Dependencies & Triggers: Consumes AnalyzerContext and Issue; called by ArchitectureAnalyzer
 *   and Layer 1 rule evaluators.
 * Responsibilities: Detect monolithic branch dispatchers exceeding threshold, exempt simple
 *   enum-to-constant converters, and emit canonical ARCH-DISP-001 issues.
 * Exit Semantics & Design Rationale: Pure, linear line-based scan with zero AST overhead.
 */

import type { AnalyzerContext, Issue } from '../../types';
import { SEVERITY_WARNING } from '../../types';

/** Canonical rule ID for dispatch complexity. */
export const ARCH_DISP_RULE_ID = 'ARCH-DISP-001';

/** Default branch threshold for monolithic dispatchers. */
const DEFAULT_MAX_DISPATCH_BRANCHES = 8;

/**
 * Checks if a set of branch lines represents a trivial enum-to-constant mapping table.
 *
 * @param branchLines - Lines within the dispatch block.
 * @returns True if every branch is merely returning a constant or literal value.
 */
function isTrivialConstantMapping(branchLines: readonly string[]): boolean {
    let nonTrivialCount = 0;
    for (const line of branchLines) {
        const trimmed = line.trim();
        // If a branch contains method calls, assignments, or multiple statements, it's procedural
        if (
            trimmed.includes('(') &&
            !trimmed.startsWith('return ') &&
            !trimmed.startsWith('case ')
        ) {
            nonTrivialCount++;
        }
        if (trimmed.includes('for ') || trimmed.includes('while ') || trimmed.includes('if ')) {
            nonTrivialCount++;
        }
    }
    return nonTrivialCount === 0;
}

/**
 * Audits source text for monolithic dispatchers exceeding branch thresholds.
 *
 * @param content - Source file content.
 * @param file - Normalized file path.
 * @param ctx - Analyzer context.
 * @returns Array of emitted ARCH-DISP-001 issues.
 */
export function auditDispatchComplexity(
    content: string,
    file: string,
    ctx: AnalyzerContext,
): Issue[] {
    const issues: Issue[] = [];
    const threshold =
        (ctx.options?.maxDispatchBranches as number | undefined) ?? DEFAULT_MAX_DISPATCH_BRANCHES;

    const lines = content.split(/\r?\n/);
    let inSwitch = false;
    let switchStartLine = 0;
    let switchBraceDepth = 0;
    let branchCount = 0;
    let switchLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
            continue;
        }

        // Detect switch start
        if (!inSwitch && (trimmed.startsWith('switch ') || trimmed.startsWith('switch('))) {
            inSwitch = true;
            switchStartLine = i + 1;
            switchBraceDepth = 0;
            branchCount = 0;
            switchLines = [];
        }

        if (inSwitch) {
            switchLines.push(line);
            for (const ch of line) {
                if (ch === '{') switchBraceDepth++;
                else if (ch === '}') switchBraceDepth--;
            }

            if (trimmed.startsWith('case ') || trimmed.startsWith('default:')) {
                branchCount++;
            }

            // Check if switch ended
            if (switchBraceDepth <= 0 && i > switchStartLine - 1) {
                if (branchCount >= threshold && !isTrivialConstantMapping(switchLines)) {
                    issues.push({
                        id: `architecture:${ARCH_DISP_RULE_ID}:${file}:${switchStartLine}`,
                        analyzer: 'architecture',
                        rule: ARCH_DISP_RULE_ID,
                        severity: SEVERITY_WARNING,
                        message:
                            `Monolithic dispatcher with ${branchCount} branches detected ` +
                            `(threshold: ${threshold}). Tightly coupled procedural branches ` +
                            `impair modular extensibility.`,
                        location: {
                            file,
                            start: { line: switchStartLine, column: 1 },
                            end: { line: switchStartLine, column: 1 },
                        },
                        detail: { branchCount, threshold },
                        suggestion:
                            'Refactor monolithic switch dispatcher to a table-driven lookup ' +
                            '(Map/Dictionary) or Strategy pattern.',
                    });
                }
                inSwitch = false;
                switchLines = [];
            }
        }
    }

    return issues;
}
