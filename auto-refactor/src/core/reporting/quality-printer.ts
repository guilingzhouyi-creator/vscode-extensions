/**
 * Module: Core Engine — Quality Assessment & Stack Profile Presenter
 * File Path: src/core/reporting/quality-printer.ts
 * Architecture Role: Presentation layer rendering human-readable console blocks for project
 *   stack profile, transparent quality assessment, and Tri-Plane unified governance vectors.
 * Dependencies & Triggers: Consumes ProjectProfile, QualityScoreBreakdown, and
 *   UnifiedQualityAssessment; called by api.scanAndRender when `--score` or `--profile` is active.
 * Responsibilities:
 *   1. Format and write project stack profile and partitions to stdout.
 *   2. Render 10-axis transparent code quality breakdown and key rationales.
 *   3. Render Tri-Plane static (Q_s), dynamic (Q_d), and feedback (Q_f) vectors and fused Q_tot.
 * Exit Semantics & Design Rationale: Pure presentation functions writing directly to
 *   process.stdout; never throws or halts scan flow; lines strictly bounded to <= 100 columns.
 */

import type { ProjectProfile } from '../types';
import type { QualityDimension, QualityScoreBreakdown } from '../scoring/scoringTypes';
import type { UnifiedQualityAssessment } from '../scoring/fusion-scorer';
import type { AutonomyEvaluation } from '../scoring/autonomy-scorer';

/** Scale factor that converts a 0..1 confidence/score fraction into a percentage. */
const PERCENT_SCALE = 100;

/** Minimum column width for a quality-dimension label in the score report. */
const QUALITY_DIMENSION_LABEL_WIDTH = 26;

/** Maximum number of quality rationales printed by `--score`, highest-impact first. */
const MAX_QUALITY_RATIONALES = 8;

const DEFAULT_EMPTY_PLACEHOLDER = 'none';
const DEFAULT_SCALE_GRADE = 'standard';
const TOP_DEPENDENCIES_LIMIT = 5;
const SDK_NAME_PAD_WIDTH = 20;

/**
 * Print the resolved project stack profile to stdout: language, build systems, frameworks,
 * scale grade, polyglot flag, and partition names.
 *
 * @param profile - Resolved project profile whose partitions are summarized.
 * @param scaleGrade - Optional scale grade label; defaults to 'standard' when omitted.
 */
export function printProjectStackProfile(profile: ProjectProfile, scaleGrade?: string): void {
    process.stdout.write(`\n=== Project Stack Profile ===\n`);
    process.stdout.write(`Primary Language: ${profile.primaryLanguage}\n`);
    process.stdout.write(
        `Build Systems:    ${profile.buildSystems.join(', ') || DEFAULT_EMPTY_PLACEHOLDER}\n`,
    );
    process.stdout.write(
        `Frameworks:       ${profile.frameworks.join(', ') || DEFAULT_EMPTY_PLACEHOLDER}\n`,
    );
    process.stdout.write(`Scale Grade:      ${scaleGrade || DEFAULT_SCALE_GRADE}\n`);
    process.stdout.write(`Is Polyglot:      ${profile.isPolyglot}\n`);
    if (profile.partitions.length > 0) {
        process.stdout.write(
            `Partitions:       ${profile.partitions.map((partition) => partition.name).join(', ')}\n`,
        );
    }
    process.stdout.write(`=============================\n\n`);
}

/**
 * Render Tri-Plane Unified Governance Vector details to stdout.
 *
 * @param triPlane - UnifiedQualityAssessment carrying static, dynamic, and feedback scores.
 */
function renderTriPlaneVector(triPlane: UnifiedQualityAssessment): void {
    process.stdout.write(`-------------------------------------------\n`);
    process.stdout.write(`Tri-Plane Unified Governance Vector:\n`);
    const staticVec = triPlane.staticVector;
    const wsPct = (triPlane.weights.Ws * PERCENT_SCALE).toFixed(0);
    process.stdout.write(
        `  • Static Plane Q_s (${wsPct}% wt)   : ${triPlane.staticScore.toFixed(1)} ` +
            `[A:${staticVec.A.toFixed(0)} M:${staticVec.M.toFixed(0)} P:${staticVec.P.toFixed(0)} ` +
            `D:${staticVec.D.toFixed(0)} T:${staticVec.T.toFixed(0)} R:${staticVec.R.toFixed(0)} ` +
            `S:${staticVec.S.toFixed(0)} E:${staticVec.E.toFixed(0)}]\n`,
    );
    const wdPct = (triPlane.weights.Wd * PERCENT_SCALE).toFixed(0);
    if (triPlane.dynamicVector) {
        const dynamicVec = triPlane.dynamicVector;
        process.stdout.write(
            `  • Dynamic Plane Q_d (${wdPct}% wt)  : ${triPlane.dynamicScore.toFixed(1)} ` +
                `[L:${dynamicVec.L.toFixed(0)} T:${dynamicVec.T.toFixed(0)} M:${dynamicVec.M.toFixed(0)} ` +
                `C:${dynamicVec.C.toFixed(0)} E:${dynamicVec.E.toFixed(0)}]\n`,
        );
    } else {
        process.stdout.write(`  • Dynamic Plane Q_d (${wdPct}% wt)  : N/A (Offline Static Only)\n`);
    }
    const wfPct = (triPlane.weights.Wf * PERCENT_SCALE).toFixed(0);
    process.stdout.write(
        `  • Feedback Plane Q_f (${wfPct}% wt) : ${triPlane.feedbackScore.toFixed(1)}\n`,
    );
    process.stdout.write(
        `  • Fused Total Q_tot         : ${triPlane.totalScore.toFixed(1)} / 100\n`,
    );
}

/**
 * Renders technical debt, density tensor, and polyglot metrics.
 */
function renderTechnicalDebtAndDensity(scoreBreakdown: QualityScoreBreakdown): void {
    if (
        !scoreBreakdown.technicalDebt &&
        !scoreBreakdown.densityTensorSummary &&
        !scoreBreakdown.polyglotGeneralization &&
        !scoreBreakdown.quant
    ) {
        return;
    }
    process.stdout.write(`-------------------------------------------\n`);
    if (scoreBreakdown.technicalDebt) {
        const technicalDebt = scoreBreakdown.technicalDebt;
        const remediationHours = (technicalDebt.totalRemediationMinutes / 60).toFixed(1);
        process.stdout.write(
            `SQALE Technical Debt    : ${technicalDebt.technicalDebtRatio.toFixed(1)}% ` +
                `[Grade: ${technicalDebt.sqaleGrade}] (Remediation: ${remediationHours}h / ${technicalDebt.totalRemediationMinutes}min)\n`,
        );
    }
    if (scoreBreakdown.densityTensorSummary) {
        const densityTensor = scoreBreakdown.densityTensorSummary;
        const distanceSuffix = densityTensor.averageMahalanobisDistance !== undefined
            ? ` | Mahalanobis: ${densityTensor.averageMahalanobisDistance.toFixed(2)}`
            : '';
        process.stdout.write(
            `5D Density Tensor       : Density ${(densityTensor.compositeDensity * PERCENT_SCALE).toFixed(1)}% ` +
                `[TSPR: ${(densityTensor.averageTspr * PERCENT_SCALE).toFixed(0)}% | POR: ${(densityTensor.averagePor * PERCENT_SCALE).toFixed(0)}%${distanceSuffix}]\n`,
        );
    }
    if (scoreBreakdown.polyglotGeneralization) {
        const polyglotMetrics = scoreBreakdown.polyglotGeneralization;
        process.stdout.write(
            `Polyglot Generalization : ${polyglotMetrics.index.toFixed(1)} / 100 ` +
                `(${polyglotMetrics.languageCount} langs, mean: ${polyglotMetrics.meanScore.toFixed(1)}, penalty: ${polyglotMetrics.dispersionPenalty.toFixed(2)})\n`,
        );
    }
    if (scoreBreakdown.quant) {
        const quant = scoreBreakdown.quant;
        const statusBadge = quant.financial.status === 'de-leveraging' ? '[De-leveraging]' :
            quant.financial.status === 'balanced' ? '[Balanced]' : '[Insolvent]';
        process.stdout.write(
            `Quantitative Risk Model : ICR: ${quant.financial.interestCoverageRatio.toFixed(2)}x ${statusBadge} ` +
                `| QSR: ${quant.riskRatios.qsr.toFixed(1)} | Sortino: ${quant.riskRatios.sortino.toFixed(1)} ` +
                `| Gini: ${quant.inequality.debtGini.toFixed(2)} | Entropy: ${quant.inequality.defectEntropy.toFixed(2)}\n`,
        );
    }
}

/**
 * Renders top deduction rationales.
 */
function renderDeductionRationales(rationales?: QualityScoreBreakdown['rationales']): void {
    if (!rationales || rationales.length === 0) return;
    process.stdout.write(`-------------------------------------------\n`);
    process.stdout.write(`Key Deductions & Rationales:\n`);
    for (const rationale of rationales.slice(0, MAX_QUALITY_RATIONALES)) {
        process.stdout.write(
            `  [${rationale.delta} pts] ${rationale.dimension}: ${rationale.reason}${rationale.line ? ` (L${rationale.line})` : ''}\n`,
        );
    }
}

/**
 * Print the transparent code quality assessment breakdown and Tri-Plane vectors to stdout.
 *
 * @param scoreBreakdown - Overall project quality score breakdown.
 * @param triPlane - Optional tri-plane unified quality assessment.
 * @param reviewProfile - Optional active review profile name.
 */
export function printQualityScoreAssessment(
    scoreBreakdown: QualityScoreBreakdown,
    triPlane?: UnifiedQualityAssessment,
    reviewProfile?: string,
): void {
    process.stdout.write(
        `\n=== Transparent Code Quality Assessment${reviewProfile ? ` [Profile: ${reviewProfile}]` : ''} ===\n`,
    );
    // A NaN composite means no dimension carried a weight (a narrow scan witnesses none of
    // the ten axes). Printing "NaN / 100" would read as a corrupt number, so state plainly
    // that nothing was measured instead.
    const compositeText = Number.isNaN(scoreBreakdown.compositeScore)
        ? 'N/A (no quality dimension was measured)'
        : `${scoreBreakdown.compositeScore.toFixed(1)} / 100`;
    process.stdout.write(
        `Composite Quality Index: ${compositeText} [Grade: ${scoreBreakdown.grade}] ` +
            `(Confidence: ${(scoreBreakdown.confidence * PERCENT_SCALE).toFixed(0)}%)\n`,
    );
    process.stdout.write(`-------------------------------------------\n`);
    const notEvaluatedSet = new Set<QualityDimension>(scoreBreakdown.notEvaluated ?? []);
    for (const [dimensionKey, scoreValue] of Object.entries(scoreBreakdown.indices)) {
        const isNotEvaluated = notEvaluatedSet.has(dimensionKey as QualityDimension);
        const valText = isNotEvaluated ? 'N/A [NOT EVALUATED]' : (scoreValue as number).toFixed(2);
        const weightVal = scoreBreakdown.weights ? (scoreBreakdown.weights as any)[dimensionKey] : undefined;
        const weightTag = typeof weightVal === 'number' ? ` (wt: ${(weightVal * 100).toFixed(1)}%)` : '';
        process.stdout.write(`  • ${dimensionKey.padEnd(QUALITY_DIMENSION_LABEL_WIDTH)}: ${valText}${weightTag}\n`);
    }
    if (triPlane) {
        renderTriPlaneVector(triPlane);
    }
    renderTechnicalDebtAndDensity(scoreBreakdown);
    renderDeductionRationales(scoreBreakdown.rationales);
    process.stdout.write(`===========================================\n\n`);
}

/**
 * Print the In-House Autonomy Index and external SDK breakdown to stdout.
 *
 * @param autonomyEvaluation - Project autonomy evaluation.
 */
export function printAutonomyAssessment(autonomyEvaluation: AutonomyEvaluation): void {
    process.stdout.write(`\n=== In-House Self-Development Assessment (CAI 2.0) ===\n`);
    process.stdout.write(
        `Composite Autonomy Index: ${autonomyEvaluation.compositeAutonomyIndex.toFixed(1)}% ` +
            `[Grade: ${autonomyEvaluation.grade}]\n`,
    );
    process.stdout.write(`Status: ${autonomyEvaluation.gradeDescription}\n`);
    if (autonomyEvaluation.confidence) {
        const confTag = autonomyEvaluation.confidence.isLowConfidence
            ? ' [Sparse Sample - Smoothed]'
            : '';
        process.stdout.write(
            `Bayesian Credible Bounds : [${autonomyEvaluation.confidence.lowerBound.toFixed(1)}% ~ ` +
                `${autonomyEvaluation.confidence.upperBound.toFixed(1)}%] ` +
                `(Sample Sufficiency: ${(autonomyEvaluation.confidence.sampleSufficiency * PERCENT_SCALE).toFixed(0)}%)${confTag}\n`,
        );
    }
    process.stdout.write(`-------------------------------------------\n`);
    process.stdout.write(
        `  • Effective LOC Autonomy : ${autonomyEvaluation.dimensions.effectiveLocAutonomy.toFixed(1)}% ` +
            `(${autonomyEvaluation.stats.proprietaryEffectiveLoc} / ${autonomyEvaluation.stats.totalEffectiveLoc} ELOC)\n`,
    );
    process.stdout.write(
        `  • Symbol Call Autonomy   : ${autonomyEvaluation.dimensions.symbolCallAutonomy.toFixed(1)}% ` +
            `(${autonomyEvaluation.stats.internalSymbolCalls} int vs ${autonomyEvaluation.stats.externalSdkCalls} ext SDK)\n`,
    );
    process.stdout.write(
        `  • Domain Kernel Density  : ${autonomyEvaluation.dimensions.domainKernelDensity.toFixed(1)}%\n`,
    );
    process.stdout.write(
        `  • Code Originality       : ${autonomyEvaluation.dimensions.codeOriginality.toFixed(1)}%\n`,
    );
    process.stdout.write(
        `  • Supply Chain Resilience: ${autonomyEvaluation.dimensions.supplyChainResilience.toFixed(1)}% ` +
            `(${autonomyEvaluation.supplyChain?.directDependencies || 0} direct, ` +
            `${autonomyEvaluation.supplyChain?.transitiveDependencies || 0} transitive, ` +
            `depth: ${autonomyEvaluation.supplyChain?.estimatedDepth || 1})\n`,
    );
    process.stdout.write(
        `  • Critical Path Autonomy : ${autonomyEvaluation.dimensions.criticalPathAutonomy.toFixed(1)}% ` +
            `(${autonomyEvaluation.stats.criticalPathFiles || 0} files in security/runtime core)\n`,
    );
    if (autonomyEvaluation.externalSdkInventory.length > 0) {
        process.stdout.write(`-------------------------------------------\n`);
        process.stdout.write(`Top External SDK Dependencies:\n`);
        for (const sdk of autonomyEvaluation.externalSdkInventory.slice(
            0,
            TOP_DEPENDENCIES_LIMIT,
        )) {
            process.stdout.write(
                `  • ${sdk.name.padEnd(SDK_NAME_PAD_WIDTH)}: ${sdk.callCount} calls across ${sdk.fileCount} files\n`,
            );
        }
    }
    process.stdout.write(`==================================================\n\n`);
}
