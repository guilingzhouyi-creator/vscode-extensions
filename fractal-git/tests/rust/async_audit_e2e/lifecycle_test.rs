//! Integration Test: End-to-End Persistent Daemon Audit & Sealed Promotion Gate
//! File Path: tests/rust/async_audit_e2e/lifecycle_test.rs
//! Architecture Role: Verifies live `taxis daemon start`, `HelloAuth` commits, debounced
//!   worktree-free commits to `refs/fractal/audit/trunk`, fail-closed promotion checks, and
//!   clean discovery sentinel cleanup on shutdown.
//! Dependencies & Triggers: Invoked via `integration_governance`.
//! Responsibilities: Guarantee zero `.audit-logs/` leakage and strict receipt verification.
//! Exit Semantics & Design Rationale: Covers bad secret, paused stale tree, and valid paths.

use std::fs;
use std::time::Duration;

use serde_json::Value;

use crate::cli_harness::scratch_scoped_dir;

use super::fixtures::{init_dev_repo, make_ipc_commit};
use super::harness::{
    expect_commit_oid, run_taxis_cli, spawn_persistent_daemon, wait_for_audit_status,
    wait_for_daemon_meta,
};
use super::{TEST_AUTHORITY_HEX, WRONG_AUTHORITY_HEX};

const CLEAN_MATH_SRC: &str = concat!(
    "//! Clean arithmetic helper module.\n\n",
    "/// Adds two signed 64-bit integers using saturating overflow semantics.\n",
    "pub fn safe_add(left: i64, right: i64) -> i64 {\n",
    "    left.saturating_add(right)\n",
    "}\n"
);

#[test]
fn test_taxis_persistent_async_audit_lifecycle_and_sealed_promotion() {
    let guard = scratch_scoped_dir("taxis_async_audit", "e2e");
    let repo_dir = guard.path();
    let taxis_dir = repo_dir.join(".taxis");
    init_dev_repo(repo_dir);
    let _ = fs::create_dir_all(taxis_dir.join("refs/heads"));

    let mut daemon_guard = spawn_persistent_daemon(repo_dir, "80", "600");
    let meta_path = taxis_dir.join("daemon.json");
    let daemon_meta = wait_for_daemon_meta(&meta_path);
    assert_eq!(daemon_meta["manages_async_audit"], Value::Bool(true));

    let commit_1 = make_ipc_commit(
        "refs/heads/main",
        Vec::new(),
        &[("src/math.rs", CLEAN_MATH_SRC)],
        "feat(math): add saturating arithmetic helper cleanly",
        1_790_000_000,
    );
    let commit_oid_1 = expect_commit_oid(&daemon_meta, &commit_1, "commit 1");

    let status = wait_for_audit_status(repo_dir, |val| {
        val["last_audit_commit_oid"].as_str().is_some()
    });
    assert_eq!(status["active"], Value::Bool(true));
    assert_eq!(status["paused"], Value::Bool(false));
    assert_eq!(status["writes_audit_logs_dir"], Value::Bool(false));
    assert_eq!(
        status["last_decision"],
        Value::String(String::from("approved"))
    );
    assert!(status["last_composite_score"]
        .as_f64()
        .is_some_and(|s| s >= 90.0));
    assert!(taxis_dir.join("refs/fractal/audit/trunk").is_file());
    assert!(!repo_dir.join(".audit-logs").exists() && !taxis_dir.join(".audit-logs").exists());

    let latest_out = run_taxis_cli(repo_dir, &["--json", "audit", "latest"], TEST_AUTHORITY_HEX);
    assert!(latest_out.status.success());
    let latest_val: Value = serde_json::from_slice(&latest_out.stdout).expect("latest JSON");
    assert_eq!(latest_val["found"], Value::Bool(true));
    assert_eq!(latest_val["writes_audit_logs_dir"], Value::Bool(false));
    assert_eq!(
        latest_val["receipt"]["payload"]["signatureAlgorithm"],
        Value::String(String::from("hmac-sm3"))
    );
    assert_eq!(
        latest_val["receipt"]["payload"]["decision"],
        Value::String(String::from("approved"))
    );

    let trace_out = run_taxis_cli(repo_dir, &["--json", "audit", "trace"], TEST_AUTHORITY_HEX);
    assert!(trace_out.status.success());
    let trace_val: Value = serde_json::from_slice(&trace_out.stdout).expect("trace JSON");
    assert!(trace_val["count"].as_u64().unwrap_or(0) >= 1);
    assert_eq!(trace_val["writes_audit_logs_dir"], Value::Bool(false));

    let bad_secret = run_taxis_cli(
        repo_dir,
        &[
            "promotion",
            "stage",
            "--oid",
            &commit_oid_1,
            "--agent",
            "agent-e2e",
            "--summary",
            "Forged authority secret check",
            "--require-audit-tree",
        ],
        WRONG_AUTHORITY_HEX,
    );
    assert!(
        !bad_secret.status.success(),
        "forged secret must fail closed"
    );

    let valid_stage = run_taxis_cli(
        repo_dir,
        &[
            "--json",
            "promotion",
            "stage",
            "--oid",
            &commit_oid_1,
            "--agent",
            "agent-e2e",
            "--summary",
            "Sealed audit tree promotion stage",
            "--require-audit-tree",
        ],
        TEST_AUTHORITY_HEX,
    );
    assert!(valid_stage.status.success(), "valid promotion stage failed");

    fs::write(taxis_dir.join("audit.paused"), b"paused\n").expect("write audit.paused");
    let commit_2 = make_ipc_commit(
        "refs/heads/main",
        vec![commit_oid_1],
        &[
            ("src/math.rs", CLEAN_MATH_SRC),
            (
                "src/extra.rs",
                "/// Extra constant.\npub const FLAG: u8 = 1;\n",
            ),
        ],
        "feat(math): add extra unaudited module",
        1_790_000_060,
    );
    let commit_oid_2 = expect_commit_oid(&daemon_meta, &commit_2, "commit 2");
    let stale_stage = run_taxis_cli(
        repo_dir,
        &[
            "promotion",
            "stage",
            "--oid",
            &commit_oid_2,
            "--agent",
            "agent-e2e",
            "--summary",
            "Mismatched candidate tree check",
            "--require-audit-tree",
        ],
        TEST_AUTHORITY_HEX,
    );
    assert!(!stale_stage.status.success(), "stale tree must fail closed");

    let stop_out = run_taxis_cli(repo_dir, &["--json", "daemon", "stop"], TEST_AUTHORITY_HEX);
    assert!(stop_out.status.success());
    let exit_status = daemon_guard
        .wait_exit(Duration::from_secs(6))
        .expect("daemon exit");
    assert!(exit_status.success());
    assert!(!meta_path.exists());
    assert!(!repo_dir.join(".audit-logs").exists() && !taxis_dir.join(".audit-logs").exists());
}
