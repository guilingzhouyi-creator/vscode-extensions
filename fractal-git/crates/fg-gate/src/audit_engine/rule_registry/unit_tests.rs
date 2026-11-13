//! Module: fg-gate — Rule Registry & Path Exemption Unit Tests
//! File Path: crates/fg-gate/src/audit_engine/rule_registry/unit_tests.rs
//! Architecture Role: Verifies fail-closed SSOT rule closure and top-level/nested test exemptions.

#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn unregistered_rule_id_is_rejected_fail_closed() {
        let mut findings = Vec::new();
        let outcome = record_finding(
            &mut findings,
            "FAKE-RULE-999",
            "hygiene",
            AuditSeverity::Warning,
            "src/a.ts",
            1,
            String::from("must fail"),
        );
        assert!(outcome.is_err());
        assert!(findings.is_empty());
    }

    #[test]
    fn recognizes_top_level_and_nested_test_or_fixture_paths() {
        assert!(is_test_code_path("tests/rust/sample_test.rs"));
        assert!(is_test_code_path("tests/foo.ts"));
        assert!(is_test_code_path("crates/a/tests/helper.rs"));
        assert!(is_test_code_path("benches/perf.rs"));
        assert!(is_test_code_path("src/app.spec.ts"));
        assert!(is_test_code_path("tests.rs"));
        assert!(is_test_or_fixture_path("fixtures/mock.json"));
        assert!(is_test_or_fixture_path("docs/guide.md"));
        assert!(!is_test_code_path("src/test_runner.rs"));
        assert!(!is_test_or_fixture_path("src/engine.rs"));
        assert_eq!(SourceLanguage::detect("src/main.rs"), SourceLanguage::Rust);
        assert_eq!(SourceLanguage::detect("a.TSX"), SourceLanguage::TypeScript);
    }
}
