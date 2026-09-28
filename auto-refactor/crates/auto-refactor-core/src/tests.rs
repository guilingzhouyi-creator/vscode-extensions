//! Unit tests for the N-API exposure layer.
//!
//! This crate is the only place the Rust/JavaScript boundary is shaped, and it was excluded
//! from both `cargo clippy` and `cargo test` in the `gate:rust` script, so it carried no
//! coverage at all. That exclusion is not theoretical: the JS bridge called `maskSourceCode`
//! with a single argument while this binding takes two, and every native masking call threw
//! at runtime. Nothing in the workspace noticed, because the parity suite that would have
//! caught it was itself dead code.
//!
//! These tests pin the conversions this crate owns — argument shapes, optional-field
//! defaults, and the DTO mapping — rather than re-testing the operator libraries, which have
//! their own coverage in `ops-*`.

use std::collections::HashMap;

use super::*;

/// Masking profile matching the JS shim's TypeScript defaults.
fn ts_config() -> NativeMaskConfig {
    NativeMaskConfig {
        line_comment: "//".to_string(),
        block_comment_open: Some("/*".to_string()),
        block_comment_close: Some("*/".to_string()),
        quote_chars: "\"'`".to_string(),
        multiline_templates: Some(true),
        regex_literals: Some(false),
    }
}

#[test]
fn mask_config_requires_both_block_comment_delimiters() {
    assert!(ops_mask::MaskConfig::from(ts_config())
        .block_comment
        .is_some());

    let half = NativeMaskConfig {
        block_comment_close: None,
        ..ts_config()
    };
    assert!(
        ops_mask::MaskConfig::from(half).block_comment.is_none(),
        "a half-specified block comment must not produce a broken delimiter pair"
    );

    let empty = NativeMaskConfig {
        block_comment_open: Some(String::new()),
        ..ts_config()
    };
    assert!(ops_mask::MaskConfig::from(empty).block_comment.is_none());
}

#[test]
fn mask_config_defaults_optional_flags_to_false() {
    let cfg = NativeMaskConfig {
        multiline_templates: None,
        regex_literals: None,
        ..ts_config()
    };
    let converted = ops_mask::MaskConfig::from(cfg);
    assert!(!converted.multiline_templates);
    assert!(!converted.regex_literals);
}

#[test]
fn mask_source_code_masks_comments_and_string_literals() {
    let src = "const a = 1; // trailing\nconst b = \"text\";";
    let out = mask_source_code(src.to_string(), ts_config());
    assert_eq!(out.lines, 2);
    assert_eq!(out.raw.len(), 2);
    assert_eq!(out.masked.len(), 2);
    assert!(
        !out.masked[0].contains("trailing"),
        "comment bodies must not survive into the masked view"
    );
    // Literals are blanked, not preserved: the masked view exists so analyzers cannot match
    // keywords inside string content. The unmasked form stays available in `raw`.
    assert!(
        !out.masked[1].contains("text"),
        "string literal bodies must be blanked in the masked view"
    );
    assert!(
        out.raw[1].contains("text"),
        "the raw view must still carry the original literal"
    );
}

#[test]
fn mask_source_code_keeps_crlf_line_count_consistent_with_the_shim() {
    // Splitting on '\n' leaves a trailing empty line, and the JS shim behaves the same way;
    // the parity suite is what pins the two together, so this test asserts the shared shape
    // rather than a number chosen here.
    let out = mask_source_code("const a = 1;\r\nconst b = 2;\r\n".to_string(), ts_config());
    assert_eq!(out.raw.len(), 3);
    assert_eq!(out.masked.len(), 3);
    assert_eq!(out.non_blank_lines, 2);
    assert_eq!(out.masked[0], "const a = 1;");
}

#[test]
fn histogram_diff_of_identical_content_is_empty() {
    assert!(compute_histogram_diff("a\nb\n".to_string(), "a\nb\n".to_string()).is_empty());
}

#[test]
fn histogram_diff_reports_the_changed_line() {
    let hunks = compute_histogram_diff("a\nb\nc\n".to_string(), "a\nB\nc\n".to_string());
    assert_eq!(hunks.len(), 1);
    assert!(hunks[0].lines.iter().any(|l| l == "-b"));
    assert!(hunks[0].lines.iter().any(|l| l == "+B"));
}

#[test]
fn dependency_graph_detects_a_cycle() {
    let edges = vec![
        vec!["a".to_string(), "b".to_string()],
        vec!["b".to_string(), "a".to_string()],
    ];
    let analysis = analyze_dependency_graph(edges);
    assert!(!analysis.is_acyclic);
    assert_eq!(analysis.cycles.len(), 1);
}

#[test]
fn dependency_graph_reports_an_acyclic_order() {
    let edges = vec![
        vec!["a".to_string(), "b".to_string()],
        vec!["b".to_string(), "c".to_string()],
    ];
    let analysis = analyze_dependency_graph(edges);
    assert!(analysis.is_acyclic);
    let pos = |node: &str| {
        analysis
            .topological_order
            .iter()
            .position(|n| n == node)
            .expect("node present in topological order")
    };
    assert!(pos("a") < pos("b") && pos("b") < pos("c"));
}

#[test]
fn pattern_match_reports_position_and_text() {
    let matches = fast_pattern_match("const alpha = 1;".to_string(), vec!["alpha".to_string()]);
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].pattern, "alpha");
    assert_eq!(matches[0].line, 1);
    assert_eq!(matches[0].match_text, "alpha");
}

#[test]
fn dataflow_defaults_to_forward_when_unspecified() {
    let nodes = vec!["a".to_string(), "b".to_string()];
    let edges = vec![vec!["a".to_string(), "b".to_string()]];
    let mut gen = HashMap::new();
    gen.insert("a".to_string(), vec!["seed".to_string()]);

    let out = solve_dataflow(
        "a".to_string(),
        nodes,
        edges,
        None,
        Some(gen),
        Some(HashMap::new()),
    );
    assert_eq!(out.in_sets.get("a").cloned(), Some(Vec::new()));
    assert_eq!(
        out.out_sets.get("b").cloned(),
        Some(vec!["seed".to_string()])
    );
}

#[test]
fn dataflow_propagates_backward_when_requested() {
    let nodes = vec!["a".to_string(), "b".to_string()];
    let edges = vec![vec!["a".to_string(), "b".to_string()]];
    let mut gen = HashMap::new();
    gen.insert("b".to_string(), vec!["seed".to_string()]);

    let out = solve_dataflow(
        "a".to_string(),
        nodes,
        edges,
        Some(false),
        Some(gen),
        Some(HashMap::new()),
    );
    // Backward analysis seeds at the entry and flows against the edge direction.
    assert_eq!(
        out.in_sets.get("a").cloned(),
        Some(vec!["seed".to_string()])
    );
}

#[test]
fn minhash_signature_has_the_requested_length() {
    let sig = compute_minhash("function f() { return 1; }".to_string(), Some(64));
    assert_eq!(sig.len(), 64);
}

#[test]
fn dominator_tree_resolves_a_diamond() {
    // a -> b, a -> c, b -> d, c -> d: d's immediate dominator is a, not b or c.
    let nodes: Vec<String> = ["a", "b", "c", "d"].iter().map(|s| s.to_string()).collect();
    let edges = vec![
        vec!["a".to_string(), "b".to_string()],
        vec!["a".to_string(), "c".to_string()],
        vec!["b".to_string(), "d".to_string()],
        vec!["c".to_string(), "d".to_string()],
    ];
    let tree = compute_dominator_tree("a".to_string(), nodes, edges);
    assert_eq!(tree.idom.get("d").map(String::as_str), Some("a"));
}
