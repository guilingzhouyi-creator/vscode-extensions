/**
 * Module: Core Reporting — Agent Review & Dual-Faced Presentation Reporter
 * File Path: src/core/reporters/agent-review-reporter.ts
 * Architecture Role: Dual-faced review serialization engine providing high-density CAPP
 *   directives for autonomous AI Agents, structured agent context blocks, and JSON payloads
 *   for Praxis frontend UI presentation.
 * Dependencies & Triggers: Consumes ScanReport, Issue from types, formatCompactAgentPrompt and
 *   constraint/verification generators from guidance, and defaultPraxisPresentationService
 *   from praxis; invoked by CLI/API formatters.
 * Responsibilities:
 *   1. Serialize scan reports into CAPP 2.0 ultra-compact DSL format (toCapp).
 *   2. Serialize scan reports into agent-friendly structured prompt blocks (toAgentReview).
 *   3. Serialize scan reports into Praxis presentation JSON payloads (toPraxisPresentation).
 *   4. Serialize scan reports into strongly-typed multi-agent directives payload
 *      (toStructuredAgentDirectives / toStructuredAgentDirectivesJson).
 * Exit Semantics & Design Rationale: Pure, synchronous, non-throwing formatting;
 *   adheres to CC <= 10 and Depth <= 3 complexity budgets with zero side-effects.
 */

import type { ScanReport, Issue } from '../types';
import {
    formatCompactAgentPrompt,
    extractAnchorCodeSlice,
    resolveTopologyLayer,
    generateImmutableConstraints,
    generateVerificationDirective,
} from '../guidance/agentConstraintGenerator';
import { defaultPraxisPresentationService } from '../praxis/presentation/presentation-adapter';
import type { PraxisPresentationOptions } from '../praxis/presentation/presentation-types';
import type {
    AgentDirectiveSeverity,
    AgentTopologyLayer,
    AgentTargetContext,
    AgentRuleContract,
    AgentImmutableConstraints,
    AgentRemediationRecipe,
    AgentVerificationDirective,
    AgentActionableDirective,
    AgentDirectiveEnvelope,
    AgentBuilderDirective,
    AgentReviewerCrossCheckPoint,
    AgentDirectivesMetrics,
    AgentReviewDirectivesPayload,
    AgentDirectiveTrack,
    CrossFileCallSite,
    CrossFileUsageContext,
    ClarificationOption,
    AgentClarificationRequest,
    AgentStandardizationProposal,
    AgentExactPatch,
} from './agent-directives-types';

export type {
    AgentDirectiveSeverity,
    AgentTopologyLayer,
    AgentTargetContext,
    AgentRuleContract,
    AgentImmutableConstraints,
    AgentRemediationRecipe,
    AgentVerificationDirective,
    AgentActionableDirective,
    AgentDirectiveEnvelope,
    AgentBuilderDirective,
    AgentReviewerCrossCheckPoint,
    AgentDirectivesMetrics,
    AgentReviewDirectivesPayload,
    AgentDirectiveTrack,
    CrossFileCallSite,
    CrossFileUsageContext,
    ClarificationOption,
    AgentClarificationRequest,
    AgentStandardizationProposal,
    AgentExactPatch,
};

/** Formatting options for Agent review reporter */
export interface AgentReviewReporterOptions {
    /** Maximum number of directives to include in the output (defaults to 100) */
    readonly maxDirectives?: number;
    /** Whether to include actionable code snippets (defaults to true) */
    readonly includeSnippets?: boolean;
    /** Base directory to resolve source files for anchor code context extraction */
    readonly baseDir?: string;
    /** Context line radius for anchor code slice (defaults to 2) */
    readonly contextRadius?: number;
}

const DEFAULT_MAX_DIRECTIVES = 100;

const TOPOLOGY_RANK: Record<AgentTopologyLayer, number> = {
    L1_CONTRACT: 1,
    L2_OPERATOR: 2,
    L3_CONFIG: 3,
    L4_PRESENTATION: 4,
    L5_GOVERNANCE: 5,
};

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

function resolveDirectiveSeverity(severity: string | undefined): AgentDirectiveSeverity {
    if (severity === 'error') return 'BLOCK';
    if (severity === 'warning') return 'WARN';
    return 'INFO';
}

function buildTargetContext(
    issue: Issue,
    reportRoot: string,
    options?: AgentReviewReporterOptions,
): AgentTargetContext {
    const file = issue.location?.file || 'unknown';
    const startLine = issue.location?.start?.line ?? 1;
    const endLine = issue.location?.end?.line ?? startLine;
    const startColumn = issue.location?.start?.column;
    const endColumn = issue.location?.end?.column;
    const baseDir = options?.baseDir || reportRoot;
    const radius = options?.contextRadius ?? 2;
    const anchorCodeSlice = extractAnchorCodeSlice(file, startLine, endLine, baseDir, radius);

    return {
        filePath: file,
        startLine,
        endLine,
        ...(startColumn !== undefined ? { startColumn } : {}),
        ...(endColumn !== undefined ? { endColumn } : {}),
        ...(anchorCodeSlice !== undefined ? { anchorCodeSlice } : {}),
        ...(issue.actionable?.targetSymbol ? { targetSymbol: issue.actionable.targetSymbol } : {}),
    };
}

function buildRemediationRecipe(issue: Issue): AgentRemediationRecipe {
    const act = issue.actionable;
    let remediationSummary = issue.suggestion;
    if (!remediationSummary) {
        remediationSummary = act ? `Apply standard ${act.action} remediation` : issue.message;
    }

    return {
        remediationSummary,
        ...(act?.templateSnippet ? { templateSnippet: act.templateSnippet } : {}),
        safeToAutomate: act?.safeToAutomate ?? false,
        ...(act?.action ? { actionVerb: act.action } : {}),
        ...(act?.taxonomy ? { taxonomy: act.taxonomy } : {}),
    };
}

function extractIssueClarification(issue: Issue): AgentClarificationRequest | undefined {
    const raw =
        (issue as unknown as Record<string, unknown>).clarificationRequest ??
        issue.detail?.clarificationRequest ??
        (issue.actionable as unknown as Record<string, unknown> | undefined)?.clarificationRequest;
    if (raw && typeof raw === 'object' && 'promptQuestion' in (raw as Record<string, unknown>)) {
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

function extractIssueStandardizationProposal(
    issue: Issue,
    directiveId: string,
): AgentStandardizationProposal | undefined {
    const raw =
        (issue as unknown as Record<string, unknown>).standardizationProposal ??
        issue.detail?.standardizationProposal ??
        (issue.actionable as unknown as Record<string, unknown> | undefined)
            ?.standardizationProposal;
    if (raw && typeof raw === 'object') {
        return raw as AgentStandardizationProposal;
    }
    const act = issue.actionable;
    if (act?.patch || act?.action) {
        return {
            proposalId: `PROP:${issue.id || directiveId}`,
            ...(act.patch ? { exactPatch: act.patch } : {}),
            ...(act.action ? { transformOperator: act.action } : {}),
            ...(act.templateSnippet ? { afterSnippet: act.templateSnippet } : {}),
        };
    }
    return undefined;
}

function resolveDirectiveTrack(
    issue: Issue,
    clarificationRequest?: AgentClarificationRequest,
    standardizationProposal?: AgentStandardizationProposal,
): AgentDirectiveTrack | undefined {
    const explicit = (issue as unknown as Record<string, unknown>).directiveTrack as
        AgentDirectiveTrack | undefined;
    if (explicit === 'clarification_request' || explicit === 'standardization_proposal') {
        return explicit;
    }
    if (clarificationRequest) {
        return 'clarification_request';
    }
    if (standardizationProposal || issue.actionable) {
        return 'standardization_proposal';
    }
    return undefined;
}

/**
 * Maps a single Issue into a strongly-typed AgentActionableDirective.
 *
 * @param issue - Diagnostic finding
 * @param reportRoot - Audited root path
 * @param options - Formatting options
 * @returns Complete AgentActionableDirective
 */
function mapIssueToDirective(
    issue: Issue,
    reportRoot: string,
    options?: AgentReviewReporterOptions,
): AgentActionableDirective {
    const targetContext = buildTargetContext(issue, reportRoot, options);
    const topologyLayer = resolveTopologyLayer(issue.rule, targetContext.filePath);
    const severity = resolveDirectiveSeverity(issue.severity);

    const ruleContract: AgentRuleContract = {
        ruleId: issue.rule,
        severity,
        topologyLayer,
        rootCause: issue.message,
        ...(issue.analyzer ? { analyzer: issue.analyzer } : {}),
    };

    const immutableConstraints = generateImmutableConstraints(issue, topologyLayer);
    const remediationRecipe = buildRemediationRecipe(issue);
    const verificationDirective = generateVerificationDirective(issue, topologyLayer, reportRoot);
    const directiveId = `${issue.analyzer || 'diag'}:${issue.rule}:${targetContext.filePath}:${targetContext.startLine}`;

    const clarificationRequest = extractIssueClarification(issue);
    const crossFileUsageContext = extractIssueCrossFileContext(issue, clarificationRequest);
    const standardizationProposal = extractIssueStandardizationProposal(issue, directiveId);
    const directiveTrack = resolveDirectiveTrack(
        issue,
        clarificationRequest,
        standardizationProposal,
    );

    return {
        directiveId,
        targetContext,
        ruleContract,
        immutableConstraints,
        remediationRecipe,
        verificationDirective,
        ...(directiveTrack ? { directiveTrack } : {}),
        ...(standardizationProposal ? { standardizationProposal } : {}),
        ...(clarificationRequest ? { clarificationRequest } : {}),
        ...(crossFileUsageContext ? { crossFileUsageContext } : {}),
    };
}

/**
 * Transforms a ScanReport into a structured multi-agent collaborative directives payload.
 *
 * @param report - Complete scan report
 * @param options - Formatting options
 * @returns AgentReviewDirectivesPayload with envelopes, builder tasks, reviewer points,
 *   and metrics
 */
export function toStructuredAgentDirectives(
    report: ScanReport,
    options?: AgentReviewReporterOptions,
): AgentReviewDirectivesPayload {
    const maxDirectives = options?.maxDirectives ?? DEFAULT_MAX_DIRECTIVES;
    const targetRoot = report.root || 'workspace';
    const issuesSlice = report.issues.slice(0, maxDirectives);

    const directives: AgentActionableDirective[] = issuesSlice.map((issue) =>
        mapIssueToDirective(issue, targetRoot, options),
    );

    const overallVerdict = resolveOverallVerdict(report);
    const envelope: AgentDirectiveEnvelope = {
        protocolVersion: '2.0',
        envelopeId: `ENV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        generatedAt: report.generatedAt || new Date().toISOString(),
        targetRoot,
        overallVerdict,
        directives,
    };

    // Topological sort for Builder Agents (L1 -> L2 -> L3 -> L4 -> L5)
    const sortedDirectives = [...directives].sort((a, b) => {
        const rankDiff =
            TOPOLOGY_RANK[a.ruleContract.topologyLayer] -
            TOPOLOGY_RANK[b.ruleContract.topologyLayer];
        if (rankDiff !== 0) return rankDiff;
        const fileDiff = a.targetContext.filePath.localeCompare(b.targetContext.filePath);
        if (fileDiff !== 0) return fileDiff;
        return a.targetContext.startLine - b.targetContext.startLine;
    });

    const builderDirectives: AgentBuilderDirective[] = sortedDirectives.map((d, idx) => {
        const hasClarify = Boolean(d.clarificationRequest);
        const action = hasClarify
            ? 'request_clarification'
            : d.remediationRecipe.actionVerb || 'refactor';
        const safeToAutomate = hasClarify ? false : d.remediationRecipe.safeToAutomate;
        const instruction =
            hasClarify && d.clarificationRequest
                ? `[Awaiting Clarification] ${d.clarificationRequest.promptQuestion}`
                : d.remediationRecipe.remediationSummary;

        return {
            directiveId: d.directiveId,
            sequence: idx + 1,
            topologyLayer: d.ruleContract.topologyLayer,
            targetFile: d.targetContext.filePath,
            line: d.targetContext.startLine,
            action,
            safeToAutomate,
            instruction,
            ...(d.remediationRecipe.templateSnippet
                ? { templateSnippet: d.remediationRecipe.templateSnippet }
                : {}),
            constraints: d.immutableConstraints.contractRules,
            ...(hasClarify ? { requiresClarification: true } : {}),
            ...(d.clarificationRequest ? { clarificationRequest: d.clarificationRequest } : {}),
        };
    });

    const reviewerDirectives: AgentReviewerCrossCheckPoint[] = directives.map((d) => ({
        checkPointId: `CP-${d.directiveId}`,
        targetFile: d.targetContext.filePath,
        relatedRule: d.ruleContract.ruleId,
        severity: d.ruleContract.severity,
        verificationCommand: d.verificationDirective.command,
        qualitativeAssertion: d.verificationDirective.assertionCriteria.join('; '),
        topologyLayer: d.ruleContract.topologyLayer,
    }));

    const byTopologyLayer: Record<AgentTopologyLayer, number> = {
        L1_CONTRACT: 0,
        L2_OPERATOR: 0,
        L3_CONFIG: 0,
        L4_PRESENTATION: 0,
        L5_GOVERNANCE: 0,
    };
    for (const d of directives) {
        byTopologyLayer[d.ruleContract.topologyLayer]++;
    }

    const totalDirectives = directives.length;
    const safeToAutomateCount = directives.filter((d) => d.remediationRecipe.safeToAutomate).length;
    const automationRatio =
        totalDirectives === 0 ? 1.0 : Number((safeToAutomateCount / totalDirectives).toFixed(2));
    const affectedFilesCount = new Set(directives.map((d) => d.targetContext.filePath)).size;

    const metrics: AgentDirectivesMetrics = {
        totalDirectives,
        bySeverity: {
            block: directives.filter((d) => d.ruleContract.severity === 'BLOCK').length,
            warn: directives.filter((d) => d.ruleContract.severity === 'WARN').length,
            info: directives.filter((d) => d.ruleContract.severity === 'INFO').length,
        },
        byTopologyLayer,
        safeToAutomateCount,
        automationRatio,
        affectedFilesCount,
    };

    return {
        envelope,
        builderDirectives,
        reviewerDirectives,
        metrics,
    };
}

/**
 * Transforms a ScanReport into a formatted JSON string of the multi-agent directives payload.
 *
 * @param report - Complete scan report
 * @param options - Formatting options
 * @returns JSON serialized AgentReviewDirectivesPayload
 */
export function toStructuredAgentDirectivesJson(
    report: ScanReport,
    options?: AgentReviewReporterOptions,
): string {
    const payload = toStructuredAgentDirectives(report, options);
    return JSON.stringify(payload, null, 2);
}

function formatDirectiveClarification(req: AgentClarificationRequest): string[] {
    const lines: string[] = [
        '- Clarification Request:',
        `  * Question: ${req.promptQuestion} (Type: \`${req.questionType}\`)`,
    ];
    if (req.candidateOptions && req.candidateOptions.length > 0) {
        lines.push('  * Candidate Options:');
        for (const opt of req.candidateOptions) {
            const rec = opt.recommended ? ' (recommended)' : '';
            const def = opt.key === req.defaultChoiceKey ? ' [default]' : '';
            lines.push(`    - \`${opt.key}\`: ${opt.label}${rec}${def}`);
        }
    }
    return lines;
}

function formatDirectiveCrossFileImpact(ctx: CrossFileUsageContext): string[] {
    const lines: string[] = [
        '- Cross-File Impact:',
        `  * Exported: ${ctx.isExportedSymbol}, References: ${ctx.referenceCount}, Coordinated Rename: ${ctx.requiresCoordinatedRename}`,
    ];
    if (ctx.impactedFiles && ctx.impactedFiles.length > 0) {
        lines.push(
            `  * Impacted Files (${ctx.impactedFiles.length}): ${ctx.impactedFiles.join(', ')}`,
        );
    }
    return lines;
}

function formatDirectiveRemediation(
    recipe: AgentRemediationRecipe,
    includeSnippets: boolean,
): string[] {
    const lines: string[] = [];
    if (recipe.actionVerb) {
        lines.push(
            `- Action: \`${recipe.actionVerb}\` (Safe to automate: ${recipe.safeToAutomate})`,
        );
        if (recipe.taxonomy) {
            lines.push(`- Taxonomy: \`${recipe.taxonomy}\``);
        }
        if (includeSnippets && recipe.templateSnippet) {
            lines.push('- Remediation Template:');
            lines.push('```');
            lines.push(recipe.templateSnippet);
            lines.push('```');
        }
    } else {
        lines.push(`- Suggestion: ${recipe.remediationSummary}`);
    }
    return lines;
}

/**
 * Formats a single actionable directive into an agent markdown block.
 *
 * @param directive - Actionable directive
 * @param includeSnippets - Whether to include code snippets
 * @returns Rendered markdown lines
 */
function formatAgentDirectiveBlock(
    directive: AgentActionableDirective,
    includeSnippets: boolean,
): string[] {
    const sev =
        directive.ruleContract.severity === 'BLOCK'
            ? 'ERROR'
            : directive.ruleContract.severity === 'WARN'
              ? 'WARNING'
              : 'INFO';
    const file = directive.targetContext.filePath;
    const line = directive.targetContext.startLine;
    const col = directive.targetContext.startColumn;

    const lines: string[] = [
        `### [${sev}|${directive.ruleContract.ruleId}] ${file}:${line}`,
        `- Message: ${directive.ruleContract.rootCause}`,
        `- Target Context: \`${file}:${line}${col !== undefined ? `:${col}` : ''}\` (Layer: \`${directive.ruleContract.topologyLayer}\`, Span: L${line}-L${directive.targetContext.endLine})`,
    ];

    if (directive.targetContext.anchorCodeSlice) {
        lines.push('- Anchor Code Slice:');
        lines.push('```');
        lines.push(directive.targetContext.anchorCodeSlice);
        lines.push('```');
    }

    if (directive.immutableConstraints.contractRules.length > 0) {
        lines.push('- Immutable Constraints:');
        for (const rule of directive.immutableConstraints.contractRules) {
            lines.push(`  * ${rule}`);
        }
    }

    if (directive.directiveTrack) {
        lines.push(`- Directive Track: \`${directive.directiveTrack}\``);
    }

    if (directive.clarificationRequest) {
        lines.push(...formatDirectiveClarification(directive.clarificationRequest));
    }

    if (directive.crossFileUsageContext) {
        lines.push(...formatDirectiveCrossFileImpact(directive.crossFileUsageContext));
    }

    lines.push(...formatDirectiveRemediation(directive.remediationRecipe, includeSnippets));

    lines.push(`- Verification Directive: \`${directive.verificationDirective.command}\``);
    if (directive.verificationDirective.assertionCriteria.length > 0) {
        lines.push(
            `  * Assertion: ${directive.verificationDirective.assertionCriteria.join('; ')}`,
        );
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

    const payload = toStructuredAgentDirectives(report, options);

    lines.push('## Actionable Findings');
    lines.push('');

    for (const directive of payload.envelope.directives) {
        const block = formatAgentDirectiveBlock(directive, includeSnippets);
        lines.push(...block);
        lines.push('');
    }

    if (report.issues.length > maxDirectives) {
        const remaining = report.issues.length - maxDirectives;
        lines.push(`*Note: ${remaining} additional findings omitted for token conservation.*`);
        lines.push('');
    }

    lines.push('## Multi-Agent Execution Plan');
    lines.push(
        `- Builder Directives: ${payload.builderDirectives.length} tasks ordered topologically (L1_CONTRACT -> L5_GOVERNANCE)`,
    );
    lines.push(`- Reviewer Checkpoints: ${payload.reviewerDirectives.length} cross-check points`);
    lines.push(
        `- Automation Feasibility: ${payload.metrics.safeToAutomateCount}/${payload.metrics.totalDirectives} directives (${Math.round(payload.metrics.automationRatio * 100)}%) safe for autonomous application`,
    );
    lines.push('');

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
