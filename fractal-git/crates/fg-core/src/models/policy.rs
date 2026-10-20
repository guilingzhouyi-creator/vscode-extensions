//! Module: fg-core — Generalized VCS Governance Policy
//! File Path: crates/fg-core/src/models/policy.rs
//! Architecture Role: Generalized, declarative specification for commit message governance,
//!   decoupled from any specific repository workspace and configurable via presets or TOML.

use serde::{Deserialize, Serialize};

/// Mode of diff coherence validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiffCoherenceMode {
    /// Disabled: no diff-to-message cross-validation.
    Disabled,
    /// Warn: out-of-scope mutations produce warnings.
    Permissive,
    /// Strict: Rust-grade borrow check; out-of-scope mutations or empty commits fail compilation.
    Strict,
}

/// Generalized commit message and authority policy for Taxis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaxisPolicy {
    /// Policy identifier/name.
    pub name: String,
    /// Permitted Conventional Commit types (e.g. feat, fix, refactor, perf, etc.).
    pub allowed_types: Vec<String>,
    /// Minimum header length in characters (default: 5).
    pub min_header_chars: usize,
    /// Maximum header length in characters (default: 80).
    pub max_header_chars: usize,
    /// Disallow trailing period on header line (default: true).
    pub disallow_header_period: bool,
    /// Require an empty blank line between header and body (default: true).
    pub require_blank_line: bool,
    /// Minimum substantive body characters for production commits (default: 30).
    pub min_body_chars: usize,
    /// Types that trigger substantive body and structured section checks.
    pub production_types: Vec<String>,
    /// Required structured sections for production commits
    /// (e.g. ["Why", "Changed", "Verification"]).
    pub required_sections: Vec<String>,
    /// Whether a project identifier section is mandatory.
    pub require_project_tag: bool,
    /// Whitelist of allowed project names if project tag is required (empty = allow any).
    pub allowed_projects: Vec<String>,
    /// Forbidden terms or patterns (anti-slang, anti-hype).
    pub forbidden_terms: Vec<String>,
    /// Diff-to-claim semantic coherence verification mode.
    pub diff_coherence: DiffCoherenceMode,
    /// Disallow raw execution telemetry numbers (e.g. "15 tests passed", "0.04s")
    /// in verification section.
    pub qualitative_verification_only: bool,
    /// Enforce exclusive human control on System Trunk & Integration Trunk.
    pub human_controlled_trunks: bool,
    /// Dual-Trunk mode active: official commit count only counts system/integration merges.
    pub dual_trunk_enabled: bool,
    /// Whether promotions to System Trunk strictly require GUI UAC click authorization.
    pub uac_required_for_system_trunk: bool,
    /// Staged promotion lease time-to-live in seconds (default: 3600 = 1 hour).
    pub staged_promotion_ttl_seconds: u64,
    /// Required score delta to supersede an active staged promotion (default: 5.0).
    pub replacement_score_baseline_delta: f64,
    /// Minimum composite score required to enter the staged promotion queue (default: 80.0).
    pub minimum_promotion_score: f64,
}

impl Default for TaxisPolicy {
    fn default() -> Self {
        Self::rust_strict()
    }
}

impl TaxisPolicy {
    /// Rust-Grade Strict Policy: Complete compile-time type verification,
    /// qualitative verification only, diff-to-scope coherence checking, and human-only dual trunks.
    pub fn rust_strict() -> Self {
        Self {
            name: "rust-strict".into(),
            allowed_types: vec![
                "feat".into(),
                "fix".into(),
                "refactor".into(),
                "perf".into(),
                "docs".into(),
                "test".into(),
                "chore".into(),
                "style".into(),
            ],
            min_header_chars: 5,
            max_header_chars: 80,
            disallow_header_period: true,
            require_blank_line: true,
            min_body_chars: 30,
            production_types: vec![
                "feat".into(),
                "fix".into(),
                "refactor".into(),
                "perf".into(),
            ],
            required_sections: vec!["Why".into(), "Changed".into(), "Verification".into()],
            require_project_tag: false,
            allowed_projects: Vec::new(),
            forbidden_terms: vec![
                "wip".into(),
                "temp".into(),
                "tmp".into(),
                "quick fix".into(),
                "hack".into(),
                "placeholder".into(),
                "update code".into(),
                "fix bug".into(),
                "100% safe".into(),
                "flawless".into(),
                "perfect".into(),
                "never fails".into(),
                "zero bug".into(),
                "exit code 0".into(),
                "all tests passed".into(),
                "all tests green".into(),
            ],
            diff_coherence: DiffCoherenceMode::Strict,
            qualitative_verification_only: true,
            human_controlled_trunks: true,
            dual_trunk_enabled: true,
            uac_required_for_system_trunk: true,
            staged_promotion_ttl_seconds: 3600,
            replacement_score_baseline_delta: 5.0,
            minimum_promotion_score: 80.0,
        }
    }

    /// Conventional Semantic Policy: Standard Conventional Commits 2.0 without
    /// project or diff bounds.
    pub fn conventional_semantic() -> Self {
        Self {
            name: "conventional-semantic".into(),
            allowed_types: vec![
                "feat".into(),
                "fix".into(),
                "refactor".into(),
                "perf".into(),
                "docs".into(),
                "test".into(),
                "chore".into(),
                "style".into(),
                "build".into(),
                "ci".into(),
                "revert".into(),
            ],
            min_header_chars: 3,
            max_header_chars: 100,
            disallow_header_period: false,
            require_blank_line: true,
            min_body_chars: 10,
            production_types: vec!["feat".into(), "fix".into()],
            required_sections: Vec::new(),
            require_project_tag: false,
            allowed_projects: Vec::new(),
            forbidden_terms: vec!["wip".into(), "temp".into()],
            diff_coherence: DiffCoherenceMode::Permissive,
            qualitative_verification_only: false,
            human_controlled_trunks: true,
            dual_trunk_enabled: false,
            uac_required_for_system_trunk: true,
            staged_promotion_ttl_seconds: 3600,
            replacement_score_baseline_delta: 5.0,
            minimum_promotion_score: 70.0,
        }
    }

    /// Native Git Policy: 100% permissive fallback, accepting any commit message.
    pub fn git_native() -> Self {
        Self {
            name: "git-native".into(),
            allowed_types: Vec::new(),
            min_header_chars: 1,
            max_header_chars: 1000,
            disallow_header_period: false,
            require_blank_line: false,
            min_body_chars: 0,
            production_types: Vec::new(),
            required_sections: Vec::new(),
            require_project_tag: false,
            allowed_projects: Vec::new(),
            forbidden_terms: Vec::new(),
            diff_coherence: DiffCoherenceMode::Disabled,
            qualitative_verification_only: false,
            human_controlled_trunks: false,
            dual_trunk_enabled: false,
            uac_required_for_system_trunk: false,
            staged_promotion_ttl_seconds: 3600,
            replacement_score_baseline_delta: 0.0,
            minimum_promotion_score: 0.0,
        }
    }
}
