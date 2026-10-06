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

/**
 * High-performance, interface-driven standard implementation of IPraxisReviewClient.
 */
export class PraxisReviewClient implements IPraxisReviewClient {
    private readonly root: string;
    private readonly graph: SemanticGraph;
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
     * Conducts comprehensive static analysis review across entire workspace.
     */
    public async reviewWorkspace(
        options: PraxisWorkspaceReviewOptions = {},
    ): Promise<PraxisWorkspaceReviewVerdict> {
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
        const lineCount = fileContent.split(/\r?\n/).length;
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
     * Conducts deep semantic & AST slice review for an individual file.
     */
    public async reviewFile(
        filePath: string,
        content?: string,
        options: PraxisFileReviewOptions = {},
    ): Promise<PraxisFileReviewVerdict> {
        const fileContent = await this.readFileContentSafe(filePath, content);
        const graph = options.graph ?? this.graph;
        if (fileContent.length > 0) {
            defaultSemanticAdapterRegistry.extractFileToGraph(filePath, fileContent, graph);
        }

        const effectiveCardContext = options.cardContext ?? this.defaultCardContext;
        const useMoE = options.useSparseMoE ?? this.enableMoE;

        let sliceAudit: PraxisSliceAuditVerdict | undefined;
        let sparsePlan: SparseRoutingPlan | undefined;
        const issues: Issue[] = [];

        if (useMoE && fileContent.length > 0) {
            const moe = await this.auditMoESlice(filePath, fileContent);
            sliceAudit = moe.sliceAudit;
            sparsePlan = moe.sparsePlan;
            for (let i = 0; i < moe.issues.length; i++) {
                issues.push(moe.issues[i]);
            }
        }

        const l1Issues = defaultPyramidEvaluator.evaluateAllLayer1(graph, {
            currentFilePath: filePath,
        });
        for (let i = 0; i < l1Issues.length; i++) {
            issues.push(l1Issues[i]);
        }

        const contentIssues = this.collectContentAuditIssues(filePath, fileContent, graph);
        for (let i = 0; i < contentIssues.length; i++) {
            issues.push(contentIssues[i]);
        }

        const status = this.resolveFileStatus(issues);
        const timestamp = Date.now();

        const verdict: PraxisFileReviewVerdict = {
            filePath,
            status,
            issues,
            sliceAudit,
            sparsePlan,
            cardContext: effectiveCardContext,
            timestamp,
        };

        const includePresentation =
            options.includeDualFacedPresentation ?? this.includeDualFacedPresentation;
        if (includePresentation) {
            const bundle = buildAgentDirectivesBundle(issues, filePath, effectiveCardContext, {
                locale: options.presentationLocale ?? this.defaultLocale,
            });
            verdict.agentDirectives = bundle;
            verdict.directivesMarkdown = bundle.renderedMarkdown;
            verdict.cappDirectiveText = bundle.compactPromptText;
            verdict.presentationPayload = bundle.presentationPayload;
        }

        return verdict;
    }

    /**
     * Conducts semantic-aware diff governance review for code change.
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
     * Evaluates merge gate invariants across branches and diff hunks.
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
 * @returns Fully initialized IPraxisReviewClient instance
 */
export function createPraxisClient(options?: PraxisClientConfig): IPraxisReviewClient {
    return new PraxisReviewClient(options);
}

/**
 * Default singleton instance of Praxis Review Client.
 */
export const defaultPraxisReviewClient: IPraxisReviewClient = createPraxisClient();
