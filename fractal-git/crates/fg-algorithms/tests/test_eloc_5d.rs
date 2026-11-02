//! Integration and unit tests for 5D ELOC and density metrics.

use fg_algorithms::diff::{
    classify_line, evaluate_diff_5d_eloc, evaluate_file_5d_eloc, LineSemanticKind,
};

#[test]
fn test_pure_comments_produce_zero_eloc() {
    let code = "// Comment 1\n/* Block comment */\n/// Rustdoc line\n   \n";
    let metrics = evaluate_file_5d_eloc(code);
    assert_eq!(metrics.effective_lines_of_code, 0.0);
    assert_eq!(metrics.substance_preservation_ratio, 0.0);
    assert_eq!(metrics.eloc_5d, 0.0);
    assert_eq!(metrics.tspr, 0.0);
    assert_eq!(metrics.comment_lines, 3);
    assert_eq!(metrics.blank_lines, 1);
}

#[test]
fn test_substantive_code_metrics() {
    let code = "pub fn add(operand_a: i32, operand_b: i32) -> i32 {\n    operand_a + operand_b\n}\n";
    let metrics = evaluate_file_5d_eloc(code);
    assert_eq!(metrics.substantive_lines, 3);
    assert_eq!(metrics.effective_lines_of_code, 3.0);
    assert!(metrics.substance_preservation_ratio >= 0.75);
}

#[test]
fn test_diff_5d_turnover() {
    let added_lines = ["pub fn calculate() -> u32 {", "    42", "}"];
    let deleted_lines = ["// old comment", "pub fn old() {}"];
    let delta = evaluate_diff_5d_eloc(
        added_lines.iter().copied(),
        deleted_lines.iter().copied(),
    );
    assert_eq!(delta.physical_lines_added, 3);
    assert_eq!(delta.effective_lines_added, 3.0);
    assert_eq!(delta.effective_lines_deleted, 1.0);
    assert!(delta.net_turnover_weighted >= 3.8);
    assert_eq!(delta.phys_add, 3);
    assert_eq!(delta.eloc_5d_add, 3.0);
}

#[test]
fn test_line_semantic_classification() {
    assert_eq!(classify_line(""), LineSemanticKind::Blank);
    assert_eq!(classify_line("   "), LineSemanticKind::Blank);
    assert_eq!(classify_line("// comment"), LineSemanticKind::Comment);
    assert_eq!(classify_line("/// doc comment"), LineSemanticKind::DocComment);
    assert_eq!(classify_line("return self.inner.call();"), LineSemanticKind::Trampoline);
    assert_eq!(classify_line("{}"), LineSemanticKind::Trampoline);
    assert_eq!(classify_line("let a = 10;"), LineSemanticKind::Substantive);
}
