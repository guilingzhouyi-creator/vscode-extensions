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

/** Intermediate evaluation context passed to scope synthesizers */
export interface ScopeSynthesisContext {
    readonly params: ScopeNormalizationParams;
    readonly sliceAfterScore: number;
    readonly dimCoverage: number;
    readonly compositeConfidence: number;
    readonly activeDims: QualityDimension[];
}

/** Synthesized mode evaluation outcome */
export interface ModeSynthesisResult {
    readonly projectMean: number;
    readonly standardError: number;
    readonly changesetDelta?: ChangesetDeltaAssessment;
    readonly domainAssessment?: DomainAssessment;
    readonly explanation: string;
}

/**
 * Synthesizes baseline directly from whole-project scan.
 *
 * @param ctx - Scope synthesis evaluation context.
 * @returns Synthesized mode evaluation outcome.
 */
export function synthesizeProjectScope(ctx: ScopeSynthesisContext): ModeSynthesisResult {
    const projectMean = ctx.sliceAfterScore;
    const errFactor = ((100 - projectMean) / 3) * (1 - ctx.compositeConfidence);
    const standardError = Math.max(0.05, Math.round(errFactor * 100) / 100);
    const explanation = `Full PROJECT review completed; baseline updated directly to ${projectMean.toFixed(2)}`;

    return {
        projectMean,
        standardError,
        explanation,
    };
}

/**
 * Synthesizes incremental changes using Bayesian belief updating.
 *
 * @param ctx - Scope synthesis evaluation context.
 * @returns Synthesized mode evaluation outcome.
 */
export function synthesizeChangesetScope(ctx: ScopeSynthesisContext): ModeSynthesisResult {
    const { params, sliceAfterScore, activeDims } = ctx;
    const {
        priorProjectMean,
        priorProjectConfidence = 0.9,
        sliceBeforeScores,
        sliceAfterScores,
        elocAudited,
        elocTotalProject,
        elocSemantic,
        averageEvidenceConfidence,
        weights = DEFAULT_QUALITY_WEIGHTS,
    } = params;

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

    const changesetDelta: ChangesetDeltaAssessment = Object.freeze({
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

    // Scales prior variance according to uncalibrated confidence
    // and project distance from ceiling
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

    const projectMean = Math.round(Math.max(0, Math.min(100, updatedMu)) * 100) / 100;
    const standardError = Math.round(Math.sqrt(posteriorVar) * 100) / 100;
    const explanation =
        `CHANGESET review evaluated ${elocAudited} lines (ΔQ: ${deltaQ >= 0 ? '+' : ''}${deltaQ}, ` +
        `QED: ${qed}); global baseline gently shifted by ${deltaMuProject.toFixed(3)} to ${projectMean.toFixed(2)}`;

    return {
        projectMean,
        standardError,
        changesetDelta,
        explanation,
    };
}

/**
 * Synthesizes localized specialized domain scope without perturbing baseline.
 *
 * @param ctx - Scope synthesis evaluation context.
 * @returns Synthesized mode evaluation outcome.
 */
export function synthesizeDomainScope(ctx: ScopeSynthesisContext): ModeSynthesisResult {
    const domName = ctx.params.domain || 'specialized';
    const domainAssessment: DomainAssessment = Object.freeze({
        domain: domName,
        domainScore: ctx.sliceAfterScore,
        measuredCoverage: ctx.dimCoverage,
    });
    const domainErr = ((100 - ctx.sliceAfterScore) / 4) * (1 - ctx.compositeConfidence);
    const standardError = Math.max(0.1, Math.round(domainErr * 100) / 100);
    const explanation =
        `DOMAIN(${domName}) review completed with score ${ctx.sliceAfterScore.toFixed(1)}; ` +
        `global project baseline left unperturbed`;

    return {
        projectMean: ctx.params.priorProjectMean,
        standardError,
        domainAssessment,
        explanation,
    };
}

export type ScopeSynthesizer = (ctx: ScopeSynthesisContext) => ModeSynthesisResult;

/** Dispatch table mapping audit scope modes to synthesis strategies */
export const SYNTHESIZER_REGISTRY: Record<AuditScopeMode, ScopeSynthesizer> = {
    PROJECT: synthesizeProjectScope,
    CHANGESET: synthesizeChangesetScope,
    DOMAIN: synthesizeDomainScope,
};

/**
 * Normalizes quality scoring across scope boundaries using Bayesian belief updating.
 *
 * @param params - Scope normalization inputs and observations.
 * @returns Frozen ScopeNormalizedAssessment.
 */
export function normalizeScopeQuality(params: ScopeNormalizationParams): ScopeNormalizedAssessment {
    const {
        mode,
        priorProjectMean,
        sliceAfterScores,
        elocAudited,
        elocBlastRadius,
        elocTotalProject,
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

    // Table-driven mode-specific score synthesis
    const synthesizer = SYNTHESIZER_REGISTRY[mode] ?? synthesizeDomainScope;
    const {
        projectMean,
        standardError,
        changesetDelta,
        domainAssessment,
        explanation,
    } = synthesizer({
        params,
        sliceAfterScore,
        dimCoverage,
        compositeConfidence,
        activeDims,
    });

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
