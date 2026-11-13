//! Module: fg-algorithms — 10-Dimension Finding Deduction & Tier Escalation Rules
//! File Path: crates/fg-algorithms/src/scoring/ten_dimensions/deductions.rs
//! Architecture Role: Maps security, architecture, performance, and rule-table findings onto the
//!   ten linear deduction accumulators plus tiered residual technical-debt scaling.
//! Dependencies & Triggers: Consumes `taxonomy` types; called per finding in `ten_dimensions`.
//! Responsibilities: Accumulate deterministic deduction points parity-aligned with TS engine.
//! Exit Semantics & Design Rationale: Bitmask prevents duplicate dimension double-charging before
//!   residual `TechDebtRisk` escalation runs.

use crate::scoring::ten_dimensions::taxonomy::{
    family_dimension_of, FindingSeverity, QualityDimension, ScoringFinding,
};

const TIER1_PREFIXES: &[&str] = &["SEC", "ARCH", "DEP-INV", "GUARD-DESTR"];
const TIER2_PREFIXES: &[&str] = &["CPX", "CMP", "DAT", "TST-DBT"];

/// Accumulates linear dimension deductions and tiered residual debt points for one finding.
pub(crate) fn accumulate_finding_deductions(
    finding: &ScoringFinding<'_>,
    linear_points: &mut [f64; 10],
) {
    let mut claimed_mask: u32 = 0;

    if let Some((dim, pts)) = match_security_deduction(finding) {
        claimed_mask |= 1 << (dim as usize);
        linear_points[dim as usize] += pts;
    }
    if let Some((primary_dim, pts, extra_sec)) = match_architecture_deduction(finding) {
        claimed_mask |= 1 << (primary_dim as usize);
        linear_points[primary_dim as usize] += pts;
        if let Some(sec_pts) = extra_sec {
            claimed_mask |= 1 << (QualityDimension::CodeSecurity as usize);
            linear_points[QualityDimension::CodeSecurity as usize] += sec_pts;
        }
    }
    if let Some((dim, pts)) = match_performance_deduction(finding) {
        claimed_mask |= 1 << (dim as usize);
        linear_points[dim as usize] += pts;
    }
    if let Some((dim, pts)) = match_rule_table_deduction(finding) {
        let bit = 1 << (dim as usize);
        if (claimed_mask & bit) == 0 {
            claimed_mask |= bit;
            linear_points[dim as usize] += pts;
        }
    }
    apply_severity_debt_fallback(finding, claimed_mask, linear_points);
}

fn match_security_deduction(finding: &ScoringFinding<'_>) -> Option<(QualityDimension, f64)> {
    let rule = finding.rule_id;
    let pts = match rule {
        "SEC-VUL-001" | "SEC-VUL-002" => 40.0,
        "SEC-VUL-003" => 35.0,
        "SEC-VUL-004" => 25.0,
        "SEC-VUL-005" | "SEC-LEAK-001" => 20.0,
        "SEC-VUL-006" => 30.0,
        "HC-SECRET" | "secret-detected" | "high-entropy-token" => 50.0,
        _ if finding.analyzer == "security" => 25.0,
        _ if finding.analyzer == "secrets" => 50.0,
        _ if rule.contains("eval") || rule.contains("unsafe") || rule.contains("sanitization") => {
            30.0
        }
        _ => return None,
    };
    Some((QualityDimension::CodeSecurity, pts))
}

fn match_architecture_deduction(
    finding: &ScoringFinding<'_>,
) -> Option<(QualityDimension, f64, Option<f64>)> {
    if finding.analyzer != "architecture" && finding.analyzer != "dependency-graph" {
        return None;
    }
    let rule = finding.rule_id;
    if rule == "ARCH-LEAK-002" {
        return Some((QualityDimension::ArchitectureConsistency, 30.0, Some(30.0)));
    }
    let is_boundary = matches!(
        rule,
        "ARCH-LEAK-001" | "ARCH-DIR-001" | "ARCH-DIR-002" | "ARCH-DIR-003" | "ARCH-BND-001"
    ) || rule.contains("layer")
        || rule.contains("boundary");
    let pts = if is_boundary {
        20.0
    } else if rule == "import-cycle" || rule.contains("cycle") || rule.contains("circular") {
        25.0
    } else {
        15.0
    };
    Some((QualityDimension::ArchitectureConsistency, pts, None))
}

fn match_performance_deduction(finding: &ScoringFinding<'_>) -> Option<(QualityDimension, f64)> {
    if finding.analyzer != "performance" {
        return None;
    }
    let rule = finding.rule_id;
    let pts = if rule == "PRF-MEM-001" || rule.contains("loop") || rule.contains("alloc") {
        15.0
    } else {
        10.0
    };
    Some((QualityDimension::PerformanceEfficiency, pts))
}

fn match_rule_table_deduction(finding: &ScoringFinding<'_>) -> Option<(QualityDimension, f64)> {
    let dim = family_dimension_of(finding.rule_id)?;
    let pts = match finding.rule_id {
        "ARCH-ABS-001" | "VOL-ELOC-001" | "VOL-LOC-001" | "large-file" | "high-complexity"
        | "CMT-TRM-001" | "FGT-GAT-001" | "GUARD-DESTR-001" => 15.0,
        "CPX-NEST-001" | "CPX-REC-001" | "TSM-ANY-001" | "TSM-VAR-001" | "RSM-UNWRAP-001"
        | "RSM-PNC-001" | "ERR-FLT-001" | "HC-ABS-PATH" => 10.0,
        "CMT-DOC-001" | "DOC-LNK-001" | "duplicate-literal" | "HYG-NAM-001" | "HYG-IND-001"
        | "HYG-EOL-001" | "HYG-BOM-001" | "HYG-EMP-001" | "RSM-SAF-001" | "SIM-ARGS-001"
        | "PRF-IO-001" => 8.0,
        "HC-MAGIC-NUM" => 4.0,
        _ => match finding.severity {
            FindingSeverity::Error => 15.0,
            FindingSeverity::Warning => 8.0,
            FindingSeverity::Info => 4.0,
        },
    };
    Some((dim, pts))
}

fn apply_severity_debt_fallback(
    finding: &ScoringFinding<'_>,
    claimed_mask: u32,
    linear_points: &mut [f64; 10],
) {
    let base_pts = match finding.severity {
        FindingSeverity::Error => 15.0,
        FindingSeverity::Warning => 5.0,
        FindingSeverity::Info => return,
    };
    let target_dim = if claimed_mask != 0 {
        QualityDimension::TechDebtRisk
    } else {
        family_dimension_of(finding.rule_id).unwrap_or(QualityDimension::TechDebtRisk)
    };
    let scale = if target_dim == QualityDimension::TechDebtRisk {
        classify_tier_penalty_scale(finding)
    } else {
        1.0
    };
    if scale > 0.0 {
        linear_points[target_dim as usize] += (base_pts * scale).round();
    }
}

fn classify_tier_penalty_scale(finding: &ScoringFinding<'_>) -> f64 {
    let rule = finding.rule_id;
    let is_tier1 = finding.severity == FindingSeverity::Error
        || finding.analyzer.contains("security")
        || rule.contains("LEAK")
        || rule.contains("CIRCULAR")
        || TIER1_PREFIXES.iter().any(|pfx| rule.starts_with(pfx));
    if is_tier1 {
        return 1.0;
    }
    let is_tier2 = finding.analyzer.contains("complexity")
        || finding.analyzer.contains("maintainability")
        || TIER2_PREFIXES.iter().any(|pfx| rule.starts_with(pfx));
    if is_tier2 {
        0.5
    } else {
        0.0
    }
}
