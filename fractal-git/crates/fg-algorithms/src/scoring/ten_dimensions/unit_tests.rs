//! Module: fg-algorithms — 10-Dimension Quality Scorer Unit Tests
//! File Path: crates/fg-algorithms/src/scoring/ten_dimensions/unit_tests.rs
//! Architecture Role: Unit tests asserting epistemic ceiling reserves, absolute security penalty
//!   curves, and grade transitions.

#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn clean_file_scores_below_100_epistemic_ceiling() {
        let complexities = [2.0, 3.0];
        let metric = FileMetricSummary {
            file: "src/clean.ts",
            lines: 120,
            non_blank_lines: 100,
            eloc: 95,
            max_nesting_depth: 2,
            exported_symbols: 4,
            function_complexities: &complexities,
        };
        let evaluated = evaluate_file_quality(
            &[],
            Some(&metric),
            ProjectArchetype::Library,
            &QualityCurveConfig::default(),
        );
        assert!(evaluated.composite_score > 98.0 && evaluated.composite_score < 100.0);
        assert_eq!(evaluated.grade, "A+");
    }

    #[test]
    fn security_finding_uses_absolute_track_and_drops_grade() {
        let complexities = [4.0];
        let metric = FileMetricSummary {
            file: "src/vuln.ts",
            lines: 100,
            non_blank_lines: 100,
            eloc: 90,
            max_nesting_depth: 2,
            exported_symbols: 2,
            function_complexities: &complexities,
        };
        let findings = [
            ScoringFinding {
                rule_id: "SEC-VUL-001",
                analyzer: "security",
                severity: FindingSeverity::Error,
                message: "eval call detected",
                line: 10,
            },
            ScoringFinding {
                rule_id: "HC-SECRET",
                analyzer: "secrets",
                severity: FindingSeverity::Error,
                message: "hardcoded secret",
                line: 15,
            },
        ];
        let evaluated = evaluate_file_quality(
            &findings,
            Some(&metric),
            ProjectArchetype::Web,
            &QualityCurveConfig::default(),
        );
        assert!(evaluated.indices[QualityDimension::CodeSecurity as usize] < 20.0);
        assert!(evaluated.composite_score < 85.0);
    }
}
