//! Module: fg-gate — Snapshot Audit Types & Language Classifier
//! File Path: crates/fg-gate/src/audit_engine/rule_registry/mod.rs
//! Architecture Role: Canonical finding, language, and per-file structural outcome types consumed
//!   across `audit_engine` and upstream snapshot evaluators.
//! Dependencies & Triggers: Pairs with `helpers` for test exemptions and SSOT rule validation.
//! Responsibilities: Classify source extensions deterministically and define shared DTO structs.
//! Exit Semantics & Design Rationale: Static lookup slice replaces chained `if` branches (`CC <= 3`).

mod helpers;
#[cfg(test)]
mod unit_tests;

pub use helpers::{
    build_registered_finding, is_test_code_path, is_test_or_fixture_path, record_finding,
    SnapshotFileSlice,
};

use serde::{Deserialize, Serialize};

/// Severity classification emitted by snapshot audit experts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuditSeverity {
    /// Blocking defect or invariant violation.
    Error,
    /// Non-blocking maintainability or hygiene issue.
    Warning,
    /// Informational observation.
    Info,
}

/// Static analysis finding bound strictly to a registered SSOT rule identifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditFinding {
    /// Registered rule identifier verified via `is_registered`.
    pub rule_id: String,
    /// Originating expert analyzer label (`"security"`, `"complexity"`, `"hygiene"`).
    pub analyzer: String,
    /// Severity classification.
    pub severity: AuditSeverity,
    /// Normalized slash-delimited workspace-relative path.
    pub file: String,
    /// 1-based line number where the finding starts.
    pub line: usize,
    /// Structured explanation without secret leaks or raw file dumps.
    pub message: String,
}

/// Normalized language classification for snapshot files.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceLanguage {
    /// TypeScript or JavaScript source (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`).
    TypeScript,
    /// Rust crate source (`.rs`).
    Rust,
    /// Python source (`.py`).
    Python,
    /// Godot GDScript (`.gd`).
    GdScript,
    /// PowerShell or POSIX Shell (`.ps1`, `.sh`, `.bash`, `.zsh`, `.psm1`, `.psd1`).
    Shell,
    /// Go source (`.go`).
    Go,
    /// Markdown, JSON, TOML, YAML, or generic UTF-8 asset.
    Other,
}

const EXT_LANGUAGE_TABLE: &[(&str, SourceLanguage)] = &[
    (".ts", SourceLanguage::TypeScript),
    (".tsx", SourceLanguage::TypeScript),
    (".js", SourceLanguage::TypeScript),
    (".jsx", SourceLanguage::TypeScript),
    (".mjs", SourceLanguage::TypeScript),
    (".cjs", SourceLanguage::TypeScript),
    (".rs", SourceLanguage::Rust),
    (".py", SourceLanguage::Python),
    (".gd", SourceLanguage::GdScript),
    (".ps1", SourceLanguage::Shell),
    (".psm1", SourceLanguage::Shell),
    (".psd1", SourceLanguage::Shell),
    (".sh", SourceLanguage::Shell),
    (".bash", SourceLanguage::Shell),
    (".zsh", SourceLanguage::Shell),
    (".go", SourceLanguage::Go),
];

impl SourceLanguage {
    /// Classifies a normalized repository path into a concrete ecosystem language.
    #[must_use]
    pub fn detect(rel_path: &str) -> Self {
        let Some(dot_idx) = rel_path.rfind('.') else {
            return Self::Other;
        };
        let suffix = &rel_path[dot_idx..];
        EXT_LANGUAGE_TABLE
            .iter()
            .find(|(ext, _)| suffix.eq_ignore_ascii_case(ext))
            .map_or(Self::Other, |(_, lang)| *lang)
    }
}

/// Complete per-file structural measurements and findings produced by snapshot experts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileAuditOutcome {
    /// Workspace-relative normalized path.
    pub file: String,
    /// Classified language family.
    pub language: SourceLanguage,
    /// Physical line count.
    pub lines: usize,
    /// Non-blank physical line count.
    pub non_blank_lines: usize,
    /// Effective semantic lines of code (non-blank, non-comment).
    pub eloc: usize,
    /// Maximum control-flow nesting depth observed.
    pub max_nesting_depth: usize,
    /// Number of exported public symbols declared by this file.
    pub exported_symbols: usize,
    /// Cyclomatic complexity for each function or method in the file.
    pub function_complexities: Vec<f64>,
    /// Internal relative import targets resolved inside the workspace.
    pub internal_imports: Vec<String>,
    /// External third-party package imports for CAI evaluation.
    pub external_packages: Vec<String>,
    /// Shannon entropy H(X) over non-whitespace characters.
    pub shannon_entropy: f64,
    /// Count of trivial one-line forwarding wrapper functions.
    pub trivial_forwarders: usize,
    /// All SSOT-verified findings detected in this file.
    pub findings: Vec<AuditFinding>,
}
