//! Module: fg-gate::diff_bounds::admission — Empirical Admission Turnover Engine
//! File Path: crates/fg-gate/src/diff_bounds/admission.rs
//! Architecture Role: Calculates Bayesian posterior adaptive turnover admission floor.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

/// Floor on the empirical admission turnover to guarantee a meaningful contribution.
pub const ADMISSION_TURNOVER_FLOOR: f64 = 3.0;
/// Cap on the empirical admission turnover to prevent ratchet lock out.
pub const ADMISSION_TURNOVER_CAP: f64 = 25.0;
/// Minimum trajectory samples required before adaptive thresholding leaves the cold-start floor.
pub const MIN_TRAJECTORY_SAMPLES: usize = 3;
/// Maximum trailing samples retained by the sliding empirical estimation window.
pub const DEFAULT_TRAJECTORY_WINDOW_SIZE: usize = 20;
/// Bayesian Jeffreys prior alpha parameter on Bernoulli pass-outcome counts.
pub const JEFFREYS_PRIOR_ALPHA: f64 = 0.5;
/// Bayesian Jeffreys prior beta parameter on Bernoulli pass-outcome counts.
pub const JEFFREYS_PRIOR_BETA: f64 = 0.5;
/// Discount factor applied to empirical standard deviation.
pub const STANDARD_DEVIATION_DISCOUNT_FACTOR: f64 = 0.5;
/// Maximum cyclomatic complexity noise index (CC / ELOC) before full damping applies.
pub const MAX_NOISE_CEILING: f64 = 4.0;

/// Historical trajectory outcome paired with measured net 5D ELOC semantic turnover.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AdmissionSample {
    /// Net 5D semantic turnover recorded for the historical commit/run.
    pub turnover: f64,
    /// Whether the trajectory sample satisfied gate admission.
    pub passed: bool,
}

impl AdmissionSample {
    /// Constructs a new admission trajectory sample.
    pub const fn new(turnover: f64, passed: bool) -> Self {
        Self { turnover, passed }
    }
}

/// Evaluates empirical dynamic admission threshold from historical samples using
/// Jeffreys Beta(0.5, 0.5) pass-rate posterior `(pass_count + 0.5) / (N + 1.0)` and
/// population standard deviation over the trailing window.
pub fn calculate_empirical_admission_threshold_samples(
    recent_samples: &[AdmissionSample],
    current_complexity: f64,
    current_eloc: f64,
) -> f64 {
    let window_start = recent_samples
        .len()
        .saturating_sub(DEFAULT_TRAJECTORY_WINDOW_SIZE);
    let window = &recent_samples[window_start..];
    if window.len() < MIN_TRAJECTORY_SAMPLES {
        return ADMISSION_TURNOVER_FLOOR;
    }

    let mut valid_count = 0usize;
    let mut running_mean = 0.0f64;
    let mut second_moment_sum = 0.0f64;
    let mut pass_count = 0usize;

    for sample in window {
        if !sample.turnover.is_finite() {
            continue;
        }
        valid_count += 1;
        if sample.passed {
            pass_count += 1;
        }
        let delta = sample.turnover - running_mean;
        running_mean += delta / valid_count as f64;
        let delta_after = sample.turnover - running_mean;
        second_moment_sum += delta * delta_after;
    }

    if valid_count < MIN_TRAJECTORY_SAMPLES {
        return ADMISSION_TURNOVER_FLOOR;
    }

    let variance = (second_moment_sum / valid_count as f64).max(0.0);
    let standard_deviation = variance.sqrt();

    let posterior_confidence = (pass_count as f64 + JEFFREYS_PRIOR_ALPHA)
        / (valid_count as f64 + JEFFREYS_PRIOR_ALPHA + JEFFREYS_PRIOR_BETA);

    let safe_eloc = current_eloc.max(1.0);
    let raw_noise = if current_complexity.is_finite() && current_complexity > 0.0 {
        current_complexity / safe_eloc
    } else {
        0.0
    };
    let noise_factor = raw_noise.clamp(0.0, MAX_NOISE_CEILING) / MAX_NOISE_CEILING;

    let statistical_center =
        (running_mean - STANDARD_DEVIATION_DISCOUNT_FACTOR * standard_deviation).max(0.0);
    let calibrated = statistical_center * (1.0 - noise_factor) * posterior_confidence;
    let clamped = calibrated.clamp(ADMISSION_TURNOVER_FLOOR, ADMISSION_TURNOVER_CAP);
    (clamped * 100.0).round() / 100.0
}

/// Evaluates empirical dynamic admission threshold from raw turnover values (treating each
/// turnover entry at or above the floor as a passed observation).
pub fn calculate_empirical_admission_threshold(recent_turnovers: &[f64]) -> f64 {
    let window_start = recent_turnovers
        .len()
        .saturating_sub(DEFAULT_TRAJECTORY_WINDOW_SIZE);
    let window = &recent_turnovers[window_start..];
    let mut samples = Vec::with_capacity(window.len());
    for &turnover_val in window {
        samples.push(AdmissionSample::new(
            turnover_val,
            turnover_val >= ADMISSION_TURNOVER_FLOOR,
        ));
    }
    calculate_empirical_admission_threshold_samples(&samples, 0.0, 1.0)
}

/// A structured violation of the minimum admission turnover.
#[derive(Debug, Clone, PartialEq)]
pub struct AdmissionViolation {
    /// Governance rule identifier triggering the block.
    pub rule_id: &'static str,
    /// Measured batch net 5D ELOC turnover.
    pub actual_turnover: f64,
    /// Required empirical admission turnover floor.
    pub required_threshold: f64,
    /// Formatted actual turnover display value.
    pub turnover: String,
    /// Formatted required threshold display value.
    pub threshold: String,
    /// Human-readable explanation of the admission deficit.
    pub message: String,
}

/// Verifies whether candidate batch turnover satisfies the empirical admission floor derived from
/// structured trajectory samples.
pub fn verify_admission_turnover_samples(
    batch_turnover: f64,
    recent_samples: &[AdmissionSample],
    current_complexity: f64,
    current_eloc: f64,
) -> Result<f64, AdmissionViolation> {
    let required_threshold = calculate_empirical_admission_threshold_samples(
        recent_samples,
        current_complexity,
        current_eloc,
    );
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

/// Verifies whether the candidate batch turnover satisfies the admission floor.
pub fn verify_admission_turnover(
    batch_turnover: f64,
    recent_turnovers: &[f64],
) -> Result<f64, AdmissionViolation> {
    let window_start = recent_turnovers
        .len()
        .saturating_sub(DEFAULT_TRAJECTORY_WINDOW_SIZE);
    let window = &recent_turnovers[window_start..];
    let mut samples = Vec::with_capacity(window.len());
    for &turnover_val in window {
        samples.push(AdmissionSample::new(
            turnover_val,
            turnover_val >= ADMISSION_TURNOVER_FLOOR,
        ));
    }
    verify_admission_turnover_samples(batch_turnover, &samples, 0.0, 1.0)
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

    #[test]
    fn test_jeffreys_posterior_reflects_pass_rate_and_caps_at_25() {
        let mut high_pass = Vec::new();
        let mut mixed_pass = Vec::new();
        for idx in 0..20 {
            high_pass.push(AdmissionSample::new(100.0, true));
            mixed_pass.push(AdmissionSample::new(20.0, idx % 2 == 0));
        }
        let capped = calculate_empirical_admission_threshold_samples(&high_pass, 0.0, 100.0);
        assert_eq!(capped, ADMISSION_TURNOVER_CAP);

        let mixed = calculate_empirical_admission_threshold_samples(&mixed_pass, 0.0, 100.0);
        // mean=20, std=0, pass=10/20 -> posterior=(10.5/21)=0.5 -> threshold=10.0
        assert!((mixed - 10.0).abs() < 1e-6);
    }

    #[test]
    fn test_admission_matches_ssot_json_contract() {
        let raw = include_str!("../../../../../scripts/common/diff-bounds-contract.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).expect("valid SSOT json");
        let empirical = &parsed["empiricalAdmission"];
        assert_eq!(
            empirical["turnoverFloor"].as_f64(),
            Some(ADMISSION_TURNOVER_FLOOR)
        );
        assert_eq!(
            empirical["turnoverCap"].as_f64(),
            Some(ADMISSION_TURNOVER_CAP)
        );
        assert_eq!(
            empirical["minTrajectorySamples"].as_u64(),
            Some(MIN_TRAJECTORY_SAMPLES as u64)
        );
        assert_eq!(
            empirical["trajectoryWindowSize"].as_u64(),
            Some(DEFAULT_TRAJECTORY_WINDOW_SIZE as u64)
        );
        assert_eq!(
            empirical["jeffreysPriorAlpha"].as_f64(),
            Some(JEFFREYS_PRIOR_ALPHA)
        );
        assert_eq!(
            empirical["jeffreysPriorBeta"].as_f64(),
            Some(JEFFREYS_PRIOR_BETA)
        );
        assert_eq!(
            empirical["stdDevDiscountFactor"].as_f64(),
            Some(STANDARD_DEVIATION_DISCOUNT_FACTOR)
        );
        assert_eq!(
            empirical["maxNoiseCeiling"].as_f64(),
            Some(MAX_NOISE_CEILING)
        );
    }
}
