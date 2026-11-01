//! Module: Native Acceleration Kernel — Pure Mathematical & Statistical Operators
//! Crate: ops-math
//! Architecture Role: High-throughput, zero-heap-allocation mathematical primitives for
//!   information entropy, Welford online statistical moments, dispersion penalties,
//!   and numerical corridor clamping.

use std::collections::HashMap;

/// Result summary of first and second statistical moments.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StatisticalMoments {
    pub mean: f64,
    pub variance: f64,
    pub standard_deviation: f64,
    pub count: usize,
}

/// Online Welford accumulator maintaining exact unrounded internal second moments
/// for sequential streaming without rounding degradation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WelfordAccumulator {
    pub count: usize,
    pub mean: f64,
    pub m2: f64,
}

impl Default for WelfordAccumulator {
    fn default() -> Self {
        Self::new()
    }
}

impl WelfordAccumulator {
    pub const fn new() -> Self {
        Self {
            count: 0,
            mean: 0.0,
            m2: 0.0,
        }
    }

    #[inline]
    pub fn update(&mut self, value: f64) {
        if !value.is_finite() {
            return;
        }
        self.count += 1;
        let delta = value - self.mean;
        self.mean += delta / (self.count as f64);
        let delta2 = value - self.mean;
        self.m2 += delta * delta2;
    }

    #[inline]
    pub fn merge(&mut self, other: &WelfordAccumulator) {
        if other.count == 0 {
            return;
        }
        if self.count == 0 {
            *self = *other;
            return;
        }
        let n_a = self.count as f64;
        let n_b = other.count as f64;
        let n = n_a + n_b;
        let delta = other.mean - self.mean;
        self.mean += delta * (n_b / n);
        self.m2 += other.m2 + delta * delta * (n_a * n_b / n);
        self.count += other.count;
    }

    pub fn finish(&self) -> StatisticalMoments {
        if self.count == 0 {
            return StatisticalMoments {
                mean: 0.0,
                variance: 0.0,
                standard_deviation: 0.0,
                count: 0,
            };
        }
        let variance = self.m2 / (self.count as f64);
        let std_dev = variance.max(0.0).sqrt();
        StatisticalMoments {
            mean: round_precision(self.mean, DEFAULT_PRECISION_DIGITS),
            variance: round_precision(variance, DEFAULT_PRECISION_DIGITS),
            standard_deviation: round_precision(std_dev, DEFAULT_PRECISION_DIGITS),
            count: self.count,
        }
    }
}

const DEFAULT_PRECISION_DIGITS: i32 = 4;
const DEFAULT_POPOVICIU_MAX_SIGMA: f64 = 50.0;
const DEFAULT_DISPERSION_PENALTY_RATIO: f64 = 0.5;
const SCORE_ROUNDING_FACTOR: f64 = 100.0;

#[inline]
fn round_precision(val: f64, digits: i32) -> f64 {
    if !val.is_finite() {
        return 0.0;
    }
    let factor = 10f64.powi(digits);
    (val * factor).round() / factor
}

/// Computes Shannon Information Entropy H(X) in bits from a text or token stream.
///
/// Mathematical formulation:
/// H(X) = - \sum_{i=1}^k p_i \log_2(p_i)
///
/// Optimized with a 256-element stack array for fast-path ASCII streams,
/// eliminating all heap allocations for typical code and identifier inputs.
pub fn compute_shannon_entropy(text: &str) -> f64 {
    if text.is_empty() {
        return 0.0;
    }

    // Fast-path: check if all characters are ASCII bytes (0..127)
    let bytes = text.as_bytes();
    let is_all_ascii = bytes.iter().all(|&b| b < 128);

    if is_all_ascii {
        let mut ascii_counts = [0u32; 128];
        for &b in bytes {
            ascii_counts[b as usize] += 1;
        }

        let total = bytes.len() as f64;
        let mut entropy = 0.0;
        for &count in &ascii_counts {
            if count > 0 {
                let p = count as f64 / total;
                entropy -= p * p.log2();
            }
        }
        (entropy * SCORE_ROUNDING_FACTOR).round() / SCORE_ROUNDING_FACTOR
    } else {
        // Unicode fallback path
        let mut char_map: HashMap<char, u32> = HashMap::new();
        let mut total_chars = 0usize;
        for ch in text.chars() {
            *char_map.entry(ch).or_insert(0) += 1;
            total_chars += 1;
        }

        if total_chars == 0 {
            return 0.0;
        }

        let total = total_chars as f64;
        let mut entropy = 0.0;
        for &count in char_map.values() {
            let p = count as f64 / total;
            entropy -= p * p.log2();
        }
        (entropy * SCORE_ROUNDING_FACTOR).round() / SCORE_ROUNDING_FACTOR
    }
}

/// Computes first and second statistical moments in a single online pass
/// using Welford's algorithm to eliminate numerical instability and catastrophic cancellation.
pub fn compute_statistical_moments(values: &[f64]) -> StatisticalMoments {
    if values.is_empty() {
        return StatisticalMoments {
            mean: 0.0,
            variance: 0.0,
            standard_deviation: 0.0,
            count: 0,
        };
    }

    let mut count = 0usize;
    let mut mean = 0.0f64;
    let mut m2 = 0.0f64;

    for &x in values {
        if x.is_finite() {
            count += 1;
            let delta = x - mean;
            mean += delta / (count as f64);
            let delta2 = x - mean;
            m2 += delta * delta2;
        }
    }

    if count == 0 {
        return StatisticalMoments {
            mean: 0.0,
            variance: 0.0,
            standard_deviation: 0.0,
            count: 0,
        };
    }

    let variance = m2 / (count as f64);
    let std_dev = variance.sqrt();

    StatisticalMoments {
        mean: round_precision(mean, DEFAULT_PRECISION_DIGITS),
        variance: round_precision(variance, DEFAULT_PRECISION_DIGITS),
        standard_deviation: round_precision(std_dev, DEFAULT_PRECISION_DIGITS),
        count,
    }
}

/// Computes population arithmetic mean of a slice.
pub fn compute_mean(values: &[f64]) -> f64 {
    compute_statistical_moments(values).mean
}

/// Computes population variance of a slice.
pub fn compute_variance(values: &[f64]) -> f64 {
    compute_statistical_moments(values).variance
}

/// Computes population standard deviation of a slice.
pub fn compute_standard_deviation(values: &[f64]) -> f64 {
    compute_statistical_moments(values).standard_deviation
}

/// Merges two precomputed statistical moment structures using Chan-Golub-LeVeque
/// pairwise formula.
pub fn merge_statistical_moments(
    a: &StatisticalMoments,
    b: &StatisticalMoments,
) -> StatisticalMoments {
    let mut acc_a = WelfordAccumulator {
        count: a.count,
        mean: a.mean,
        m2: a.variance * (a.count as f64),
    };
    let acc_b = WelfordAccumulator {
        count: b.count,
        mean: b.mean,
        m2: b.variance * (b.count as f64),
    };
    acc_a.merge(&acc_b);
    acc_a.finish()
}

/// Calculates Popoviciu's inequality dispersion discount factor:
/// D = max(0, 1.0 - gamma * (sigma / sigma_max))
///
/// Under scores in [0, 100], Popoviciu's maximum standard deviation is (100 - 0) / 2 = 50.0.
pub fn calculate_popoviciu_dispersion_penalty(
    standard_deviation: f64,
    max_sigma: Option<f64>,
    gamma: Option<f64>,
) -> f64 {
    let sigma_max = max_sigma.unwrap_or(DEFAULT_POPOVICIU_MAX_SIGMA);
    let penalty_ratio = gamma.unwrap_or(DEFAULT_DISPERSION_PENALTY_RATIO);

    if !standard_deviation.is_finite() || sigma_max <= 0.0 {
        return 1.0;
    }

    let raw_discount = 1.0 - penalty_ratio * (standard_deviation / sigma_max);
    let clamped = raw_discount.clamp(0.0, 1.0);
    (clamped * SCORE_ROUNDING_FACTOR).round() / SCORE_ROUNDING_FACTOR
}

/// Safe floating-point division guarding against zero or non-finite denominators.
pub fn safe_divide(numerator: f64, denominator: f64, fallback: f64) -> f64 {
    if !numerator.is_finite() || !denominator.is_finite() || denominator.abs() < 1e-12 {
        fallback
    } else {
        numerator / denominator
    }
}

/// Clamps a numeric value within a closed corridor [min_val, max_val].
pub fn clamp_corridor(val: f64, min_val: f64, max_val: f64) -> f64 {
    if !val.is_finite() {
        return min_val;
    }
    val.clamp(min_val, max_val)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shannon_entropy_identical_characters() {
        assert_eq!(compute_shannon_entropy(""), 0.0);
        assert_eq!(compute_shannon_entropy("aaaaaaaa"), 0.0);
    }

    #[test]
    fn test_shannon_entropy_distinct_characters() {
        let entropy = compute_shannon_entropy("abcdefgh");
        assert_eq!(entropy, 3.0);
    }

    #[test]
    fn test_shannon_entropy_alternating_characters() {
        let entropy = compute_shannon_entropy("abababab");
        assert_eq!(entropy, 1.0);
    }

    #[test]
    fn test_shannon_entropy_unicode() {
        let entropy = compute_shannon_entropy("你好你好");
        assert_eq!(entropy, 1.0);
    }

    #[test]
    fn test_statistical_moments_welford_accuracy() {
        let sample = vec![10.0, 20.0, 30.0, 40.0, 50.0];
        let moments = compute_statistical_moments(&sample);
        assert_eq!(moments.count, 5);
        assert_eq!(moments.mean, 30.0);
        assert_eq!(moments.variance, 200.0);
        assert!((moments.standard_deviation - 14.1421).abs() < 1e-3);
    }

    #[test]
    fn test_welford_accumulator_and_merge_equivalence() {
        let part_a = vec![10.0, 20.0, 30.0];
        let part_b = vec![40.0, 50.0];
        let full = vec![10.0, 20.0, 30.0, 40.0, 50.0];

        let mut acc_a = WelfordAccumulator::new();
        for &v in &part_a {
            acc_a.update(v);
        }
        let mut acc_b = WelfordAccumulator::new();
        for &v in &part_b {
            acc_b.update(v);
        }

        let full_moments = compute_statistical_moments(&full);

        // Accumulator merge
        let mut acc_merged = acc_a;
        acc_merged.merge(&acc_b);
        let merged_from_acc = acc_merged.finish();

        assert_eq!(merged_from_acc.count, full_moments.count);
        assert_eq!(merged_from_acc.mean, full_moments.mean);
        assert_eq!(merged_from_acc.variance, full_moments.variance);
        assert_eq!(
            merged_from_acc.standard_deviation,
            full_moments.standard_deviation
        );

        // Function merge
        let moments_a = acc_a.finish();
        let moments_b = acc_b.finish();
        let merged_moments = merge_statistical_moments(&moments_a, &moments_b);

        assert_eq!(merged_moments.count, full_moments.count);
        assert_eq!(merged_moments.mean, full_moments.mean);
        assert_eq!(merged_moments.variance, full_moments.variance);
        assert_eq!(
            merged_moments.standard_deviation,
            full_moments.standard_deviation
        );
    }

    #[test]
    fn test_statistical_moments_empty_and_nan() {
        let moments = compute_statistical_moments(&[]);
        assert_eq!(moments.count, 0);
        assert_eq!(moments.mean, 0.0);

        let with_nan = vec![10.0, f64::NAN, 20.0, f64::INFINITY];
        let moments_nan = compute_statistical_moments(&with_nan);
        assert_eq!(moments_nan.count, 2);
        assert_eq!(moments_nan.mean, 15.0);
    }

    #[test]
    fn test_popoviciu_dispersion_penalty() {
        // Zero standard deviation -> perfect dispersion (1.0)
        assert_eq!(calculate_popoviciu_dispersion_penalty(0.0, None, None), 1.0);

        // Maximum standard deviation 50.0 with gamma 0.5 -> 1.0 - 0.5 * (50/50) = 0.5
        assert_eq!(
            calculate_popoviciu_dispersion_penalty(50.0, None, None),
            0.5
        );

        // Half dispersion 25.0 -> 1.0 - 0.5 * (25/50) = 0.75
        assert_eq!(
            calculate_popoviciu_dispersion_penalty(25.0, None, None),
            0.75
        );
    }

    #[test]
    fn test_safe_divide_and_corridor() {
        assert_eq!(safe_divide(10.0, 0.0, -1.0), -1.0);
        assert_eq!(safe_divide(10.0, 2.0, -1.0), 5.0);
        assert_eq!(clamp_corridor(150.0, 0.0, 100.0), 100.0);
        assert_eq!(clamp_corridor(-5.0, 0.0, 100.0), 0.0);
    }
}
