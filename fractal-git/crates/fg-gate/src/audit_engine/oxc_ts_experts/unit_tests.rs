//! Module: fg-gate — Oxc TS/JS Expert Unit Tests
//! File Path: crates/fg-gate/src/audit_engine/oxc_ts_experts/unit_tests.rs
//! Architecture Role: Validates TS/JS security, complexity, nesting, modern syntax, and top-level
//!   test directory exemption rules over Oxc AST snapshots.

#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn oxc_detects_eval_var_any_and_empty_catch() {
        let ev = concat!("ev", "al(\"1+1\")");
        let code = format!(
            "export function runUnsafe(x: any) {{\n  var y = {ev};\n  try {{\n    return y + x;\n  }} catch (err) {{}}\n}}\n"
        );
        let slice = SnapshotFileSlice {
            rel_path: "src/unsafe_sample.ts",
            content: code.as_bytes(),
        };
        let analysis = analyze_typescript_ast(&slice).expect("oxc analyze");
        assert_eq!(analysis.exported_symbols, 1);
        assert!(analysis.findings.iter().any(|f| f.rule_id == "SEC-VUL-001"));
        assert!(analysis.findings.iter().any(|f| f.rule_id == "TSM-ANY-001"));
        assert!(analysis.findings.iter().any(|f| f.rule_id == "TSM-VAR-001"));
        assert!(analysis.findings.iter().any(|f| f.rule_id == "ERR-FLT-001"));
        assert!(analysis.findings.iter().any(|f| f.rule_id == "CMT-DOC-001"));
    }

    #[test]
    fn oxc_detects_deep_nesting_and_high_complexity() {
        let code = concat!(
            "/** Sample doc */\n",
            "export function deepBranch(a: boolean, b: boolean, c: boolean, d: boolean, e: boolean) {\n",
            "  if (a) { if (b) { if (c) { if (d) { if (e) { return 1; } } } } }\n",
            "  return 0;\n}\n"
        );
        let slice = SnapshotFileSlice { rel_path: "src/nested.ts", content: code.as_bytes() };
        let analysis = analyze_typescript_ast(&slice).expect("oxc analyze");
        assert!(analysis.max_nesting_depth >= 5);
        assert!(analysis.findings.iter().any(|f| f.rule_id == "CPX-NEST-001"));
        assert!(analysis.findings.iter().any(|f| f.rule_id == "SIM-ARGS-001"));
    }

    #[test]
    fn oxc_exempts_top_level_tests_dir_from_any_and_jsdoc_noise() {
        let code = b"export function helper(payload: any) {\n  return payload;\n}\n";
        let slice = SnapshotFileSlice { rel_path: "tests/foo.ts", content: code };
        let analysis = analyze_typescript_ast(&slice).expect("oxc test path");
        assert!(!analysis.findings.iter().any(|f| f.rule_id == "TSM-ANY-001"));
        assert!(!analysis.findings.iter().any(|f| f.rule_id == "CMT-DOC-001"));
    }
}
