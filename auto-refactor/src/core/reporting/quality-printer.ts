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
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import type { UnifiedQualityAssessment } from '../scoring/fusion-scorer';

/** Scale factor that converts a 0..1 confidence/score fraction into a percentage. */
const PERCENT_SCALE = 100;

/** Minimum column width for a quality-dimension label in the score report. */
const QUALITY_DIMENSION_LABEL_WIDTH = 26;

/** Maximum number of quality rationales printed by `--score`, highest-impact first. */
const MAX_QUALITY_RATIONALES = 8;

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
    process.stdout.write(`Build Systems:    ${profile.buildSystems.join(', ') || 'none'}\n`);
    process.stdout.write(`Frameworks:       ${profile.frameworks.join(', ') || 'none'}\n`);
    process.stdout.write(`Scale Grade:      ${scaleGrade || 'standard'}\n`);
    process.stdout.write(`Is Polyglot:      ${profile.isPolyglot}\n`);
    if (profile.partitions.length > 0) {
        process.stdout.write(
            `Partitions:       ${profile.partitions.map((p) => p.name).join(', ')}\n`,
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
    const sv = triPlane.staticVector;
    const wsPct = (triPlane.weights.Ws * PERCENT_SCALE).toFixed(0);
    process.stdout.write(
        `  • Static Plane Q_s (${wsPct}% wt)   : ${triPlane.staticScore.toFixed(1)} ` +
            `[A:${sv.A.toFixed(0)} M:${sv.M.toFixed(0)} P:${sv.P.toFixed(0)} ` +
            `D:${sv.D.toFixed(0)} T:${sv.T.toFixed(0)} R:${sv.R.toFixed(0)} ` +
            `E:${sv.E.toFixed(0)}]\n`,
    );
    const wdPct = (triPlane.weights.Wd * PERCENT_SCALE).toFixed(0);
    if (triPlane.dynamicVector) {
        const dv = triPlane.dynamicVector;
        process.stdout.write(
            `  • Dynamic Plane Q_d (${wdPct}% wt)  : ${triPlane.dynamicScore.toFixed(1)} ` +
                `[L:${dv.L.toFixed(0)} T:${dv.T.toFixed(0)} M:${dv.M.toFixed(0)} ` +
                `C:${dv.C.toFixed(0)} E:${dv.E.toFixed(0)}]\n`,
        );
    } else {
        process.stdout.write(
            `  • Dynamic Plane Q_d (${wdPct}% wt)  : N/A (Offline Static Only)\n`,
        );
    }
    const wfPct = (triPlane.weights.Wf * PERCENT_SCALE).toFixed(0);
    process.stdout.write(
        `  • Feedback Plane Q_f (${wfPct}% wt) : ${triPlane.feedbackScore.toFixed(1)}\n`,
    );
    process.stdout.write(`  • Fused Total Q_tot         : ${triPlane.totalScore.toFixed(1)} / 100\n`);
}

/**
 * Print the transparent code quality assessment breakdown and Tri-Plane vectors to stdout.
 *
 * @param q - Overall project quality score breakdown.
 * @param triPlane - Optional tri-plane unified quality assessment.
 */
export function printQualityScoreAssessment(
    q: QualityScoreBreakdown,
    triPlane?: UnifiedQualityAssessment,
): void {
    process.stdout.write(`\n=== Transparent Code Quality Assessment ===\n`);
    process.stdout.write(
        `Composite Quality Index: ${q.compositeScore.toFixed(1)} / 100 [Grade: ${q.grade}] ` +
            `(Confidence: ${(q.confidence * PERCENT_SCALE).toFixed(0)}%)\n`,
    );
    process.stdout.write(`-------------------------------------------\n`);
    for (const [dim, val] of Object.entries(q.indices)) {
        process.stdout.write(
            `  • ${dim.padEnd(QUALITY_DIMENSION_LABEL_WIDTH)}: ${(val as number).toFixed(1)}\n`,
        );
    }
    if (triPlane) {
        renderTriPlaneVector(triPlane);
    }
    if (q.rationales && q.rationales.length > 0) {
        process.stdout.write(`-------------------------------------------\n`);
        process.stdout.write(`Key Deductions & Rationales:\n`);
        for (const r of q.rationales.slice(0, MAX_QUALITY_RATIONALES)) {
            process.stdout.write(
                `  [${r.delta} pts] ${r.dimension}: ${r.reason}${r.line ? ` (L${r.line})` : ''}\n`,
            );
        }
    }
    process.stdout.write(`===========================================\n\n`);
}
