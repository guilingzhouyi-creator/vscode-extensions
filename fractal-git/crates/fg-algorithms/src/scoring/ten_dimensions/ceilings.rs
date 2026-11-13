//! Module: fg-algorithms — 10-Dimension Epistemic & Security Ceilings
//! File Path: crates/fg-algorithms/src/scoring/ten_dimensions/ceilings.rs
//! Architecture Role: Pure IEEE-754 theoretical ceilings (`computeSecurityCeiling`,
//!   `computeEpistemicCeiling`) and curve hyperparameter structs aligned with `scorer-formulas.ts`.
//! Dependencies & Triggers: Uses `crate::scoring::ten_dimensions::taxonomy`.
//! Responsibilities: Export constants, ceiling config types, and theoretical upper bounds `< 100.0`.
//! Exit Semantics & Design Rationale: Reserves epistemic margin proportional to surface area.

use super::taxonomy::{FileMetricSummary, QualityDimension};

pub const DIMENSION_MAX_SCORE: f64 = 100.0;
pub const MIN_EPISTEMIC_GAP: f64 = 0.01;
pub const THEORETICAL_SCORE_CEILING: f64 = 99.99;
pub const SCORE_ROUNDING: f64 = 100.0;
pub const SCALE_FACTOR_PRECISION: f64 = 10_000.0;
pub const GRADE_A_PLUS_MIN: f64 = 90.0;
pub const GRADE_A_MIN: f64 = 80.0;
pub const GRADE_B_MIN: f64 = 70.0;
pub const GRADE_C_MIN: f64 = 60.0;
pub const GRADE_D_MIN: f64 = 50.0;
pub const CONFIDENCE_FLOOR: f64 = 0.6;
pub const CONFIDENCE_LINE_CAP: f64 = 300.0;
pub const CONFIDENCE_LINE_SCALE: f64 = 750.0;
pub const PROJECT_SCALE_FACTOR: f64 = 20.0;
pub const DEFAULT_SCALE_REFERENCE_LINES: f64 = 100.0;
pub const POPOVICIU_MAX_SIGMA: f64 = 50.0;
pub const DEFAULT_DISPERSION_PENALTY_RATIO: f64 = 0.5;
pub const MAX_NESTING_DEPTH: usize = 4;
pub const MAX_EXPORTED_SYMBOLS: usize = 30;

/// Security ceiling configuration mirroring `SecurityCeilingScoringConfig`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SecurityCeilingConfig {
    pub export_weight: f64,
    pub loc_weight: f64,
    pub export_limit: f64,
    pub loc_limit: f64,
    pub max_discount: f64,
    pub baseline_lines: f64,
    pub epistemic_base_reserve: f64,
}

impl Default for SecurityCeilingConfig {
    fn default() -> Self {
        Self {
            export_weight: 0.6, loc_weight: 0.4, export_limit: 30.0, loc_limit: 500.0,
            max_discount: 0.5, baseline_lines: 100.0, epistemic_base_reserve: 0.25,
        }
    }
}

/// Epistemic ceiling configuration mirroring `EpistemicCeilingScoringConfig`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EpistemicCeilingConfig {
    pub base_reserve: f64,
    pub max_surface_discount: f64,
    pub volume_half_point_lines: f64,
    pub export_surface_half_point: f64,
    pub volume_weight: f64,
    pub export_weight: f64,
    pub baseline_lines: f64,
}

impl Default for EpistemicCeilingConfig {
    fn default() -> Self {
        Self {
            base_reserve: 0.25, max_surface_discount: 0.55, volume_half_point_lines: 2500.0,
            export_surface_half_point: 80.0, volume_weight: 0.7, export_weight: 0.3,
            baseline_lines: 100.0,
        }
    }
}

/// Quality scoring curve parameters matching `DEFAULT_SCORING_CONFIG.quality`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QualityCurveConfig {
    pub composite_index_floor: f64,
    pub saturation_halfpoint: f64,
    pub macro_file_knee_scale: f64,
    pub macro_file_log_weight: f64,
    pub micro_file_floor_scale: f64,
    pub security_ceiling: SecurityCeilingConfig,
    pub epistemic_ceiling: EpistemicCeilingConfig,
}

impl Default for QualityCurveConfig {
    fn default() -> Self {
        Self {
            composite_index_floor: 15.0, saturation_halfpoint: 30.0, macro_file_knee_scale: 10.0,
            macro_file_log_weight: 2.0, micro_file_floor_scale: 0.2,
            security_ceiling: SecurityCeilingConfig::default(),
            epistemic_ceiling: EpistemicCeilingConfig::default(),
        }
    }
}

pub(crate) fn round_two(val: f64) -> f64 {
    (val * SCORE_ROUNDING).round() / SCORE_ROUNDING
}

/// Computes `computeSecurityCeiling` matching `scorer-formulas.ts`.
#[must_use]
pub fn compute_security_ceiling(
    metric: Option<&FileMetricSummary<'_>>,
    scale_factor: f64,
    config: &SecurityCeilingConfig,
) -> f64 {
    let exp_symbols = metric.map_or(0.0, |entry| entry.exported_symbols as f64);
    let lines = metric.map_or(scale_factor * config.baseline_lines, |e| e.non_blank_lines as f64);
    let exp_term = config.export_weight * (exp_symbols.max(0.0) / config.export_limit).tanh();
    let loc_term = config.loc_weight * (lines.max(0.0) / config.loc_limit).tanh();
    let reserve = config.epistemic_base_reserve.max(MIN_EPISTEMIC_GAP);
    let discount = reserve + config.max_discount * (exp_term + loc_term);
    round_two(DIMENSION_MAX_SCORE - discount).min(DIMENSION_MAX_SCORE - MIN_EPISTEMIC_GAP)
}

/// Computes `computeEpistemicCeiling` matching `scorer-formulas.ts`.
#[must_use]
pub fn compute_epistemic_ceiling(
    metric: Option<&FileMetricSummary<'_>>,
    scale_factor: f64,
    config: &EpistemicCeilingConfig,
) -> f64 {
    let exp_symbols = metric.map_or(0.0, |entry| entry.exported_symbols as f64);
    let lines = metric.map_or(scale_factor * config.baseline_lines, |e| e.non_blank_lines as f64);
    let load = config.volume_weight * (lines.max(0.0) / config.volume_half_point_lines)
        + config.export_weight * (exp_symbols.max(0.0) / config.export_surface_half_point);
    let saturated = if load.is_finite() && load > 0.0 { load / (1.0 + load) } else { 0.0 };
    let reserve = config.base_reserve.max(MIN_EPISTEMIC_GAP);
    let discount = reserve + config.max_surface_discount * saturated;
    round_two(DIMENSION_MAX_SCORE - discount).min(DIMENSION_MAX_SCORE - MIN_EPISTEMIC_GAP)
}

/// Computes dimension-specific theoretical ceiling `< 100.0`.
#[must_use]
pub fn compute_dimension_ceiling(
    dim: QualityDimension,
    metric: Option<&FileMetricSummary<'_>>,
    scale_factor: f64,
    config: &QualityCurveConfig,
) -> f64 {
    if dim == QualityDimension::CodeSecurity {
        compute_security_ceiling(metric, scale_factor, &config.security_ceiling)
    } else {
        compute_epistemic_ceiling(metric, scale_factor, &config.epistemic_ceiling)
    }
}
