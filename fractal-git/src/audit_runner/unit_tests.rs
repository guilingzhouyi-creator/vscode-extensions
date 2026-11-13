//! Module: Fractal Git — Native Audit Runner Unit Tests
//! File Path: src/audit_runner/unit_tests.rs
//! Architecture Role: Verifies schema compliance, HMAC-SM3 promotion sealing, and anti-gaming
//!   conjunction blocking on clean versus trivial-semantic snapshots.
//! Dependencies & Triggers: Tests `evaluate_and_seal_snapshot` and `verify_sealed_receipt_for_promotion`.
//! Responsibilities: Ensure fail-closed integrity and delta anti-gaming parity.
//! Exit Semantics & Design Rationale: Pure in-memory slice fixtures without temp directories.

use fg_core::models::quality_evidence::parse_quality_document;
use fg_core::models::AuthoritySecret;

use super::*;

#[test]
fn evaluate_and_seal_clean_snapshot_passes_schema_and_verification() {
    let secret = AuthoritySecret::from_bytes(&[9u8; 32]).expect("secret");
    let ts_code = b"/** Adds numbers cleanly. */\nexport function add(left: number, right: number): number {\n  return left + right;\n}\n";
    let rs_code = b"/// Doubles value.\npub fn double_val(value: i32) -> i32 {\n    value * 2\n}\n";
    let slices = [
        SnapshotFileSlice {
            rel_path: "src/math.ts",
            content: ts_code,
        },
        SnapshotFileSlice {
            rel_path: "src/lib.rs",
            content: rs_code,
        },
    ];
    let tree_oid = Oid::from_hex("1111111111111111111111111111111111111111").expect("oid");
    let outcome = evaluate_and_seal_snapshot(&SnapshotAuditRequest {
        repository_id: "repo-demo",
        review_id: "rev-001",
        operation_id: "op-001",
        tree_oid,
        parent_oids: &[],
        archetype: ProjectArchetype::Library,
        previous_scores: &[94.0, 95.5, 96.2],
        previous_evidence_digest: None,
        authority_secret: &secret,
        key_id: "k-test",
        now_ms: 1_700_000_000_000,
        changed_eloc: 20,
        net_debt_eliminated: 5.0,
        claims_score_gain: false,
        previous_sqale_minutes: None,
        previous_composite_score: None,
        slices: &slices,
    })
    .expect("audit");

    assert_eq!(
        outcome.receipt.payload.decision,
        ReceiptPayloadDecision::Approved
    );
    assert!(outcome.anti_gaming_passed);
    assert!(parse_quality_document(&outcome.evidence_canonical_bytes).is_ok());
    assert!(parse_quality_document(&outcome.receipt_canonical_bytes).is_ok());
    assert!(verify_sealed_receipt_for_promotion(
        &outcome.receipt,
        &tree_oid,
        &secret,
        1_700_000_100_000
    )
    .is_ok());
}

#[test]
fn delta_anti_gaming_blocks_trivial_semantic_change_claiming_gain() {
    let secret = AuthoritySecret::from_bytes(&[9u8; 32]).expect("secret");
    let rs_code = b"/// Clean arithmetic.\npub fn add_one(val: i32) -> i32 {\n    val + 1\n}\n\n/// Clean double.\npub fn double_it(val: i32) -> i32 {\n    val * 2\n}\n\n/// Clean triple.\npub fn triple_it(val: i32) -> i32 {\n    val * 3\n}\n\n/// Clean quad.\npub fn quad_it(val: i32) -> i32 {\n    val * 4\n}\n";
    let slices = [SnapshotFileSlice {
        rel_path: "src/lib.rs",
        content: rs_code,
    }];
    let tree_oid = Oid::from_hex("2222222222222222222222222222222222222222").expect("oid");
    let outcome = evaluate_and_seal_snapshot(&SnapshotAuditRequest {
        repository_id: "repo-demo",
        review_id: "rev-002",
        operation_id: "op-002",
        tree_oid,
        parent_oids: &[],
        archetype: ProjectArchetype::Library,
        previous_scores: &[80.0],
        previous_evidence_digest: None,
        authority_secret: &secret,
        key_id: "k-test",
        now_ms: 1_700_000_050_000,
        changed_eloc: 1,
        net_debt_eliminated: 0.0,
        claims_score_gain: false,
        previous_sqale_minutes: Some(0.0),
        previous_composite_score: Some(80.0),
        slices: &slices,
    })
    .expect("audit");

    assert!(!outcome.anti_gaming_passed);
    assert!(outcome
        .anti_gaming_reason
        .as_deref()
        .is_some_and(|reason| reason.contains("15.00%")));
    assert_eq!(
        outcome.receipt.payload.decision,
        ReceiptPayloadDecision::Blocked
    );
}
