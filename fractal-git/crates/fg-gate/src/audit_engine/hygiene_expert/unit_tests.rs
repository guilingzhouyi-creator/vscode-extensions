//! Module: fg-gate — Hygiene Expert Unit Tests
//! File Path: crates/fg-gate/src/audit_engine/hygiene_expert/unit_tests.rs
//! Architecture Role: Verifies merge conflict, token leakage, fixture exemption, and EOL rules.

#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn detects_conflict_marker_and_secret() {
        let mut findings = Vec::new();
        let src = concat!("const tok = 'sk_", "live_abc123456789xyz';\n<<<<<<< HEAD\n");
        let slice = SnapshotFileSlice {
            rel_path: "src/app.ts",
            content: src.as_bytes(),
        };
        let measurement =
            inspect_file_hygiene(&slice, SourceLanguage::TypeScript, &mut findings).expect("scan");
        assert_eq!(measurement.lines, 2);
        assert!(findings.iter().any(|entry| entry.rule_id == "HC-SECRET"));
        assert!(findings.iter().any(|entry| entry.rule_id == "FGT-GAT-001"));
    }

    #[test]
    fn skips_volume_and_path_checks_on_fixture_while_enforcing_eol() {
        let mut findings = Vec::new();
        let src = concat!("const p = \"/Us", "ers/demo/project\";\r\n");
        let slice = SnapshotFileSlice {
            rel_path: "fixtures/sample.rs",
            content: src.as_bytes(),
        };
        inspect_file_hygiene(&slice, SourceLanguage::Rust, &mut findings).expect("scan fixture");
        assert!(!findings.iter().any(|entry| entry.rule_id == "HC-ABS-PATH"));
        assert!(findings.iter().any(|entry| entry.rule_id == "HYG-EOL-001"));
    }
}
