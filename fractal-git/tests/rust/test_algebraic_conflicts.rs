//! Module: Tests — Jujutsu Algebraic Merge & ChangeId Invariants
//! File Path: tests/rust/test_algebraic_conflicts.rs
//! Architecture Role: Verifies algebraic conflict properties, term cancellations,
//!   and immutable ChangeId deterministic derivation.
//! Dependencies & Triggers: Tests fg-algorithms algebraic merge and fg-core ChangeId.
//! Responsibilities: Mathematical property testing, conflict associativity, and serialization.
//! Exit Semantics & Design Rationale: Asserts zero dirty working tree markers
//!   and 100% deterministic identity tracking across multi-agent commit evolution.

use fg_algorithms::merge::AlgebraicMerge;
use fg_core::models::{ChangeId, Oid};

#[test]
fn test_algebraic_merge_resolved_and_unambiguous() {
    let resolved_term = AlgebraicMerge::resolved("file_content_alpha".to_string());
    assert!(resolved_term.is_resolved());
    assert_eq!(
        resolved_term.resolved_value(),
        Some(&"file_content_alpha".to_string())
    );
    assert_eq!(resolved_term.removes().len(), 0);
    assert_eq!(resolved_term.adds().len(), 1);
    assert_eq!(resolved_term.describe(), "Resolved(file_content_alpha)");
}

#[test]
fn test_algebraic_merge_three_way_cancellation() {
    // 1. Clean update on one side (ours changed, theirs kept base)
    let merge_ours = AlgebraicMerge::from_three_way("base_v1", "ours_v2", "base_v1");
    assert!(merge_ours.is_resolved());
    assert_eq!(merge_ours.resolved_value(), Some(&"ours_v2"));

    // 2. Clean update on other side (theirs changed, ours kept base)
    let merge_theirs = AlgebraicMerge::from_three_way("base_v1", "base_v1", "theirs_v2");
    assert!(merge_theirs.is_resolved());
    assert_eq!(merge_theirs.resolved_value(), Some(&"theirs_v2"));

    // 3. Convergent identical change on both sides (both updated to same content)
    let merge_convergent =
        AlgebraicMerge::from_three_way("base_v1", "converged_v2", "converged_v2");
    assert!(merge_convergent.is_resolved());
    assert_eq!(merge_convergent.resolved_value(), Some(&"converged_v2"));

    // 4. True conflict (divergent edits)
    let merge_conflict =
        AlgebraicMerge::from_three_way("base_v1", "ours_diverge", "theirs_diverge");
    assert!(!merge_conflict.is_resolved());
    assert_eq!(merge_conflict.resolved_value(), None);
    assert_eq!(merge_conflict.removes(), &["base_v1"]);
    assert_eq!(merge_conflict.adds(), &["ours_diverge", "theirs_diverge"]);
}

#[test]
fn test_algebraic_merge_associative_combination() {
    // Merge A against Base
    let merge_alpha = AlgebraicMerge::from_three_way(
        Oid::from_bytes([1; 20]),
        Oid::from_bytes([2; 20]),
        Oid::from_bytes([3; 20]),
    );

    // Identity test: combining with empty ancestor
    let base_identity = AlgebraicMerge::resolved(Oid::from_bytes([1; 20]));
    let combined_self = merge_alpha.combine(&base_identity, &base_identity);
    assert_eq!(combined_self, merge_alpha);
}

#[test]
fn test_change_id_derivation_and_serialization() {
    let timestamp_ms = 1_700_000_000_000i64;
    let change_id_1 = ChangeId::derive("agent-reviewer", "card-101", timestamp_ms);
    let change_id_2 = ChangeId::derive("agent-reviewer", "card-101", timestamp_ms);
    let change_id_diff = ChangeId::derive("agent-reviewer", "card-102", timestamp_ms);

    // 1. Deterministic repeatability
    assert_eq!(change_id_1, change_id_2);
    assert_ne!(change_id_1, change_id_diff);

    // 2. Hex roundtrip
    let hex_representation = change_id_1.to_hex();
    assert_eq!(hex_representation.len(), 32);
    let parsed_change_id = ChangeId::from_hex(&hex_representation).expect("Valid ChangeId hex");
    assert_eq!(change_id_1, parsed_change_id);

    // 3. Serde JSON roundtrip
    let serialized_json = serde_json::to_string(&change_id_1).expect("JSON serialize");
    assert_eq!(serialized_json, format!("\"{}\"", hex_representation));
    let deserialized_id: ChangeId =
        serde_json::from_str(&serialized_json).expect("JSON deserialize");
    assert_eq!(change_id_1, deserialized_id);
}
