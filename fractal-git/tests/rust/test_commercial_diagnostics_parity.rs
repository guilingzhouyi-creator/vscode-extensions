//! Module: tests::test_commercial_diagnostics_parity — Industrial Diagnostic Logging Parity
//! File Path: tests/rust/test_commercial_diagnostics_parity.rs
//! Architecture Role: Proves passive background JSONL diagnostic recording,
//!   trace correlation, and sensitive token redaction meet commercial standards.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Validate dual-track logging (clean stderr vs structured JSONL on disk).
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-CLI-001`: Subcommand contract and telemetry parity

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn scratch_repo(label: &str) -> PathBuf {
    crate::cli_harness::scratch_repo("taxis_diag", label)
}

fn run_taxis(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_taxis"));
    cmd.args(args)
        .current_dir(repo)
        .env_remove("TAXIS_LOG")
        .env_remove("TAXIS_DIAGNOSTIC")
        .env_remove("TAXIS_DEV_MODE");
    for (k, v) in envs {
        cmd.env(k, v);
    }
    cmd.output()
        .expect("the built taxis binary must be runnable")
}

#[test]
fn default_commercial_mode_writes_passive_jsonl_log() {
    let repo = scratch_repo("passive_log");
    let init_out = run_taxis(&repo, &["init", "--dev"], &[]);
    assert!(init_out.status.success());

    // Commit with an invalid message violating length and structure
    let commit_out = run_taxis(&repo, &["commit", "-m", "short"], &[]);
    assert!(!commit_out.status.success());

    // 1. Verify terminal stderr is clean (no internal rule IDs, clean 'error:' prefix)
    let stderr = String::from_utf8_lossy(&commit_out.stderr);
    assert!(stderr.contains("error:"));
    assert!(
        !stderr.contains("FGT-MSG-"),
        "terminal must hide raw rule ID: {stderr}"
    );
    assert!(
        !stderr.contains("[COMMIT_GOVERNANCE_FAIL]"),
        "terminal must hide raw tag: {stderr}"
    );

    // 2. Verify passive JSONL log was recorded on disk
    let log_path = repo.join(".taxis/diagnostics/taxis.jsonl");
    assert!(
        log_path.is_file(),
        "diagnostic log file must exist at {}",
        log_path.display()
    );

    let content = fs::read_to_string(&log_path).expect("read diagnostic log");
    assert!(!content.trim().is_empty(), "log file must contain records");

    let lines: Vec<&str> = content.lines().collect();
    assert!(
        lines.len() >= 2,
        "must record command_dispatch and rejection events"
    );

    // 3. Verify structured JSON schema
    let mut saw_rejection = false;
    for line in lines {
        let val: serde_json::Value =
            serde_json::from_str(line).expect("each line must be valid JSON");
        assert!(val.get("timestamp").is_some());
        assert!(val.get("level").is_some());
        assert!(val.get("target").is_some());
        assert!(val.get("trace_id").is_some());
        assert!(val.get("pid").is_some());
        assert!(val.get("edition").is_some());

        let trace_id = val["trace_id"].as_str().unwrap_or_default();
        assert!(
            trace_id.starts_with("tx-"),
            "trace_id must start with tx-: {trace_id}"
        );

        if val["event"].as_str() == Some("rejection") {
            saw_rejection = true;
            assert!(
                val.get("rule_id").is_some(),
                "rejection record must retain rule_id in JSONL audit trail"
            );
        }
    }
    assert!(
        saw_rejection,
        "must have recorded a structured rejection audit event"
    );

    let _ = fs::remove_dir_all(&repo);
}
#[test]
fn sensitive_tokens_are_redacted_in_passive_log() {
    let repo = scratch_repo("redact_log");
    let init_out = run_taxis(&repo, &["init", "--dev"], &[]);
    assert!(init_out.status.success());

    // Dispatch command containing confidential token
    let secret = "secret_auth_token_999";
    let _ = run_taxis(
        &repo,
        &["commit", "-m", "ordinary commit", "--token", secret],
        &[],
    );

    let log_path = repo.join(".taxis/diagnostics/taxis.jsonl");
    if log_path.is_file() {
        let content = fs::read_to_string(&log_path).expect("read diagnostic log");
        assert!(
            !content.contains(secret),
            "secret token must be redacted from disk log: {content}"
        );
        assert!(
            content.contains("***REDACTED***"),
            "redaction sentinel must be present: {content}"
        );
    }

    let _ = fs::remove_dir_all(&repo);
}
#[test]
fn diagnostics_cli_tool_queries_status_and_tail() {
    let repo = scratch_repo("diag_tool");
    let init_out = run_taxis(&repo, &["init", "--dev"], &[]);
    assert!(init_out.status.success());

    // 1. Query diagnostics status
    let status_out = run_taxis(&repo, &["diagnostics", "status"], &[]);
    assert!(status_out.status.success());
    let stdout = String::from_utf8_lossy(&status_out.stdout);
    assert!(stdout.contains("Taxis Commercial Diagnostics System"));
    assert!(stdout.contains("Active Trace ID"));
    assert!(stdout.contains("taxis.jsonl"));

    // 2. Query diagnostics path
    let path_out = run_taxis(&repo, &["diagnostics", "path"], &[]);
    assert!(path_out.status.success());
    let path_str = String::from_utf8_lossy(&path_out.stdout);
    assert!(path_str.contains("taxis.jsonl"));

    // 3. Query diagnostics tail
    let tail_out = run_taxis(&repo, &["diagnostics", "tail"], &[]);
    assert!(tail_out.status.success());

    let _ = fs::remove_dir_all(&repo);
}
