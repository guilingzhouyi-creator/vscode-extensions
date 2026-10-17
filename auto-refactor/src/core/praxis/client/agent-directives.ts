/**
 * Module: Core Engine — Praxis Agent Directives Protocol & Dual-Faced Diff
 * File Path: src/core/praxis/client/agent-directives.ts
 * Architecture Role: Protocol transformer and serializer implementing structured Agent Directives
 *   and Dual-Faced Diff models; bridges machine-executable CAPP directives
 *   and human diagnostic cards.
 * Dependencies & Triggers: Consumes types, agentConstraintGenerator, presentation, and contracts;
 *   invoked by praxisReviewClient during review and merge gate evaluation.
 * Responsibilities:
 *   1. Transform static analysis findings into structured AgentDirectivesBundle.
 *   2. Stamp Praxis multi-agent context (cardId, cellId, agentUid, checkpointId) onto diff lines.
 *   3. Assemble Dual-Faced Diff representations (Agent Face vs Human Face).
 * Exit Semantics & Design Rationale: Pure, deterministic, non-throwing in-memory transformations;
 *   adheres to CC <= 15 and Depth <= 4 budgets with zero loop heap allocations.
 */

import type { Issue } from '../../types';
import type { PraxisCardContext, ReviewDiffHunk } from '../contracts';
import { formatCompactAgentPrompt } from '../../guidance/agentConstraintGenerator';
import { defaultPraxisPresentationService } from '../presentation/presentation-adapter';
import type { PraxisLocale } from '../presentation/i18n-types';
import type {
    PraxisBadgeColor,
    PraxisDiagnosticCard,
    PraxisPresentationSeverity,
} from '../presentation/presentation-types';
import type {
    AgentClarificationRequest,
    CrossFileUsageContext,
} from '../../reporters/agent-directives-types';
import type { AgentDirectiveItem, AgentDirectivesBundle, DualFacedDiffResult } from './types';

const DEFAULT_MAX_DIRECTIVES = 100;
const RISK_BASE_INSERT = 0.2;
const RISK_BASE_DELETE = 0.1;
const RISK_VIOLATION_PENALTY = 0.4;
const RISK_IMPACT_PENALTY = 0.2;
const RISK_MAX_SCORE = 1.0;
const RISK_DEFAULT_CONFIDENCE = 0.95;

const SEVERITY_STR_ERROR = 'error';
const SEVERITY_STR_WARN = 'warning';
const VERDICT_BLOCK = 'BLOCK';
const VERDICT_WARN = 'WARN';
const VERDICT_PASS = 'PASS';
const TEXT_YES = 'Yes';
const TEXT_NO = 'No';
const TEXT_RECOMMENDED = ' (Recommended)';
const LINE_TYPE_INSERT = 'insert';
const LINE_TYPE_DELETE = 'delete';
const STATUS_MAJOR_REWORK = 'major_rework_needed';
const STATUS_MINOR_FIX = 'minor_fix_needed';
const ACTION_AUTO_PATCH = 'auto_patch';
const ACTION_REWORK = 'rework';
const ACTION_AUTO_FIX = 'auto_fix';
const COLOR_YELLOW: PraxisBadgeColor = 'yellow';
const COLOR_GREEN: PraxisBadgeColor = 'green';
const COLOR_RED: PraxisBadgeColor = 'red';
const FILE_MERGE_DIFF = 'merge-diff';
const DEFAULT_UNSPECIFIED_RULE = 'unspecified-violation';
const SEVERITY_BLOCK: PraxisPresentationSeverity = 'block';
const SEVERITY_WARN_PRES: PraxisPresentationSeverity = 'warn';
const PROP_PROMPT_QUESTION = 'promptQuestion';

/**
 * Extracts structured directive items from static analysis issues.
 *
 * @param issues - Detected diagnostic issues
 * @param maxDirectives - Maximum number of items to return
 * @returns Array of structured AgentDirectiveItem
 */
export function extractDirectiveItems(
    issues: Issue[],
    maxDirectives: number = DEFAULT_MAX_DIRECTIVES,
): AgentDirectiveItem[] {
    const count = Math.min(issues.length, maxDirectives);
    const items: AgentDirectiveItem[] = [];

    for (let i = 0; i < count; i++) {
        const issue = issues[i];
        const actionable = issue.actionable;
        items.push({
            id: issue.id,
            rule: issue.rule,
            severity: issue.severity,
            message: issue.message,
            filePath: issue.location?.file || 'unknown',
            line: issue.location?.start?.line ?? 1,
            column: issue.location?.start?.column,
            action: actionable?.action,
            safeToAutomate: actionable?.safeToAutomate,
            taxonomy: actionable?.taxonomy,
            templateSnippet: actionable?.templateSnippet,
            suggestion: issue.suggestion,
        });
    }

    return items;
}

interface IssueSeverityCounts {
    errorCount: number;
    warnCount: number;
    infoCount: number;
}

/**
 * Counts severity occurrences across all detected static analysis issues.
 *
 * @param issues - Detected diagnostic issues
 * @returns Partitioned error, warning, and informational counts
 */
function countIssueSeverities(issues: Issue[]): IssueSeverityCounts {
    let errorCount = 0;
    let warnCount = 0;
    let infoCount = 0;
    for (let i = 0; i < issues.length; i++) {
        const sev = issues[i].severity;
        if (sev === SEVERITY_STR_ERROR) {
            errorCount++;
        } else if (sev === SEVERITY_STR_WARN) {
            warnCount++;
        } else {
            infoCount++;
        }
    }
    return { errorCount, warnCount, infoCount };
}

function extractIssueClarification(issue: Issue): AgentClarificationRequest | undefined {
    const raw =
        (issue as unknown as Record<string, unknown>).clarificationRequest ??
        issue.detail?.clarificationRequest ??
        (issue.actionable as unknown as Record<string, unknown> | undefined)?.clarificationRequest;
    if (raw && typeof raw === 'object' && PROP_PROMPT_QUESTION in (raw as Record<string, unknown>)) {
        return raw as AgentClarificationRequest;
    }
    return undefined;
}

function extractIssueCrossFileContext(
    issue: Issue,
    clarification?: AgentClarificationRequest,
): CrossFileUsageContext | undefined {
    const raw =
        (issue as unknown as Record<string, unknown>).crossFileUsageContext ??
        issue.detail?.crossFileUsageContext ??
        (issue.actionable as unknown as Record<string, unknown> | undefined)?.crossFileUsageContext;
    if (raw && typeof raw === 'object') {
        return raw as CrossFileUsageContext;
    }
    return clarification?.crossFileUsageContext;
}

function formatClarificationOptions(clarification: AgentClarificationRequest): string[] {
    const lines: string[] = [];
    if (!clarification.candidateOptions || clarification.candidateOptions.length === 0) {
        return lines;
    }
    lines.push('  * Candidate Options:');
    for (const opt of clarification.candidateOptions) {
        const optObj = typeof opt === 'string' ? { key: opt, label: opt } : opt;
        const rec = optObj.recommended ? TEXT_RECOMMENDED : '';
        const def = optObj.key === clarification.defaultChoiceKey ? ' [Default]' : '';
        const desc = optObj.description ? ` - ${optObj.description}` : '';
        lines.push(`    - [${optObj.key}] ${optObj.label}${rec}${def}${desc}`);
    }
    return lines;
}

function formatCrossFileContextLines(crossFileContext: CrossFileUsageContext): string[] {
    const lines: string[] = [
        '  * Cross-File Impact:',
        `    - Exported Symbol: ${crossFileContext.isExportedSymbol ? TEXT_YES : TEXT_NO}`,
        `    - Reference Count: ${crossFileContext.referenceCount}`,
        `    - Coordinated Rename Required: ${crossFileContext.requiresCoordinatedRename ? TEXT_YES : TEXT_NO}`,
    ];

    if (crossFileContext.impactedFiles && crossFileContext.impactedFiles.length > 0) {
        lines.push(
            `    - Impacted Files (${crossFileContext.impactedFiles.length}): ${crossFileContext.impactedFiles.join(', ')}`,
        );
    }
    if (crossFileContext.sampleCallSites && crossFileContext.sampleCallSites.length > 0) {
        lines.push('    - Sample Call Sites:');
        for (const site of crossFileContext.sampleCallSites) {
            const snippet = site.codeSnippet ? ` -> \`${site.codeSnippet.trim()}\`` : '';
            lines.push(`      * ${site.filePath}:${site.line}${snippet}`);
        }
    }
    return lines;
}

function formatClarificationInquiryBlock(
    clarification: AgentClarificationRequest,
    crossFileContext?: CrossFileUsageContext,
): string[] {
    const lines: string[] = [
        '- Clarification Request:',
        `  * Question: ${clarification.promptQuestion}`,
    ];

    if (clarification.questionType) {
        lines.push(`  * Question Type: \`${clarification.questionType}\``);
    }

    lines.push(...formatClarificationOptions(clarification));

    if (clarification.defaultChoiceKey) {
        lines.push(`  * Default Choice: \`${clarification.defaultChoiceKey}\``);
    }

    if (crossFileContext) {
        lines.push(...formatCrossFileContextLines(crossFileContext));
    }

    return lines;
}

function formatFindingHeader(issue: Issue): string[] {
    const sev = issue.severity.toUpperCase();
    const file = issue.location?.file || 'unknown';
    const lineNo = issue.location?.start?.line ?? 1;
    return [`### [${sev}|${issue.rule}] ${file}:${lineNo}`, `- Message: ${issue.message}`];
}

function formatCrossFileDetails(crossFileContext: CrossFileUsageContext): string[] {
    const lines: string[] = [
        '- Cross-File Impact:',
        `  * Exported Symbol: ${crossFileContext.isExportedSymbol ? TEXT_YES : TEXT_NO}`,
        `  * Reference Count: ${crossFileContext.referenceCount}`,
        `  * Coordinated Rename Required: ${crossFileContext.requiresCoordinatedRename ? TEXT_YES : TEXT_NO}`,
    ];
    if (crossFileContext.impactedFiles && crossFileContext.impactedFiles.length > 0) {
        lines.push(
            `  * Impacted Files (${crossFileContext.impactedFiles.length}): ${crossFileContext.impactedFiles.join(', ')}`,
        );
    }
    return lines;
}

function formatFindingAction(issue: Issue): string[] {
    const lines: string[] = [];
    if (issue.actionable) {
        const act = issue.actionable;
        lines.push(`- Action: \`${act.action}\` (Safe to automate: ${act.safeToAutomate})`);
        if (act.taxonomy) {
            lines.push(`- Taxonomy: \`${act.taxonomy}\``);
        }
        if (act.templateSnippet) {
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

function formatFindingItem(issue: Issue): string[] {
    const lines = formatFindingHeader(issue);

    const clarification = extractIssueClarification(issue);
    const crossFileContext = extractIssueCrossFileContext(issue, clarification);

    if (clarification) {
        lines.push(...formatClarificationInquiryBlock(clarification, crossFileContext));
    } else if (crossFileContext) {
        lines.push(...formatCrossFileDetails(crossFileContext));
    }

    lines.push(...formatFindingAction(issue));
    lines.push('');
    return lines;
}

/**
 * Formats diagnostic findings as clean, human- and agent-readable Markdown directives.
 *
 * @param issues - Detected issues
 * @param target - Scan target root or file
 * @param cardContext - Optional Praxis multi-agent context
 * @param maxDirectives - Maximum findings to render
 * @returns Rendered markdown string
 */
export function formatDirectivesMarkdown(
    issues: Issue[],
    target: string,
    cardContext?: PraxisCardContext,
    maxDirectives: number = DEFAULT_MAX_DIRECTIVES,
): string {
    const counts = countIssueSeverities(issues);
    const verdict = counts.errorCount > 0 ? VERDICT_BLOCK : counts.warnCount > 0 ? VERDICT_WARN : VERDICT_PASS;
    const lines: string[] = [
        '# Static Analysis Review Directives for AI Agent',
        `- Target: ${target}`,
        `- Overall Verdict: ${verdict}`,
        `- Issues Total: ${issues.length} (Errors: ${counts.errorCount}, Warnings: ${counts.warnCount}, Info: ${counts.infoCount})`,
    ];

    const clarifyCount = issues.filter((i) => Boolean(extractIssueClarification(i))).length;
    if (clarifyCount > 0) {
        lines.push(`- Clarification Requests: ${clarifyCount} pending decision`);
    }

    if (cardContext) {
        const checkpointInfo = cardContext.checkpointId ? ` | Checkpoint: ${cardContext.checkpointId}` : '';
        lines.push(
            `- Praxis Context: Cell: ${cardContext.cellId} | Agent: ${cardContext.agentUid} | Card: ${cardContext.cardId}${checkpointInfo}`,
        );
    }
    lines.push('');

    if (issues.length === 0) {
        lines.push('No issues detected. Code satisfies all static analysis invariants.');
        return lines.join('\n');
    }

    lines.push('## Actionable Findings');
    lines.push('');

    const renderCount = Math.min(issues.length, maxDirectives);
    for (let i = 0; i < renderCount; i++) {
        lines.push(...formatFindingItem(issues[i]));
    }

    if (issues.length > maxDirectives) {
        const remaining = issues.length - maxDirectives;
        lines.push(`*Note: ${remaining} additional findings omitted for token conservation.*`);
        lines.push('');
    }

    lines.push('## Recommended Verification');
    lines.push('Execute localized verification suite to confirm invariant satisfaction.');

    return lines.join('\n');
}

/**
 * Builds a structured AgentDirectivesBundle integrating CAPP, Markdown, and UI presentation.
 *
 * @param issues - Detected issues
 * @param target - Scan target path
 * @param cardContext - Optional Praxis task card context
 * @param options - Custom configuration options
 * @param options.maxDirectives - Maximum findings to include
 * @param options.locale - Target locale for UI diagnostic presentation
 * @returns Structured AgentDirectivesBundle
 */
export function buildAgentDirectivesBundle(
    issues: Issue[],
    target: string,
    cardContext?: PraxisCardContext,
    options?: { maxDirectives?: number; locale?: PraxisLocale },
): AgentDirectivesBundle {
    const maxDirectives = options?.maxDirectives ?? DEFAULT_MAX_DIRECTIVES;
    const items = extractDirectiveItems(issues, maxDirectives);

    let blockCount = 0;
    let warnCount = 0;
    let infoCount = 0;

    for (let i = 0; i < issues.length; i++) {
        const s = issues[i].severity;
        if (s === SEVERITY_STR_ERROR) {
            blockCount++;
        } else if (s === SEVERITY_STR_WARN) {
            warnCount++;
        } else {
            infoCount++;
        }
    }

    const cappPrompt = formatCompactAgentPrompt(target, issues);
    const renderedMarkdown = formatDirectivesMarkdown(issues, target, cardContext, maxDirectives);
    const presentationPayload = defaultPraxisPresentationService.toPresentation(cappPrompt, {
        locale: options?.locale,
    });

    return {
        items,
        compactPromptText: cappPrompt.compactPromptText,
        renderedMarkdown,
        presentationPayload,
        summary: {
            total: issues.length,
            blockCount,
            warnCount,
            infoCount,
        },
    };
}

/**
 * Computes line-level risk metrics given line type and hunk context.
 */
function computeLineRisk(
    lineType: 'context' | 'insert' | 'delete',
    hasViolations: boolean,
    hasImpact: boolean,
    associatedRules?: string[],
): { riskScore: number; confidence: number; associatedRules?: string[] } {
    let score = 0;
    if (lineType === LINE_TYPE_INSERT) {
        score = RISK_BASE_INSERT;
    } else if (lineType === LINE_TYPE_DELETE) {
        score = RISK_BASE_DELETE;
    }

    if (hasViolations) {
        score += RISK_VIOLATION_PENALTY;
    }
    if (hasImpact) {
        score += RISK_IMPACT_PENALTY;
    }

    const riskScore = Number(Math.min(RISK_MAX_SCORE, score).toFixed(2));
    return {
        riskScore,
        confidence: RISK_DEFAULT_CONFIDENCE,
        associatedRules,
    };
}

/**
 * Tags diff hunks and attributed lines with Praxis multi-agent context and risk metrics.
 *
 * @param hunks - Review diff hunks to tag
 * @param cardContext - Dynamic task card context
 * @returns Tagged review diff hunks
 */
export function tagHunksWithContext(
    hunks: ReviewDiffHunk[],
    cardContext?: PraxisCardContext,
): ReviewDiffHunk[] {
    for (let i = 0; i < hunks.length; i++) {
        const hunk = hunks[i];
        const hasViolations = Boolean(
            hunk.reviewVerdict?.violations && hunk.reviewVerdict.violations.length > 0,
        );
        const hasImpact = Boolean(
            hunk.astContext?.impactFiles && hunk.astContext.impactFiles.length > 2,
        );
        const rules = hunk.reviewVerdict?.violations
            ? extractRulesFromViolations(hunk.reviewVerdict.violations)
            : undefined;

        for (let j = 0; j < hunk.lines.length; j++) {
            const line = hunk.lines[j];
            if (cardContext && !line.attribution) {
                line.attribution = {
                    cardId: cardContext.cardId,
                    cellId: cardContext.cellId,
                    agentUid: cardContext.agentUid,
                    cardType: cardContext.cardType,
                    checkpointId: cardContext.checkpointId,
                    customData: cardContext.customData,
                };
            }
            if (!line.metrics) {
                line.metrics = computeLineRisk(line.type, hasViolations, hasImpact, rules);
            }
        }
    }

    return hunks;
}

/**
 * Extracts rule identifier tokens from violation strings.
 */
function extractRulesFromViolations(violations: string[]): string[] {
    const rules: string[] = [];
    for (let i = 0; i < violations.length; i++) {
        const v = violations[i];
        const match = v.match(/\[([a-zA-Z0-9_\-:]+)\]/);
        if (match && match[1]) {
            rules.push(match[1]);
        }
    }
    return rules;
}

/**
 * Builds diagnostic cards for Human Face presentation from gate violations.
 */
function buildGateDiagnosticCards(
    violations: string[],
    approved: boolean,
    locale: PraxisLocale = 'zh-CN',
): PraxisDiagnosticCard[] {
    if (violations.length === 0) {
        return [];
    }

    const cards: PraxisDiagnosticCard[] = [];
    for (let i = 0; i < violations.length; i++) {
        const v = violations[i];
        const match = v.match(/\[([a-zA-Z0-9_\-:]+)\]\s*(.*)/);
        const ruleId = match ? match[1] : DEFAULT_UNSPECIFIED_RULE;
        const msg = match ? match[2] : v;
        const isError = !approved || /BLOCK|error/i.test(v);
        const severity: PraxisPresentationSeverity = isError ? SEVERITY_BLOCK : SEVERITY_WARN_PRES;
        const badgeColor: PraxisBadgeColor = isError ? COLOR_RED : COLOR_YELLOW;
        const badgeText = isError
            ? locale === 'zh-CN'
                ? '[阻断]'
                : '[BLOCK]'
            : locale === 'zh-CN'
              ? '[告警]'
              : '[WARN]';

        cards.push({
            id: `gate-card-${i + 1}`,
            ruleId,
            title: ruleId,
            message: msg,
            file: FILE_MERGE_DIFF,
            line: 1,
            severity,
            badgeText,
            badgeColor,
            remediation: msg,
            sourceAgentDirective: `[GUARD|${isError ? VERDICT_BLOCK : VERDICT_WARN}|${ruleId}] merge-diff:1 -> ${msg}`,
        });
    }

    return cards;
}

interface HunkAggregates {
    linesAdded: number;
    linesDeleted: number;
    linesUnchanged: number;
    totalRisk: number;
    ratedLines: number;
    symbolScopeSet: Set<string>;
    impactFileSet: Set<string>;
    affectedFileSet: Set<string>;
    actionSet: Set<string>;
}

function accumulateHunkLineStats(
    hunk: ReviewDiffHunk,
    counts: {
        linesAdded: number;
        linesDeleted: number;
        linesUnchanged: number;
        totalRisk: number;
        ratedLines: number;
    },
): void {
    for (const line of hunk.lines) {
        if (line.type === LINE_TYPE_INSERT) {
            counts.linesAdded++;
        } else if (line.type === LINE_TYPE_DELETE) {
            counts.linesDeleted++;
        } else {
            counts.linesUnchanged++;
        }

        if (line.metrics?.riskScore !== undefined) {
            counts.totalRisk += line.metrics.riskScore;
            counts.ratedLines++;
        }
    }
}

/**
 * Aggregates statistics and symbol sets across diff hunks.
 */
function aggregateHunkMetrics(hunks: ReviewDiffHunk[]): HunkAggregates {
    const counts = {
        linesAdded: 0,
        linesDeleted: 0,
        linesUnchanged: 0,
        totalRisk: 0,
        ratedLines: 0,
    };

    const symbolScopeSet = new Set<string>();
    const impactFileSet = new Set<string>();
    const affectedFileSet = new Set<string>();
    const actionSet = new Set<string>();

    for (const hunk of hunks) {
        if (hunk.astContext?.enclosingSymbol) {
            symbolScopeSet.add(hunk.astContext.enclosingSymbol);
        }
        if (hunk.astContext?.impactFiles) {
            hunk.astContext.impactFiles.forEach((file) => impactFileSet.add(file));
        }
        const colonMatch = /^[^:]+:([^:]+)/.exec(hunk.hunkId);
        if (colonMatch && colonMatch[1]) {
            affectedFileSet.add(colonMatch[1]);
        }

        if (hunk.reviewVerdict?.suggestedPatch) {
            actionSet.add(ACTION_AUTO_PATCH);
        }
        if (hunk.reviewVerdict?.status === STATUS_MAJOR_REWORK) {
            actionSet.add(ACTION_REWORK);
        } else if (hunk.reviewVerdict?.status === STATUS_MINOR_FIX) {
            actionSet.add(ACTION_AUTO_FIX);
        }

        accumulateHunkLineStats(hunk, counts);
    }

    return {
        ...counts,
        symbolScopeSet,
        impactFileSet,
        affectedFileSet,
        actionSet,
    };
}

/**
 * Options for assembling Dual-Faced Diff representation.
 */
export interface DualFacedDiffOptions {
    readonly hunks: ReviewDiffHunk[];
    readonly sourceBranch: string;
    readonly targetBranch: string;
    readonly gateApproved: boolean;
    readonly violations: string[];
    readonly cardContext?: PraxisCardContext;
    readonly locale?: PraxisLocale;
}

function resolveDualFacedDiffParams(
    optionsOrHunks: DualFacedDiffOptions | ReviewDiffHunk[],
    sourceBranch?: string,
    targetBranch?: string,
    restArgs: readonly unknown[] = [],
): {
    hunks: ReviewDiffHunk[];
    sourceBranch: string;
    targetBranch: string;
    gateApproved: boolean;
    violations: string[];
    cardContext?: PraxisCardContext;
    locale: PraxisLocale;
} {
    if (!Array.isArray(optionsOrHunks) && typeof optionsOrHunks === 'object' && optionsOrHunks !== null) {
        return {
            hunks: optionsOrHunks.hunks,
            sourceBranch: optionsOrHunks.sourceBranch,
            targetBranch: optionsOrHunks.targetBranch,
            gateApproved: optionsOrHunks.gateApproved,
            violations: optionsOrHunks.violations,
            cardContext: optionsOrHunks.cardContext,
            locale: optionsOrHunks.locale ?? 'zh-CN',
        };
    }
    return {
        hunks: optionsOrHunks,
        sourceBranch: sourceBranch ?? '',
        targetBranch: targetBranch ?? '',
        gateApproved: Boolean(restArgs[0]),
        violations: (restArgs[1] as string[]) ?? [],
        cardContext: restArgs[2] as PraxisCardContext | undefined,
        locale: (restArgs[3] as PraxisLocale) ?? 'zh-CN',
    };
}

/**
 * Assembles Dual-Faced Diff representation combining Agent Face and Human Face.
 *
 * @param optionsOrHunks - Structured diff options or tagged diff hunks
 * @param sourceBranch - Source branch (legacy positional)
 * @param targetBranch - Target branch (legacy positional)
 * @param restArgs - Legacy positional arguments for backward compatibility
 * @returns DualFacedDiffResult
 */
export function buildDualFacedDiff(
    optionsOrHunks: DualFacedDiffOptions | ReviewDiffHunk[],
    sourceBranch?: string,
    targetBranch?: string,
    ...restArgs: unknown[]
): DualFacedDiffResult {
    const params = resolveDualFacedDiffParams(optionsOrHunks, sourceBranch, targetBranch, restArgs);
    const agg = aggregateHunkMetrics(params.hunks);
    const averageRiskScore =
        agg.ratedLines > 0 ? Number((agg.totalRisk / agg.ratedLines).toFixed(2)) : 0;
    let badgeColor: PraxisBadgeColor = COLOR_YELLOW;
    if (params.gateApproved) {
        badgeColor = COLOR_GREEN;
    } else if (params.violations.some((v) => v.includes(VERDICT_BLOCK) || v.includes(SEVERITY_STR_ERROR))) {
        badgeColor = COLOR_RED;
    }

    const statusText = params.gateApproved
        ? `[APPROVED] Clean merge gate from ${params.sourceBranch} to ${params.targetBranch}`
        : `[REWORK NEEDED] ${params.violations.length} violation(s) detected during merge gate evaluation`;

    const diagnosticCards = buildGateDiagnosticCards(params.violations, params.gateApproved, params.locale);

    return {
        agentFace: {
            attributedHunks: params.hunks,
            symbolScopes: Array.from(agg.symbolScopeSet),
            impactFiles: Array.from(agg.impactFileSet),
            averageRiskScore,
            suggestedActions: Array.from(agg.actionSet),
        },
        humanFace: {
            approved: params.gateApproved,
            statusText,
            badgeColor,
            linesAdded: agg.linesAdded,
            linesDeleted: agg.linesDeleted,
            linesUnchanged: agg.linesUnchanged,
            affectedFiles: Array.from(agg.affectedFileSet),
            violations: params.violations,
            diagnosticCards,
        },
    };
}
