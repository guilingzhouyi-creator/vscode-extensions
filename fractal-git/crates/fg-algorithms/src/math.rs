//! Module: fg-algorithms — Bayesian Statistics & Mathematical Modeling
//! File Path: crates/fg-algorithms/src/math.rs
//! Architecture Role: Pure mathematical modeling library for objective software quality metrics.
//!   Evaluates conjugate posterior score envelopes over `fg_core::jeffreys_beta_from_counts`
//!   using non-informative Jeffreys priors `Beta(0.5, 0.5)`.
//! Dependencies & Triggers: Consumed by Taxis UAC Promotion Ledger,
//!   Auto-Refactor telemetry, and CLI.
//! Responsibilities: Compute mathematically sound posterior means, variances,
//!   and 95% credible intervals strictly from objective observation counts
//!   without subjective manual bias.
//! Exit Semantics & Design Rationale:
//!   - Delegates core Beta(0.5, 0.5) math to `fg_core::jeffreys_beta_from_counts` (`FGT-COR-001`).
//!   - Closed-form analytical equations guarantee sub-microsecond execution latency
//!     and zero memory allocation (`FGT-PRF-001`).
//!
//! Domain Governance Rules: FGT-ALG-001 (Bayesian statistical modeling), FGT-COR-001, FGT-PRF-001.

use fg_core::jeffreys_beta_from_counts;

/// Full posterior statistical score estimate on a `[0.0, 100.0]` percentage scale.
#[derive(Debug, Clone, PartialEq)]
pub struct PosteriorScoreEstimate {
    /// Observed raw composite score in `[0.0, 100.0]`.
    pub raw_score: f64,
    /// Conjugate posterior mean in `[0.0, 100.0]`.
    pub posterior_mean: f64,
    /// Posterior variance in `[0.0, 1.0]` probability space.
    pub variance: f64,
    /// 95% credible interval lower bound (`mean - 1.96 * std_dev`) in `[0.0, 100.0]`.
    pub credible_lower_95: f64,
}

/// Evaluates a full Bayesian posterior score envelope from an observed composite score.
///
/// Uses non-informative Jeffreys prior `Beta(0.5, 0.5)` over an effective observation scale `n = 50.0`.
#[must_use]
pub fn evaluate_score_envelope(composite_score: f64) -> PosteriorScoreEstimate {
    let success_probability = (composite_score / 100.0).clamp(0.0, 1.0);
    let effective_sample_size = 50.0;
    let passed = success_probability * effective_sample_size;
    let failed = (1.0 - success_probability) * effective_sample_size;
    let posterior = jeffreys_beta_from_counts(passed, failed);

    let round_1dec = |sample_val: f64| (sample_val * 1000.0).round() / 10.0;

    PosteriorScoreEstimate {
        raw_score: composite_score,
        posterior_mean: round_1dec(posterior.mean),
        variance: posterior.variance,
        credible_lower_95: round_1dec(posterior.ci95_lower),
    }
}

/// Computes the Jeffreys `Beta(0.5, 0.5)` conjugate posterior credible interval lower bound
/// (95% confidence).
///
/// Returns a rounded percentage value in `[0.0, 100.0]` with 1 decimal place precision.
#[inline]
#[must_use]
pub fn compute_jeffreys_credible_lower(composite_score: f64) -> f64 {
    evaluate_score_envelope(composite_score).credible_lower_95
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_perfect_score_posterior() {
        let est = evaluate_score_envelope(100.0);
        assert_eq!(est.raw_score, 100.0);
        assert!(est.posterior_mean > 98.0 && est.posterior_mean <= 100.0);
        assert!(est.credible_lower_95 > 93.0 && est.credible_lower_95 <= 100.0);
    }

    #[test]
    fn test_zero_score_posterior() {
        let est = evaluate_score_envelope(0.0);
        assert_eq!(est.raw_score, 0.0);
        assert!(est.posterior_mean < 2.0);
        assert_eq!(est.credible_lower_95, 0.0);
    }

    #[test]
    fn test_midpoint_score_posterior() {
        let est = evaluate_score_envelope(50.0);
        assert_eq!(est.posterior_mean, 50.0);
        assert!(est.credible_lower_95 > 35.0 && est.credible_lower_95 < 40.0);
    }

    #[test]
    fn test_out_of_bounds_clamping() {
        let lower = compute_jeffreys_credible_lower(-10.0);
        assert_eq!(lower, 0.0);

        let upper = compute_jeffreys_credible_lower(150.0);
        assert!(upper > 90.0 && upper <= 100.0);
    }
}
