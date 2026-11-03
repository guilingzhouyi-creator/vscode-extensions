//! Test Suite: Declaration Anchor Extraction and Matching
//! File Path: tests/rust/test_declaration_anchor.rs
//!
//! The anchor check is only honest if it can tell a real declaration from prose. These tests pin
//! the extraction patterns and the intersection rule in both directions: a symbol the diff
//! introduced must be recognized however the author quotes it, and text that names nothing must
//! never satisfy the check.

use fg_gate::commit_guard::declaration::{
    extract_candidate_symbols, extract_candidate_symbols_from_lines, extract_citations, has_anchor,
};

#[test]
fn rust_declarations_are_extracted_from_added_lines() {
    let diff = "--- a/guard.rs\n+++ b/guard.rs\n+pub fn resolve_commit_slot() -> u8 { 0 }\n+pub struct SectionScan {}\n+const MAX_DEPTH: usize = 4;\n-removed_fn_call();\n";
    let symbols = extract_candidate_symbols(diff);
    let names: Vec<&str> = symbols.iter().map(|symbol| symbol.name.as_str()).collect();
    assert!(
        names.contains(&"resolve_commit_slot"),
        "a function declaration must be extracted: {names:?}"
    );
    assert!(
        names.contains(&"SectionScan"),
        "a struct declaration must be extracted: {names:?}"
    );
    assert!(
        !names.contains(&"removed_fn_call"),
        "a removed line must not contribute a symbol: {names:?}"
    );
}

#[test]
fn typescript_and_gdscript_declarations_are_extracted() {
    let lines = [
        "export function verifyPreReviewZone(files: StagedFileEntry[]) {",
        "class FractalGitEngine {",
        "func apply_snapshot(snapshot: Dictionary) -> void:",
        "class_name GameConfig",
    ];
    let symbols = extract_candidate_symbols_from_lines(&lines);
    let names: Vec<&str> = symbols.iter().map(|symbol| symbol.name.as_str()).collect();
    for expected in [
        "verifyPreReviewZone",
        "FractalGitEngine",
        "apply_snapshot",
        "GameConfig",
    ] {
        assert!(
            names.contains(&expected),
            "'{expected}' must be extracted: {names:?}"
        );
    }
}

#[test]
fn backticked_citations_are_extracted() {
    let verification = "- 断言 `resolve_commit_slot` 在缺字段时返回错误，并复核 `SectionScan::parse`。";
    let citations = extract_citations(verification);
    assert!(
        citations.iter().any(|value| value == "resolve_commit_slot"),
        "a backticked identifier must be captured: {citations:?}"
    );
    assert!(
        citations.iter().any(|value| value.contains("SectionScan")),
        "a qualified identifier must be captured: {citations:?}"
    );
}

#[test]
fn bare_command_is_not_treated_as_a_citation() {
    let verification = "- `cargo test --workspace`";
    let citations = extract_citations(verification);
    assert!(
        citations.is_empty(),
        "a command line is not an identifier: {citations:?}"
    );
}

#[test]
fn anchor_matches_backticked_symbol() {
    let candidates = extract_candidate_symbols_from_lines(&["pub fn resolve_commit_slot() {}"]);
    let verification = "- 断言 `resolve_commit_slot` 返回明确错误。";
    assert!(
        has_anchor(verification, &candidates),
        "a backticked symbol must satisfy the anchor"
    );
}

#[test]
fn anchor_matches_plain_mention() {
    let candidates = extract_candidate_symbols_from_lines(&["pub fn resolve_commit_slot() {}"]);
    let verification = "- 断言 resolve_commit_slot 在缺字段时返回明确错误。";
    assert!(
        has_anchor(verification, &candidates),
        "a plain mention of a real symbol must satisfy the anchor"
    );
}

#[test]
fn anchor_rejects_prose_that_names_nothing() {
    let candidates = extract_candidate_symbols_from_lines(&["pub fn resolve_commit_slot() {}"]);
    let verification = "- 断言解析结果与预期一致且无回归。";
    assert!(
        !has_anchor(verification, &candidates),
        "prose naming no symbol must not satisfy the anchor"
    );
}

#[test]
fn anchor_is_impossible_without_candidates() {
    let verification = "- 断言 `anything` 返回明确错误。";
    assert!(
        !has_anchor(verification, &[]),
        "with no candidate symbols the check must report no anchor rather than pass vacuously"
    );
}

#[test]
fn path_fragment_alone_is_not_an_anchor() {
    let candidates = extract_candidate_symbols_from_lines(&["pub fn resolve_commit_slot() {}"]);
    let verification = "- 断言 crates/fg-gate/src/commit_guard.rs 中的改动正确。";
    assert!(
        !has_anchor(verification, &candidates),
        "naming a directory or file is not evidence of a demonstrated behaviour"
    );
}
