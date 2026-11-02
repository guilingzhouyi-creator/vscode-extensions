//! Module: fg-gate::diff_bounds::admission — Empirical Admission Turnover Engine
//! File Path: crates/fg-gate/src/diff_bounds/admission.rs
//! Architecture Role: Calculates Bayesian posterior adaptive turnover admission floor.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

/// Floor on the empirical admission turnover to guarantee a meaningful contribution.
pub const ADMISSION_TURNOVER_FLOOR: f64 = 3.0;
/// Cap on the empirical admission turnover to prevent ratchet lock out.
pub const ADMISSION_TURNOVER_CAP: f64 = 25.0;

/// Evaluates empirical dynamic admission threshold from historical turnover samples.
pub fn calculate_empirical_admission_threshold(recent_turnovers: &[f64]) -> f64 {
    if recent_turnovers.len() < 3 {
        return ADMISSION_TURNOVER_FLOOR;
    }

    let sample_count = recent_turnovers.len() as f64;
    let turnover_sum: f64 = recent_turnovers.iter().sum();
    let empirical_mean = turnover_sum / sample_count;

    let sample_variance: f64 = recent_turnovers
        .iter()
        .map(|&observed_val| (observed_val - empirical_mean) * (observed_val - empirical_mean))
        .sum::<f64>()
        / (sample_count - 1.0).max(1.0);
    let standard_deviation = sample_variance.sqrt();

    let jeffreys_posterior_mean = (0.5 + turnover_sum) / (1.0 + sample_count);
    let candidate_threshold = jeffreys_posterior_mean - 0.5 * standard_deviation;

    candidate_threshold.clamp(ADMISSION_TURNOVER_FLOOR, ADMISSION_TURNOVER_CAP)
}

/// A structured violation of the minimum admission turnover.
#[derive(Debug, Clone, PartialEq)]
pub struct AdmissionViolation {
    pub rule_id: &'static str,
    pub actual_turnover: f64,
    pub required_threshold: f64,
    pub turnover: String,
    pub threshold: String,
    pub message: String,
}

/// Verifies whether the candidate batch turnover satisfies the admission floor.
pub fn verify_admission_turnover(
    batch_turnover: f64,
    recent_turnovers: &[f64],
) -> Result<f64, AdmissionViolation> {
    let required_threshold = calculate_empirical_admission_threshold(recent_turnovers);
    if batch_turnover < required_threshold {
        return Err(AdmissionViolation {
            rule_id: "BLOCK_ADMISSION_TURNOVER_DEFICIT",
            actual_turnover: batch_turnover,
            required_threshold,
            turnover: format!("{:.1}", batch_turnover),
            threshold: format!("{:.1}", required_threshold),
            message: format!(
                "Commit batch net 5D ELOC turnover ({:.1}) is below empirical admission threshold ({:.1}). Substantive technical turnover required.",
                batch_turnover, required_threshold
            ),
        });
    }
    Ok(required_threshold)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cold_start_fallback_to_floor() {
        let threshold_empty = calculate_empirical_admission_threshold(&[]);
        assert_eq!(threshold_empty, ADMISSION_TURNOVER_FLOOR);

        let threshold_two_samples = calculate_empirical_admission_threshold(&[12.0, 15.0]);
        assert_eq!(threshold_two_samples, ADMISSION_TURNOVER_FLOOR);
    }

    #[test]
    fn test_empirical_adaptive_threshold() {
        let samples = [10.0, 12.0, 14.0, 11.0, 13.0, 12.5, 13.5, 11.5, 12.0, 14.0];
        let threshold = calculate_empirical_admission_threshold(&samples);
        assert!(threshold >= ADMISSION_TURNOVER_FLOOR);
        assert!(threshold <= ADMISSION_TURNOVER_CAP);
        assert!(verify_admission_turnover(15.0, &samples).is_ok());
        assert!(verify_admission_turnover(1.5, &samples).is_err());
    }
}
