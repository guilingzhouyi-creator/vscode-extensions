//! Test Suite: Taxis Governance V2 — Policy, Intent Blackboard, Block Merge, and Provenance Ledger
//! File Path: tests/rust/test_governance_pipeline.rs
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-ALG-001`: Myers diff, 3-way merge, and block pushout guard

use std::fs;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use fractal_git::{
    ActorIdentity, AgentPushContext, BlockProvenanceEntry, BlockProvenanceParams,
    BlockThreeWayMerge, CommitGovernanceHook, CommitMessageGuard, DiskBlackboardStore,
    DiskProvenanceStore, FractalRef, HookContext, HookPipeline, HookTier, HygieneConflictHook, Oid,
    PreReceiveGuard, TaxisPolicy, UacPromotionGateHook,
};

#[test]
fn test_workspace_strict_commit_policy() {
    let policy = TaxisPolicy::workspace_strict();
    assert_eq!(policy.name, "workspace-strict");
    assert!(policy.require_project_tag);
    assert!(policy.human_controlled_trunks);

    // 1. Valid workspace-strict commit with [fractal-git] tag and clean sections
    let valid_msg = r#"feat(core): introduce mechanical provenance tracking

[Project]
fractal-git

[Why]
Record objective physical timestamps for code blocks to eliminate semantic disputes.

[Changed]
- Added BlockProvenanceEntry structure
- Implemented DiskProvenanceStore for atomic storage

[Verification]
Assert all block timestamps are monotonically ordered relative to host epoch."#;

    let res = CommitMessageGuard::parse_and_verify(valid_msg, &policy, None);
    assert!(
        res.is_ok(),
        "Valid workspace-strict message should pass: {:?}",
        res.err()
    );

    // 2. Failure: Missing [Project] tag
    let missing_tag = r#"feat(core): introduce mechanical provenance tracking

[Why]
Record objective physical timestamps for code blocks to eliminate semantic disputes.

[Changed]
- Added BlockProvenanceEntry structure

[Verification]
Assert all block timestamps are monotonically ordered relative to host epoch."#;

    let res_missing = CommitMessageGuard::parse_and_verify(missing_tag, &policy, None);
    assert!(res_missing.is_err());
    let err_str = format!("{:?}", res_missing.err().unwrap());
    assert!(
        err_str.contains("Missing mandatory [Project] section") || err_str.contains("[Project]"),
        "Should reject missing project: {}",
        err_str
    );

    // 3. Failure: Forbidden buzzwords (e.g. "perfect" or "完美")
    let forbidden_word_msg = r#"fix(core): perfect lockless memory barrier

[Project]
fractal-git

[Why]
Eliminate crashing defect in pre-receive validation loop.

[Changed]
- Fixed null reference check

[Verification]
Assert no panic occurs on boundary test suite."#;

    let res_forbidden = CommitMessageGuard::parse_and_verify(forbidden_word_msg, &policy, None);
    assert!(res_forbidden.is_err());
    let err_forbidden = format!("{:?}", res_forbidden.err().unwrap());
    assert!(
        err_forbidden.contains("Forbidden term") || err_forbidden.contains("CMG-STY"),
        "Should trigger forbidden term guard: {}",
        err_forbidden
    );
}

#[test]
fn test_force_push_pre_receive_barriers() {
    let human = ActorIdentity::human("Guiling", "guiling@example.com", "token-secret");
    let agent_force = ActorIdentity::agent(AgentPushContext {
        agent_uid: "agent-007".to_string(),
        cell_id: "cell-core".to_string(),
        role: "coder".to_string(),
        is_force_push: true,
    });
    let trunk_ref = FractalRef::SystemTrunk {
        branch: "main".to_string(),
    };
    let cell_ref = FractalRef::CellMain {
        cell_id: "cell-core".to_string(),
    };
    let sub_ref = FractalRef::SubAgentWorktree {
        cell_id: "cell-core".to_string(),
        card_id: "card-01".to_string(),
        subagent_id: "sub-02".to_string(),
    };

    // System trunk strictly forbids force-push, even for Human
    assert!(PreReceiveGuard::assert_force_push_allowed(&trunk_ref, &human).is_err());
    // Cell main strictly forbids force-push for all
    assert!(PreReceiveGuard::assert_force_push_allowed(&cell_ref, &human).is_err());
    // Agent can NEVER force-push anywhere
    assert!(PreReceiveGuard::assert_force_push_allowed(&sub_ref, &agent_force).is_err());

    // Human force-push on leaf sub-tree is allowed (operator emergency reset)
    assert!(PreReceiveGuard::assert_force_push_allowed(&sub_ref, &human).is_ok());

    // Non-force agent push to authorized sub-tree is allowed by authority guard
    let agent_normal = ActorIdentity::agent(AgentPushContext {
        agent_uid: "agent-007".to_string(),
        cell_id: "cell-core".to_string(),
        role: "coder".to_string(),
        is_force_push: false,
    });
    let policy = TaxisPolicy::workspace_strict();
    assert!(PreReceiveGuard::assert_actor_authorized(&sub_ref, &agent_normal, &policy).is_ok());
}

#[test]
fn test_block_three_way_merge_concurrent_modifications() {
    // Base file with common header and two functions
    let base = r#"use std::collections::HashMap;
use std::sync::Arc;

pub fn calculate_subtotal(items: &[u32]) -> u32 {
    items.iter().sum()
}

pub fn calculate_tax(subtotal: u32) -> u32 {
    subtotal / 10
}
"#;

    // Side A adds an import and modifies calculate_subtotal
    let side_a = r#"use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

pub fn calculate_subtotal(items: &[u32]) -> u32 {
    let _start = Instant::now();
    items.iter().sum()
}

pub fn calculate_tax(subtotal: u32) -> u32 {
    subtotal / 10
}
"#;

    // Side B adds another import and modifies calculate_tax
    let side_b = r#"use std::collections::HashMap;
use std::sync::Arc;
use std::path::PathBuf;

pub fn calculate_subtotal(items: &[u32]) -> u32 {
    items.iter().sum()
}

pub fn calculate_tax(subtotal: u32) -> u32 {
    (subtotal as f64 * 0.12) as u32
}
"#;

    let result = BlockThreeWayMerge::merge(
        base.as_bytes(),
        side_a.as_bytes(),
        side_b.as_bytes(),
        "side_a",
        "side_b",
    );

    assert!(
        result.is_clean,
        "Block merge should succeed cleanly without false conflicts"
    );
    let merged = String::from_utf8_lossy(&result.content);

    // Verify union of imports
    assert!(merged.contains("use std::time::Instant;"));
    assert!(merged.contains("use std::path::PathBuf;"));
    assert!(merged.contains("use std::collections::HashMap;"));

    // Verify both function modifications co-exist
    assert!(merged.contains("let _start = Instant::now();"));
    assert!(merged.contains("(subtotal as f64 * 0.12) as u32"));
}

#[test]
fn test_fractal_hook_pipeline() {
    let mut pipeline = HookPipeline::new();
    pipeline.register(Arc::new(HygieneConflictHook));
    pipeline.register(Arc::new(CommitGovernanceHook));
    pipeline.register(Arc::new(UacPromotionGateHook));

    let actor = ActorIdentity::human("Guiling", "guiling@example.com", "token-secret");
    let policy = TaxisPolicy::workspace_strict();
    let staged_clean = vec!["crates/fg-gate/src/hook.rs".to_string()];

    let valid_msg = r#"feat(core): add clean hook pipeline

[Project]
fractal-git

[Why]
Test hook execution with structured verification.

[Changed]
- Added hook tests

[Verification]
Assert all hook pipeline assertions succeed."#;

    let ctx_sub = HookContext {
        tier: HookTier::SubToCard,
        source_ref: "refs/fractal/cell/cell-01/card/card-02/sub/sub-03",
        target_ref: "refs/fractal/cell/cell-01/card/card-02",
        actor: &actor,
        policy: &policy,
        staged_files: &staged_clean,
        commit_message: Some(valid_msg),
    };

    // SubToCard evaluation should pass
    let verdicts_sub = pipeline
        .evaluate_tier(HookTier::SubToCard, &ctx_sub)
        .unwrap();
    assert!(verdicts_sub.iter().all(|(_, v)| v.is_passing()));
    assert!(pipeline
        .assert_tier_approved(HookTier::SubToCard, &ctx_sub)
        .is_ok());

    // Empty path in staged set triggers hygiene hook block
    let staged_dirty = vec!["".to_string()];
    let ctx_dirty = HookContext {
        tier: HookTier::SubToCard,
        source_ref: "refs/fractal/cell/cell-01/card/card-02/sub/sub-03",
        target_ref: "refs/fractal/cell/cell-01/card/card-02",
        actor: &actor,
        policy: &policy,
        staged_files: &staged_dirty,
        commit_message: Some(valid_msg),
    };
    let verdict_dirty = pipeline.assert_tier_approved(HookTier::SubToCard, &ctx_dirty);
    assert!(
        verdict_dirty.is_err(),
        "Should block commit containing empty path"
    );
}

#[test]
fn test_card_blackboard_and_disk_store() {
    let temp_dir = std::env::temp_dir().join(format!("taxis-test-bb-{}", std::process::id()));
    let _ = fs::remove_dir_all(&temp_dir);
    let _ = fs::create_dir_all(&temp_dir);

    let store = DiskBlackboardStore::new(&temp_dir);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let mut bb = store.load_or_create("card-alpha", "cell-01").unwrap();

    // Agent 1 claims scope A
    let lease1 = bb
        .claim("agent-1", "src/service.rs", "fn process_order", 100, now_ms)
        .unwrap();
    assert_eq!(lease1.agent_uid, "agent-1");

    // Agent 2 claims disjoint scope B in the same file -> SUCCESS
    let lease2 = bb
        .claim("agent-2", "src/service.rs", "fn cancel_order", 100, now_ms)
        .unwrap();
    assert_eq!(lease2.agent_uid, "agent-2");

    // Agent 3 claims colliding scope A -> REJECT with collision details
    let collision = bb
        .claim("agent-3", "src/service.rs", "fn process_order", 100, now_ms)
        .unwrap_err();
    assert_eq!(collision.conflicting_agent, "agent-1");

    // Persist to disk and reload
    store.save(&bb).unwrap();
    let reloaded = store.load_or_create("card-alpha", "cell-01").unwrap();
    assert_eq!(reloaded.active_leases.len(), 2);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_mechanical_provenance_store() {
    let temp_dir = std::env::temp_dir().join(format!("taxis-test-prov-{}", std::process::id()));
    let _ = fs::remove_dir_all(&temp_dir);
    let _ = fs::create_dir_all(&temp_dir);

    let store = DiskProvenanceStore::new(&temp_dir);
    let now_ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;

    let entry1 = BlockProvenanceEntry::new(BlockProvenanceParams {
        file_path: "crates/fg-gate/src/hook.rs".to_string(),
        block_id: "fn evaluate_tier".to_string(),
        line_span: (10, 25),
        block_hash: Oid::from_bytes([1u8; 20]),
        physical_timestamp_ns: now_ns,
        ccd_generation: 1,
        agent_uid: "agent-infra".to_string(),
        cell_id: "cell-gate".to_string(),
        base_commit: Oid::ZERO,
    });
    let entry2 = BlockProvenanceEntry::new(BlockProvenanceParams {
        file_path: "crates/fg-gate/src/hook.rs".to_string(),
        block_id: "fn assert_tier_approved".to_string(),
        line_span: (30, 45),
        block_hash: Oid::from_bytes([2u8; 20]),
        physical_timestamp_ns: now_ns + 1000,
        ccd_generation: 1,
        agent_uid: "agent-infra".to_string(),
        cell_id: "cell-gate".to_string(),
        base_commit: Oid::ZERO,
    });

    store
        .record_batch(vec![entry1.clone(), entry2.clone()])
        .unwrap();

    let ledger = store.load_or_create().unwrap();
    assert_eq!(ledger.entries.len(), 2);

    let queried = ledger.query_file("crates/fg-gate/src/hook.rs");
    assert_eq!(queried.len(), 2);

    let latest = ledger
        .query_latest_block("crates/fg-gate/src/hook.rs", "fn assert_tier_approved")
        .expect("Should locate block");
    assert_eq!(latest.physical_timestamp_ns, now_ns + 1000);
    assert_eq!(latest.agent_uid, "agent-infra");

    let _ = fs::remove_dir_all(&temp_dir);
}
