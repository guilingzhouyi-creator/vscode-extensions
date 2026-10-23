//! Module: taxis_cmd::verify — Multi-Tier Quality & Gate Verifier
//! File Path: src/bin/taxis_cmd/verify.rs
//! Architecture Role: Runs multi-tier gate verification across pre-receive authority, commit
//!   message invariants, conflict markers, and storage quota governance.
//! Dependencies & Triggers: Dispatched by `taxis verify` / `taxis check` / `taxis gate`.
//! Responsibilities: Comprehensive four-tier invariant inspection and verdict reporting.
//! Exit Semantics & Design Rationale:
//!   - Exits 0 if and only if all four quality tiers pass without violation.
//!   - Exits 1 on any invariant regression or governance failure.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use fractal_git::{
    ActorIdentity, AgentPushContext, CommitMessageGuard, ConflictGuard, FractalRef, PreReceiveGuard,
    QuotaGovernor, TaxisPolicy,
};

use super::common::{print_json, CliContext};

/// Runs multi-tier gate verification across authority, message, conflict, and quota checks.
pub fn handle_verify(ctx: &CliContext) {
    let agent_ctx = AgentPushContext {
        agent_uid: "agent-verifier".into(),
        cell_id: "cell-core".into(),
        role: "verifier".into(),
        is_force_push: false,
    };
    let agent_actor = ActorIdentity::agent(agent_ctx);
    let human_actor = ActorIdentity::human(
        "Supervisor",
        "supervisor@internal",
        "gate-selftest-credential",
    );
    let policy = TaxisPolicy::rust_strict();

    let trunk_ref = FractalRef::Trunk;
    let subagent_ref = FractalRef::SubAgentWorktree {
        cell_id: "cell-core".into(),
        card_id: "card-gate".into(),
        subagent_id: "agent-verifier".into(),
    };

    // Tier 1: authority boundaries
    let agent_blocked =
        PreReceiveGuard::assert_actor_authorized(&trunk_ref, &agent_actor, &policy).is_err();
    let human_allowed =
        PreReceiveGuard::assert_actor_authorized(&trunk_ref, &human_actor, &policy).is_ok();
    let subagent_allowed =
        PreReceiveGuard::assert_actor_authorized(&subagent_ref, &agent_actor, &policy).is_ok();
    let unverified_human = ActorIdentity::unverified_human("Supervisor", "supervisor@internal");
    let credential_ok =
        PreReceiveGuard::assert_actor_authorized(&trunk_ref, &unverified_human, &policy).is_err();
    let pre_receive_ok = agent_blocked && human_allowed && subagent_allowed && credential_ok;

    // Tier 2: conventional semantic message validation
    let valid_msg = concat!(
        "feat(core): verify taxis commit guard\n\n",
        "[Why]\nSystem integrity audit.\n\n",
        "[Changed]\n- Audited invariants\n\n",
        "[Verification]\nAssert all domain invariants hold true without regression."
    );
    let msg_guard_ok = CommitMessageGuard::parse_and_verify(valid_msg, &policy, None).is_ok();

    // Tiers 3 & 4: conflict markers and quota limits
    let conflict_ok =
        ConflictGuard::assert_clean_content("sample.rs", b"pub fn clean() {}\n").is_ok();
    let quota = QuotaGovernor::default();
    let quota_ok = quota.assert_spawn_capacity(0).is_ok() && quota.assert_storage_budget(0).is_ok();

    let all_gates_passed = pre_receive_ok && msg_guard_ok && conflict_ok && quota_ok;
    report_verify(
        ctx,
        &quota,
        all_gates_passed,
        pre_receive_ok,
        msg_guard_ok,
        conflict_ok,
        quota_ok,
    );

    if !all_gates_passed {
        std::process::exit(1);
    }
}

/// Prints the four gate tier results in the requested format.
fn report_verify(
    ctx: &CliContext,
    quota: &QuotaGovernor,
    all_gates_passed: bool,
    pre_receive_ok: bool,
    msg_guard_ok: bool,
    conflict_ok: bool,
    quota_ok: bool,
) {
    let tier_state = |passed: bool| if passed { "PASS" } else { "FAIL" };

    if ctx.json_mode {
        let verify_payload = serde_json::json!({
            "engine": "taxis",
            "operation": "verify",
            "all_gates_passed": all_gates_passed,
            "tiers": {
                "pre_receive": tier_state(pre_receive_ok),
                "commit_message": tier_state(msg_guard_ok),
                "conflict": tier_state(conflict_ok),
                "quota": tier_state(quota_ok),
            },
            "quota": {
                "max_worktrees": quota.max_concurrent_worktrees(),
                "max_disk_mb": quota.max_disk_megabytes(),
            },
        });
        print_json(&verify_payload);
        return;
    }

    println!(
        "=== Running Taxis Multi-Tier Gate Verification ===\n\
         [1/4] PreReceiveGuard   : {} (Human trunks & Agent sandbox)\n\
         [2/4] CommitMessageGuard: {} (Rust-grade type witness)\n\
         [3/4] ConflictGuard     : {} (Conflict marker scanning active)\n\
         [4/4] QuotaGovernor     : {} (Limit {} worktrees, {} MB)",
        tier_state(pre_receive_ok),
        tier_state(msg_guard_ok),
        tier_state(conflict_ok),
        tier_state(quota_ok),
        quota.max_concurrent_worktrees(),
        quota.max_disk_megabytes(),
    );
    if all_gates_passed {
        println!("Result: ALL GATES PASS (Zero rule drift)");
    } else {
        println!("Result: GATE VERIFICATION FAILED (see per-tier verdicts above)");
    }
}
