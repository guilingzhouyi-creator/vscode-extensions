//! Module: fg-algorithms — 10-Dimension Dual-Track Scoring Curves & Confidence
//! File Path: crates/fg-algorithms/src/scoring/ten_dimensions/curves.rs
//! Architecture Role: C1 scale sanitization, hyperbolic/subtractive track compression,
//!   weighted geometric composite scoring, Popoviciu variance damping, and confidence evaluation.
//! Dependencies & Triggers: Pairs with `ceilings`; consumed by `ten_dimensions::mod.rs`.
//! Responsibilities: Compute bounded per-dimension scores, composite index, grade, and confidence.
//! Exit Semantics & Design Rationale: Bit-accurate mirror of `scorer-formulas.ts` formulas.

use super::ceilings::{
    compute_epistemic_ceiling, compute_security_ceiling, round_two, CONFIDENCE_FLOOR,
    CONFIDENCE_LINE_CAP, CONFIDENCE_LINE_SCALE, DEFAULT_DISPERSION_PENALTY_RATIO,
    DEFAULT_SCALE_REFERENCE_LINES, DIMENSION_MAX_SCORE, GRADE_A_MIN, GRADE_A_PLUS_MIN, GRADE_B_MIN,
    GRADE_C_MIN, GRADE_D_MIN, MIN_EPISTEMIC_GAP, POPOVICIU_MAX_SIGMA, PROJECT_SCALE_FACTOR,
    QualityCurveConfig, SCALE_FACTOR_PRECISION,
};
use super::taxonomy::{FileMetricSummary, QualityDimension, QualityWeightVector};

fn round_four(val: f64) -> f64 {
    (val * SCALE_FACTOR_PRECISION).round() / SCALE_FACTOR_PRECISION
}

/// Normalizes input scale factor with C1 continuous micro-file blend and macro-file log damping.
#[must_use]
pub fn sanitize_scale_factor(scale_factor: f64, config: &QualityCurveConfig) -> f64 {
    let safe_scale = if scale_factor.is_finite() && scale_factor > 0.0 { scale_factor } else { 1.0 };
    if safe_scale < 1.0 {
        let floor = config.micro_file_floor_scale;
        return round_four(floor + (1.0 - floor) * safe_scale);
    }
    if safe_scale <= config.macro_file_knee_scale {
        return round_four(safe_scale);
    }
    let (knee, weight) = (config.macro_file_knee_scale, config.macro_file_log_weight);
    round_four(knee + weight * (1.0 + (safe_scale - knee) / weight).ln())
}

fn evaluate_dimension_score(
    dim: QualityDimension,
    raw_points: f64,
    effective_scale: f64,
    security_ceiling: f64,
    general_ceiling: f64,
    config: &QualityCurveConfig,
) -> f64 {
    let raw = if raw_points.is_finite() { raw_points.max(0.0) } else { 0.0 };
    if dim == QualityDimension::CodeSecurity {
        return if raw <= 0.0 { security_ceiling } else { round_two(security_ceiling - raw).max(0.0) };
    }
    if raw <= 0.0 {
        return general_ceiling;
    }
    let raw_score = (general_ceiling * config.saturation_halfpoint)
        / (config.saturation_halfpoint + raw / effective_scale);
    if raw_score.is_finite() { raw_score.clamp(0.0, general_ceiling) } else { general_ceiling }
}

/// Transforms raw linear deduction totals per dimension into dual-track bounded scores.
#[must_use]
pub fn apply_scale_damped_scores(
    linear_points: &[f64; 10],
    scale_factor: f64,
    metric: Option<&FileMetricSummary<'_>>,
    config: &QualityCurveConfig,
) -> [f64; 10] {
    let effective_scale = sanitize_scale_factor(scale_factor, config);
    let ceiling_scale = if metric.is_some() { effective_scale } else { 1.0 };
    let sec_ceil = compute_security_ceiling(metric, ceiling_scale, &config.security_ceiling);
    let gen_ceil = compute_epistemic_ceiling(metric, ceiling_scale, &config.epistemic_ceiling);
    let dims = QualityDimension::all();
    let mut scores = [0.0_f64; 10];
    for idx in 0..10 {
        scores[idx] = evaluate_dimension_score(dims[idx], linear_points[idx], effective_scale, sec_ceil, gen_ceil, config);
    }
    scores
}

/// Computes weighted geometric mean composite score bounded by `[floor, safe_ceiling]`.
#[must_use]
pub fn compute_composite_score(scores: &[f64; 10], weights: &QualityWeightVector, floor: f64, ceiling: f64) -> f64 {
    let safe_floor = if floor.is_finite() && floor > 0.0 { floor } else { 15.0 };
    let safe_ceiling = (DIMENSION_MAX_SCORE - MIN_EPISTEMIC_GAP).min(ceiling);
    let (mut log_sum, mut total_w) = (0.0_f64, 0.0_f64);
    for (&w, &v) in weights.values.iter().zip(scores.iter()) {
        if w.is_finite() && w > 0.0 && v.is_finite() {
            log_sum += w * v.max(safe_floor).ln();
            total_w += w;
        }
    }
    if total_w <= 0.0 { return 0.0; }
    round_two((log_sum / total_w).exp()).clamp(0.0, safe_ceiling)
}

/// Converts composite numeric score to letter grade matching `resolveQualityGrade`.
#[must_use]
pub fn resolve_quality_grade(score: f64) -> &'static str {
    if !score.is_finite() { return "N/A"; }
    const CUTOFFS: &[(f64, &str)] = &[
        (GRADE_A_PLUS_MIN, "A+"), (GRADE_A_MIN, "A"), (GRADE_B_MIN, "B"),
        (GRADE_C_MIN, "C"), (GRADE_D_MIN, "D"),
    ];
    CUTOFFS.iter().find(|(min, _)| score >= *min).map_or("F", |(_, g)| *g)
}

/// Computes volume-aware confidence score matching `calculateConfidenceFromVolume`.
#[must_use]
pub fn calculate_confidence_from_volume(lines: f64, coverage: f64, project_scope: bool) -> f64 {
    let safe = if lines.is_finite() && lines > 0.0 { lines } else { DEFAULT_SCALE_REFERENCE_LINES };
    let eff = if project_scope { safe } else { safe.min(CONFIDENCE_LINE_CAP) };
    let scale = if project_scope { CONFIDENCE_LINE_SCALE * PROJECT_SCALE_FACTOR } else { CONFIDENCE_LINE_SCALE };
    let base = round_two(CONFIDENCE_FLOOR + eff / scale).clamp(CONFIDENCE_FLOOR, 1.0);
    round_two((base * coverage.clamp(0.0, 1.0)).max(CONFIDENCE_FLOOR)).min(1.0)
}

/// Computes Popoviciu dispersion penalty factor `D = max(0, 1 - (sigma / 50) * gamma)`.
#[must_use]
pub fn compute_popoviciu_dispersion_penalty(std_dev: f64, gamma: f64) -> f64 {
    if !std_dev.is_finite() || std_dev <= 0.0 { return 1.0; }
    let g = if gamma.is_finite() { gamma.clamp(0.0, 1.0) } else { DEFAULT_DISPERSION_PENALTY_RATIO };
    round_two((1.0 - (std_dev / POPOVICIU_MAX_SIGMA) * g).max(0.0))
}
