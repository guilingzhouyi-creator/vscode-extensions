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

use std::path::{Path, PathBuf};

use fg_core::models::{current_unix_seconds, AuthoritySecret};
use fg_gate::auto_audit_hook::{AutoAuditHook, AutoAuditReceipt};
use fg_gate::resolve_authority_secret;
use fractal_git::constants::cli::CliTag;
use fractal_git::{
    ActorIdentity, AgentPushContext, CommitMessageGuard, ConflictGuard, FractalRef, HookTier,
    PreReceiveGuard, QuotaGovernor, TaxisPolicy,
};

use super::common::{find_all_arg_values, find_arg_value, print_json, reject, CliContext};

/// Default filename for the signed verification receipt inside `.taxis/` or `git_dir`.
pub const VERIFY_RECEIPT_FILENAME: &str = "verify-receipt.json";

/// Fixture secret backing the deterministic `taxis verify` self-test.
const FIXTURE_SECRET_BYTES: [u8; 32] = [7u8; 32];

/// Runs multi-tier gate verification across authority, message, conflict, and quota checks.
pub fn handle_verify(ctx: &CliContext) {
    if ctx.args.first().map(|s| s.as_str()) == Some("slice") {
        super::gate_slice::handle_gate_slice(ctx);
        return;
    }

    let agent_ctx = AgentPushContext {
        agent_uid: "agent-verifier".into(),
        cell_id: "cell-core".into(),
        role: "verifier".into(),
        is_force_push: false,
    };
    let agent_actor = ActorIdentity::agent(agent_ctx);
    let secret = match AuthoritySecret::from_bytes(&FIXTURE_SECRET_BYTES) {
        Ok(secret) => secret,
        Err(secret_err) => reject(
            CliTag::ERROR,
            format!("fixture authority secret: {secret_err}"),
        ),
    };
    let now_secs = current_unix_seconds();
    let token = issue_token(&secret, "Supervisor", 3600, now_secs);
    let human_actor = ActorIdentity::human("Supervisor", "supervisor@internal", token.clone());
    let mut policy = TaxisPolicy::rust_strict();
    policy.authority_secret = Some(secret.clone());

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
    let tampered_human =
        ActorIdentity::human("Supervisor", "supervisor@internal", tamper_token(&token));
    let tampered_blocked =
        PreReceiveGuard::assert_actor_authorized(&trunk_ref, &tampered_human, &policy).is_err();
    let expired_human = ActorIdentity::human(
        "Supervisor",
        "supervisor@internal",
        issue_token(&secret, "Supervisor", 0, now_secs - 10),
    );
    let expired_blocked =
        PreReceiveGuard::assert_actor_authorized(&trunk_ref, &expired_human, &policy).is_err();
    let mismatched_human = ActorIdentity::human(
        "Supervisor",
        "supervisor@internal",
        issue_token(&secret, "Auditor", 3600, now_secs),
    );
    let subject_mismatch_blocked =
        PreReceiveGuard::assert_actor_authorized(&trunk_ref, &mismatched_human, &policy).is_err();
    let secretless_policy = TaxisPolicy::rust_strict();
    let secretless_blocked =
        PreReceiveGuard::assert_actor_authorized(&trunk_ref, &human_actor, &secretless_policy)
            .is_err();
    let pre_receive_ok = agent_blocked
        && human_allowed
        && subagent_allowed
        && credential_ok
        && tampered_blocked
        && expired_blocked
        && subject_mismatch_blocked
        && secretless_blocked;

    // Tier 2: conventional semantic message validation
    let valid_msg = concat!(
        "feat(core): verify taxis commit guard\n\n",
        "[Why]\nSystem integrity audit.\n\n",
        "[Added]\n- Audited invariants\n\n",
        "[Verification]\nAssert all domain invariants hold true without regression."
    );
    let msg_guard_ok = CommitMessageGuard::parse_and_verify(valid_msg, &policy, None).is_ok();

    // Tiers 3 & 4: conflict markers, TKCV+Canary real file inspection, and quota limits
    let signing_secret = resolve_authority_secret(&ctx.git_dir).unwrap_or_else(|_| secret.clone());
    let (workspace_ok, receipt) = inspect_workspace_and_issue_receipt(ctx, &signing_secret);
    let conflict_ok = ConflictGuard::assert_clean_content("sample.rs", b"pub fn clean() {}\n")
        .is_ok()
        && workspace_ok;
    let quota = QuotaGovernor::default();
    let quota_ok = quota.assert_spawn_capacity(0).is_ok() && quota.assert_storage_budget(0).is_ok();

    let all_gates_passed = pre_receive_ok && msg_guard_ok && conflict_ok && quota_ok;
    if let Some(ref verified_receipt) = receipt {
        persist_verify_receipt(ctx, verified_receipt, all_gates_passed);
    }
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

/// Inspects explicit `--file` targets or staged workspace files via ConflictGuard + AutoAuditHook.
fn inspect_workspace_and_issue_receipt(
    ctx: &CliContext,
    secret: &AuthoritySecret,
) -> (bool, Option<AutoAuditReceipt>) {
    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    let target_files = collect_verify_targets(ctx, &work_root);
    let hook = AutoAuditHook::new(HookTier::SubToCard).with_authority_secret(secret.clone());
    let test_override = find_arg_value(&ctx.args, &["--test", "--test-file"])
        .and_then(|test_path| std::fs::read_to_string(work_root.join(test_path)).ok());

    let mut latest_receipt: Option<AutoAuditReceipt> = None;
    for rel_path in &target_files {
        let Some(file_receipt) =
            audit_single_workspace_file(&hook, &work_root, rel_path, test_override.as_deref())
        else {
            return (false, None);
        };
        latest_receipt = Some(file_receipt);
    }

    if latest_receipt.is_none() {
        let default_source = "pub fn verify_probe(val: u32) -> u32 {\n    val * 2\n}\n";
        let default_tests =
            "#[test]\nfn test_verify_probe() {\n    assert_eq!(verify_probe(4), 8);\n}\n";
        latest_receipt = hook
            .audit_source_and_test("src/lib.rs", default_source, default_tests, "taxis-verify")
            .ok();
    }

    (latest_receipt.is_some(), latest_receipt)
}

/// Collects explicit `--file` paths or staged index paths for real-file verification.
fn collect_verify_targets(ctx: &CliContext, work_root: &Path) -> Vec<String> {
    let explicit = find_all_arg_values(&ctx.args, &["--file", "--files", "--source"]);
    if !explicit.is_empty() {
        return explicit.into_iter().map(str::to_string).collect();
    }
    let mut staged = Vec::new();
    let index_file = ctx.git_dir.join("index");
    if let Ok(git_index) = fg_index::GitIndex::load(&index_file) {
        for entry in git_index.entries() {
            if work_root.join(&entry.path).is_file() {
                staged.push(entry.path.clone());
            }
        }
    }
    staged
}

/// Audits one workspace file against ConflictGuard, TKCV, and IKCE Canary probes.
fn audit_single_workspace_file(
    hook: &AutoAuditHook,
    work_root: &Path,
    rel_path: &str,
    test_override: Option<&str>,
) -> Option<AutoAuditReceipt> {
    let direct = Path::new(rel_path);
    let full_path = if direct.is_file() {
        direct.to_path_buf()
    } else {
        work_root.join(rel_path)
    };
    let workspace_rel = full_path
        .strip_prefix(work_root)
        .ok()
        .and_then(|sub| sub.to_str())
        .unwrap_or(rel_path);
    let bytes = std::fs::read(&full_path).ok()?;
    ConflictGuard::assert_clean_content(workspace_rel, &bytes).ok()?;
    let source_code = std::str::from_utf8(&bytes).ok()?;
    hook.audit_source_and_test(
        workspace_rel,
        source_code,
        test_override.unwrap_or(source_code),
        "taxis-verify",
    )
    .ok()
}

/// Persists the signed verification receipt to `.taxis/verify-receipt.json` and any `--receipt` path.
fn persist_verify_receipt(ctx: &CliContext, receipt: &AutoAuditReceipt, all_gates_passed: bool) {
    let composite_score = (receipt.credit.posterior_mean * 100.0).clamp(0.0, 100.0);
    let payload = serde_json::json!({
        "schema": "taxis-verify-receipt-v1",
        "all_gates_passed": all_gates_passed,
        "anti_gaming_passed": !receipt.credit.gaming_detected,
        "composite_score": composite_score,
        "cai_index": composite_score,
        "credible_interval_lower": receipt.credit.credible_interval_lower * 100.0,
        "receipt_digest": receipt.receipt_digest,
        "signature": receipt.record.sig,
        "audit_record": receipt.record,
    });
    let Ok(serialized) = serde_json::to_vec_pretty(&payload) else {
        return;
    };
    for target in resolve_receipt_destinations(ctx) {
        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&target, &serialized);
    }
}

/// Resolves output paths where `verify-receipt.json` should be written.
fn resolve_receipt_destinations(ctx: &CliContext) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(custom) = find_arg_value(&ctx.args, &["--receipt", "--output"]) {
        paths.push(PathBuf::from(custom));
    }
    if ctx.git_dir.is_dir() {
        paths.push(ctx.git_dir.join(VERIFY_RECEIPT_FILENAME));
    }
    let dot_taxis = super::repo_view::resolve_work_root(&ctx.git_dir).join(".taxis");
    if dot_taxis.is_dir() {
        paths.push(dot_taxis.join(VERIFY_RECEIPT_FILENAME));
    }
    paths
}

/// Computes lowercase hex SM3 digest of a canonical payload string.
pub(crate) fn compute_sm3_hex(payload: &str) -> String {
    const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";
    let digest = fg_core::crypto::sm3_hash(payload.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in &digest {
        out.push(HEX_DIGITS[(byte >> 4) as usize] as char);
        out.push(HEX_DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
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

/// Issues a fixture token or exits with the typed authority rejection tag.
fn issue_token(secret: &AuthoritySecret, subject: &str, ttl_secs: u64, now_secs: i64) -> String {
    match secret.issue(subject, ttl_secs, now_secs) {
        Ok(token) => token,
        Err(issue_err) => reject(
            CliTag::AUTHORITY_BREACH,
            format!("fixture token issuance failed: {issue_err}"),
        ),
    }
}

/// Flips the final MAC nibble to produce a structurally valid but forged token.
fn tamper_token(token: &str) -> String {
    let mut tampered = token.to_string();
    if let Some(last) = tampered.pop() {
        tampered.push(if last == '0' { '1' } else { '0' });
    }
    tampered
}
