//! Integration Test: Duplicate Daemon Lock Rejection & Stale Discovery Recovery
//! File Path: tests/rust/async_audit_e2e/recovery_test.rs
//! Architecture Role: Verifies active daemons reject conflicting `taxis daemon start` calls,
//!   offline status probes detect dead daemon metadata, and restarts reclaim stale sentinels.
//! Dependencies & Triggers: Invoked via `integration_governance`.
//! Responsibilities: Ensure daemon crash recovery restores clean `active=true` auditing.
//! Exit Semantics & Design Rationale: Stops spawned daemon instances reliably via `daemon stop`.

use std::fs;
use std::time::Duration;

use serde_json::Value;

use crate::cli_harness::scratch_scoped_dir;

use super::fixtures::init_dev_repo;
use super::harness::{
    run_taxis_cli, spawn_persistent_daemon, wait_for_audit_status, wait_for_daemon_meta,
};
use super::TEST_AUTHORITY_HEX;

#[test]
fn test_taxis_duplicate_daemon_rejection_and_stale_discovery_reclaim() {
    let guard = scratch_scoped_dir("taxis_async_recovery", "e2e");
    let repo_dir = guard.path();
    let taxis_dir = repo_dir.join(".taxis");
    init_dev_repo(repo_dir);
    let _ = fs::create_dir_all(taxis_dir.join("refs/heads"));

    let mut daemon_1 = spawn_persistent_daemon(repo_dir, "60", "5000");
    let meta_path = taxis_dir.join("daemon.json");
    let _ = wait_for_daemon_meta(&meta_path);

    let dup_out = run_taxis_cli(repo_dir, &["daemon", "start"], TEST_AUTHORITY_HEX);
    assert!(
        !dup_out.status.success(),
        "duplicate daemon start must reject when active daemon holds IPC"
    );
    assert!(run_taxis_cli(repo_dir, &["--json", "daemon", "stop"], TEST_AUTHORITY_HEX)
        .status
        .success());
    assert!(daemon_1.wait_exit(Duration::from_secs(6)).is_some_and(|st| st.success()));

    let dead_listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
    let dead_endpoint = dead_listener.local_addr().expect("local addr").to_string();
    drop(dead_listener);
    fs::write(
        &meta_path,
        format!(
            "{{\"pid\":999999,\"transport\":\"tcp\",\"endpoint\":\"{dead_endpoint}\",\"token_hex\":\"deadbeef\",\"manages_async_audit\":true,\"started_at_ms\":1}}"
        ),
    )
    .expect("plant stale daemon.json");
    fs::write(taxis_dir.join("daemon.stop"), b"stop\n").expect("plant stale daemon.stop");

    let stale_out = run_taxis_cli(repo_dir, &["--json", "audit", "status"], TEST_AUTHORITY_HEX);
    assert!(stale_out.status.success());
    let stale_json: Value = serde_json::from_slice(&stale_out.stdout).expect("stale json");
    assert_eq!(stale_json["stale_daemon_detected"], Value::Bool(true));

    let mut daemon_2 = spawn_persistent_daemon(repo_dir, "60", "5000");
    let restarted = wait_for_audit_status(repo_dir, |val| {
        val["active"] == Value::Bool(true) && val["stale_daemon_detected"] == Value::Bool(false)
    });
    assert!(restarted["active"] == Value::Bool(true));

    assert!(run_taxis_cli(repo_dir, &["--json", "daemon", "stop"], TEST_AUTHORITY_HEX)
        .status
        .success());
    assert!(daemon_2.wait_exit(Duration::from_secs(6)).is_some_and(|st| st.success()));
}
