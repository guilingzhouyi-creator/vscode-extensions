/**
 * Module: Core Governance — Gate Feedback Vocabulary Evaluator
 * File Path: src/core/governance/gate-feedback.ts
 * Architecture Role: Static guard asserting that operator-facing feedback emitted by gate
 *   scripts and CI workflows uses semantic step identifiers and a closed four-state status
 *   vocabulary rather than positional labels or status synonyms.
 * Dependencies & Triggers: Consumes RepoArchetypeContext; invoked by GateArchitectureAnalyzer
 *   and auditGateArchitecture during repository governance evaluation.
 * Responsibilities:
 *   1. Reject positional step labels (ORDINAL-GATE, ORDINAL-RULE, ORDINAL-STAGE) in gate feedback;
 *   2. Reject bracketed and non-closed status synonyms (STATUS-OK, STATUS-FAIL, etc.) in favor of
 *      PASS/BLOCK/SKIP/WARN;
 *   3. Exempt legitimate test fixtures, registry declarations, and explicit allow markers;
 *   4. Emit structured Issue findings with file, line, and remediation instructions.
 * Exit Semantics & Design Rationale: Deterministic pure evaluation returning findings/issues.
 *   Positional labels carry no registered meaning, making pipeline reordering silently break
 *   failure attribution; closed four-state status tokens guarantee unified tooling parsing.
 */

import * as path from 'path';
import type { Issue } from '../types';
import { SEVERITY_ERROR } from '../types';
import type { RepoArchetypeContext } from './repo-archetype';
import { ANALYZER_GATE_ARCHITECTURE } from './gate-governance';

/** Canonical rule identifier for gate feedback vocabulary guard. */
export const RULE_GUARD_FBK_001 = 'GUARD-FBK-001';

/** Positional label and status synonym pattern definition. */
export interface FeedbackPattern {
    readonly id: string;
    readonly pattern: RegExp;
    readonly description: string;
}

/** Positional labels that must never reach operator-facing feedback. */
export const ORDINAL_LABEL_PATTERNS: readonly FeedbackPattern[] = Object.freeze([
    {
        id: 'ORDINAL-GATE',
        pattern: /\bGate\s+\d+(?:\.\d+)?\b/,
        description: 'Positional gate number label (e.g. "Gate 3")',
    },
    {
        id: 'ORDINAL-RULE',
        pattern: /\bRule\s+\d+(?:\.\d+)?\b/,
        description: 'Positional rule number label (e.g. "Rule 5.1")',
    },
    {
        id: 'ORDINAL-STAGE',
        pattern: /\bStage\s+\d+\s*:/,
        description: 'Positional stage label with colon (e.g. "Stage 1:")',
    },
]);

/**
 * Status synonyms banned everywhere in operator feedback.
 * The closed vocabulary has exactly four members: PASS, BLOCK, SKIP, WARN.
 */
export const STATUS_SYNONYMS: readonly FeedbackPattern[] = Object.freeze([
    { id: 'STATUS-OK', pattern: /\[OK\]/, description: 'Bracketed status synonym [OK]' },
    {
        id: 'STATUS-PASS-BRACKET',
        pattern: /\[PASS\]/,
        description: 'Bracketed status synonym [PASS]',
    },
    {
        id: 'STATUS-PASS-WITH-WARNING',
        pattern: /(?<![A-Z_])PASS_WITH_WARNING(?![A-Z_])/,
        description: 'Unclosed status token PASS_WITH_WARNING',
    },
    {
        id: 'STATUS-FAIL-BRACKET',
        pattern: /\[FAIL\]/,
        description: 'Bracketed status synonym [FAIL]',
    },
    {
        id: 'STATUS-FAILED-BRACKET',
        pattern: /\[FAILED\]/,
        description: 'Bracketed status synonym [FAILED]',
    },
    {
        id: 'STATUS-ERROR-BRACKET',
        pattern: /\[ERROR\]/,
        description: 'Bracketed status synonym [ERROR]',
    },
    { id: 'STATUS-NA-BRACKET', pattern: /\[N\/A\]/, description: 'Bracketed status synonym [N/A]' },
    {
        id: 'STATUS-DONE-BRACKET',
        pattern: /\[DONE\]/,
        description: 'Bracketed status synonym [DONE]',
    },
    {
        id: 'STATUS-SUCCESS-BRACKET',
        pattern: /\[SUCCESS\]/,
        description: 'Bracketed status synonym [SUCCESS]',
    },
    {
        id: 'STATUS-INFO-BRACKET',
        pattern: /\[INFO\]/,
        description: 'Bracketed status synonym [INFO]',
    },
]);

/**
 * File markers legitimately containing test fixtures or vocabulary definitions.
 */
const DEFAULT_ALLOW_MARKERS: readonly string[] = Object.freeze([
    'validate-gate-feedback.js',
    'gate-step-registry.json',
    'test-gate-guards.js',
    'gate-feedback.ts',
    'gate-feedback.js',
]);

/** Structured finding produced when a banned feedback token is detected. */
export interface FeedbackFinding {
    readonly patternId: string;
    readonly line: number;
    readonly matchedToken: string;
    readonly lineSnippet: string;
}

/**
 * Checks whether a relative file path is exempted from feedback vocabulary audits.
 *
 * @param filePath - File path to check.
 * @returns True if exempted.
 */
export function isExemptedFeedbackFile(filePath: string): boolean {
    const norm = filePath.replace(/\\/g, '/');
    return DEFAULT_ALLOW_MARKERS.some((marker) => norm.endsWith(marker));
}

/**
 * Audits file text content for banned positional feedback labels and non-closed status tokens.
 *
 * @param content - Full text of the file.
 * @param filePath - Path to the file.
 * @returns Array of feedback findings.
 */
export function auditFeedbackContent(content: string, filePath: string): FeedbackFinding[] {
    if (isExemptedFeedbackFile(filePath)) {
        return [];
    }

    const lines = content.split(/\r?\n/);
    const findings: FeedbackFinding[] = [];
    const allPatterns = [...ORDINAL_LABEL_PATTERNS, ...STATUS_SYNONYMS];

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        for (let pIndex = 0; pIndex < allPatterns.length; pIndex++) {
            const entry = allPatterns[pIndex];
            const match = entry.pattern.exec(line);
            if (match) {
                findings.push({
                    patternId: entry.id,
                    line: index + 1,
                    matchedToken: match[0],
                    lineSnippet: line.trim().slice(0, 120),
                });
            }
        }
    }

    return findings;
}

/**
 * Creates an Issue descriptor representing a gate feedback vocabulary violation.
 *
 * @param relPath - Normalized file path relative to repo root.
 * @param finding - The feedback finding.
 * @returns Structured Issue.
 */
function createFeedbackIssue(relPath: string, finding: FeedbackFinding): Issue {
    return {
        id: `${ANALYZER_GATE_ARCHITECTURE}:${RULE_GUARD_FBK_001}:${relPath}:${finding.line}`,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        rule: RULE_GUARD_FBK_001,
        severity: SEVERITY_ERROR,
        location: {
            file: relPath,
            start: { line: finding.line, column: 1 },
            end: { line: finding.line, column: 1 },
        },
        message: `Operator-facing feedback contains forbidden token '${finding.matchedToken}' (${finding.patternId}): "${finding.lineSnippet}". Gate feedback must use semantic step identifiers and closed four-state status vocabulary (PASS, BLOCK, SKIP, WARN).`,
        detail: {
            category: 'standardization',
            risk: 'high',
            remediation:
                'Replace positional labels (Gate N, Rule N.M, Stage N:) with semantic step identifiers from gate-step-registry.json, and replace bracketed status synonyms ([OK], [FAIL], [ERROR]) with PASS, BLOCK, SKIP, or WARN.',
            rationale:
                'Positional labels carry no registered meaning, silently breaking attribution when pipelines reorder; closed four-state status vocabulary guarantees deterministic gate parsing across tools.',
        },
    };
}

/**
 * Audits repository gate infrastructure (hooks, gate runner scripts, CI workflows) for feedback
 * vocabulary.
 *
 * @param context - Repository archetype context.
 * @param issues - Issue accumulator array.
 */
export function auditFeedbackVocabulary(context: RepoArchetypeContext, issues: Issue[]): void {
    const targets: Array<{ relPath: string; content: string }> = [];

    // Pre-commit hook
    if (context.hooks.preCommit) {
        targets.push({
            relPath: path
                .relative(context.root, context.hooks.preCommit.filePath)
                .replace(/\\/g, '/'),
            content: context.hooks.preCommit.content,
        });
    }

    // Commit-msg hook
    if (context.hooks.commitMsg) {
        targets.push({
            relPath: path
                .relative(context.root, context.hooks.commitMsg.filePath)
                .replace(/\\/g, '/'),
            content: context.hooks.commitMsg.content,
        });
    }

    // Pre-push hook
    if (context.hooks.prePush) {
        targets.push({
            relPath: path
                .relative(context.root, context.hooks.prePush.filePath)
                .replace(/\\/g, '/'),
            content: context.hooks.prePush.content,
        });
    }

    // Discovered gate scripts in scripts/, tools/, gates/
    for (const [rel, content] of Object.entries(context.gateScripts.contents)) {
        targets.push({ relPath: rel, content });
    }

    // Discovered CI workflow contents
    for (const [rel, content] of Object.entries(context.ci.workflowContents)) {
        targets.push({ relPath: rel, content });
    }

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const findings = auditFeedbackContent(target.content, target.relPath);
        for (let j = 0; j < findings.length; j++) {
            issues.push(createFeedbackIssue(target.relPath, findings[j]));
        }
    }
}
