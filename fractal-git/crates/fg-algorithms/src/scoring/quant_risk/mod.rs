//! Module: fg-algorithms — SQALE, ADR-Q Quantitative Risk & CAI 2.0
//! File Path: crates/fg-algorithms/src/scoring/quant_risk/mod.rs
//! Architecture Role: Pure-Rust quantitative telemetry evaluator mirroring `auto-refactor`'s SQALE
//!   remediation effort model, 8-metric ADR-Q stability ledger, and CAI 2.0 Bayesian autonomy score.
//! Dependencies & Triggers: Uses `crate::math::evaluate_score_envelope` and `fg_core::models::QuantMetrics`.
//! Responsibilities: Re-export SQALE/ADR-Q modules and evaluate CAI 2.0 plus DTO serialization.
//! Exit Semantics & Design Rationale: Zero heap allocations during core loop evaluations; clean
//!   division-by-zero guards across empty or sparse snapshots.

pub mod adrq_ratios;
pub mod adrq_stats;
pub mod sqale;
#[cfg(test)]
mod unit_tests;

pub use adrq_stats::{evaluate_adrq_risk, AdrqInputs, AdrqRiskReport};
pub use sqale::{
    evaluate_technical_debt, resolve_issue_remediation_minutes, SqaleGrade, TechnicalDebtReport,
    DEFAULT_DEV_MINUTES_PER_ELOC,
};

use crate::math::evaluate_score_envelope;
use crate::scoring::ten_dimensions::{
    calculate_confidence_from_volume, QualityWeightVector, THEORETICAL_SCORE_CEILING,
};
use fg_core::models::quality_contracts::QuantMetrics;

/// Inputs for CAI 2.0 autonomy scoring matching `AutonomyEvaluation`.
#[derive(Debug, Clone, Copy)]
pub struct CaiInputs {
    /// Proprietary effective LOC across analyzed source files.
    pub proprietary_eloc: usize,
    /// Third-party vendored ELOC.
    pub vendor_eloc: usize,
    /// Generated code ELOC.
    pub generated_eloc: usize,
    /// Domain kernel algorithm ELOC inside proprietary code.
    pub domain_kernel_eloc: usize,
    /// Internal repository symbol call or import count.
    pub internal_calls: usize,
    /// External SDK call or import count.
    pub external_calls: usize,
    /// Number of distinct external SDK packages detected.
    pub external_packages: usize,
    /// Critical path internal call count.
    pub critical_internal_calls: usize,
    /// Critical path external call count.
    pub critical_external_calls: usize,
    /// Clone finding count (`HYG-CLN-001`) penalizing originality.
    pub clone_findings: usize,
    /// Direct and transitive dependency count from manifests or lockfiles.
    pub dependency_count: usize,
}

/// Evaluates CAI 2.0 composite autonomy ratio bounded in `[0.0, 1.0]`.
#[must_use]
pub fn evaluate_cai_autonomy_rate(inputs: &CaiInputs) -> f64 {
    let eloc = inputs.proprietary_eloc as f64;
    let sample_margin = 0.75 / (1.0 + eloc / 5000.0);
    let axis_ceiling = (100.0 - 0.15 - sample_margin).min(THEORETICAL_SCORE_CEILING);
    let tree_eloc = (inputs.proprietary_eloc + inputs.vendor_eloc + inputs.generated_eloc) as f64;
    let r_loc = if tree_eloc > 0.0 {
        ((eloc / tree_eloc) * 100.0).min(axis_ceiling)
    } else {
        axis_ceiling
    };
    let scoped_calls = inputs.internal_calls + inputs.external_calls;
    let raw_call = if scoped_calls > 0 {
        ((inputs.internal_calls as f64) / (scoped_calls as f64)) * 100.0
    } else if inputs.external_packages > 0 {
        (100.0 - (inputs.external_packages as f64) * 5.0).max(20.0)
    } else {
        axis_ceiling
    };
    let r_call = raw_call.min(axis_ceiling);
    let r_domain = if inputs.proprietary_eloc > 0 {
        (((inputs.domain_kernel_eloc as f64) / eloc) * 100.0).clamp(25.0, axis_ceiling)
    } else {
        axis_ceiling
    };
    let clone_density = if inputs.clone_findings == 0 {
        0.0
    } else {
        (inputs.clone_findings as f64) / (eloc / 1000.0).max(1.0)
    };
    let r_pure = ((100.0 * 12.0) / (12.0 + clone_density)).min(axis_ceiling);
    let r_supply = (100.0 - (inputs.dependency_count as f64) * 1.25).clamp(20.0, axis_ceiling);
    let crit_total = inputs.critical_internal_calls + inputs.critical_external_calls;
    let r_crit = if crit_total > 0 {
        (((inputs.critical_internal_calls as f64) / (crit_total as f64)) * 100.0).min(axis_ceiling)
    } else {
        r_call
    };
    let axes = [r_loc, r_call, r_domain, r_pure, r_supply, r_crit];
    let weights = [0.22, 0.22, 0.18, 0.14, 0.12, 0.12];
    let (mut log_sum, mut weight_sum) = (0.0_f64, 0.0_f64);
    for idx in 0..6 {
        log_sum += weights[idx] * axes[idx].clamp(15.0, 100.0).ln();
        weight_sum += weights[idx];
    }
    let composite = (log_sum / weight_sum).exp().clamp(0.0, axis_ceiling);
    let ratio = (evaluate_score_envelope(composite).posterior_mean / 100.0).clamp(0.0, 1.0);
    (ratio * 10_000.0).round() / 10_000.0
}

/// Packages SQALE, ADR-Q, CAI, workspace health, and polyglot scores into closed `QuantMetrics`.
#[must_use]
pub fn build_quant_metrics_dto(
    workspace_health_score: f64,
    polyglot_index: f64,
    autonomy_rate: f64,
    total_eloc: usize,
    sqale: &TechnicalDebtReport,
    adrq: &AdrqRiskReport,
    _weights: Option<&QualityWeightVector>,
) -> QuantMetrics {
    let confidence = calculate_confidence_from_volume(total_eloc.max(1) as f64, 1.0, true);
    QuantMetrics {
        rcr: adrq.rcr,
        erq: adrq.erq,
        ddr: adrq.ddr,
        edb95: adrq.edb95,
        ptd: adrq.ptd,
        dsi: adrq.dsi,
        rcd: adrq.rcd,
        ehl: adrq.ehl,
        workspace_health_score: round_two(workspace_health_score.clamp(0.0, 100.0)),
        autonomy_rate: (autonomy_rate.clamp(0.0, 1.0) * 10_000.0).round() / 10_000.0,
        polyglot_index: round_two(polyglot_index.clamp(0.0, 100.0)),
        sqale_minutes: round_two(sqale.total_remediation_minutes.max(0.0)),
        tdr: ((sqale.technical_debt_ratio.max(0.0)) * 10_000.0).round() / 10_000.0,
        confidence,
    }
}

fn round_two(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}
