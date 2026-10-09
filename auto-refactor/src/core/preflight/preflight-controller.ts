/**
 * Module: Core Preflight — Preflight Audit Controller & Orchestration Facade
 * File Path: src/core/preflight/preflight-controller.ts
 * Architecture Role: Primary architectural facade coordinating preflight review:
 *   baseline grounding, shallow indexing, scope mode decision, sparse activation,
 *   slice partitioning, progressive expansion, and Bayesian scope normalization.
 * Dependencies & Triggers: Consumes all preflight sub-modules; invoked by public API (src/api.ts)
 *   and scanner execution pipelines.
 * Responsibilities:
 *   1. Substantive facade: aggregates >= 3 sub-modules, validates schema, enforces immutability.
 *   2. Execute end-to-end preflight planning before expensive AST and rule execution.
 *   3. Finalize audit bus aggregation, Bayesian score updating, and composite gate verdict.
 *   4. Publish transparent disclosures: "What was audited / Why only these / What was skipped".
 * Exit Semantics & Design Rationale: Never throws; deterministic; returns frozen structures.
 */

import {
    readAuditedBaseline,
    updateAuditedBaseline,
    type AuditedBaselineRecord,
    type GateVerdictSummary,
} from './eloc-baseline';
import { PreflightAuditIndexStore } from './audit-index';
import { decideAuditScope, type AuditScopeDecision, type AuditScopeMode } from './scope-decision';
import { activateSparseAnalyzers, type SparseActivationResult } from './sparse-activator';
import {
    partitionReviewSlices,
    SharedContextCache,
    type SlicePartitionResult,
} from './slice-partitioner';
import { traceProgressiveExpansion, type ExpansionTraceResult } from './expansion-tracer';
import { AuditBus, type AuditBusAggregationResult } from './audit-bus';
import { normalizeScopeQuality, type ScopeNormalizedAssessment } from './scope-normalizer';
import type { QualityDimension, QualityWeights } from '../scoring/scoringTypes';

/** Configuration options for executing preflight planning */
export interface PreflightPlanOptions {
    readonly ledgerDir: string;
    readonly fileContents: ReadonlyMap<string, string>;
    readonly availableAnalyzers: readonly string[];
    readonly diffFiles?: readonly string[];
    readonly explicitMode?: AuditScopeMode;
    readonly explicitDomain?: string;
    readonly activationThreshold?: number;
    readonly maxWorkers?: number;
}

/** Complete outcome of preflight planning execution */
export interface PreflightPlanResult {
    readonly ledgerDir: string;
    readonly scopeDecision: AuditScopeDecision;
    readonly activationResult: SparseActivationResult;
    readonly partitionResult: SlicePartitionResult;
    readonly baselineRecord: AuditedBaselineRecord;
    readonly expansionResult?: ExpansionTraceResult;
    readonly indexStore: PreflightAuditIndexStore;
    readonly auditBus: AuditBus;
    readonly sharedContext: SharedContextCache;
    readonly planSummary: string;
}

/** Parameters for finalizing an audit session */
export interface FinalizeSessionParams {
    readonly planResult: PreflightPlanResult;
    readonly reviewId: string;
    readonly commitHash: string;
    readonly priorProjectMean: number;
    readonly ledgerDir?: string;
    readonly sliceBeforeScores?: Record<QualityDimension, number>;
    readonly sliceAfterScores: Record<QualityDimension, number>;
    readonly elocSemantic: number;
    readonly weights?: QualityWeights;
}

/** Complete finalization outcome */
export interface AuditFinalizationOutcome {
    readonly mode: AuditScopeMode;
    readonly gateVerdict: GateVerdictSummary;
    readonly busResult: AuditBusAggregationResult;
    readonly scopeAssessment: ScopeNormalizedAssessment;
    readonly updatedBaseline: AuditedBaselineRecord;
    readonly transparentReport: {
        readonly auditedEloc: number;
        readonly reason: string;
        readonly coverageRatio: number;
        readonly skippedFilesCount: number;
        readonly unEvaluatedDimensionsCount: number;
    };
}

/** Computes aggregate estimated ELOC across all indexed project entries */
function computeTotalProjectEloc(indexStore: PreflightAuditIndexStore): number {
    let total = 0;
    for (const entry of indexStore.getAllEntries()) {
        total += entry.eloc.estimatedEloc;
    }
    return total;
}

/** Calculates estimated blast radius ELOC from expansion result or default fallback */
function computeBlastRadiusEloc(
    auditedEloc: number,
    expansionResult?: ExpansionTraceResult,
): number {
    const estimatedRadius = expansionResult?.totalAuditedCount
        ? expansionResult.totalAuditedCount * 80
        : 100;
    return Math.max(auditedEloc, estimatedRadius);
}

/**
 * Evaluates composite gate verdict with early returns using flat guard clauses.
 * Pure decision function ensuring deterministic policy enforcement.
 *
 * @param hasBlockingErrors - Whether blocking audit findings were emitted.
 * @param mode - Review scope mode.
 * @param domain - Optional specialized domain.
 * @param scopeAssessment - Normalized Bayesian scope assessment.
 * @returns Frozen GateVerdictSummary.
 */
export function evaluateGateVerdict(
    hasBlockingErrors: boolean,
    mode: AuditScopeMode,
    domain: string | undefined,
    scopeAssessment: ScopeNormalizedAssessment,
): GateVerdictSummary {
    if (hasBlockingErrors) {
        return Object.freeze({ pass: false, code: 'FAIL_BLOCKING_ERRORS' });
    }

    if (mode === 'CHANGESET') {
        const deltaQ = scopeAssessment.changesetDelta?.deltaQ ?? 0;
        if (deltaQ < -1.0) {
            return Object.freeze({ pass: false, code: 'FAIL_REGRESSION_DELTA' });
        }
        return Object.freeze({ pass: true, code: 'PASS_CHANGESET_LOCAL' });
    }

    if (mode === 'PROJECT') {
        if (scopeAssessment.projectBaseline.mean < 80.0) {
            return Object.freeze({ pass: false, code: 'FAIL_PROJECT_BASELINE' });
        }
        return Object.freeze({ pass: true, code: 'PASS_PROJECT_FULL' });
    }

    return Object.freeze({
        pass: true,
        code: `PASS_DOMAIN_${domain || 'SPECIALIZED'}`,
    });
}

/**
 * Preflight Audit Controller — Substantive Orchestration Facade.
 */
export class PreflightAuditController {
    /**
     * Executes end-to-end preflight audit planning.
     * Concurrency: Reentrant and thread-safe planning without shared mutable state.
     *
     * @param options - Preflight plan options.
     * @returns Frozen PreflightPlanResult.
     */
    public async planAudit(options: PreflightPlanOptions): Promise<PreflightPlanResult> {
        const {
            ledgerDir,
            fileContents,
            availableAnalyzers,
            diffFiles = [],
            explicitMode,
            explicitDomain,
            activationThreshold = 0.35,
            maxWorkers = 4,
        } = options;

        // Read audited baseline
        const baselineRecord = await readAuditedBaseline(ledgerDir);

        // Build lightweight shallow preflight index
        const indexStore = new PreflightAuditIndexStore();
        const allFiles = Array.from(fileContents.keys());
        const indexedEntries = indexStore.batchIndex(fileContents as Map<string, string>);

        // Decide audit scope mode
        const scopeDecision = decideAuditScope({
            explicitMode,
            explicitDomain,
            diffFiles,
            allProjectFiles: allFiles,
            indexStore,
        });

        // Progressive expansion tracing for changeset scope
        let expansionResult: ExpansionTraceResult | undefined;
        let targetFiles = scopeDecision.targetFiles;

        if (scopeDecision.mode === 'CHANGESET' && diffFiles.length > 0) {
            expansionResult = traceProgressiveExpansion(diffFiles, indexStore);
            targetFiles = expansionResult.allAuditedFiles;
        }

        // Filter indexed entries down to targets
        const targetEntrySet = new Set(targetFiles);
        const candidateEntries = indexedEntries.filter((e) => targetEntrySet.has(e.filePath));
        const changedSet = new Set(diffFiles);
        const neighborSet = new Set(expansionResult?.firstOrderNeighbors || []);

        // Sparse activation scoring and analyzer pruning
        const activationResult = activateSparseAnalyzers(
            availableAnalyzers,
            candidateEntries,
            scopeDecision,
            changedSet,
            neighborSet,
            activationThreshold,
        );

        // Mutually disjoint slice partitioning
        const partitionResult = partitionReviewSlices(
            activationResult,
            candidateEntries,
            maxWorkers,
        );

        const auditBus = new AuditBus();
        const sharedContext = new SharedContextCache();

        const planSummary =
            `[PreflightPlan] Mode: ${scopeDecision.mode} | ` +
            `${activationResult.summaryText} | Disjoint Slices: ${partitionResult.slices.length}`;

        return Object.freeze({
            ledgerDir,
            scopeDecision,
            activationResult,
            partitionResult,
            baselineRecord,
            expansionResult,
            indexStore,
            auditBus,
            sharedContext,
            planSummary,
        });
    }

    /**
     * Finalizes audit bus aggregation, Bayesian updating, and composite gate verdict.
     * Concurrency: Thread-safe session finalizer; updates baseline atomically.
     *
     * @param params - Finalization parameters.
     * @returns Frozen AuditFinalizationOutcome.
     */
    public async finalizeAudit(params: FinalizeSessionParams): Promise<AuditFinalizationOutcome> {
        const {
            planResult,
            reviewId,
            commitHash,
            priorProjectMean,
            sliceBeforeScores,
            sliceAfterScores,
            elocSemantic,
            weights,
        } = params;

        // Finalize audit bus aggregation
        const busResult = planResult.auditBus.finalize();

        // Total project ELOC and blast radius estimation
        const elocTotalProject = computeTotalProjectEloc(planResult.indexStore);
        const elocBlastRadius = computeBlastRadiusEloc(
            busResult.totalAuditedEloc,
            planResult.expansionResult,
        );

        // Scope-normalized Bayesian quantification
        const scopeAssessment = normalizeScopeQuality({
            mode: planResult.scopeDecision.mode,
            domain: planResult.scopeDecision.domain,
            priorProjectMean,
            sliceBeforeScores,
            sliceAfterScores,
            elocAudited: busResult.totalAuditedEloc,
            elocBlastRadius,
            elocTotalProject,
            elocSemantic,
            averageEvidenceConfidence: busResult.averageEvidenceConfidence,
            weights,
        });

        // Formulate composite gate verdict via flat decision function
        const hasBlockingErrors = busResult.findingsBySeverity.error > 0;
        const gateVerdict = evaluateGateVerdict(
            hasBlockingErrors,
            planResult.scopeDecision.mode,
            planResult.scopeDecision.domain,
            scopeAssessment,
        );

        // Update audited baseline
        const targetLedgerDir = params.ledgerDir ?? planResult.ledgerDir ?? '.refactor-trajectory';
        const updatedBaseline = await updateAuditedBaseline({
            ledgerDir: targetLedgerDir,
            delta: {
                processed: busResult.totalAuditedEloc,
                unique: busResult.totalAuditedEloc,
                changed: elocSemantic,
                semantic: elocSemantic,
            },
            reviewId,
            commitHash,
            scoreVector: [scopeAssessment.projectBaseline.mean],
            gateVerdict,
        });

        const transparentReport = Object.freeze({
            auditedEloc: busResult.totalAuditedEloc,
            reason: planResult.scopeDecision.reason,
            coverageRatio: planResult.scopeDecision.coverageRatio,
            skippedFilesCount: planResult.activationResult.skippedFiles.length,
            unEvaluatedDimensionsCount: 10 - Object.keys(sliceAfterScores).length,
        });

        return Object.freeze({
            mode: planResult.scopeDecision.mode,
            gateVerdict,
            busResult,
            scopeAssessment,
            updatedBaseline,
            transparentReport,
        });
    }
}

/** Shared singleton instance for default execution */
export const defaultPreflightController = new PreflightAuditController();
