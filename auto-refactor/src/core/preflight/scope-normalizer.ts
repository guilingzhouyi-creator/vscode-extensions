/**
 * Module: Core Preflight — Scope-Normalized Quality Quantification & Bayesian Updating
 * File Path: src/core/preflight/scope-normalizer.ts
 * Architecture Role: Implements engineering-grade multi-scale confidence architecture and
 *   Bayesian conjugate belief updating for score scope normalization. Eliminates catastrophic
 *   score cliff crashes when evaluating small changesets or isolated domains.
 * Dependencies & Triggers: Consumes scoringTypes and scorer-formulas; called by preflight
 *   controller and composite gate finalizers.
 * Responsibilities:
 *   1. Calculate multi-scale confidence combining evidence certainty, blast-radius scope,
 *      and dimension coverage.
 *   2. Update project-level global baseline via Bayesian Gaussian updating without sampling bias.
 *   3. Partition scores into representations (Q_project, ΔQ_change with QED, Q_domain).
 *   4. Publish transparent 95% confidence intervals [μ - 1.96σ, μ + 1.96σ] for all outputs.
 * Exit Semantics & Design Rationale: Pure math functions; safe floating-point guards; never throws.
 */

import type { QualityDimension, QualityWeights } from '../scoring/scoringTypes';
import { ALL_QUALITY_DIMENSIONS, DEFAULT_QUALITY_WEIGHTS } from '../scoring/scoringTypes';
import { computeCompositeScore } from '../scoring/scorer-formulas';
import type { AuditScopeMode } from './scope-decision';

/** Input parameters for scope normalization evaluation */
export interface ScopeNormalizationParams {
    readonly mode: AuditScopeMode;
    readonly domain?: string;
    readonly priorProjectMean: number;
    readonly priorProjectConfidence?: number;
    readonly sliceBeforeScores?: Record<QualityDimension, number>;
    readonly sliceAfterScores: Record<QualityDimension, number>;
    readonly elocAudited: number;
    readonly elocBlastRadius: number;
    readonly elocTotalProject: number;
    readonly elocSemantic: number;
    readonly averageEvidenceConfidence: number;
    readonly weights?: QualityWeights;
}

/** Project-level Bayesian state with confidence interval */
export interface ProjectBaselineAssessment {
    readonly mean: number;
    readonly standardError: number;
    readonly confidenceInterval95: readonly [number, number];
    readonly confidence: number;
}

/** Changeset-level delta and efficiency evaluation */
export interface ChangesetDeltaAssessment {
    readonly deltaQ: number;
    readonly qed: number;
    readonly dimensionDeltas: Readonly<Partial<Record<QualityDimension, number>>>;
    readonly sliceBeforeScore: number;
    readonly sliceAfterScore: number;
}

/** Specialized domain quality evaluation */
export interface DomainAssessment {
    readonly domain: string;
    readonly domainScore: number;
    readonly measuredCoverage: number;
}

/** Complete scope-normalized evaluation output */
export interface ScopeNormalizedAssessment {
    readonly mode: AuditScopeMode;
    readonly projectBaseline: ProjectBaselineAssessment;
    readonly changesetDelta?: ChangesetDeltaAssessment;
    readonly domainAssessment?: DomainAssessment;
    readonly multiScaleConfidence: {
        readonly evidenceConfidence: number;
        readonly scopeCompleteness: number;
        readonly dimensionCoverage: number;
        readonly compositeConfidence: number;
    };
    readonly explanation: string;
}

/**
 * Computes scope completeness factor C_scope.
 *
 * @param elocAudited - Effective logic lines audited in slice.
 * @param elocBlastRadius - Effective logic lines within calculated blast radius.
 * @param elocTotal - Total effective logic lines across whole repository.
 * @returns Bounded scope completeness factor in [0.1, 1.0].
 */
export function calculateScopeCompleteness(
    elocAudited: number,
    elocBlastRadius: number,
    elocTotal: number,
): number {
    const safeBlast = Math.max(1, elocBlastRadius);
    const safeTotal = Math.max(1, elocTotal);

    const localCoverage = Math.min(1.0, elocAudited / safeBlast);
    const globalFraction = Math.min(1.0, elocAudited / safeTotal);

    const raw = 0.7 * localCoverage + 0.3 * Math.sqrt(globalFraction);
    return Math.round(Math.max(0.1, Math.min(1.0, raw)) * 1000) / 1000;
}

/**
 * Computes combined multi-scale composite confidence.
 *
 * @param evidenceConfidence - Analyzer evidence certainty factor.
 * @param scopeCompleteness - Blast radius scope completeness factor.
 * @param dimensionCoverage - Ten-dimensional quality coverage ratio.
 * @returns Bounded composite confidence factor in [0.6, 1.0].
 */
export function calculateCompositeConfidence(
    evidenceConfidence: number,
    scopeCompleteness: number,
    dimensionCoverage: number,
): number {
    const safeEvidence = Math.max(0.1, Math.min(1.0, evidenceConfidence));
    const safeScope = Math.max(0.1, Math.min(1.0, scopeCompleteness));
    const safeCoverage = Math.max(0.1, Math.min(1.0, dimensionCoverage));

    // C_comp = (C_ev * Cov)^0.7 * (C_scope)^0.3
    const termEvidence = Math.pow(safeEvidence * safeCoverage, 0.7);
    const termScope = Math.pow(safeScope, 0.3);
    const combined = termEvidence * termScope;

    // Floor clamped at 0.60
    return Math.round(Math.max(0.6, Math.min(1.0, combined)) * 100) / 100;
}

/**
 * Normalizes quality scoring across scope boundaries using Bayesian belief updating.
 *
 * @param params - Scope normalization inputs and observations.
 * @returns Frozen ScopeNormalizedAssessment.
 */
export function normalizeScopeQuality(params: ScopeNormalizationParams): ScopeNormalizedAssessment {
    const {
        mode,
        domain,
        priorProjectMean,
        priorProjectConfidence = 0.9,
        sliceBeforeScores,
        sliceAfterScores,
        elocAudited,
        elocBlastRadius,
        elocTotalProject,
        elocSemantic,
        averageEvidenceConfidence,
        weights = DEFAULT_QUALITY_WEIGHTS,
    } = params;

    // Calculate slice composite score after changes
    const activeDims = ALL_QUALITY_DIMENSIONS.filter((d) => sliceAfterScores[d] !== undefined);
    const afterComp = computeCompositeScore(sliceAfterScores, activeDims, weights);
    const sliceAfterScore = Number.isFinite(afterComp.compositeScore)
        ? afterComp.compositeScore
        : priorProjectMean;
    const dimCoverage = afterComp.coverage;

    // Calculate multi-scale confidence
    const scopeCompleteness =
        mode === 'PROJECT'
            ? 1.0
            : calculateScopeCompleteness(elocAudited, elocBlastRadius, elocTotalProject);
    const compositeConfidence = calculateCompositeConfidence(
        averageEvidenceConfidence,
        scopeCompleteness,
        dimCoverage,
    );

    // Handle mode-specific score synthesis
    let projectMean = priorProjectMean;
    let standardError = 0.2;
    let changesetDelta: ChangesetDeltaAssessment | undefined;
    let domainAssessment: DomainAssessment | undefined;
    let explanation = '';

    if (mode === 'PROJECT') {
        // Full project scan directly dictates the baseline
        projectMean = sliceAfterScore;
        const errFactor = ((100 - projectMean) / 3) * (1 - compositeConfidence);
        standardError = Math.max(0.05, Math.round(errFactor * 100) / 100);
        explanation = `Full PROJECT review completed; baseline updated directly to ${projectMean.toFixed(2)}`;
    } else if (mode === 'CHANGESET') {
        // Incremental mode: compute delta and Bayesian update
        const beforeComp = sliceBeforeScores
            ? computeCompositeScore(sliceBeforeScores, activeDims, weights)
            : { compositeScore: priorProjectMean };
        const sliceBeforeScore = Number.isFinite(beforeComp.compositeScore)
            ? beforeComp.compositeScore
            : priorProjectMean;

        const deltaQ = Math.round((sliceAfterScore - sliceBeforeScore) * 100) / 100;
        const qed = Math.round((deltaQ / Math.max(1, elocSemantic)) * 1000) / 1000;

        const dimensionDeltas: Partial<Record<QualityDimension, number>> = {};
        for (const dim of activeDims) {
            const b = sliceBeforeScores?.[dim] ?? sliceAfterScores[dim];
            const a = sliceAfterScores[dim];
            dimensionDeltas[dim] = Math.round((a - b) * 100) / 100;
        }

        changesetDelta = Object.freeze({
            deltaQ,
            qed,
            dimensionDeltas: Object.freeze(dimensionDeltas),
            sliceBeforeScore,
            sliceAfterScore,
        });

        // Bayesian belief update
        const safeTotal = Math.max(1, elocTotalProject);
        const semanticRatio = Math.min(1.0, elocSemantic / safeTotal);
        const auditedRatio = Math.min(1.0, elocAudited / safeTotal);

        const deltaMuProject = deltaQ * semanticRatio;

        // Prior uncertainty
        const priorUncertainty =
            ((100 - priorProjectMean) / 2) * (1 - priorProjectConfidence) + 0.1;
        const sigma0 = Math.max(0.1, priorUncertainty);
        const var0 = sigma0 * sigma0;

        // Slice observation variance
        const slicePrecisionWeight = Math.max(0.0001, auditedRatio * averageEvidenceConfidence);
        const varSlice = 1.0 / slicePrecisionWeight;

        // Conjugate posterior calculation
        const posteriorVar = (var0 * varSlice) / (var0 + varSlice);
        const weightedPrior = priorProjectMean / var0;
        const weightedObs = (priorProjectMean + deltaMuProject) / varSlice;
        const updatedMu = posteriorVar * (weightedPrior + weightedObs);

        projectMean = Math.round(Math.max(0, Math.min(100, updatedMu)) * 100) / 100;
        standardError = Math.round(Math.sqrt(posteriorVar) * 100) / 100;
        explanation =
            `CHANGESET review evaluated ${elocAudited} lines (ΔQ: ${deltaQ >= 0 ? '+' : ''}${deltaQ}, ` +
            `QED: ${qed}); global baseline gently shifted by ${deltaMuProject.toFixed(3)} to ${projectMean.toFixed(2)}`;
    } else if (mode === 'DOMAIN') {
        const domName = domain || 'specialized';
        domainAssessment = Object.freeze({
            domain: domName,
            domainScore: sliceAfterScore,
            measuredCoverage: dimCoverage,
        });
        const domainErr = ((100 - sliceAfterScore) / 4) * (1 - compositeConfidence);
        standardError = Math.max(0.1, Math.round(domainErr * 100) / 100);
        explanation =
            `DOMAIN(${domName}) review completed with score ${sliceAfterScore.toFixed(1)}; ` +
            `global project baseline left unperturbed`;
    }

    const ciLower = Math.max(0, Math.round((projectMean - 1.96 * standardError) * 100) / 100);
    const ciUpper = Math.min(100, Math.round((projectMean + 1.96 * standardError) * 100) / 100);

    const projectBaseline: ProjectBaselineAssessment = Object.freeze({
        mean: projectMean,
        standardError,
        confidenceInterval95: Object.freeze([ciLower, ciUpper] as [number, number]),
        confidence: compositeConfidence,
    });

    return Object.freeze({
        mode,
        projectBaseline,
        changesetDelta,
        domainAssessment,
        multiScaleConfidence: Object.freeze({
            evidenceConfidence: averageEvidenceConfidence,
            scopeCompleteness,
            dimensionCoverage: dimCoverage,
            compositeConfidence,
        }),
        explanation,
    });
}
