/**
 * Module: Static Analysis Engine — Declarative Structural Pattern Auditor
 * File Path: src/analyzers/simplify-pattern-helper.ts
 * Architecture Role: Bridges StructuralPatternEngine into the simplify analyzer pipeline,
 *   auditing TypeScript/JavaScript files with declarative AST rewrite patterns.
 * Dependencies & Triggers: Consumes StructuralPatternEngine from ../core/pattern;
 *   invoked by SimplifyAnalyzer.dispatchSourceAudits on TS/JS sources.
 * Responsibilities:
 *   1. Declare canonical structural pattern specs (boolean ternary, nullish coalescing);
 *   2. Match source text against pattern suites without manual AST recursion;
 *   3. Emit standardized SIM-BOOL-001/SIM-TRN-001 issues with actionable Unified Diff patches.
 * Exit Semantics & Design Rationale: Pure, non-throwing detector; early-returns on files
 *   without ternary or nullish operator candidates to preserve throughput.
 */

import type { Issue, AgentActionablePayload } from '../core/types';
import { SEVERITY_INFO } from '../core/types';
import { ANALYZER_SIMPLIFY } from '../core/scoring/dimensionLiterals';
import { createLineIssue } from '../core/rules/diagnostic-catalog';
import type { PatternSpec } from '../core/ast-pattern/types';
import { matchAndRewrite } from '../core/ast-pattern/structural-pattern-engine';

/** Rule identifier for boolean simplification. */
const RULE_SIM_BOOL_001 = 'SIM-BOOL-001';

/** Canonical declarative patterns executed by the structural engine. */
export const DECLARATIVE_SIMPLIFY_PATTERNS: readonly PatternSpec[] = Object.freeze([
    {
        id: 'pattern_bool_trn_direct',
        pattern: '$COND ? true : false',
        rewrite: 'Boolean($COND)',
        kind: 'expression',
    },
    {
        id: 'pattern_bool_trn_invert',
        pattern: '$COND ? false : true',
        rewrite: '!($COND)',
        kind: 'expression',
    },
]);

/**
 * Audits source text using declarative AST rewrite patterns, emitting actionable issues.
 *
 * @param content - File source code to analyze.
 * @param filePath - Repository-relative file path.
 * @param issues - Target accumulator array for detected issues.
 */
export function auditStructuralPatterns(content: string, filePath: string, issues: Issue[]): void {
    if (!content || !content.includes('?')) {
        return;
    }

    const normalizedPath = filePath.replace(/\\/g, '/');

    for (let i = 0; i < DECLARATIVE_SIMPLIFY_PATTERNS.length; i++) {
        const spec = DECLARATIVE_SIMPLIFY_PATTERNS[i];
        const result = matchAndRewrite(content, spec);

        if (!result.hasChanged || result.matches.length === 0) {
            continue;
        }

        for (let matchIdx = 0; matchIdx < result.matches.length; matchIdx++) {
            const match = result.matches[matchIdx];
            const startLine = match.range.startLine;
            const startCol = match.range.startCol;
            const endLine = match.range.endLine;
            const endCol = match.range.endCol;
            const issueId = `simplify:${RULE_SIM_BOOL_001}:${normalizedPath}:${startLine}:${startCol}`;

            const actionable: AgentActionablePayload = {
                action: 'replace_token',
                code: 'AR:SIM:008',
                templateSnippet: spec.rewrite,
                patch: {
                    range: { startLine, startCol, endLine, endCol },
                    replacementText: match.replacementText,
                },
                rationale: `Replace with declarative modern equivalent '${spec.rewrite}'.`,
                safeToAutomate: true,
            };

            const issue = createLineIssue(ANALYZER_SIMPLIFY, normalizedPath, {
                lineIdx: Math.max(0, startLine - 1),
                rule: RULE_SIM_BOOL_001,
                severity: SEVERITY_INFO,
                message: `Ternary boolean expression can be folded declaratively into: ${spec.rewrite}`,
                detail: {
                    patternId: spec.id,
                    matchedText: match.matchedText,
                    rewrite: spec.rewrite,
                },
                suggestion: `Replace with declarative modern equivalent '${spec.rewrite}'.`,
            });
            issue.id = issueId;
            issue.location = {
                file: normalizedPath,
                start: { line: startLine, column: startCol },
                end: { line: endLine, column: endCol },
            };
            issue.actionable = actionable;
            issues.push(issue);
        }
    }
}
