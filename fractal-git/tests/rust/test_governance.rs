//! Test Suite: Taxis Generalized Governance, Rust-Grade Commit Invariants & Human Control Boundary
//! File Path: tests/rust/test_governance.rs

use fractal_git::{
    ActorIdentity, AgentPushContext, CommitCountVerdict, CommitCounter, CommitMessageGuard,
    CommitTelemetryConfig, DiffCoherenceMode, FractalRef, Oid, PreReceiveGuard, TaxisPolicy,
    TelemetryCommitNode,
};

#[test]
fn test_generalized_policy_presets() {
    let strict = TaxisPolicy::rust_strict();
    assert_eq!(strict.name, "rust-strict");
    assert!(strict.human_controlled_trunks);
    assert!(strict.qualitative_verification_only);
    assert_eq!(strict.diff_coherence, DiffCoherenceMode::Strict);

    let conventional = TaxisPolicy::conventional_semantic();
    assert_eq!(conventional.name, "conventional-semantic");
    assert!(!conventional.dual_trunk_enabled);

    let native = TaxisPolicy::git_native();
    assert_eq!(native.name, "git-native");
    assert!(!native.human_controlled_trunks);
}

#[test]
fn test_rust_grade_commit_guard_validations() {
    let policy = TaxisPolicy::rust_strict();

    // 1. Valid commit message with qualitative verification and scope coherence
    let valid_msg = r#"feat(cas): introduce 64-byte aligned chunking buffer

[Why]
Eliminate transient heap allocation during streaming object encoding.

[Changed]
- Added aligned page chunker implementation
- Wired zero-copy buffer recycling

[Verification]
Assert all allocated memory slots return to free pool without byte leakage."#;

    let touched_files = vec!["crates/fg-storage/src/cas.rs".to_string()];
    let res = CommitMessageGuard::parse_and_verify(valid_msg, &policy, Some(&touched_files));
    assert!(
        res.is_ok(),
        "Valid semantic commit should pass: {:?}",
        res.err()
    );
    let witness = res.unwrap();
    assert_eq!(witness.commit_type, "feat");
    assert_eq!(witness.scope, Some("cas".into()));
    assert_eq!(witness.summary, "introduce 64-byte aligned chunking buffer");
    assert!(witness.get_section("Why").is_some());

    // 2. Failure: Missing blank line between header and body
    let no_blank_line = r#"feat(cas): introduce buffer
[Why]
Valid why section."#;
    let res_no_blank = CommitMessageGuard::parse_and_verify(no_blank_line, &policy, None);
    assert!(res_no_blank.is_err());
    let err_msg = format!("{:?}", res_no_blank.err().unwrap());
    assert!(err_msg.contains("Line 2 must be an empty blank line"));

    // 3. Failure: Qualitative verification violation (execution telemetry numbers)
    let raw_telemetry_msg = r#"feat(cas): introduce 64-byte aligned chunking buffer

[Why]
Eliminate transient heap allocation during streaming object encoding.

[Changed]
- Added aligned page chunker implementation

[Verification]
All 15 tests passed with exit code 0."#;
    let res_telemetry =
        CommitMessageGuard::parse_and_verify(raw_telemetry_msg, &policy, Some(&touched_files));
    assert!(res_telemetry.is_err());
    let err_telemetry = format!("{:?}", res_telemetry.err().unwrap());
    assert!(err_telemetry.contains("CMG-STY-006"));

    // 4. Failure: Out-of-scope mutation (diff scope borrow check)
    let out_of_scope_files = vec!["drivers/net/ethernet.rs".to_string()];
    let res_scope =
        CommitMessageGuard::parse_and_verify(valid_msg, &policy, Some(&out_of_scope_files));
    assert!(res_scope.is_err());
    let err_scope = format!("{:?}", res_scope.err().unwrap());
    assert!(err_scope.contains("FGT-GAT-001"));

    // 5. Failure: Forbidden terms (wip / quick fix)
    let forbidden_msg = r#"feat(cas): wip quick fix for buffer

[Why]
Valid why section.

[Changed]
- Valid changed.

[Verification]
Valid qualitative assertion."#;
    let res_forbidden = CommitMessageGuard::parse_and_verify(forbidden_msg, &policy, None);
    assert!(res_forbidden.is_err());
    let err_forbidden = format!("{:?}", res_forbidden.err().unwrap());
    assert!(err_forbidden.contains("CMG-STY-001"));
}

#[test]
fn test_human_control_boundary() {
    let policy = TaxisPolicy::rust_strict();

    let agent_ctx = AgentPushContext {
        agent_uid: "agent-007".into(),
        cell_id: "cell-core".into(),
        role: "worker".into(),
        is_force_push: false,
    };
    let agent_actor = ActorIdentity::agent(agent_ctx);

    let human_actor = ActorIdentity::human(
        "Lead Architect",
        "architect@company.com",
        Some("AUTH-TOKEN-123".into()),
    );

    let system_trunk = FractalRef::SystemTrunk {
        branch: "main".into(),
    };
    let integration_trunk = FractalRef::Trunk;
    let cell_main = FractalRef::CellMain {
        cell_id: "cell-core".into(),
    };

    // Agent direct push to System Trunk is strictly rejected
    let res_agent_sys =
        PreReceiveGuard::assert_actor_authorized(&system_trunk, &agent_actor, &policy);
    assert!(res_agent_sys.is_err());
    let err_sys = format!("{:?}", res_agent_sys.err().unwrap());
    assert!(err_sys.contains("Human Control Breach"));

    // Agent direct push to Integration Trunk is strictly rejected
    let res_agent_trunk =
        PreReceiveGuard::assert_actor_authorized(&integration_trunk, &agent_actor, &policy);
    assert!(res_agent_trunk.is_err());
    let err_trunk = format!("{:?}", res_agent_trunk.err().unwrap());
    assert!(err_trunk.contains("Human Control Breach"));

    // Human actor to System Trunk & Integration Trunk is allowed
    assert!(PreReceiveGuard::assert_actor_authorized(&system_trunk, &human_actor, &policy).is_ok());
    assert!(
        PreReceiveGuard::assert_actor_authorized(&integration_trunk, &human_actor, &policy).is_ok()
    );

    // Agent actor pushing to its own Cell Main is allowed
    assert!(PreReceiveGuard::assert_actor_authorized(&cell_main, &agent_actor, &policy).is_ok());
}

#[test]
fn test_anti_inflation_commit_telemetry() {
    // Simulate DAG:
    // Root commit (OID 1)
    // 50 ephemeral agent micro-commits (OID 100..150)
    // 2 official human-signed milestone promotion merges (OID 200, 201)
    let root_oid = Oid::from_bytes([1; 20]);
    let promotion_1_oid = Oid::from_bytes([2; 20]);
    let promotion_2_oid = Oid::from_bytes([3; 20]);

    let config_dual = CommitTelemetryConfig {
        dual_trunk_enabled: true,
        target_ref: FractalRef::Trunk,
    };

    let config_native = CommitTelemetryConfig {
        dual_trunk_enabled: false,
        target_ref: FractalRef::SystemTrunk {
            branch: "main".into(),
        },
    };

    let resolver = |oid: &Oid| -> Result<Option<TelemetryCommitNode>, fractal_git::FractalError> {
        let bytes = oid.as_bytes();
        if bytes[0] == 3 {
            // Promotion 2: merges promotion 1 and an agent branch
            Ok(Some(TelemetryCommitNode {
                oid: *oid,
                parent_oids: vec![promotion_1_oid, Oid::from_bytes([150; 20])],
                is_human_signed: true,
                is_promotion_merge: true,
                is_agent_micro_commit: false,
            }))
        } else if bytes[0] == 2 {
            // Promotion 1: merges root
            Ok(Some(TelemetryCommitNode {
                oid: *oid,
                parent_oids: vec![root_oid],
                is_human_signed: true,
                is_promotion_merge: true,
                is_agent_micro_commit: false,
            }))
        } else if bytes[0] == 1 {
            // Root commit
            Ok(Some(TelemetryCommitNode {
                oid: *oid,
                parent_oids: vec![],
                is_human_signed: true,
                is_promotion_merge: false,
                is_agent_micro_commit: false,
            }))
        } else if bytes[0] >= 100 && bytes[0] <= 150 {
            // Ephemeral agent micro-commits
            let prev = if bytes[0] == 100 {
                root_oid
            } else {
                Oid::from_bytes([bytes[0] - 1; 20])
            };
            Ok(Some(TelemetryCommitNode {
                oid: *oid,
                parent_oids: vec![prev],
                is_human_signed: false,
                is_promotion_merge: false,
                is_agent_micro_commit: true,
            }))
        } else {
            Ok(None)
        }
    };

    // Under Dual-Trunk mode:
    // Only Root + Promotion 1 + Promotion 2 are counted as official commits!
    // The 51 agent micro-commits are filtered out.
    let verdict_dual: CommitCountVerdict =
        CommitCounter::count_commits(Some(promotion_2_oid), &config_dual, resolver).unwrap();
    assert_eq!(
        verdict_dual.official_count, 3,
        "Official count must only count promotions and root milestone"
    );
    assert_eq!(
        verdict_dual.filtered_agent_commits, 51,
        "Must filter all 51 agent micro-commits"
    );
    assert_eq!(verdict_dual.total_raw_commits, 54);
    assert!(verdict_dual.dual_trunk_active);

    // Under Native Git mode:
    // All 54 commits are counted (100% native Git compatible)
    let verdict_native: CommitCountVerdict =
        CommitCounter::count_commits(Some(promotion_2_oid), &config_native, resolver).unwrap();
    assert_eq!(
        verdict_native.official_count, 54,
        "Native Git mode must count all 54 commits"
    );
    assert_eq!(verdict_native.filtered_agent_commits, 0);
    assert!(!verdict_native.dual_trunk_active);
}
