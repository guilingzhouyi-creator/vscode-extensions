/**
 * Module: Core Engine — Canonical Issue Builder
 * File Path: src/core/reporting/canonical-issue-builder.ts
 * Architecture Role: Central factory utility standardizing the construction of Issue finding
 *   records across built-in and specialized analyzers.
 * Dependencies & Triggers: Consumes ../types; invoked by analyzers across src/analyzers/
 *   to ensure uniform ID formatting, 1-based line/column normalization, and metadata structure.
 * Responsibilities:
 *   1. Standardize issue ID structure `${analyzer}:${rule}:${file}:${line}`;
 *   2. Normalize 0-based or 1-based line indices into valid 1-based SourceLocation records;
 *   3. Attach actionable remediations, structured machine details, and human suggestions;
 *   4. Provide type-safe Issue builder helpers compatible with baseline ratchet decoration.
 * Exit Semantics & Design Rationale: Pure factory functions; ELOC >= 15 with canonical
 *   standardization guarantees.
 */

import type { AgentActionablePayload, Issue, IssueLocation, Severity } from '../types';

/**
 * Options for constructing a standardized Issue finding.
 */
export interface CanonicalIssueOptions {
    analyzer: string;
    rule: string;
    file: string;
    line: number;
    column?: number;
    severity: Severity;
    message: string;
    suggestion?: string;
    detail?: Record<string, unknown>;
    actionable?: AgentActionablePayload;
    endLine?: number;
    endColumn?: number;
}

/**
 * Builds a standardized Issue record with canonical ID formatting and normalized SourceLocation.
 *
 * @param options - Structured issue creation parameters.
 * @returns Fully populated, normalized Issue finding.
 */
export function buildCanonicalIssue(options: CanonicalIssueOptions): Issue {
    const normFile = options.file.replace(/\\/g, '/');
    const line = Math.max(1, options.line);
    const column = Math.max(1, options.column ?? 1);
    const endLine = Math.max(line, options.endLine ?? line);
    const endColumn = Math.max(column, options.endColumn ?? column);

    const location: IssueLocation = {
        file: normFile,
        start: { line, column },
        end: { line: endLine, column: endColumn },
    };

    const issue: Issue = {
        id: `${options.analyzer}:${options.rule}:${normFile}:${line}`,
        analyzer: options.analyzer,
        rule: options.rule,
        severity: options.severity,
        message: options.message,
        location,
        detail: options.detail ?? {},
    };

    if (options.suggestion) {
        issue.suggestion = options.suggestion;
    }
    if (options.actionable) {
        issue.actionable = options.actionable;
    }

    return issue;
}
