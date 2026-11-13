//! Module: fg-algorithms — Pure-Rust Objective Quality & Quantitative Risk Scoring
//! File Path: crates/fg-algorithms/src/scoring/mod.rs
//! Architecture Role: Facade bundling the 10-dimension dual-track scorer, SQALE + ADR-Q + CAI 2.0
//!   quantitative risk engine, Popoviciu polyglot balance model, and anti-gaming circuit breaker.
//! Dependencies & Triggers: Upstream of Taxis background audit runner and parity gates.
//! Responsibilities: Export cohesive pure mathematical quality evaluation operators.
//! Exit Semantics & Design Rationale: Zero I/O, zero panics, zero hot-loop heap allocations.

pub mod anti_gaming;
pub mod polyglot;
pub mod quant_risk;
pub mod ten_dimensions;

pub use anti_gaming::{
    compute_text_shannon_entropy, evaluate_anti_gaming_conjunction, AntiGamingInputs,
    AntiGamingVerdict, LOW_ENTROPY_MIN_LINES, LOW_ENTROPY_SHANNON_THRESHOLD,
    SEMANTIC_CHANGE_RATIO_THRESHOLD, VERDICT_BLOCK_GAMING_DETECTED,
};
pub use polyglot::{
    evaluate_polyglot_balance, LanguageStackMeasurement, PolyglotBalanceReport, StackLanguage,
};
pub use quant_risk::{
    build_quant_metrics_dto, evaluate_adrq_risk, evaluate_cai_autonomy_rate,
    evaluate_technical_debt, resolve_issue_remediation_minutes, AdrqInputs, AdrqRiskReport,
    CaiInputs, SqaleGrade, TechnicalDebtReport, DEFAULT_DEV_MINUTES_PER_ELOC,
};
pub use ten_dimensions::{
    apply_scale_damped_scores, calculate_confidence_from_volume, compute_composite_score,
    compute_dimension_ceiling, compute_epistemic_ceiling, compute_popoviciu_dispersion_penalty,
    compute_security_ceiling, evaluate_file_quality, evaluate_project_quality, family_dimension_of,
    resolve_quality_grade, sanitize_scale_factor, tune_archetype_weights, DimensionScaleMode,
    EpistemicCeilingConfig, EvaluatedQualityScore, FileMetricSummary, FindingSeverity,
    ProjectArchetype, QualityCurveConfig, QualityDimension, QualityWeightVector, ScoringFinding,
    SecurityCeilingConfig, CONFIDENCE_FLOOR, CONFIDENCE_LINE_CAP, CONFIDENCE_LINE_SCALE,
    DEFAULT_DISPERSION_PENALTY_RATIO, DEFAULT_SCALE_REFERENCE_LINES, DIMENSION_MAX_SCORE,
    MAX_EXPORTED_SYMBOLS, MAX_NESTING_DEPTH, MIN_EPISTEMIC_GAP, POPOVICIU_MAX_SIGMA,
    PROJECT_SCALE_FACTOR, SCORE_ROUNDING, THEORETICAL_SCORE_CEILING,
};
