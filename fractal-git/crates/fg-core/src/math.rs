//! Module: fg-core — Shared Statistical & Varint Mathematical Primitives
//! File Path: crates/fg-core/src/math.rs
//! Architecture Role: Canonical zero-allocation mathematical primitives shared across `fg-algorithms`,
//!   `fg-index`, `fg-storage`, `fg-topology`, and `fg-gate`.
//! Dependencies & Triggers: Invoked by Bayesian quality/credit evaluators and Git bijective base-128
//!   offset varint codecs (`DIRC` v4 path prefix compression and `OFS_DELTA` packfile framing).
//! Responsibilities: Compute conjugate Jeffreys `Beta(0.5, 0.5)` posteriors and encode/decode Git
//!   offset varints entirely on the stack without transient heap allocation.
//! Exit Semantics & Design Rationale:
//!   - Eliminates four divergent copies of the Jeffreys `Beta(0.5, 0.5)` formula across crates.
//!   - Replaces per-entry `Vec<u8>::insert(0, ...)` heap allocations in `OFS_DELTA` and `DIRC` v4
//!     loops with a fixed `[u8; 10]` stack buffer (`FGT-PRF-001`).
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocation guard in hot loops

/// Conjugate posterior summary under the non-informative Jeffreys prior `Beta(0.5, 0.5)`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JeffreysPosterior {
    /// Posterior mean $\hat{\mu} = (\alpha_0 + s) / (\alpha_0 + \beta_0 + s + f)$ in `[0.0, 1.0]`.
    pub mean: f64,
    /// Analytical Beta variance $\alpha\beta / ((\alpha+\beta)^2 (\alpha+\beta+1))$.
    pub variance: f64,
    /// Posterior standard deviation $\sqrt{\text{variance}}$.
    pub std_dev: f64,
    /// Lower bound of the 95% normal-approximated credible interval, clamped to `[0.0, 1.0]`.
    pub ci95_lower: f64,
    /// Upper bound of the 95% normal-approximated credible interval, clamped to `[0.0, 1.0]`.
    pub ci95_upper: f64,
}

/// Evaluates the conjugate Jeffreys `Beta(0.5 + passed, 0.5 + failed)` posterior for continuous or
/// discrete non-negative pseudo-counts.
#[must_use]
pub fn jeffreys_beta_from_counts(passed: f64, failed: f64) -> JeffreysPosterior {
    let clean_passed = if passed.is_finite() && passed > 0.0 {
        passed
    } else {
        0.0
    };
    let clean_failed = if failed.is_finite() && failed > 0.0 {
        failed
    } else {
        0.0
    };

    let alpha = 0.5 + clean_passed;
    let beta = 0.5 + clean_failed;
    let denom = alpha + beta;
    let mean = (alpha / denom).clamp(0.0, 1.0);
    let variance = (alpha * beta) / (denom * denom * (denom + 1.0));
    let std_dev = variance.sqrt();
    let ci95_lower = (mean - 1.96 * std_dev).clamp(0.0, 1.0);
    let ci95_upper = (mean + 1.96 * std_dev).clamp(0.0, 1.0);

    JeffreysPosterior {
        mean,
        variance,
        std_dev,
        ci95_lower,
        ci95_upper,
    }
}

/// Evaluates the conjugate Jeffreys `Beta(0.5, 0.5)` posterior from integer `(passed, total)` trials.
#[must_use]
pub fn jeffreys_beta_trials(passed: u64, total: u64) -> JeffreysPosterior {
    let clamped_passed = passed.min(total);
    let failed = total - clamped_passed;
    jeffreys_beta_from_counts(clamped_passed as f64, failed as f64)
}

/// Encodes a `u64` using Git's bijective base-128 offset varint (`OFS_DELTA` and `DIRC` v4).
///
/// Returns `(buffer, start_index)` such that `&buffer[start_index..]` holds the canonical encoded
/// bytes with zero heap allocation.
#[must_use]
pub const fn encode_git_offset_varint(mut value: u64) -> ([u8; 10], usize) {
    let mut buf = [0u8; 10];
    let mut pos = 9;
    buf[pos] = (value & 0x7f) as u8;
    value >>= 7;
    while value != 0 {
        value -= 1;
        pos -= 1;
        buf[pos] = 0x80 | ((value & 0x7f) as u8);
        value >>= 7;
    }
    (buf, pos)
}

/// Decodes a Git bijective base-128 offset varint from the front of `bytes`.
///
/// Returns `Some((decoded_value, bytes_consumed))`, or `None` if `bytes` is empty, truncated, or
/// overflows `u64`.
#[must_use]
pub const fn decode_git_offset_varint(bytes: &[u8]) -> Option<(u64, usize)> {
    if bytes.is_empty() {
        return None;
    }
    let mut idx = 0;
    let mut byte = bytes[idx];
    let mut value = (byte & 0x7f) as u64;
    idx += 1;

    while (byte & 0x80) != 0 {
        if idx >= bytes.len() {
            return None;
        }
        byte = bytes[idx];
        idx += 1;
        value = match value.checked_add(1) {
            Some(incremented) => match incremented.checked_shl(7) {
                Some(shifted) => shifted | ((byte & 0x7f) as u64),
                None => return None,
            },
            None => return None,
        };
    }

    Some((value, idx))
}

#[cfg(test)]
mod tests {
    use super::{
        decode_git_offset_varint, encode_git_offset_varint, jeffreys_beta_from_counts,
        jeffreys_beta_trials,
    };

    #[test]
    fn jeffreys_trials_matches_closed_form() {
        let full = jeffreys_beta_trials(10, 10);
        assert!((full.mean - (10.5 / 11.0)).abs() < 1e-12);
        assert!(full.ci95_lower > 0.70 && full.ci95_upper <= 1.0);

        let zero = jeffreys_beta_trials(0, 10);
        assert!((zero.mean - (0.5 / 11.0)).abs() < 1e-12);
        assert!(zero.ci95_lower >= 0.0 && zero.ci95_upper < 0.25);

        let empty = jeffreys_beta_from_counts(f64::NAN, -3.0);
        assert!((empty.mean - 0.5).abs() < 1e-12);
    }

    #[test]
    fn git_offset_varint_round_trips_boundary_values() {
        for sample in [
            0u64,
            1,
            127,
            128,
            129,
            16_383,
            16_384,
            65_535,
            1_048_576,
            u32::MAX as u64,
            u64::MAX >> 1,
        ] {
            let (buf, start) = encode_git_offset_varint(sample);
            let slice = &buf[start..];
            let (decoded, consumed) = decode_git_offset_varint(slice).expect("valid varint");
            assert_eq!(decoded, sample);
            assert_eq!(consumed, slice.len());
        }

        assert!(decode_git_offset_varint(&[]).is_none());
        assert!(decode_git_offset_varint(&[0x80]).is_none());
    }
}
