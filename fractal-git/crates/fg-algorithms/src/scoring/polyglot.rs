//! Module: fg-algorithms — Polyglot Generalization Balance Evaluator
//! File Path: crates/fg-algorithms/src/scoring/polyglot.rs
//! Architecture Role: Pure-Rust multi-language equilibrium model weighting measured stacks via
//!   smooth logarithmic weights `w_i = ln(LOC_i + 10)` and applying Popoviciu variance
//!   dispersion damping (`sigma_max = 50.0`, `gamma = 0.5`).
//! Dependencies & Triggers: Shares Popoviciu constants with `ten_dimensions`.
//! Responsibilities: Classify languages by extension, accumulate file counts/LOC, and compute
//!   balanced polyglot generalization indices.
//! Exit Semantics & Design Rationale: Matches `scripts/common/evaluate-polyglot-balance.js`
//!   and `calculatePolyglotGeneralizationIndex` in `modernization-metrics.ts`.

use crate::scoring::ten_dimensions::{
    compute_popoviciu_dispersion_penalty, DEFAULT_DISPERSION_PENALTY_RATIO,
};

/// Language ecosystems tracked by the monorepo polyglot balance metric.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StackLanguage {
    /// TypeScript / JavaScript modules (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`).
    TypeScript = 0,
    /// GDScript modules (`.gd`).
    GdScript = 1,
    /// Python modules (`.py`).
    Python = 2,
    /// PowerShell / POSIX shell scripts (`.ps1`, `.sh`, etc.).
    Shell = 3,
    /// Rust crates (`.rs`).
    Rust = 4,
    /// Go modules (`.go`).
    Go = 5,
}

const EXT_LANGUAGE_MAP: &[(&str, StackLanguage)] = &[
    (".ts", StackLanguage::TypeScript),
    (".tsx", StackLanguage::TypeScript),
    (".js", StackLanguage::TypeScript),
    (".jsx", StackLanguage::TypeScript),
    (".mjs", StackLanguage::TypeScript),
    (".cjs", StackLanguage::TypeScript),
    (".gd", StackLanguage::GdScript),
    (".py", StackLanguage::Python),
    (".ps1", StackLanguage::Shell),
    (".psm1", StackLanguage::Shell),
    (".psd1", StackLanguage::Shell),
    (".sh", StackLanguage::Shell),
    (".bash", StackLanguage::Shell),
    (".zsh", StackLanguage::Shell),
    (".rs", StackLanguage::Rust),
    (".go", StackLanguage::Go),
];

impl StackLanguage {
    /// Classifies a normalized repository path into a tracked language stack.
    #[must_use]
    pub fn from_path(rel_path: &str) -> Option<Self> {
        let dot = rel_path.rfind('.')?;
        let ext = &rel_path[dot..];
        EXT_LANGUAGE_MAP
            .iter()
            .find(|(suffix, _)| ext.eq_ignore_ascii_case(suffix))
            .map(|(_, lang)| *lang)
    }

    /// Canonical kebab/lowercase name for diagnostics.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::GdScript => "gdscript",
            Self::Python => "python",
            Self::Shell => "shell",
            Self::Rust => "rust",
            Self::Go => "go",
        }
    }
}

/// Measured volume and mean composite quality score for a single language stack.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LanguageStackMeasurement {
    /// Target language ecosystem.
    pub language: StackLanguage,
    /// Measured file count in snapshot.
    pub file_count: usize,
    /// Total physical line count in snapshot.
    pub total_loc: usize,
    /// Mean quality score in `[0.0, 100.0]`.
    pub mean_score: f64,
}

/// Equilibrium output across measured active language stacks.
#[derive(Debug, Clone, PartialEq)]
pub struct PolyglotBalanceReport {
    /// Final dispersion-damped polyglot generalization index `[0.0, 100.0]`.
    pub polyglot_index: f64,
    /// LOC-log-weighted mean score across languages.
    pub weighted_mean: f64,
    /// Weighted standard deviation across language stacks.
    pub standard_deviation: f64,
    /// Popoviciu damping multiplier in `[0.0, 1.0]`.
    pub dispersion_penalty: f64,
    /// Number of distinct active languages evaluated.
    pub active_languages: usize,
}

/// Computes `polyglotIndex` using `w_i = ln(LOC_i + 10)` and Popoviciu dispersion damping.
#[must_use]
pub fn evaluate_polyglot_balance(stacks: &[LanguageStackMeasurement]) -> PolyglotBalanceReport {
    let mut active_weights = [0.0_f64; 6];
    let mut active_scores = [0.0_f64; 6];
    let mut active_count = 0usize;
    let mut weight_sum = 0.0_f64;

    let mut idx = 0;
    while idx < stacks.len() {
        let stack = &stacks[idx];
        if stack.file_count > 0 && stack.mean_score.is_finite() {
            let slot = stack.language as usize;
            let weight = ((stack.total_loc as f64) + 10.0).ln();
            active_weights[slot] = weight;
            active_scores[slot] = stack.mean_score.clamp(0.0, 100.0);
            weight_sum += weight;
            active_count += 1;
        }
        idx += 1;
    }

    if active_count == 0 || weight_sum <= 0.0 {
        return PolyglotBalanceReport {
            polyglot_index: 0.0,
            weighted_mean: 0.0,
            standard_deviation: 0.0,
            dispersion_penalty: 1.0,
            active_languages: 0,
        };
    }

    let mut weighted_score_sum = 0.0_f64;
    idx = 0;
    while idx < 6 {
        if active_weights[idx] > 0.0 {
            weighted_score_sum += active_weights[idx] * active_scores[idx];
        }
        idx += 1;
    }
    let weighted_mean = weighted_score_sum / weight_sum;
    let mut weighted_variance_sum = 0.0_f64;
    idx = 0;
    while idx < 6 {
        if active_weights[idx] > 0.0 {
            let diff = active_scores[idx] - weighted_mean;
            weighted_variance_sum += active_weights[idx] * diff * diff;
        }
        idx += 1;
    }
    let std_dev = (weighted_variance_sum / weight_sum).max(0.0).sqrt();
    let penalty = compute_popoviciu_dispersion_penalty(std_dev, DEFAULT_DISPERSION_PENALTY_RATIO);
    let polyglot_index = ((weighted_mean * penalty) * 100.0).round() / 100.0;

    PolyglotBalanceReport {
        polyglot_index: polyglot_index.clamp(0.0, 100.0),
        weighted_mean: (weighted_mean * 100.0).round() / 100.0,
        standard_deviation: (std_dev * 100.0).round() / 100.0,
        dispersion_penalty: penalty,
        active_languages: active_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bimodal_language_scores_incur_popoviciu_damping() {
        let stacks = [
            LanguageStackMeasurement {
                language: StackLanguage::TypeScript,
                file_count: 10,
                total_loc: 2000,
                mean_score: 96.0,
            },
            LanguageStackMeasurement {
                language: StackLanguage::Shell,
                file_count: 5,
                total_loc: 500,
                mean_score: 40.0,
            },
        ];
        let report = evaluate_polyglot_balance(&stacks);
        assert_eq!(report.active_languages, 2);
        assert!(report.dispersion_penalty < 0.85);
        assert!(report.polyglot_index < report.weighted_mean);
    }
}
