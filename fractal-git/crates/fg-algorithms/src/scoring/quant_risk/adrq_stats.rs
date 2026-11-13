//! Module: fg-algorithms — ADR-Q Inequality, Entropy & Stochastic Reversion Stats
//! File Path: crates/fg-algorithms/src/scoring/quant_risk/adrq_stats.rs
//! Architecture Role: Evaluates debt spatial Gini (`dsi`), rule-family Shannon entropy (`rcd`),
//!   Ornstein-Uhlenbeck reversion half-life (`ehl`), and complexity excess kurtosis (`cc_kurtosis`).
//! Dependencies & Triggers: Pairs with `adrq_ratios`; exports `AdrqRiskReport`, `AdrqInputs`, and
//!   `evaluate_adrq_risk`.
//! Responsibilities: Combine time-series ratios and distributional risk dispersion metrics.
//! Exit Semantics & Design Rationale: Zero panics; bounded inputs guard division-by-zero cleanly.

use crate::scoring::quant_risk::adrq_ratios::{compute_rcr, compute_risk_ratios};

const EPSILON_FLOAT: f64 = 1e-6;
const MIN_RISK_SAMPLE_SIZE: usize = 3;
const MAX_RISK_WINDOW_SIZE: usize = 500;
const MIN_KURTOSIS_SAMPLES: usize = 4;
const NORMAL_KURTOSIS: f64 = 3.0;

fn round_two(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

/// Quantitative risk ledger outputs (`ADR-Q` 8 metrics).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AdrqRiskReport {
    pub rcr: f64,
    pub erq: f64,
    pub ddr: f64,
    pub edb95: f64,
    pub ptd: f64,
    pub dsi: f64,
    pub rcd: f64,
    pub ehl: f64,
    pub cc_kurtosis: f64,
}

/// Inputs required to evaluate full ADR-Q risk ledger cleanly without allocating.
#[derive(Debug, Clone, Copy)]
pub struct AdrqInputs<'a> {
    pub file_debts: &'a [f64],
    pub family_counts: &'a [usize],
    pub history_scores: &'a [f64],
    pub complexity_samples: &'a [f64],
    pub refactoring_yield_minutes: Option<f64>,
    pub debt_accrual_minutes: Option<f64>,
}

/// Computes the 8-metric ADR-Q quantitative risk report.
#[must_use]
pub fn evaluate_adrq_risk(inputs: &AdrqInputs<'_>) -> AdrqRiskReport {
    let rcr = compute_rcr(
        inputs.file_debts,
        inputs.refactoring_yield_minutes,
        inputs.debt_accrual_minutes,
    );
    let (erq, ddr, edb95, ptd) = compute_risk_ratios(inputs.history_scores);
    AdrqRiskReport {
        rcr,
        erq,
        ddr,
        edb95,
        ptd,
        dsi: compute_gini(inputs.file_debts),
        rcd: compute_normalized_category_entropy(inputs.family_counts),
        ehl: compute_ou_half_life(inputs.history_scores),
        cc_kurtosis: compute_excess_kurtosis(inputs.complexity_samples),
    }
}

fn compute_gini(values: &[f64]) -> f64 {
    let mut sorted: Vec<f64> = values
        .iter()
        .copied()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .collect();
    let total: f64 = sorted.iter().copied().sum();
    if sorted.is_empty() || total <= 0.0 {
        return 0.0;
    }
    sorted.sort_by(f64::total_cmp);
    let count = sorted.len();
    let mut numerator = 0.0_f64;
    for (idx, val) in sorted.iter().enumerate() {
        let weight = 2.0 * ((idx + 1) as f64) - (count as f64) - 1.0;
        numerator += weight * val;
    }
    round_two(numerator / ((count as f64) * total)).clamp(0.0, 1.0)
}

fn compute_normalized_category_entropy(counts: &[usize]) -> f64 {
    let (mut active, mut total) = (0usize, 0.0_f64);
    for &c in counts {
        if c > 0 {
            active += 1;
            total += c as f64;
        }
    }
    if active <= 1 || total <= 0.0 {
        return 0.0;
    }
    let shannon: f64 = counts
        .iter()
        .copied()
        .filter(|&c| c > 0)
        .map(|c| {
            let prob = (c as f64) / total;
            -prob * prob.log2()
        })
        .sum();
    let max_shannon = (active as f64).log2();
    if max_shannon <= 0.0 {
        0.0
    } else {
        round_two(shannon / max_shannon).clamp(0.0, 1.0)
    }
}

fn compute_ou_half_life(scores: &[f64]) -> f64 {
    let finite_vals: Vec<f64> = scores.iter().copied().filter(|s| s.is_finite()).collect();
    if finite_vals.len() < MIN_RISK_SAMPLE_SIZE {
        return 1.0;
    }
    let mean = finite_vals.iter().sum::<f64>() / (finite_vals.len() as f64);
    let (mut cov_lag, mut variance) = (0.0_f64, 0.0_f64);
    for (idx, &cur) in scores.iter().enumerate() {
        if !cur.is_finite() {
            continue;
        }
        let diff = cur - mean;
        variance += diff * diff;
        if idx > 0 && scores[idx - 1].is_finite() {
            cov_lag += diff * (scores[idx - 1] - mean);
        }
    }
    if variance < EPSILON_FLOAT {
        return 1.0;
    }
    let raw_rho = cov_lag / variance;
    if raw_rho <= 0.0 {
        return 1.0;
    }
    let theta = -(raw_rho.clamp(0.01, 0.999)).ln();
    round_two(2.0_f64.ln() / theta).clamp(0.1, MAX_RISK_WINDOW_SIZE as f64)
}

fn compute_excess_kurtosis(values: &[f64]) -> f64 {
    let valid_vals: Vec<f64> = values.iter().copied().filter(|v| v.is_finite()).collect();
    if valid_vals.len() < MIN_KURTOSIS_SAMPLES {
        return 0.0;
    }
    let count = valid_vals.len() as f64;
    let mean = valid_vals.iter().sum::<f64>() / count;
    let (mut second, mut fourth) = (0.0_f64, 0.0_f64);
    for val in valid_vals {
        let diff = val - mean;
        let diff_sq = diff * diff;
        second += diff_sq;
        fourth += diff_sq * diff_sq;
    }
    let var = second / count;
    if var < EPSILON_FLOAT {
        return 0.0;
    }
    round_two((fourth / count) / (var * var) - NORMAL_KURTOSIS)
}
