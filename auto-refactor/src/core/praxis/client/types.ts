/**
 * Module: Core Engine — Praxis Client SDK Types & Contracts
 * File Path: src/core/praxis/client/types.ts
 * Architecture Role: Primary contract definitions for the unified Praxis Review Client SDK,
 *   specifying client configuration, workspace/file/diff/merge review options and verdicts,
 *   Agent Directives protocol structures, and Dual-Faced Diff payloads.
 * Dependencies & Triggers: Consumes contracts from ../contracts, ../diffGovernance,
 *   ../../types, ../../semantic, ../../router, and ../presentation; consumed by
 *   praxisReviewClient.ts and public facades.
 * Responsibilities: Declare strongly typed interfaces and data contracts without
 *   runtime overhead.
 * Exit Semantics & Design Rationale: Type-only definitions; evaluation leaves zero
 *   runtime overhead.
 */

import type { DiffInput, Issue, ScanReport } from '../../types';
import type { PraxisCardContext, ReviewDiffHunk } from '../contracts';
import type {
    IPraxisDiffGovernanceService,
    PraxisDiffGovernanceResult,
    PraxisGovernanceOptions,
} from '../diffGovernance';
import type { SemanticGraph } from '../../semantic/semanticGraph';
import type { PraxisSliceAuditVerdict, SparseRoutingPlan } from '../../router/sliceTypes';
import type { IPraxisSliceAuditService } from '../sliceAuditService';
import type { SparseMoEGateRouter } from '../../router/sparseMoEGate';
import type { PraxisLocale } from '../presentation/i18n-types';
import type {
    PraxisBadgeColor,
    PraxisDiagnosticCard,
    PraxisPresentationPayload,
} from '../presentation/presentation-types';

/**
 * Configuration options initializing the Praxis Review Client.
 */
export interface PraxisClientConfig {
    /** Workspace root directory (defaults to process.cwd()) */
    root?: string;
    /** Base semantic graph for cross-file and architectural analysis */
    graph?: SemanticGraph;
    /** Default task card context for multi-agent attribution */
    defaultCardContext?: PraxisCardContext;
    /** Diff review and governance service implementation */
    diffService?: IPraxisDiffGovernanceService;
    /** AST slice audit service implementation */
    sliceService?: IPraxisSliceAuditService;
    /** Sparse MoE conditional expert dispatching router */
    sparseRouter?: SparseMoEGateRouter;
    /** Whether to enable Sparse MoE gating (defaults to true) */
    enableMoE?: boolean;
    /** Whether to include dual-faced UI presentation payloads (defaults to true) */
    includeDualFacedPresentation?: boolean;
    /** Default locale for diagnostic cards and reports (defaults to 'zh-CN') */
    defaultLocale?: PraxisLocale;
}

/**
 * Options configuring workspace-wide static analysis review.
 */
export interface PraxisWorkspaceReviewOptions {
    /** Target directory to scan (defaults to client.root) */
    root?: string;
    /** Path to custom config file */
    configFile?: string;
    /** Filter to specific analyzer names */
    analyzers?: string[];
    /** Task card context for multi-agent tagging */
    cardContext?: PraxisCardContext;
    /** Whether to include dual-faced presentation (defaults to client setting) */
    includeDualFacedPresentation?: boolean;
    /** Target locale for UI diagnostic cards */
    presentationLocale?: PraxisLocale;
    /** Max agent directives to emit */
    maxDirectives?: number;
    /** Severity threshold that blocks the verdict (defaults to 'error') */
    failOnSeverity?: 'info' | 'warning' | 'error';
}

/**
 * Consolidated verdict returned from workspace review.
 */
export interface PraxisWorkspaceReviewVerdict {
    /** Complete scan report emitted by engine */
    scanReport: ScanReport;
    /** Consolidated workspace verdict status */
    status: 'passed' | 'warning' | 'blocked';
    /** All detected static analysis findings */
    issues: Issue[];
    /** Rendered Markdown directives optimized for AI Agent prompt ingestion */
    directivesMarkdown?: string;
    /** Ultra-compact CAPP single-line DSL string */
    cappDirectiveText?: string;
    /** Rich UI presentation payload for Praxis frontend */
    presentationPayload?: PraxisPresentationPayload;
    /** Structured AgentDirectives bundle conforming to protocol */
    agentDirectives?: AgentDirectivesBundle;
    /** Associated multi-agent task card context */
    cardContext?: PraxisCardContext;
    /** Review timestamp in epoch milliseconds */
    timestamp: number;
}

/**
 * Options configuring single file review.
 */
export interface PraxisFileReviewOptions {
    /** Task card context for multi-agent tagging */
    cardContext?: PraxisCardContext;
    /** Whether to leverage Sparse MoE gating (defaults to client setting) */
    useSparseMoE?: boolean;
    /** Whether to include dual-faced presentation (defaults to client setting) */
    includeDualFacedPresentation?: boolean;
    /** Target locale for UI diagnostic cards */
    presentationLocale?: PraxisLocale;
    /** Custom semantic graph for context enrichment */
    graph?: SemanticGraph;
    /** Optional workspace root */
    root?: string;
}

/**
 * Consolidated verdict returned from single file review.
 */
export interface PraxisFileReviewVerdict {
    /** Target file path */
    filePath: string;
    /** File review verdict status */
    status: 'passed' | 'warning' | 'blocked';
    /** Static analysis findings for this file */
    issues: Issue[];
    /** AST slice audit verdict if MoE slice audit was executed */
    sliceAudit?: PraxisSliceAuditVerdict;
    /** Sparse MoE routing plan indicating active and bypassed analyzers */
    sparsePlan?: SparseRoutingPlan;
    /** Rendered Markdown directives for AI Agent */
    directivesMarkdown?: string;
    /** Ultra-compact CAPP single-line DSL string */
    cappDirectiveText?: string;
    /** Rich UI presentation payload */
    presentationPayload?: PraxisPresentationPayload;
    /** Structured AgentDirectives bundle conforming to protocol */
    agentDirectives?: AgentDirectivesBundle;
    /** Associated multi-agent task card context */
    cardContext?: PraxisCardContext;
    /** Review timestamp in epoch milliseconds */
    timestamp: number;
}

/**
 * Individual structured directive item conforming to AgentDirectives protocol.
 */
export interface AgentDirectiveItem {
    id: string;
    rule: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    filePath: string;
    line: number;
    column?: number;
    action?: string;
    safeToAutomate?: boolean;
    taxonomy?: string;
    templateSnippet?: string;
    suggestion?: string;
}

/**
 * Structured AgentDirectives bundle for machine-actionable consumption.
 */
export interface AgentDirectivesBundle {
    items: AgentDirectiveItem[];
    compactPromptText: string;
    renderedMarkdown: string;
    presentationPayload?: PraxisPresentationPayload;
    summary: {
        total: number;
        blockCount: number;
        warnCount: number;
        infoCount: number;
    };
}

/**
 * Dual-Faced Diff result representing Agent face and Human face views.
 */
export interface DualFacedDiffResult {
    /** Agent Face: Semantic AST & risk-attributed technical dimension */
    agentFace: {
        attributedHunks: ReviewDiffHunk[];
        symbolScopes: string[];
        impactFiles: string[];
        averageRiskScore: number;
        suggestedActions: string[];
    };
    /** Human Face: Visual badges, metrics, and localized diagnostic cards */
    humanFace: {
        approved: boolean;
        statusText: string;
        badgeColor: PraxisBadgeColor;
        linesAdded: number;
        linesDeleted: number;
        linesUnchanged: number;
        affectedFiles: string[];
        violations: string[];
        diagnosticCards: PraxisDiagnosticCard[];
    };
}

/**
 * Consolidated verdict returned from merge gate evaluation.
 */
export interface PraxisMergeGateVerdict {
    /** Whether merge gate approved the incoming change */
    approved: boolean;
    /** Consolidated gate verdict classification */
    status: 'passed' | 'minor_fix_needed' | 'major_rework_needed';
    /** Source branch being merged */
    sourceBranch: string;
    /** Target base branch */
    targetBranch: string;
    /** Optional explanation for the gate decision */
    reason?: string;
    /** List of gate violations detected across hunks */
    violations: string[];
    /** List of files impacted by this merge */
    affectedFiles: string[];
    /** Diff hunks tagged with multi-agent attribution and AST context */
    attributedHunks: ReviewDiffHunk[];
    /** Dual-faced diff representation (Agent face vs Human face) */
    dualFacedDiff?: DualFacedDiffResult;
    /** Associated multi-agent task card context */
    cardContext?: PraxisCardContext;
    /** Evaluation timestamp */
    timestamp: number;
}

/**
 * Formal client service interface exposed to Praxis development teams.
 */
export interface IPraxisReviewClient {
    /** Default task card context for multi-agent attribution */
    readonly defaultCardContext?: PraxisCardContext;
    /** Shared semantic graph maintained by the client */
    readonly semanticGraph: SemanticGraph;

    /**
     * Conducts comprehensive static analysis review across entire workspace.
     */
    reviewWorkspace(options?: PraxisWorkspaceReviewOptions): Promise<PraxisWorkspaceReviewVerdict>;

    /**
     * Conducts deep semantic & AST slice review for an individual file.
     */
    reviewFile(
        filePath: string,
        content?: string,
        options?: PraxisFileReviewOptions,
    ): Promise<PraxisFileReviewVerdict>;

    /**
     * Conducts semantic-aware diff governance review for code change.
     */
    reviewDiff(
        input: DiffInput,
        options?: PraxisGovernanceOptions,
    ): Promise<PraxisDiffGovernanceResult>;

    /**
     * Evaluates merge gate invariants across branches and diff hunks.
     */
    evaluateMergeGate(
        sourceBranch: string,
        targetBranch: string,
        hunks: ReviewDiffHunk[],
    ): Promise<PraxisMergeGateVerdict>;
}
