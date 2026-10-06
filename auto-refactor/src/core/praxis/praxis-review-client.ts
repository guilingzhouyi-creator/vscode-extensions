/**
 * Module: Core Engine — Praxis Unified Review Client SDK Facade
 * File Path: src/core/praxis/praxis-review-client.ts
 * Architecture Role: Primary developer-facing SDK client and unified review facade for the
 *   Praxis multi-agent ecosystem; orchestrates workspace scans, single-file reviews,
 *   semantic diff governance, and merge gate evaluations with multi-agent context tagging
 *   and dual-faced diffs.
 * Dependencies & Triggers: Integrates Scanner, SemanticGraph, PraxisDiffGovernanceService,
 *   SparseMoEGateRouter, sliceAuditService, and AgentDirectives protocol; consumed by Praxis
 *   review cells, CI merge gates, and external tooling.
 * Responsibilities:
 *   1. Expose high-level review APIs (reviewWorkspace, reviewFile, reviewDiff, evaluateMergeGate).
 *   2. Support Praxis multi-agent context attribution (cardId, cellId, agentUid, checkpointId).
 *   3. Emit structured AgentDirectives conforming to CAPP protocol and Dual-Faced Diff
 *      representations.
 *   4. Provide zero-configuration createPraxisClient factory with 100% backward compatibility.
 * Exit Semantics & Design Rationale: Interface-driven facade designed for API stability; adheres
 *   to CC <= 15 and Depth <= 4 complexity budgets with fail-safe error isolation.
 */

import * as fs from 'fs';
import type { DiffInput, Issue, ScanReport } from '../types';
import type { PraxisCardContext, ReviewDiffHunk } from './contracts';
import { DefaultPraxisRollbackGatekeeper } from './defaults';
import type {
    IPraxisDiffGovernanceService,
    PraxisDiffGovernanceResult,
    PraxisGovernanceOptions,
} from './diffGovernance';
import { defaultPraxisGovernanceService } from './diffGovernance';
import { SemanticGraph } from '../semantic/semanticGraph';
import { defaultSemanticAdapterRegistry } from '../semantic/adapters/registry';
import { defaultPyramidEvaluator } from '../rules/pyramid/layer1Evaluator';
import { defaultPerformanceEvaluator } from '../rules/pyramid/performanceRules';
import { defaultDataArchitectureEvaluator } from '../intelligence/dataArchitecture';
import { defaultTestModernityEvaluator, isTestFilePath } from '../intelligence/testModernity';
import type { IPraxisSliceAuditService } from './sliceAuditService';
import { defaultPraxisSliceAuditService } from './sliceAuditService';
import type { SparseMoEGateRouter } from '../router/sparseMoEGate';
import { defaultSparseMoEGateRouter } from '../router/sparseMoEGate';
import type { PraxisSliceAuditVerdict, SparseRoutingPlan } from '../router/sliceTypes';
import { Scanner } from '../analyzer';
import { resolveConfig } from '../config/config';
import { Logger } from '../logger';
import { finalizeReport } from '../reporting/reportFinalizer';
import type { PraxisLocale } from './presentation/i18n-types';
import type {
    IPraxisReviewClient,
    PraxisClientConfig,
    PraxisFileReviewOptions,
    PraxisFileReviewVerdict,
    PraxisMergeGateVerdict,
    PraxisWorkspaceReviewOptions,
    PraxisWorkspaceReviewVerdict,
} from './client/types';
import {
    buildAgentDirectivesBundle,
    buildDualFacedDiff,
    tagHunksWithContext,
} from './client/agent-directives';
import { resolvePraxisClientConfig } from './client/index';

function clearGraphInstance(graph: SemanticGraph): void {
    const raw = graph as unknown as {
        nodes?: Map<unknown, unknown>;
        outgoing?: Map<unknown, unknown>;
        incoming?: Map<unknown, unknown>;
    };
    if (raw.nodes instanceof Map) {
        raw.nodes.clear();
    }
    if (raw.outgoing instanceof Map) {
        raw.outgoing.clear();
    }
    if (raw.incoming instanceof Map) {
        raw.incoming.clear();
    }
}

function countLinesFast(content: string): number {
    let count = 1;
    let pos = 0;
    while ((pos = content.indexOf('\n', pos)) !== -1) {
        count++;
        pos++;
    }
    return count;
}

/**
 * High-performance, interface-driven standard implementation of IPraxisReviewClient.
 */
export class PraxisReviewClient implements IPraxisReviewClient {
    private readonly root: string;
    private graph: SemanticGraph;
    private readonly diffService: IPraxisDiffGovernanceService;
    private readonly sliceService: IPraxisSliceAuditService;
    private readonly sparseRouter: SparseMoEGateRouter;
    private readonly enableMoE: boolean;
    private readonly includeDualFacedPresentation: boolean;
    private readonly defaultLocale: PraxisLocale;
    public readonly defaultCardContext?: PraxisCardContext;

    /**
     * Initializes the client with layered configuration options and defaults.
     */
    public constructor(options?: PraxisClientConfig) {
        const resolved = resolvePraxisClientConfig(options);
        this.root = resolved.root ?? process.cwd();
        this.graph = resolved.graph ?? new SemanticGraph();
        this.defaultCardContext = resolved.defaultCardContext;
        this.diffService = resolved.diffService ?? defaultPraxisGovernanceService;
        this.sliceService = resolved.sliceService ?? defaultPraxisSliceAuditService;
        this.sparseRouter = resolved.sparseRouter ?? defaultSparseMoEGateRouter;
        this.enableMoE = resolved.enableMoE ?? true;
        this.includeDualFacedPresentation = resolved.includeDualFacedPresentation ?? true;
        this.defaultLocale = resolved.defaultLocale ?? 'zh-CN';
    }

    /**
     * Active semantic graph instance maintained by this review client.
     */
    public get semanticGraph(): SemanticGraph {
        return this.graph;
    }

    /**
     * Clears all accumulated AST symbols, edges, and topologies from the internal semantic graph.
     * Prevents unbounded memory growth in long-running processes and batch review workflows.
     */
    public clearSemanticGraph(): void {
        clearGraphInstance(this.graph);
    }

    /**
     * Resets the semantic graph, clearing any existing nodes and optionally replacing
     * the active graph instance.
     *
     * @param newGraph - Optional fresh SemanticGraph instance to install.
     */
    public resetSemanticGraph(newGraph?: SemanticGraph): void {
        this.clearSemanticGraph();
        if (newGraph) {
            this.graph = newGraph;
        }
    }

    /**
     * Conducts comprehensive static analysis review across the entire workspace directory.
     *
     * Scans source files using configured analyzers, aggregates rule violations into a
     * finalized scan report, evaluates workspace pass/fail status against configured
     * severity thresholds, and synthesizes machine-actionable Agent Directives (Markdown,
     * CAPP DSL, and UI presentation cards) attributed to the active multi-agent card context.
     *
     * Concurrency & Reentrancy:
     *   Thread-safe and re-entrant. Allocates an isolated scanner instance and logger per
     *   review run; safe for concurrent invocation across distinct workspace roots.
     *
     * @param options - Configuration options controlling workspace scanning and directives:
     *   - `root`: Root directory path to scan (defaults to client configured root).
     *   - `configFile`: Optional path to custom configuration file overriding default settings.
     *   - `analyzers`: Allow-list of specific analyzer names; unlisted ones are bypassed.
     *   - `cardContext`: Task card metadata for multi-agent attribution;
     *     falls back to `defaultCardContext`.
     *   - `includeDualFacedPresentation`: Whether to generate presentation payload and
     *     Agent Directives.
     *   - `presentationLocale`: Target locale ('zh-CN' | 'en-US') for UI diagnostic cards.
     *   - `maxDirectives`: Maximum number of actionable directives to produce in bundle.
     *   - `failOnSeverity`: Minimum severity ('info' | 'warning' | 'error') triggering
     *     'blocked' status (default: 'error').
     * @returns Promise resolving to a deconstructed `PraxisWorkspaceReviewVerdict`:
     *   - `scanReport`: Raw finalized scan report containing file metrics and issues.
     *   - `status`: High-level evaluation outcome ('passed' | 'warning' | 'blocked').
     *   - `issues`: Flat array of all detected static analysis issues across workspace.
     *   - `cardContext`: Active task card context tagged on this review session.
     *   - `timestamp`: Review completion timestamp in epoch milliseconds.
     *   - `agentDirectives`: Optional structured AgentDirectives bundle conforming to CAPP.
     *   - `directivesMarkdown`: Optional rendered Markdown representation of agent directives.
     *   - `cappDirectiveText`: Optional compact single-line CAPP DSL text.
     *   - `presentationPayload`: Optional rich UI diagnostic cards and presentation payload.
     * @throws Rejection occurs only if critical configuration resolution or underlying
     *   scanner initialization fails unrecoverably.
     */
    public async reviewWorkspace(
        options: PraxisWorkspaceReviewOptions = {},
    ): Promise<PraxisWorkspaceReviewVerdict> {
        if ((options as { clearSemanticGraph?: boolean }).clearSemanticGraph) {
            this.clearSemanticGraph();
        }
        const root = options.root ?? this.root;
        const effectiveCardContext = options.cardContext ?? this.defaultCardContext;
        const config = resolveConfig({
            root,
            configFile: options.configFile,
            analyzers: options.analyzers,
            logLevel: 'error',
        });

        const logger = new Logger(config.logLevel, config.logFile);
        const scanner = new Scanner(config, logger);
        const rawReport = await scanner.scan();

        await finalizeReport(rawReport, config, {}, logger, scanner);
        logger.close();

        const issues = rawReport.issues;
        const status = this.resolveWorkspaceStatus(rawReport, options.failOnSeverity);
        const timestamp = Date.now();

        const verdict: PraxisWorkspaceReviewVerdict = {
            scanReport: rawReport,
            status,
            issues,
            cardContext: effectiveCardContext,
            timestamp,
        };

        const includePresentation =
            options.includeDualFacedPresentation ?? this.includeDualFacedPresentation;
        if (includePresentation) {
            const bundle = buildAgentDirectivesBundle(issues, root, effectiveCardContext, {
                maxDirectives: options.maxDirectives,
                locale: options.presentationLocale ?? this.defaultLocale,
            });
            verdict.agentDirectives = bundle;
            verdict.directivesMarkdown = bundle.renderedMarkdown;
            verdict.cappDirectiveText = bundle.compactPromptText;
            verdict.presentationPayload = bundle.presentationPayload;
        }

        return verdict;
    }

    private async readFileContentSafe(filePath: string, content?: string): Promise<string> {
        if (content !== undefined) return content;
        try {
            return await fs.promises.readFile(filePath, 'utf8');
        } catch {
            return '';
        }
    }

    private collectContentAuditIssues(
        filePath: string,
        fileContent: string,
        graph: SemanticGraph,
    ): Issue[] {
        if (fileContent.length === 0) return [];
        const issues: Issue[] = [];
        const perfIssues = defaultPerformanceEvaluator.auditSource(filePath, fileContent);
        for (let i = 0; i < perfIssues.length; i++) issues.push(perfIssues[i]);

        const dataIssues = defaultDataArchitectureEvaluator.audit(filePath, fileContent, graph);
        for (let i = 0; i < dataIssues.length; i++) issues.push(dataIssues[i]);

        if (isTestFilePath(filePath)) {
            const testIssues = defaultTestModernityEvaluator.auditTestSource(filePath, fileContent);
            for (let i = 0; i < testIssues.length; i++) issues.push(testIssues[i]);
        }
        return issues;
    }

    private async auditMoESlice(
        filePath: string,
        fileContent: string,
    ): Promise<{
        sliceAudit?: PraxisSliceAuditVerdict;
        sparsePlan?: SparseRoutingPlan;
        issues: Issue[];
    }> {
        const lineCount = countLinesFast(fileContent);
        const changedLines: number[] = new Array(lineCount);
        for (let i = 0; i < lineCount; i++) {
            changedLines[i] = i + 1;
        }
        const sliceAudit = await this.sliceService.auditSlice({
            filePath,
            oldContent: '',
            newContent: fileContent,
            changedLines,
        });
        const issues: Issue[] = [];
        if (sliceAudit.issues?.length) {
            for (let i = 0; i < sliceAudit.issues.length; i++) {
                issues.push(sliceAudit.issues[i]);
            }
        }
        return { sliceAudit, sparsePlan: sliceAudit.routingPlan, issues };
    }

    /**
     * Conducts deep semantic and AST slice review for an individual source file.
     *
     * Ingests file content directly or safely from disk, extracts symbols into the semantic
     * graph, conditionally routes changed lines through the Sparse MoE expert gating router
     * and AST slice audit service, evaluates Layer-1 pyramid architecture rules and content
     * audits (performance, data architecture, and test modernity), and synthesizes localized
     * dual-faced agent directives.
     *
     * Concurrency & Reentrancy:
     *   Safe for concurrent async invocations across distinct files. Updates the provided
     *   or client semantic graph during symbol extraction; concurrent reviews sharing the
     *   same graph instance should ensure non-conflicting symbol namespace mutations.
     *
     * @param filePath - Target file path under review (relative or absolute).
     * @param content - Optional in-memory file content string. If omitted, loaded from disk.
     * @param options - File review configuration options:
     *   - `cardContext`: Task card context for attribution; defaults to `defaultCardContext`.
     *   - `useSparseMoE`: Whether to route slice audit through Sparse MoE conditional gating;
     *     defaults to `enableMoE`.
     *   - `includeDualFacedPresentation`: Whether to generate presentation and directives.
     *   - `presentationLocale`: Preferred locale ('zh-CN' | 'en-US') for diagnostic cards.
     *   - `graph`: Custom SemanticGraph instance; defaults to client internal graph.
     *   - `root`: Optional workspace root for relative path resolution.
     * @returns Promise resolving to a deconstructed `PraxisFileReviewVerdict`:
     *   - `filePath`: Path of the reviewed file.
     *   - `status`: Individual file verdict classification ('passed' | 'warning' | 'blocked').
     *   - `issues`: Aggregated static analysis issues across AST, MoE, pyramid, and content.
     *   - `sliceAudit`: Optional AST slice audit verdict if MoE slice audit was executed.
     *   - `sparsePlan`: Optional Sparse MoE routing plan indicating active/bypassed analyzers.
     *   - `cardContext`: Attached multi-agent task card context.
     *   - `timestamp`: Review completion timestamp in epoch milliseconds.
     *   - `agentDirectives`: Optional structured AgentDirectives bundle conforming to CAPP.
     *   - `directivesMarkdown`: Optional rendered Markdown representation of directives.
     *   - `cappDirectiveText`: Optional compact single-line CAPP DSL text.
     *   - `presentationPayload`: Optional rich UI diagnostic cards and presentation payload.
     * @throws File read failures are handled fail-safely (treated as empty content);
     *   unhandled rejections occur only if underlying AST extractors or MoE router throw fatal
     *   runtime errors.
     */
    public async reviewFile(
        filePath: string,
        content?: string,
        options: PraxisFileReviewOptions = {},
    ): Promise<PraxisFileReviewVerdict> {
        const opts = options as PraxisFileReviewOptions & {
            resetGraph?: boolean;
            clearGraphAfter?: boolean;
            isolatedGraph?: boolean;
        };

        if (opts.resetGraph) {
            this.clearSemanticGraph();
        }

        const fileContent = await this.readFileContentSafe(filePath, content);
        const graph = opts.isolatedGraph
            ? new SemanticGraph()
            : (options.graph ?? this.graph);

        if (fileContent.length > 0) {
            defaultSemanticAdapterRegistry.extractFileToGraph(filePath, fileContent, graph);
        }

        try {
            const effectiveCardContext = options.cardContext ?? this.defaultCardContext;
            const useMoE = options.useSparseMoE ?? this.enableMoE;

            let sliceAudit: PraxisSliceAuditVerdict | undefined;
            let sparsePlan: SparseRoutingPlan | undefined;
            const issues: Issue[] = [];

            if (useMoE && fileContent.length > 0) {
                const moe = await this.auditMoESlice(filePath, fileContent);
                sliceAudit = moe.sliceAudit;
                sparsePlan = moe.sparsePlan;
                issues.push(...moe.issues);
            }

            const l1Issues = defaultPyramidEvaluator.evaluateAllLayer1(graph, {
                currentFilePath: filePath,
            });
            issues.push(...l1Issues);

            const contentIssues = this.collectContentAuditIssues(filePath, fileContent, graph);
            issues.push(...contentIssues);

            const status = this.resolveFileStatus(issues);
            const verdict: PraxisFileReviewVerdict = {
                filePath,
                status,
                issues,
                sliceAudit,
                sparsePlan,
                cardContext: effectiveCardContext,
                timestamp: Date.now(),
            };

            this.attachPresentationBundle(verdict, issues, filePath, effectiveCardContext, options);
            return verdict;
        } finally {
            this.cleanupReviewGraph(opts, graph, options.graph);
        }
    }

    private attachPresentationBundle(
        verdict: PraxisFileReviewVerdict,
        issues: Issue[],
        filePath: string,
        effectiveCardContext: PraxisCardContext | undefined,
        options: PraxisFileReviewOptions,
    ): void {
        const includePresentation =
            options.includeDualFacedPresentation ?? this.includeDualFacedPresentation;
        if (!includePresentation) {
            return;
        }
        const bundle = buildAgentDirectivesBundle(issues, filePath, effectiveCardContext, {
            locale: options.presentationLocale ?? this.defaultLocale,
        });
        verdict.agentDirectives = bundle;
        verdict.directivesMarkdown = bundle.renderedMarkdown;
        verdict.cappDirectiveText = bundle.compactPromptText;
        verdict.presentationPayload = bundle.presentationPayload;
    }

    private cleanupReviewGraph(
        opts: { clearGraphAfter?: boolean; isolatedGraph?: boolean },
        graph: SemanticGraph,
        externalGraph?: SemanticGraph,
    ): void {
        if (!opts.clearGraphAfter) {
            return;
        }
        if (opts.isolatedGraph) {
            clearGraphInstance(graph);
            return;
        }
        if (!externalGraph) {
            this.clearSemanticGraph();
        }
    }

    /**
     * Conducts batch static analysis review across multiple source files.
     * Provides memory bounds by supporting periodic or per-file semantic graph clearing.
     *
     * @param files - Array of file paths or file input descriptors.
     * @param options - File review options with optional graph lifecycle management:
     *   - `clearBetweenFiles`: When true, resets graph between each file review.
     *   - `autoResetGraph`: When true, resets graph after batch completion.
     * @returns Array of review verdicts for all processed files.
     */
    public async reviewFiles(
        files: Array<string | { filePath: string; content?: string }>,
        options: PraxisFileReviewOptions & {
            clearBetweenFiles?: boolean;
            autoResetGraph?: boolean;
        } = {},
    ): Promise<PraxisFileReviewVerdict[]> {
        const verdicts: PraxisFileReviewVerdict[] = [];
        try {
            for (const item of files) {
                const filePath = typeof item === 'string' ? item : item.filePath;
                const content = typeof item === 'string' ? undefined : item.content;
                if (options.clearBetweenFiles) {
                    this.clearSemanticGraph();
                }
                const verdict = await this.reviewFile(filePath, content, options);
                verdicts.push(verdict);
            }
            return verdicts;
        } finally {
            if (options.autoResetGraph) {
                this.clearSemanticGraph();
            }
        }
    }

    /**
     * Conducts semantic-aware diff governance review for proposed code modifications.
     *
     * Delegates to the underlying `IPraxisDiffGovernanceService` to evaluate hunk-level blast
     * radius, enforce architectural invariants and rollback safety thresholds, resolve symbol
     * impact against the semantic graph, and enrich all review hunks with multi-agent task card
     * attribution.
     *
     * Concurrency & Reentrancy:
     *   Re-entrant and thread-safe. Operates purely on the provided diff inputs and reads the
     *   semantic graph without mutating persistent state. Safe for concurrent worker calls.
     *
     * @param input - Diff input specification containing raw diff strings or patch hunks.
     * @param options - Diff governance options:
     *   - `graph`: SemanticGraph for cross-file symbol resolution (falls back to client graph).
     *   - `cardContext`: Multi-agent task card context (falls back to `defaultCardContext`).
     *   - `strict`: Optional boolean enforcing zero-tolerance governance checks.
     *   - `maxHunks`: Maximum number of diff hunks to process before throttling.
     * @returns Promise resolving to a deconstructed `PraxisDiffGovernanceResult`:
     *   - `approved`: Boolean indicating if all diff changes comply with governance policies.
     *   - `status`: Granular governance verdict status classification.
     *   - `hunks`: Analyzed `ReviewDiffHunk` structures enriched with AST impact and tags.
     *   - `violations`: Descriptions of any detected governance or safety policy violations.
     *   - `metrics`: Quantitative metrics summarizing blast radius and line/symbol counts.
     * @throws Fail-safe on malformed diffs (returns unparseable or rejected status); propagates
     *   only fatal unexpected exceptions from custom governance hooks.
     */
    public async reviewDiff(
        input: DiffInput,
        options: PraxisGovernanceOptions = {},
    ): Promise<PraxisDiffGovernanceResult> {
        const effectiveCardContext = options.cardContext ?? this.defaultCardContext;
        const mergedOptions: PraxisGovernanceOptions = {
            ...options,
            graph: options.graph ?? this.graph,
            cardContext: effectiveCardContext,
        };

        const result = await this.diffService.reviewDiff(input, mergedOptions);

        if (effectiveCardContext && result.hunks?.length) {
            tagHunksWithContext(result.hunks, effectiveCardContext);
        }

        return result;
    }

    private collectGateViolations(
        gateResult: { violations?: string[] },
        hunks: ReviewDiffHunk[],
    ): { violations: string[]; hasMajorRework: boolean } {
        const violations: string[] = [];
        if (gateResult.violations) {
            for (let i = 0; i < gateResult.violations.length; i++) {
                violations.push(gateResult.violations[i]);
            }
        }
        let hasMajorRework = false;
        for (let i = 0; i < hunks.length; i++) {
            const h = hunks[i];
            if (h.reviewVerdict?.violations) {
                for (let k = 0; k < h.reviewVerdict.violations.length; k++) {
                    violations.push(h.reviewVerdict.violations[k]);
                }
            }
            if (h.reviewVerdict?.status === 'major_rework_needed') {
                hasMajorRework = true;
            }
        }
        return { violations, hasMajorRework };
    }

    private resolveMergeGateStatus(
        approved: boolean,
        hasMajorRework: boolean,
        gateApproved: boolean,
    ): 'passed' | 'minor_fix_needed' | 'major_rework_needed' {
        if (approved) return 'passed';
        if (hasMajorRework || !gateApproved) return 'major_rework_needed';
        return 'minor_fix_needed';
    }

    /**
     * Evaluates merge gate invariants across branch transitions and diff hunks.
     *
     * Validates proposed branch merges against rollback gatekeepers, checks hunk-level rework
     * thresholds ('major_rework_needed'), collects impacted files, attaches multi-agent card
     * context attribution to hunks, and constructs dual-faced diff representations
     * partitioning technical AST diagnostics (Agent Face) and visual localized diagnostic
     * cards (Human Face).
     *
     * Concurrency & Reentrancy:
     *   Re-entrant and thread-safe. Pure coordination pipeline that executes gatekeeper hooks
     *   and constructs presentation payloads without mutating shared client state.
     *
     * @param sourceBranch - Identifier of incoming feature or source branch.
     * @param targetBranch - Identifier of base or target branch receiving merge.
     * @param hunks - Array of `ReviewDiffHunk` objects representing proposed code changes to
     *   evaluate against gate invariants.
     * @returns Promise resolving to a deconstructed `PraxisMergeGateVerdict`:
     *   - `approved`: Boolean flag indicating if merge is cleared without blocks/major rework.
     *   - `status`: Tri-state merge status ('passed' | 'minor_fix_needed' | 'major_rework_needed').
     *   - `sourceBranch`: Verified source branch identifier.
     *   - `targetBranch`: Verified target branch identifier.
     *   - `reason`: Explanatory rationale when merge gate blocks or approves request.
     *   - `violations`: Aggregated list of gate violations from gatekeeper and hunks.
     *   - `affectedFiles`: Deduplicated list of file paths impacted by evaluated hunks.
     *   - `attributedHunks`: Diff hunks enriched with multi-agent context tagging.
     *   - `dualFacedDiff`: Dual-faced diff representation partitioning Agent Face AST metrics
     *     and Human Face UI cards.
     *   - `cardContext`: Active multi-agent task card context.
     *   - `timestamp`: Epoch timestamp in milliseconds when gate evaluation completed.
     * @throws Propagates fatal rejections if underlying rollback gatekeepers fail
     *   unrecoverably; hunks attribution and formatting are fail-safe.
     */
    public async evaluateMergeGate(
        sourceBranch: string,
        targetBranch: string,
        hunks: ReviewDiffHunk[],
    ): Promise<PraxisMergeGateVerdict> {
        const effectiveCardContext = this.defaultCardContext;
        const hooks = this.diffService.createHooks(this.graph);

        if (effectiveCardContext) {
            tagHunksWithContext(hunks, effectiveCardContext);
        }

        const gatekeeper = hooks.rollbackGatekeeper ?? new DefaultPraxisRollbackGatekeeper();
        const gateResult = await gatekeeper.checkMergeGate(sourceBranch, targetBranch, hunks);

        const { violations, hasMajorRework } = this.collectGateViolations(gateResult, hunks);
        const approved = gateResult.approved && !hasMajorRework && violations.length === 0;
        const status = this.resolveMergeGateStatus(approved, hasMajorRework, gateResult.approved);

        const affectedFiles = this.collectAffectedFiles(hunks);
        const dualFacedDiff = buildDualFacedDiff(
            hunks,
            sourceBranch,
            targetBranch,
            approved,
            violations,
            effectiveCardContext,
            this.defaultLocale,
        );

        return {
            approved,
            status,
            sourceBranch,
            targetBranch,
            reason: gateResult.reason,
            violations,
            affectedFiles,
            attributedHunks: hunks,
            dualFacedDiff,
            cardContext: effectiveCardContext,
            timestamp: Date.now(),
        };
    }

    private resolveWorkspaceStatus(
        report: ScanReport,
        failOnSeverity?: 'info' | 'warning' | 'error',
    ): 'passed' | 'warning' | 'blocked' {
        const sev = failOnSeverity ?? 'error';
        if (sev === 'info' && report.summary.issuesTotal > 0) {
            return 'blocked';
        }
        if (
            sev === 'warning' &&
            (report.summary.bySeverity.warning > 0 || report.summary.bySeverity.error > 0)
        ) {
            return 'blocked';
        }
        if (report.summary.bySeverity.error > 0) {
            return 'blocked';
        }
        if (report.summary.bySeverity.warning > 0) {
            return 'warning';
        }
        return 'passed';
    }

    private resolveFileStatus(issues: Issue[]): 'passed' | 'warning' | 'blocked' {
        let hasWarn = false;
        for (let i = 0; i < issues.length; i++) {
            if (issues[i].severity === 'error') {
                return 'blocked';
            }
            if (issues[i].severity === 'warning') {
                hasWarn = true;
            }
        }
        return hasWarn ? 'warning' : 'passed';
    }

    private collectAffectedFiles(hunks: ReviewDiffHunk[]): string[] {
        const fileSet = new Set<string>();
        for (let i = 0; i < hunks.length; i++) {
            const h = hunks[i];
            if (h.astContext?.impactFiles) {
                for (let j = 0; j < h.astContext.impactFiles.length; j++) {
                    fileSet.add(h.astContext.impactFiles[j]);
                }
            }
            if (h.hunkId.includes(':')) {
                const parts = h.hunkId.split(':');
                if (parts.length > 1) {
                    fileSet.add(parts[1]);
                }
            }
        }
        return Array.from(fileSet);
    }
}

/**
 * Factory creating a fresh instance conforming to IPraxisReviewClient.
 *
 * @param options - Optional configuration options
 * @returns Fully initialized PraxisReviewClient instance
 */
export function createPraxisClient(options?: PraxisClientConfig): PraxisReviewClient {
    return new PraxisReviewClient(options);
}

/**
 * Default singleton instance of Praxis Review Client.
 */
export const defaultPraxisReviewClient: PraxisReviewClient = createPraxisClient();

/**
 * Convenience helper to clear accumulated state in the default singleton review client's semantic graph.
 */
export function clearDefaultPraxisClient(): void {
    defaultPraxisReviewClient.clearSemanticGraph();
}
