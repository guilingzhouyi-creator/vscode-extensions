//! Module: fg-gate — Polyglot Experts Unit Tests
//! File Path: crates/fg-gate/src/audit_engine/polyglot_experts/unit_tests.rs
//! Architecture Role: Verifies Rust `syn`, Python, and test-path exemption parity.
//! Dependencies & Triggers: Exercises [`analyze_polyglot_slice`] across multiple languages.
//! Responsibilities: Catch unwrap/panic/safety/eval/open issues and verify `tests/` exemption.
//! Exit Semantics & Design Rationale: Uses `concat!` for sensitive literals to avoid self-scan hits.

#[cfg(test)]
mod tests {
    use crate::audit_engine::rule_registry::SnapshotFileSlice;

    use super::super::*;

    #[test]
    fn rust_syn_detects_unwrap_panic_and_missing_safety() {
        let unsafe_kw = concat!("un", "safe");
        let unwrap_call = concat!("un", "wrap()");
        let code = format!(
            "pub fn bad(flag: bool) -> i32 {{\n    if flag {{\n        let val = Some(1).{unwrap_call};\n        return val;\n    }}\n    {unsafe_kw} {{\n        let ptr = &1 as *const i32;\n        *ptr\n    }}\n}}\n"
        );
        let slice = SnapshotFileSlice {
            rel_path: "crates/fg-demo/src/lib.rs",
            content: code.as_bytes(),
        };
        let report = analyze_polyglot_slice(&slice, SourceLanguage::Rust).expect("rust audit");
        assert_eq!(report.exported_symbols, 1);
        assert!(report
            .findings
            .iter()
            .any(|f| f.rule_id == "RSM-UNWRAP-001"));
        assert!(report.findings.iter().any(|f| f.rule_id == "RSM-SAF-001"));
        assert!(report.findings.iter().any(|f| f.rule_id == "CMT-DOC-001"));
    }

    #[test]
    fn python_and_shell_rules_catch_critical_defects() {
        let py_code = concat!(
            "ev",
            "al('1')\ntry:\n    open('x.txt')\nexcept:\n    pass\n"
        );
        let py_slice = SnapshotFileSlice {
            rel_path: "scripts/bad.py",
            content: py_code.as_bytes(),
        };
        let py = analyze_polyglot_slice(&py_slice, SourceLanguage::Python).expect("py");
        assert!(py.findings.iter().any(|f| f.rule_id == "SEC-VUL-001"));
        assert!(py.findings.iter().any(|f| f.rule_id == "ERR-FLT-001"));
        assert!(py.findings.iter().any(|f| f.rule_id == "PYM-OPEN-001"));
    }

    #[test]
    fn rust_syn_exempts_top_level_tests_dir_from_unwrap_panic_and_doc_noise() {
        let unwrap_call = concat!("un", "wrap()");
        let panic_macro = concat!("pan", "ic!");
        let code = format!(
            "pub fn sample_helper() -> i32 {{\n    let num = Some(7).{unwrap_call};\n    if num < 0 {{\n        {panic_macro}(\"unexpected\");\n    }}\n    num\n}}\n"
        );
        let slice = SnapshotFileSlice {
            rel_path: "tests/rust/sample_test.rs",
            content: code.as_bytes(),
        };
        let report = analyze_polyglot_slice(&slice, SourceLanguage::Rust).expect("rust test path");
        assert!(!report
            .findings
            .iter()
            .any(|f| f.rule_id == "RSM-UNWRAP-001"));
        assert!(!report.findings.iter().any(|f| f.rule_id == "RSM-PNC-001"));
        assert!(!report.findings.iter().any(|f| f.rule_id == "CMT-DOC-001"));
    }
}
