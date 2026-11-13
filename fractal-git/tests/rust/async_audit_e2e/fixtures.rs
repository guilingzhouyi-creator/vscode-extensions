//! Integration Test Fixtures: Taxis Repo Init & IPC Commit Builders
//! File Path: tests/rust/async_audit_e2e/fixtures.rs
//! Architecture Role: Builds deterministic `taxis init --dev` workspaces and IPC `Commit`
//!   frames shared across async audit lifecycle, multi-cell, and crash-recovery tests.
//! Dependencies & Triggers: Consumed by `lifecycle_test`, `pause_cell_test`, and `recovery_test`.
//! Responsibilities: Eliminate duplicated workspace setup and IPC commit payload boilerplate.
//! Exit Semantics & Design Rationale: Assertions give clear diagnostics if initialization fails.

use std::path::Path;

use fractal_git::server::{IpcMessage, IpcStageEntry};

use super::harness::run_taxis_cli;
use super::TEST_AUTHORITY_HEX;

pub(super) fn init_dev_repo(repo_dir: &Path) {
    let init_out = run_taxis_cli(
        repo_dir,
        &["init", "--dev", "--workspace", &repo_dir.to_string_lossy()],
        TEST_AUTHORITY_HEX,
    );
    assert!(
        init_out.status.success(),
        "taxis init --dev failed: {}",
        String::from_utf8_lossy(&init_out.stderr)
    );
}

pub(super) fn make_ipc_commit(
    target_ref: &str,
    parent_oids: Vec<String>,
    files: &[(&str, &str)],
    message: &str,
    timestamp_sec: i64,
) -> IpcMessage {
    let entries = files
        .iter()
        .map(|(path, content)| IpcStageEntry {
            path: String::from(*path),
            mode: String::from("100644"),
            content: Some(String::from(*content)),
            oid: None,
        })
        .collect();
    IpcMessage::Commit {
        target_ref: String::from(target_ref),
        parent_oids,
        entries,
        message: String::from(message),
        author_name: String::from("E2E Harness"),
        author_email: String::from("e2e@taxis.local"),
        timestamp_sec: Some(timestamp_sec),
        tz_offset: Some(String::from("+0000")),
    }
}
