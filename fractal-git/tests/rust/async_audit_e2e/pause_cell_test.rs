//! Integration Test: CLI Pause/Resume, Disk Cache Invalidation & Multi-Cell Promotion
//! File Path: tests/rust/async_audit_e2e/pause_cell_test.rs
//! Architecture Role: Validates `taxis audit {pause, resume}`, live `taxis add` mtime wakeup
//!   with hot-session reload, and concurrent multi-cell promotions without `--ref`.
//! Dependencies & Triggers: Invoked via `integration_governance`.
//! Responsibilities: Ensure paused commits defer audit until resume and cell refs isolate cleanly.
//! Exit Semantics & Design Rationale: Cleans up background daemon cleanly on completion.

use std::fs;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::cli_harness::scratch_scoped_dir;

use super::fixtures::{init_dev_repo, make_ipc_commit};
use super::harness::{
    expect_commit_oid, run_taxis_cli, spawn_persistent_daemon, wait_for_audit_status,
    wait_for_daemon_meta,
};
use super::TEST_AUTHORITY_HEX;

#[test]
fn test_taxis_pause_resume_cli_wakeup_and_multi_cell_promotion() {
    let guard = scratch_scoped_dir("taxis_async_pause_cells", "e2e");
    let repo_dir = guard.path();
    let taxis_dir = repo_dir.join(".taxis");
    fs::create_dir_all(repo_dir.join("src")).expect("mkdir src");
    init_dev_repo(repo_dir);
    let _ = fs::create_dir_all(taxis_dir.join("refs/heads"));
    let _ = fs::create_dir_all(taxis_dir.join("refs/fractal/cell/alpha"));
    let _ = fs::create_dir_all(taxis_dir.join("refs/fractal/cell/beta"));

    let mut daemon_1 = spawn_persistent_daemon(repo_dir, "60", "5000");
    let daemon_meta = wait_for_daemon_meta(&taxis_dir.join("daemon.json"));

    let pause_out = run_taxis_cli(repo_dir, &["--json", "audit", "pause"], TEST_AUTHORITY_HEX);
    assert!(pause_out.status.success());
    let pause_json: Value = serde_json::from_slice(&pause_out.stdout).expect("pause json");
    assert_eq!(pause_json["paused"], Value::Bool(true));

    fs::write(
        repo_dir.join("src/cli_mod.rs"),
        "//! CLI staged module.\n\n/// Doubles an integer.\npub fn twice(val: i32) -> i32 {\n    val.saturating_mul(2)\n}\n",
    )
    .expect("write cli_mod.rs");
    assert!(run_taxis_cli(repo_dir, &["add", "src/cli_mod.rs"], TEST_AUTHORITY_HEX)
        .status
        .success());
    let commit_msg = concat!(
        "feat(cli): add cli_mod while paused\n\n[Project]\nfractal-git\n\n[Why]\n",
        "Verify background daemon audit pause and resume lifecycle across CLI mutations cleanly.\n\n",
        "[Added]\n- Added src/cli_mod.rs via CLI add and commit.\n\n",
        "[Changed]\n- Recorded cell sandbox commit while automatic audit scheduling was paused.\n\n",
        "[Verification]\n- Verified pub fn twice symbol and staged blob for src/cli_mod.rs under cargo test."
    );
    assert!(run_taxis_cli(repo_dir, &["commit", "-m", commit_msg], TEST_AUTHORITY_HEX)
        .status
        .success());
    std::thread::sleep(Duration::from_millis(200));
    assert!(!taxis_dir.join("refs/fractal/audit/trunk").exists());

    assert!(run_taxis_cli(repo_dir, &["--json", "audit", "resume"], TEST_AUTHORITY_HEX)
        .status
        .success());
    let resumed = wait_for_audit_status(repo_dir, |val| val["last_audit_commit_oid"].as_str().is_some());
    assert_eq!(resumed["paused"], Value::Bool(false));
    let first_tree_oid = resumed["last_tree_oid"].as_str().expect("tree").to_owned();

    std::thread::sleep(Duration::from_millis(30));
    fs::write(
        repo_dir.join("src/wake_extra.rs"),
        "//! Live wakeup helper.\n\n/// Returns constant three.\npub const THREE: i32 = 3;\n",
    )
    .expect("write wake_extra.rs");
    assert!(run_taxis_cli(repo_dir, &["add", "src/wake_extra.rs"], TEST_AUTHORITY_HEX)
        .status
        .success());
    let updated = wait_for_audit_status(repo_dir, |val| {
        val["last_tree_oid"].as_str().is_some_and(|tree| tree != first_tree_oid)
    });
    assert_eq!(updated["last_decision"], Value::String(String::from("approved")));

    let alpha_req = make_ipc_commit(
        "refs/fractal/cell/alpha/main",
        Vec::new(),
        &[("src/alpha.rs", "//! Cell alpha.\n\n/// Alpha identity.\npub fn alpha_id() -> u32 {\n    1\n}\n")],
        "feat(alpha): commit cell alpha cleanly",
        1_790_000_100,
    );
    let beta_req = make_ipc_commit(
        "refs/fractal/cell/beta/main",
        Vec::new(),
        &[("src/beta.rs", "//! Cell beta.\n\n/// Beta identity.\npub fn beta_id() -> u32 {\n    2\n}\n")],
        "feat(beta): commit cell beta cleanly",
        1_790_000_120,
    );
    let alpha_oid = expect_commit_oid(&daemon_meta, &alpha_req, "alpha");
    let beta_oid = expect_commit_oid(&daemon_meta, &beta_req, "beta");

    let deadline = Instant::now() + Duration::from_secs(10);
    while !taxis_dir.join("refs/fractal/audit/cell/alpha/main").is_file()
        || !taxis_dir.join("refs/fractal/audit/cell/beta/main").is_file()
    {
        assert!(Instant::now() < deadline, "timed out waiting for cell audit refs");
        std::thread::sleep(Duration::from_millis(40));
    }

    assert!(run_taxis_cli(
        repo_dir,
        &["promotion", "stage", "--oid", &alpha_oid, "--agent", "alpha", "--summary", "Promote cell alpha", "--require-audit-tree"],
        TEST_AUTHORITY_HEX,
    ).status.success());
    assert!(run_taxis_cli(
        repo_dir,
        &["promotion", "reject", "--operator", "e2e-op", "--reason", "clear slot before staging cell beta"],
        TEST_AUTHORITY_HEX,
    ).status.success());
    assert!(run_taxis_cli(
        repo_dir,
        &["promotion", "stage", "--oid", &beta_oid, "--agent", "beta", "--summary", "Promote cell beta", "--require-audit-tree"],
        TEST_AUTHORITY_HEX,
    ).status.success());

    assert!(run_taxis_cli(repo_dir, &["--json", "daemon", "stop"], TEST_AUTHORITY_HEX).status.success());
    assert!(daemon_1.wait_exit(Duration::from_secs(6)).is_some_and(|st| st.success()));
}
