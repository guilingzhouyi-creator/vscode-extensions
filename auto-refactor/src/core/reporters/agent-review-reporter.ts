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
    AgentRemediationRecipe,
    AgentActionableDirective,
    AgentDirectiveEnvelope,
    AgentBuilderDirective,
    AgentReviewerCrossCheckPoint,
    AgentDirectivesMetrics,
    AgentReviewDirectivesPayload,
    AgentDirectiveTrack,
    CrossFileUsageContext,
    AgentClarificationRequest,
    AgentStandardizationProposal,
} from './agent-directives-types';

export type * from './agent-directives-types';

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
const PERCENT_MULTIPLIER = 100;
const RADIX_BASE36 = 36;
const RANDOM_SLICE_START = 2;
const RANDOM_SLICE_END = 7;
const DEFAULT_CONTEXT_RADIUS = 2;

const VERDICT_BLOCK = 'BLOCK';
const VERDICT_WARN = 'WARN';
const VERDICT_PASS = 'PASS';

const SEVERITY_ERROR = 'error';
const SEVERITY_WARNING = 'warning';
const DIRECTIVE_INFO = 'INFO';

const SEV_LABEL_ERROR = 'ERROR';
const SEV_LABEL_WARNING = 'WARNING';
const SEV_LABEL_INFO = 'INFO';

const TRACK_CLARIFICATION: AgentDirectiveTrack = 'clarification_request';
const TRACK_STANDARDIZATION: AgentDirectiveTrack = 'standardization_proposal';

const DEFAULT_TARGET_ROOT = 'workspace';
const DEFAULT_ANALYZER_DIAG = 'diag';
const DEFAULT_UNKNOWN_FILE = 'unknown';
const ACTION_REQUEST_CLARIFICATION = 'request_clarification';
const ACTION_REFACTOR = 'refactor';

const PROP_PROMPT_QUESTION = 'promptQuestion';
const FENCE_MARKDOWN_CODE = '```';
const RECOMMENDED_SUFFIX = ' (recommended)';

const CONTRACT_LAYER: AgentTopologyLayer = 'L1_CONTRACT';
const OPERATOR_LAYER: AgentTopologyLayer = 'L2_OPERATOR';
const CONFIG_LAYER: AgentTopologyLayer = 'L3_CONFIG';
const PRESENTATION_LAYER: AgentTopologyLayer = 'L4_PRESENTATION';
const GOVERNANCE_LAYER: AgentTopologyLayer = 'L5_GOVERNANCE';

const TOPOLOGY_LAYERS: readonly AgentTopologyLayer[] = [
    CONTRACT_LAYER,
    OPERATOR_LAYER,
    CONFIG_LAYER,
    PRESENTATION_LAYER,
    GOVERNANCE_LAYER,
];

const TOPOLOGY_RANK: Record<AgentTopologyLayer, number> = Object.fromEntries(
    TOPOLOGY_LAYERS.map((layer, index) => [layer, index + 1]),
) as Record<AgentTopologyLayer, number>;

/**
 * Resolves overall report diagnostic verdict.
 *
 * @param report - Complete scan report
 * @returns 'BLOCK' | 'WARN' | 'PASS'
 */
function resolveOverallVerdict(report: ScanReport): 'BLOCK' | 'WARN' | 'PASS' {
    if (report.summary.bySeverity.error > 0) return VERDICT_BLOCK;
    return report.summary.bySeverity.warning > 0 ? VERDICT_WARN : VERDICT_PASS;
}

function resolveDirectiveSeverity(severity: string | undefined): AgentDirectiveSeverity {
    if (severity === SEVERITY_ERROR) return VERDICT_BLOCK;
    return severity === SEVERITY_WARNING ? VERDICT_WARN : DIRECTIVE_INFO;
}

function buildTargetContext(
    issue: Issue,
    reportRoot: string,
    options?: AgentReviewReporterOptions,
): AgentTargetContext {
    const file = issue.location?.file || DEFAULT_UNKNOWN_FILE;
    const startLine = issue.location?.start?.line ?? 1;
    const endLine = issue.location?.end?.line ?? startLine;
    const startColumn = issue.location?.start?.column;
    const endColumn = issue.location?.end?.column;
    const baseDir = options?.baseDir || reportRoot;
    const radius = options?.contextRadius ?? DEFAULT_CONTEXT_RADIUS;
    const anchorCodeSlice = extractAnchorCodeSlice({
        filePath: file,
        startLine,
        endLine,
        baseDir,
        radius,
    });

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
    if (
        raw &&
        typeof raw === 'object' &&
        PROP_PROMPT_QUESTION in (raw as Record<string, unknown>)
    ) {
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

function getIssueProposal(
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
    if (explicit === TRACK_CLARIFICATION || explicit === TRACK_STANDARDIZATION) {
        return explicit;
    }
    if (clarificationRequest) {
        return TRACK_CLARIFICATION;
    }
    if (standardizationProposal || issue.actionable) {
        return TRACK_STANDARDIZATION;
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
    const directiveId = `${issue.analyzer || DEFAULT_ANALYZER_DIAG}:${issue.rule}:${targetContext.filePath}:${targetContext.startLine}`;

    const clarificationRequest = extractIssueClarification(issue);
    const crossFileUsageContext = extractIssueCrossFileContext(issue, clarificationRequest);
    const standardizationProposal = getIssueProposal(issue, directiveId);
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

function generateEnvelopeId(): string {
    const timestamp = Date.now().toString(RADIX_BASE36);
    const randomSuffix = Math.random()
        .toString(RADIX_BASE36)
        .slice(RANDOM_SLICE_START, RANDOM_SLICE_END);
    return `ENV-${timestamp}-${randomSuffix}`;
}

function buildDirectiveEnvelope(
    directives: AgentActionableDirective[],
    report: ScanReport,
    targetRoot: string,
): AgentDirectiveEnvelope {
    return {
        protocolVersion: '2.0',
        envelopeId: generateEnvelopeId(),
        generatedAt: report.generatedAt || new Date().toISOString(),
        targetRoot,
        overallVerdict: resolveOverallVerdict(report),
        directives,
    };
}

function buildBuilderDirectives(directives: AgentActionableDirective[]): AgentBuilderDirective[] {
    const sortedDirectives = [...directives].sort((a, b) => {
        const rankDiff =
            TOPOLOGY_RANK[a.ruleContract.topologyLayer] -
            TOPOLOGY_RANK[b.ruleContract.topologyLayer];
        if (rankDiff !== 0) return rankDiff;
        const fileDiff = a.targetContext.filePath.localeCompare(b.targetContext.filePath);
        if (fileDiff !== 0) return fileDiff;
        return a.targetContext.startLine - b.targetContext.startLine;
    });

    return sortedDirectives.map((d, idx) => {
        const hasClarify = Boolean(d.clarificationRequest);
        const action = hasClarify
            ? ACTION_REQUEST_CLARIFICATION
            : d.remediationRecipe.actionVerb || ACTION_REFACTOR;
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
}

function buildReviewerDirectives(
    directives: AgentActionableDirective[],
): AgentReviewerCrossCheckPoint[] {
    return directives.map((d) => ({
        checkPointId: `CP-${d.directiveId}`,
        targetFile: d.targetContext.filePath,
        relatedRule: d.ruleContract.ruleId,
        severity: d.ruleContract.severity,
        verificationCommand: d.verificationDirective.command,
        qualitativeAssertion: d.verificationDirective.assertionCriteria.join('; '),
        topologyLayer: d.ruleContract.topologyLayer,
    }));
}

function buildDirectivesMetrics(directives: AgentActionableDirective[]): AgentDirectivesMetrics {
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

    return {
        totalDirectives,
        bySeverity: {
            block: directives.filter((d) => d.ruleContract.severity === VERDICT_BLOCK).length,
            warn: directives.filter((d) => d.ruleContract.severity === VERDICT_WARN).length,
            info: directives.filter((d) => d.ruleContract.severity === DIRECTIVE_INFO).length,
        },
        byTopologyLayer,
        safeToAutomateCount,
        automationRatio,
        affectedFilesCount,
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
    const targetRoot = report.root || DEFAULT_TARGET_ROOT;
    const issuesSlice = report.issues.slice(0, maxDirectives);

    const directives: AgentActionableDirective[] = issuesSlice.map((issue) =>
        mapIssueToDirective(issue, targetRoot, options),
    );

    return {
        envelope: buildDirectiveEnvelope(directives, report, targetRoot),
        builderDirectives: buildBuilderDirectives(directives),
        reviewerDirectives: buildReviewerDirectives(directives),
        metrics: buildDirectivesMetrics(directives),
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
            const rec = opt.recommended ? RECOMMENDED_SUFFIX : '';
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
            lines.push(FENCE_MARKDOWN_CODE);
            lines.push(recipe.templateSnippet);
            lines.push(FENCE_MARKDOWN_CODE);
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
        directive.ruleContract.severity === VERDICT_BLOCK
            ? SEV_LABEL_ERROR
            : directive.ruleContract.severity === VERDICT_WARN
              ? SEV_LABEL_WARNING
              : SEV_LABEL_INFO;
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
        lines.push(FENCE_MARKDOWN_CODE);
        lines.push(directive.targetContext.anchorCodeSlice);
        lines.push(FENCE_MARKDOWN_CODE);
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
        `- Automation Feasibility: ${payload.metrics.safeToAutomateCount}/${payload.metrics.totalDirectives} directives (${Math.round(payload.metrics.automationRatio * PERCENT_MULTIPLIER)}%) safe for autonomous application`,
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
    const target = report.root || DEFAULT_TARGET_ROOT;
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
