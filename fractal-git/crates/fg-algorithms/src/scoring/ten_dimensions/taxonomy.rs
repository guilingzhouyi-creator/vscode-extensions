//! Module: fg-algorithms — 10-Dimension Quality Taxonomy Core Types
//! File Path: crates/fg-algorithms/src/scoring/ten_dimensions/taxonomy.rs
//! Architecture Role: Canonical quality dimension enums, severity classifications, finding/metric
//!   DTOs, and balanced base weight vectors matching TypeScript SSOT definitions.
//! Dependencies & Triggers: Paired with `archetypes`; consumed across `ten_dimensions` & `quant_risk`.
//! Responsibilities: Define `QualityDimension`, `FindingSeverity`, `ScoringFinding`, and metric types.
//! Exit Semantics & Design Rationale: Stack-only copyable DTO slices with zero runtime allocations.

pub use super::archetypes::{family_dimension_of, tune_archetype_weights, ProjectArchetype};

/// Scale normalization mode for a quality dimension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DimensionScaleMode {
    /// Absolute subtractive penalty against ceiling (`codeSecurity`).
    Absolute,
    /// Hyperbolic density decay scaled by effective file scale.
    Density,
}

/// The ten canonical quality dimensions evaluated across workspaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum QualityDimension {
    /// Layer boundaries, dependency DAGs, DTO contracts, and modularity.
    ArchitectureConsistency = 0,
    /// Type safety, dead code, numeric bounds, and control purity.
    SemanticPurity = 1,
    /// Vulnerabilities, command injection, hardcoded secrets, and unsafe proofs.
    CodeSecurity = 2,
    /// Loop allocations, blocking sync I/O, and algorithmic complexity.
    PerformanceEfficiency = 3,
    /// Hygiene, lint, formatting, error contracts, and script parity.
    Standardization = 4,
    /// Modern language idioms, shim retirement, and test integrity.
    Modernity = 5,
    /// Cyclomatic complexity, nesting depth, and ELOC file volume budgets.
    Maintainability = 6,
    /// Rustdoc/JSDoc contracts, banner hygiene, and i18n parity.
    CommentQuality = 7,
    /// Clones, duplicate literals, magic numbers, and constant extraction.
    Duplication = 8,
    /// Tiered residual technical debt severity escalation axis.
    TechDebtRisk = 9,
}

impl QualityDimension {
    /// Returns all ten quality dimensions in canonical SSOT order.
    #[must_use]
    pub const fn all() -> [Self; 10] {
        [
            Self::ArchitectureConsistency,
            Self::SemanticPurity,
            Self::CodeSecurity,
            Self::PerformanceEfficiency,
            Self::Standardization,
            Self::Modernity,
            Self::Maintainability,
            Self::CommentQuality,
            Self::Duplication,
            Self::TechDebtRisk,
        ]
    }

    /// Returns the scale mode (`Absolute` for security, `Density` for others).
    #[must_use]
    pub const fn scale_mode(self) -> DimensionScaleMode {
        match self {
            Self::CodeSecurity => DimensionScaleMode::Absolute,
            _ => DimensionScaleMode::Density,
        }
    }
}

/// Severity classification matching TS `Severity`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FindingSeverity {
    /// Blocking error finding.
    Error,
    /// Non-blocking warning finding.
    Warning,
    /// Informational suggestion finding.
    Info,
}

/// Static analysis finding consumed by the 10-dimension and SQALE scorers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScoringFinding<'a> {
    /// Registered rule identifier (e.g., `SEC-VUL-001`, `CPX-NEST-001`).
    pub rule_id: &'a str,
    /// Analyzer identifier (e.g., `security`, `complexity`, `hygiene`).
    pub analyzer: &'a str,
    /// Finding severity.
    pub severity: FindingSeverity,
    /// Diagnostic summary message.
    pub message: &'a str,
    /// Optional 1-based start line.
    pub line: usize,
}

/// Lexical and structural metrics for one scanned file.
#[derive(Debug, Clone, PartialEq)]
pub struct FileMetricSummary<'a> {
    /// Normalized workspace-relative path using `/` separators.
    pub file: &'a str,
    /// Physical line count.
    pub lines: usize,
    /// Non-blank line count.
    pub non_blank_lines: usize,
    /// Effective semantic LOC count.
    pub eloc: usize,
    /// Maximum observed control-flow nesting depth.
    pub max_nesting_depth: usize,
    /// Exported public symbol count.
    pub exported_symbols: usize,
    /// Function cyclomatic complexities extracted from the file.
    pub function_complexities: &'a [f64],
}

/// Weight array ordered identically to `QualityDimension::all()`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QualityWeightVector {
    /// Weights indexed by `QualityDimension as usize`.
    pub values: [f64; 10],
}

impl Default for QualityWeightVector {
    fn default() -> Self {
        Self {
            values: [
                0.111, 0.093, 0.139, 0.102, 0.083, 0.074, 0.111, 0.074, 0.093, 0.120,
            ],
        }
    }
}
