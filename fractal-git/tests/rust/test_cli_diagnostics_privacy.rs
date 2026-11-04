//! Test Suite: CLI Diagnostics Privacy & Rule ID Sanitization
//! File Path: tests/rust/test_cli_diagnostics_privacy.rs
//!
//! Verifies that internal governance rule identifiers (e.g. `FGT-MSG-*`, `GUARD-MSG-*`),
//! raw bracketed debugging tags (`[COMMIT_GOVERNANCE_FAIL]`), and telemetry scores
//! are strictly hidden from terminal end-users during ordinary commercial operation,
//! while remaining fully accessible when diagnostic / debug mode is explicitly invoked.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Creates a temporary directory inside the crate's `target/` tree.
fn test_temp_dir(prefix: &str) -> tempfile::TempDir {
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = std::fs::create_dir_all(&base);
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(&base)
        .or_else(|_| tempfile::tempdir())
        .expect("create test tempdir")
}

/// Initializes a repository and stages one file; returns the repository root.
fn prepared_repo(dir: &Path) {
    let status = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["init", "--dev", "--workspace"])
        .arg(dir)
        .current_dir(dir)
        .status()
        .expect("init must run");
    assert!(status.success());
    let mut handle = std::fs::File::create(dir.join("probe.txt")).expect("create file");
    writeln!(handle, "content").expect("write file");
    let add = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["add", "probe.txt"])
        .current_dir(dir)
        .output()
        .expect("add must run");
    assert!(add.status.success(), "add must succeed");
}

/// Runs taxis with clean environment, returning (exit code, stdout, stderr).
fn run_cmd(dir: &Path, args: &[&str], envs: &[(&str, &str)]) -> (i32, String, String) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_taxis"));
    cmd.args(args)
        .current_dir(dir)
        .env_remove("TAXIS_LOG")
        .env_remove("TAXIS_DIAGNOSTIC")
        .env_remove("TAXIS_DEV_MODE");
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let output = cmd.output().expect("taxis must run");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    )
}

#[test]
fn default_commercial_mode_hides_rule_ids_and_debug_tags() {
    let dir = test_temp_dir("diag-privacy-default-");
    prepared_repo(dir.path());

    // Commit with an invalid message violating length and structure
    let (code, _, stderr) = run_cmd(dir.path(), &["commit", "-m", "short"], &[]);
    assert_ne!(code, 0, "commit with invalid message must be rejected");

    // Must present standard error prefix
    assert!(
        stderr.contains("error: commit message rejected:"),
        "stderr must format with clean 'error:' prefix, got:\n{stderr}"
    );

    // Rule IDs must NOT be exposed to normal terminal end users
    assert!(
        !stderr.contains("FGT-MSG-"),
        "stderr must not leak FGT-MSG rule IDs in commercial mode, got:\n{stderr}"
    );
    assert!(
        !stderr.contains("GUARD-MSG-"),
        "stderr must not leak GUARD-MSG rule IDs in commercial mode, got:\n{stderr}"
    );

    // Debug bracket tags and telemetry scores must NOT be exposed
    assert!(
        !stderr.contains("[COMMIT_GOVERNANCE_FAIL]"),
        "stderr must not expose [COMMIT_GOVERNANCE_FAIL] badge in commercial mode, got:\n{stderr}"
    );
    assert!(
        !stderr.contains("score="),
        "stderr must not leak telemetry score= in commercial mode, got:\n{stderr}"
    );
    assert!(
        !stderr.contains("violations="),
        "stderr must not dump raw violations= vector in commercial mode, got:\n{stderr}"
    );
}

#[test]
fn diagnostic_flag_exposes_rule_ids_for_developer_triage() {
    let dir = test_temp_dir("diag-privacy-debug-");
    prepared_repo(dir.path());

    // Invoking with --debug activates diagnostic triage
    let (code, _, stderr) = run_cmd(dir.path(), &["--debug", "commit", "-m", "short"], &[]);
    assert_ne!(code, 0, "commit with invalid message must be rejected");

    // In diagnostic mode, the rule code and debug badge are displayed
    assert!(
        stderr.contains("[FGT-MSG-") || stderr.contains("FGT-MSG-"),
        "stderr must include FGT-MSG rule identifier in diagnostic mode, got:\n{stderr}"
    );
    assert!(
        stderr.contains("[COMMIT_GOVERNANCE_FAIL]"),
        "stderr must include [COMMIT_GOVERNANCE_FAIL] badge in diagnostic mode, got:\n{stderr}"
    );
}

#[test]
fn env_diagnostic_mode_exposes_rule_ids() {
    let dir = test_temp_dir("diag-privacy-env-");
    prepared_repo(dir.path());

    // Setting TAXIS_DIAGNOSTIC=1 activates diagnostic mode
    let (code, _, stderr) = run_cmd(
        dir.path(),
        &["commit", "-m", "short"],
        &[("TAXIS_DIAGNOSTIC", "1")],
    );
    assert_ne!(code, 0, "commit with invalid message must be rejected");

    assert!(
        stderr.contains("[FGT-MSG-") || stderr.contains("FGT-MSG-"),
        "stderr must include FGT-MSG rule identifier when TAXIS_DIAGNOSTIC=1, got:\n{stderr}"
    );
}
