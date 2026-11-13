//! Module: fg-algorithms — 10-Dimension Dual-Track Quality Scorer
//! File Path: crates/fg-algorithms/src/scoring/ten_dimensions/mod.rs
//! Architecture Role: Pure-Rust implementation matching `auto-refactor/src/core/scoring/quality-scorer.ts`,
//!   aggregating linear finding deductions, hyperbolic density curves, epistemic/security ceilings,
//!   and Popoviciu variance dispersion damping.
//! Dependencies & Triggers: Consumes `fg_core::models::TenDimensions`; partitions rules, curves, and
//!   deduction accumulators cleanly into focused submodules.
//! Responsibilities: Expose `evaluate_file_quality`, `evaluate_project_quality`, and all SSOT types.
//! Exit Semantics & Design Rationale: Preserves identical IEEE-754 thresholds and formulas as TS engine.

pub mod archetypes;
pub mod ceilings;
pub mod curves;
pub mod deductions;
pub mod taxonomy;
#[cfg(test)]
mod unit_tests;

pub use ceilings::{
    compute_dimension_ceiling, compute_epistemic_ceiling, compute_security_ceiling,
    EpistemicCeilingConfig, QualityCurveConfig, SecurityCeilingConfig, CONFIDENCE_FLOOR,
    CONFIDENCE_LINE_CAP, CONFIDENCE_LINE_SCALE, DEFAULT_DISPERSION_PENALTY_RATIO,
    DEFAULT_SCALE_REFERENCE_LINES, DIMENSION_MAX_SCORE, MAX_EXPORTED_SYMBOLS, MAX_NESTING_DEPTH,
    MIN_EPISTEMIC_GAP, POPOVICIU_MAX_SIGMA, PROJECT_SCALE_FACTOR, SCORE_ROUNDING,
    THEORETICAL_SCORE_CEILING,
};
pub use curves::{
    apply_scale_damped_scores, calculate_confidence_from_volume, compute_composite_score,
    compute_popoviciu_dispersion_penalty, resolve_quality_grade, sanitize_scale_factor,
};
pub use taxonomy::{
    family_dimension_of, tune_archetype_weights, DimensionScaleMode, FileMetricSummary,
    FindingSeverity, ProjectArchetype, QualityDimension, QualityWeightVector, ScoringFinding,
};

use ceilings::round_two;
use deductions::accumulate_finding_deductions;
use fg_core::models::quality_contracts::TenDimensions;

/// Evaluated 10-dimension breakdown for a single file or project aggregate.
#[derive(Debug, Clone, PartialEq)]
pub struct EvaluatedQualityScore {
    /// Ten dimension indices indexed by `QualityDimension as usize`.
    pub indices: [f64; 10],
    /// Raw accumulated linear deduction points prior to curve compression.
    pub linear_points: [f64; 10],
    /// Weighted geometric mean composite score rounded to two decimals.
    pub composite_score: f64,
    /// Letter grade (`A+`, `A`, `B`, `C`, `D`, `F`, or `N/A`).
    pub grade: &'static str,
    /// Confidence score bounded in `[0.0, 1.0]`.
    pub confidence: f64,
    /// Cross-file Popoviciu dispersion penalty factor (1.0 for single file).
    pub dispersion_penalty: f64,
    /// Standard deviation of composite scores across project files.
    pub score_std_dev: f64,
}

impl EvaluatedQualityScore {
    /// Converts internal 10D score vector into the closed schema `TenDimensions` DTO.
    #[must_use]
    pub fn to_contract_dto(&self) -> TenDimensions {
        TenDimensions {
            architecture_consistency: self.indices[0],
            semantic_purity: self.indices[1],
            code_security: self.indices[2],
            performance_efficiency: self.indices[3],
            standardization: self.indices[4],
            modernity: self.indices[5],
            maintainability: self.indices[6],
            comment_quality: self.indices[7],
            duplication: self.indices[8],
            tech_debt_risk: self.indices[9],
            composite_score: self.composite_score,
            grade: String::from(self.grade),
        }
    }
}

/// Evaluates the dual-track quality score for a single file's findings and metrics.
#[must_use]
pub fn evaluate_file_quality(
    findings: &[ScoringFinding<'_>],
    metric: Option<&FileMetricSummary<'_>>,
    archetype: ProjectArchetype,
    curve: &QualityCurveConfig,
) -> EvaluatedQualityScore {
    let mut linear_points = [0.0_f64; 10];
    for finding in findings {
        accumulate_finding_deductions(finding, &mut linear_points);
    }
    if let Some(file_metric) = metric {
        if file_metric.max_nesting_depth > MAX_NESTING_DEPTH {
            linear_points[QualityDimension::Maintainability as usize] += 10.0;
        }
        if file_metric.exported_symbols > MAX_EXPORTED_SYMBOLS {
            linear_points[QualityDimension::ArchitectureConsistency as usize] += 10.0;
        }
    }
    let lines = metric.map_or(DEFAULT_SCALE_REFERENCE_LINES, |e| {
        (if e.non_blank_lines > 0 { e.non_blank_lines } else { e.lines }) as f64
    });
    let scale_factor = (lines / DEFAULT_SCALE_REFERENCE_LINES).max(1.0);
    let indices = apply_scale_damped_scores(&linear_points, scale_factor, metric, curve);
    let weights = tune_archetype_weights(archetype, QualityWeightVector::default());
    let composite_score = compute_composite_score(
        &indices,
        &weights,
        curve.composite_index_floor,
        THEORETICAL_SCORE_CEILING,
    );
    EvaluatedQualityScore {
        indices,
        linear_points,
        composite_score,
        grade: resolve_quality_grade(composite_score),
        confidence: calculate_confidence_from_volume(lines, 1.0, false),
        dispersion_penalty: 1.0,
        score_std_dev: 0.0,
    }
}

/// Aggregates per-file scores into a LOC-weighted project 10D breakdown matching `QualityScorer`.
#[must_use]
pub fn evaluate_project_quality(
    file_scores: &[(&FileMetricSummary<'_>, &EvaluatedQualityScore)],
    archetype: ProjectArchetype,
    curve: &QualityCurveConfig,
) -> EvaluatedQualityScore {
    if file_scores.is_empty() {
        return evaluate_file_quality(&[], None, archetype, curve);
    }
    let (mut weighted_dims, mut linear_sum) = ([0.0_f64; 10], [0.0_f64; 10]);
    let (mut total_weight, mut sum_comp, mut sum_comp_sq) = (0.0_f64, 0.0_f64, 0.0_f64);
    for &(metric, file_score) in file_scores {
        let w_lines = if metric.non_blank_lines > 0 { metric.non_blank_lines } else { metric.lines.max(1) };
        let weight = (w_lines.max(1)) as f64;
        total_weight += weight;
        sum_comp += file_score.composite_score;
        sum_comp_sq += file_score.composite_score * file_score.composite_score;
        for dim_idx in 0..10 {
            weighted_dims[dim_idx] += file_score.indices[dim_idx] * weight;
            linear_sum[dim_idx] += file_score.linear_points[dim_idx];
        }
    }
    let divisor = if total_weight > 0.0 { total_weight } else { 1.0 };
    let project_scale = (total_weight / DEFAULT_SCALE_REFERENCE_LINES).max(1.0);
    let mut project_indices = [0.0_f64; 10];
    let dims = QualityDimension::all();
    for dim_idx in 0..10 {
        let avg = weighted_dims[dim_idx] / divisor;
        let ceiling = compute_dimension_ceiling(dims[dim_idx], None, project_scale, curve);
        project_indices[dim_idx] = round_two(avg).min(ceiling);
    }
    let weights = tune_archetype_weights(archetype, QualityWeightVector::default());
    let composite_score = compute_composite_score(
        &project_indices,
        &weights,
        curve.composite_index_floor,
        THEORETICAL_SCORE_CEILING,
    );
    let n = file_scores.len() as f64;
    let mean_comp = sum_comp / n;
    let std_dev = round_two(((sum_comp_sq / n) - (mean_comp * mean_comp)).max(0.0).sqrt());
    EvaluatedQualityScore {
        indices: project_indices,
        linear_points: linear_sum,
        composite_score,
        grade: resolve_quality_grade(composite_score),
        confidence: calculate_confidence_from_volume(total_weight, 1.0, true),
        dispersion_penalty: compute_popoviciu_dispersion_penalty(std_dev, 0.5),
        score_std_dev: std_dev,
    }
}
