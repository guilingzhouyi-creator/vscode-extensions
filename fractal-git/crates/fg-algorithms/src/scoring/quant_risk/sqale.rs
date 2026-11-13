//! Module: fg-algorithms — SQALE Remediation Effort & Debt Ratio
//! File Path: crates/fg-algorithms/src/scoring/quant_risk/sqale.rs
//! Architecture Role: Pure-Rust SQALE technical debt ratio (`TDR`) and remediation minute ledger
//!   driven by static prefix lookup tables aligned with TS `technical-debt-ratio.ts`.
//! Dependencies & Triggers: Uses `crate::scoring::ten_dimensions::{FindingSeverity, ScoringFinding}`.
//! Responsibilities: Compute per-finding remediation effort, high-debt minutes, and `A..E` grade.
//! Exit Semantics & Design Rationale: Zero allocations and deterministic IEEE-754 arithmetic.

use crate::scoring::ten_dimensions::{FindingSeverity, ScoringFinding};

/// Default full-lifecycle engineering baseline minutes per effective line of code.
pub const DEFAULT_DEV_MINUTES_PER_ELOC: f64 = 30.0;

const FAMILY_EFFORT_PREFIXES: &[(&str, f64)] = &[
    ("SEC-", 45.0),
    ("HC-SECRET", 45.0),
    ("ARCH-", 35.0),
    ("FGT-DEP", 35.0),
    ("FGT-TOP", 35.0),
    ("CPX-", 20.0),
    ("PRF-", 20.0),
    ("FGT-PRF", 20.0),
    ("GOV-", 15.0),
    ("GUARD-", 15.0),
    ("FGT-", 15.0),
    ("SIM-", 12.0),
    ("ERR-", 12.0),
    ("MOD-", 10.0),
    ("TSM-", 10.0),
    ("RSM-", 10.0),
    ("PYM-", 10.0),
    ("HYG-", 5.0),
    ("CMT-", 5.0),
    ("DOC-", 5.0),
    ("NAM-", 3.0),
];

/// SQALE debt letter rating ordered from lowest (`A`) to highest (`E`) burden.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqaleGrade {
    A,
    B,
    C,
    D,
    E,
}

impl SqaleGrade {
    /// Returns canonical uppercase letter (`"A"`..`"E"`).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::B => "B",
            Self::C => "C",
            Self::D => "D",
            Self::E => "E",
        }
    }

    fn from_tdr(tdr: f64) -> Self {
        if !tdr.is_finite() || tdr <= 0.05 {
            Self::A
        } else if tdr <= 0.10 {
            Self::B
        } else if tdr <= 0.20 {
            Self::C
        } else if tdr <= 0.50 {
            Self::D
        } else {
            Self::E
        }
    }
}

/// SQALE technical debt evaluation summary matching `TechnicalDebtAssessment`.
#[derive(Debug, Clone, PartialEq)]
pub struct TechnicalDebtReport {
    pub total_remediation_minutes: f64,
    pub total_remediation_hours: f64,
    pub total_remediation_days: f64,
    pub development_cost_minutes: f64,
    pub technical_debt_ratio: f64,
    pub sqale_grade: SqaleGrade,
    pub high_debt_remediation_minutes: f64,
}

/// Resolves remediation effort in minutes for one finding using TS rule-family table.
#[must_use]
pub fn resolve_issue_remediation_minutes(finding: &ScoringFinding<'_>) -> f64 {
    let family_minutes = FAMILY_EFFORT_PREFIXES
        .iter()
        .find(|(pfx, _)| finding.rule_id.starts_with(pfx))
        .map(|(_, mins)| *mins);
    if let Some(base) = family_minutes {
        return match finding.severity {
            FindingSeverity::Error => (base * 1.5).round(),
            FindingSeverity::Info => (base * 0.4).round().max(2.0),
            FindingSeverity::Warning => base,
        };
    }
    match finding.severity {
        FindingSeverity::Error => 30.0,
        FindingSeverity::Warning => 10.0,
        FindingSeverity::Info => 3.0,
    }
}

/// Evaluates SQALE technical debt ratio and rating over a set of findings and total ELOC.
#[must_use]
pub fn evaluate_technical_debt(
    findings: &[ScoringFinding<'_>],
    total_eloc: usize,
) -> TechnicalDebtReport {
    let mut total_minutes = 0.0_f64;
    let mut high_minutes = 0.0_f64;
    for finding in findings {
        let mins = resolve_issue_remediation_minutes(finding);
        total_minutes += mins;
        let is_high = matches!(finding.severity, FindingSeverity::Error)
            || (matches!(finding.severity, FindingSeverity::Warning) && mins >= 20.0);
        if is_high {
            high_minutes += mins;
        }
    }
    let dev_cost = (total_eloc.max(1) as f64) * DEFAULT_DEV_MINUTES_PER_ELOC;
    let tdr = ((total_minutes / dev_cost) * 10_000.0).round() / 10_000.0;
    let hours = ((total_minutes / 60.0) * 100.0).round() / 100.0;
    let days = ((hours / 8.0) * 100.0).round() / 100.0;

    TechnicalDebtReport {
        total_remediation_minutes: total_minutes,
        total_remediation_hours: hours,
        total_remediation_days: days,
        development_cost_minutes: dev_cost,
        technical_debt_ratio: tdr,
        sqale_grade: SqaleGrade::from_tdr(tdr),
        high_debt_remediation_minutes: high_minutes,
    }
}
