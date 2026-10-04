/**
 * Module: Core Reporting — Agent Review & Dual-Faced Presentation Reporter
 * File Path: src/core/reporters/agent-review-reporter.ts
 * Architecture Role: Dual-faced review serialization engine providing high-density CAPP
 *   directives for autonomous AI Agents, structured agent context blocks, and JSON payloads
 *   for Praxis frontend UI presentation.
 * Dependencies & Triggers: Consumes ScanReport, Issue from types, formatCompactAgentPrompt from
 *   guidance, and defaultPraxisPresentationService from praxis; invoked by CLI/API formatters.
 * Responsibilities:
 *   1. Serialize scan reports into CAPP 2.0 ultra-compact DSL format (toCapp).
 *   2. Serialize scan reports into agent-friendly structured prompt blocks (toAgentReview).
 *   3. Serialize scan reports into Praxis presentation JSON payloads (toPraxisPresentation).
 * Exit Semantics & Design Rationale: Pure, synchronous, non-throwing string formatting;
 *   adheres to CC <= 10 and Depth <= 3 complexity budgets with zero side-effects.
 */

import type { ScanReport, Issue } from '../types';
import { formatCompactAgentPrompt } from '../guidance/agentConstraintGenerator';
import { defaultPraxisPresentationService } from '../praxis/presentation/presentation-adapter';
import type { PraxisPresentationOptions } from '../praxis/presentation/presentation-types';

/** Formatting options for Agent review reporter */
export interface AgentReviewReporterOptions {
    /** Maximum number of directives to include in the output (defaults to 100) */
    readonly maxDirectives?: number;
    /** Whether to include actionable code snippets (defaults to true) */
    readonly includeSnippets?: boolean;
}

const DEFAULT_MAX_DIRECTIVES = 100;

/**
 * Resolves overall report diagnostic verdict.
 *
 * @param report - Complete scan report
 * @returns 'BLOCK' | 'WARN' | 'PASS'
 */
function resolveOverallVerdict(report: ScanReport): 'BLOCK' | 'WARN' | 'PASS' {
    if (report.summary.bySeverity.error > 0) {
        return 'BLOCK';
    }
    if (report.summary.bySeverity.warning > 0) {
        return 'WARN';
    }
    return 'PASS';
}

/**
 * Formats a single issue into an agent markdown block.
 *
 * @param issue - Diagnostic issue
 * @param includeSnippets - Whether to include code snippets
 * @returns Rendered markdown lines
 */
function formatAgentIssueBlock(issue: Issue, includeSnippets: boolean): string[] {
    const sev = issue.severity.toUpperCase();
    const file = issue.location?.file || 'unknown';
    const line = issue.location?.start?.line ?? 1;
    const lines: string[] = [
        `### [${sev}|${issue.rule}] ${file}:${line}`,
        `- Message: ${issue.message}`,
    ];

    if (issue.actionable) {
        const act = issue.actionable;
        lines.push(`- Action: \`${act.action}\` (Safe to automate: ${act.safeToAutomate})`);
        if (act.taxonomy) {
            lines.push(`- Taxonomy: \`${act.taxonomy}\``);
        }
        if (includeSnippets && act.templateSnippet) {
            lines.push('- Remediation Template:');
            lines.push('```');
            lines.push(act.templateSnippet);
            lines.push('```');
        }
    } else if (issue.suggestion) {
        lines.push(`- Suggestion: ${issue.suggestion}`);
    }

    return lines;
}

/**
 * Formats a ScanReport into a structured Markdown block optimized for Agent ingestion.
 *
 * @param report - Complete scan report
 * @param options - Formatting options
 * @returns Rendered Markdown string
 */
export function toAgentReview(report: ScanReport, options?: AgentReviewReporterOptions): string {
    const verdict = resolveOverallVerdict(report);
    const maxDirectives = options?.maxDirectives ?? DEFAULT_MAX_DIRECTIVES;
    const includeSnippets = options?.includeSnippets !== false;

    const lines: string[] = [
        '# Static Analysis Review Directives for AI Agent',
        `- Target Root: ${report.root}`,
        `- Overall Verdict: ${verdict}`,
        `- Issues Total: ${report.summary.issuesTotal} (Errors: ${report.summary.bySeverity.error}, Warnings: ${report.summary.bySeverity.warning}, Info: ${report.summary.bySeverity.info})`,
        `- Scanned Files: ${report.summary.filesScanned}`,
        '',
    ];

    if (report.issues.length === 0) {
        lines.push('No issues detected. Workspace satisfies all static analysis invariants.');
        return lines.join('\n');
    }

    lines.push('## Actionable Findings');
    lines.push('');

    const slice = report.issues.slice(0, maxDirectives);
    for (const issue of slice) {
        const block = formatAgentIssueBlock(issue, includeSnippets);
        lines.push(...block);
        lines.push('');
    }

    if (report.issues.length > maxDirectives) {
        const remaining = report.issues.length - maxDirectives;
        lines.push(`*Note: ${remaining} additional findings omitted for token conservation.*`);
        lines.push('');
    }

    lines.push('## Recommended Verification');
    lines.push('Execute localized verification suite to confirm invariant satisfaction.');

    return lines.join('\n');
}

/**
 * Formats a ScanReport into the ultra-compact CAPP 2.0 DSL format.
 *
 * @param report - Complete scan report
 * @returns Ultra-compact single-line CAPP string
 */
export function toCapp(report: ScanReport): string {
    const target = report.root || 'workspace';
    const agentPrompt = formatCompactAgentPrompt(target, report.issues);
    return agentPrompt.compactPromptText;
}

/**
 * Formats a ScanReport into a Praxis UI presentation JSON payload.
 *
 * @param report - Complete scan report
 * @param options - Presentation options
 * @returns Formatted JSON string
 */
export function toPraxisPresentation(
    report: ScanReport,
    options?: PraxisPresentationOptions,
): string {
    const payload = defaultPraxisPresentationService.fromScanReport(report, options);
    return JSON.stringify(payload, null, 2);
}
