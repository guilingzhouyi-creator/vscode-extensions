//! Module: fg-algorithms — Anti-Gaming Conjunction & Shannon Entropy Guard
//! File Path: crates/fg-algorithms/src/scoring/anti_gaming.rs
//! Architecture Role: Pure-Rust implementation of `evaluateAntiGamingConjunction`, Shannon token/byte
//!   entropy water-logging checks, and tautological assertion detection (`GOV-GAM-001` /
//!   `BLOCK_GAMING_DETECTED`).
//! Dependencies & Triggers: Matches `auto-refactor/src/core/scoring/antiGaming.ts`.
//! Responsibilities: Compute Shannon entropy, trivial forwarder counts, and the strict
//!   conjunctive `BLOCK_GAMING_DETECTED` verdict.
//! Exit Semantics & Design Rationale: Fail-closed circuit breaker with zero heap allocations inside
//!   counting loops.

/// Canonical circuit-breaker verdict emitted when quality score gaming is proven.
pub const VERDICT_BLOCK_GAMING_DETECTED: &str = "BLOCK_GAMING_DETECTED";

/// Maximum semantic change ratio below which zero net-debt cleanup triggers gaming alert.
pub const SEMANTIC_CHANGE_RATIO_THRESHOLD: f64 = 0.15;

/// Minimum non-blank line threshold before low Shannon entropy padding triggers.
pub const LOW_ENTROPY_MIN_LINES: usize = 300;

/// Minimum Shannon entropy in bits required on large source files.
pub const LOW_ENTROPY_SHANNON_THRESHOLD: f64 = 2.5;

/// Inputs evaluated by the canonical `BLOCK_GAMING_DETECTED` conjunction.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AntiGamingInputs {
    /// Semantic ELOC lines changed in candidate commit.
    pub changed_eloc: usize,
    /// Total semantic ELOC in modified files.
    pub total_eloc: usize,
    /// Net debt reduction (`before_debt_minutes - after_debt_minutes`).
    pub net_debt_eliminated: f64,
    /// Whether the commit/change claims a quality or score gain.
    pub claims_score_gain: bool,
    /// Accumulated gaming pattern penalty from static checks (e.g., tautologies, forwarders).
    pub pattern_penalty: f64,
    /// Minimum observed Shannon entropy among modified files over `LOW_ENTROPY_MIN_LINES`.
    pub min_large_file_entropy: Option<f64>,
}

/// Output verdict emitted by `evaluate_anti_gaming_conjunction`.
#[derive(Debug, Clone, PartialEq)]
pub struct AntiGamingVerdict {
    /// True when gaming behavior triggered the circuit breaker.
    pub is_gaming: bool,
    /// Canonical `BLOCK_GAMING_DETECTED` code when triggered.
    pub verdict_code: Option<&'static str>,
    /// Concise static trigger diagnostic without raw dumps.
    pub reason: Option<String>,
}

/// Computes Shannon information entropy H(X) in bits over non-whitespace byte distribution.
#[must_use]
pub fn compute_text_shannon_entropy(text: &str) -> f64 {
    let bytes = text.as_bytes();
    let mut freqs = [0_u64; 256];
    let mut total = 0_u64;
    let mut idx = 0;
    while idx < bytes.len() {
        let ch = bytes[idx];
        if !ch.is_ascii_whitespace() {
            freqs[ch as usize] += 1;
            total += 1;
        }
        idx += 1;
    }
    if total == 0 {
        return 0.0;
    }
    let total_f = total as f64;
    let mut entropy = 0.0_f64;
    let mut bucket = 0;
    while bucket < 256 {
        let count = freqs[bucket];
        if count > 0 {
            let prob = (count as f64) / total_f;
            entropy -= prob * prob.log2();
        }
        bucket += 1;
    }
    (entropy * 1000.0).round() / 1000.0
}

/// Evaluates `BLOCK_GAMING_DETECTED` across semantic ratio, net debt reduction, entropy, and pattern hits.
#[must_use]
pub fn evaluate_anti_gaming_conjunction(inputs: &AntiGamingInputs) -> AntiGamingVerdict {
    if inputs.claims_score_gain && inputs.total_eloc > 0 {
        let semantic_ratio = (inputs.changed_eloc as f64) / (inputs.total_eloc.max(1) as f64);
        if semantic_ratio <= SEMANTIC_CHANGE_RATIO_THRESHOLD && inputs.net_debt_eliminated <= 0.0 {
            return AntiGamingVerdict {
                is_gaming: true,
                verdict_code: Some(VERDICT_BLOCK_GAMING_DETECTED),
                reason: Some(format!(
                    "semantic change ratio {:.2}% <= 15.00% with {:.2} net debt eliminated",
                    semantic_ratio * 100.0,
                    inputs.net_debt_eliminated
                )),
            };
        }
    }
    if let Some(entropy) = inputs.min_large_file_entropy {
        if entropy < LOW_ENTROPY_SHANNON_THRESHOLD {
            return AntiGamingVerdict {
                is_gaming: true,
                verdict_code: Some(VERDICT_BLOCK_GAMING_DETECTED),
                reason: Some(format!(
                    "low Shannon entropy {entropy:.3} bits < {LOW_ENTROPY_SHANNON_THRESHOLD:.1} on >= {LOW_ENTROPY_MIN_LINES}-line file"
                )),
            };
        }
    }
    if inputs.pattern_penalty.is_finite() && inputs.pattern_penalty > 0.0 {
        return AntiGamingVerdict {
            is_gaming: true,
            verdict_code: Some(VERDICT_BLOCK_GAMING_DETECTED),
            reason: Some(format!(
                "gaming pattern penalty {:.1} raised (tautology/trampoline padding)",
                inputs.pattern_penalty
            )),
        };
    }
    AntiGamingVerdict {
        is_gaming: false,
        verdict_code: None,
        reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conjunctive_trivial_semantic_change_triggers_block() {
        let verdict = evaluate_anti_gaming_conjunction(&AntiGamingInputs {
            changed_eloc: 10,
            total_eloc: 100,
            net_debt_eliminated: 0.0,
            claims_score_gain: true,
            pattern_penalty: 0.0,
            min_large_file_entropy: None,
        });
        assert!(verdict.is_gaming);
        assert_eq!(verdict.verdict_code, Some(VERDICT_BLOCK_GAMING_DETECTED));
    }

    #[test]
    fn high_entropy_real_debt_cut_passes_cleanly() {
        let sample = "fn compute_hash(input: &[u8], seed: u64) -> u64 { input.iter().fold(seed, |acc, b| acc.wrapping_mul(16777619) ^ (*b as u64)) }";
        let entropy = compute_text_shannon_entropy(sample);
        assert!(entropy > 3.5);
        let verdict = evaluate_anti_gaming_conjunction(&AntiGamingInputs {
            changed_eloc: 45,
            total_eloc: 100,
            net_debt_eliminated: 12.0,
            claims_score_gain: true,
            pattern_penalty: 0.0,
            min_large_file_entropy: Some(entropy),
        });
        assert!(!verdict.is_gaming);
    }
}
