//! Module: fg-algorithms — SQALE, ADR-Q & CAI 2.0 Unit Tests
//! File Path: crates/fg-algorithms/src/scoring/quant_risk/unit_tests.rs
//! Architecture Role: Validates SQALE grade boundaries, ADR-Q dispersion/reversion indicators,
//!   and CAI 2.0 bounded autonomy computation.

#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::scoring::ten_dimensions::{FindingSeverity, ScoringFinding};

    #[test]
    fn sqale_grade_thresholds_match_ssot() {
        let clean = evaluate_technical_debt(&[], 500);
        assert_eq!(clean.sqale_grade, SqaleGrade::A);
        assert_eq!(clean.technical_debt_ratio, 0.0);

        let error_finding = [ScoringFinding {
            rule_id: "SEC-VUL-001",
            analyzer: "security",
            severity: FindingSeverity::Error,
            message: "eval",
            line: 1,
        }];
        let heavy = evaluate_technical_debt(&error_finding, 2);
        assert_eq!(heavy.total_remediation_minutes, 68.0);
        assert_eq!(heavy.sqale_grade, SqaleGrade::E);
    }

    #[test]
    fn adrq_and_cai_produce_bounded_quant_metrics() {
        let debts = [0.0, 10.0, 30.0, 5.0];
        let families = [3, 1, 2];
        let history = [82.0, 84.5, 86.0, 88.2];
        let complexities = [2.0, 3.0, 8.0, 4.0];
        let adrq = evaluate_adrq_risk(&AdrqInputs {
            file_debts: &debts,
            family_counts: &families,
            history_scores: &history,
            complexity_samples: &complexities,
            refactoring_yield_minutes: Some(40.0),
            debt_accrual_minutes: Some(15.0),
        });
        assert!(adrq.rcr > 2.0);
        assert!(adrq.dsi > 0.0 && adrq.dsi <= 1.0);
        assert!(adrq.rcd > 0.0 && adrq.rcd <= 1.0);

        let cai = evaluate_cai_autonomy_rate(&CaiInputs {
            proprietary_eloc: 4000,
            vendor_eloc: 0,
            generated_eloc: 100,
            domain_kernel_eloc: 2600,
            internal_calls: 95,
            external_calls: 5,
            external_packages: 2,
            critical_internal_calls: 20,
            critical_external_calls: 0,
            clone_findings: 0,
            dependency_count: 6,
        });
        assert!(cai > 0.85 && cai <= 1.0);
    }
}
