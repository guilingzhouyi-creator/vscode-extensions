//! Module: support::branch_test_fixtures — Shared Branch Governance Test Helpers
//! File Path: tests/rust/support/branch_test_fixtures.rs
//! Architecture Role: Provisions deterministic Strict and Advisory test repositories seeded with
//!   initial commits, symbolic `refs/heads/main`, and authority credential helpers.
//! Dependencies & Triggers: Included via `tests/integration_cli.rs`; consumes `crate::cli_harness`.
//! Responsibilities: Centralize `run_taxis_with_auth`, `compliant_kernel_msg`, repo seeding,
//!   and `cascade_checkout` helpers across split branch integration test suites.
//! Exit Semantics & Design Rationale: Fails fast with stdout/stderr diagnostics on fixture error.

#![allow(dead_code)]

use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use fg_core::models::authority::AUTHORITY_SECRET_ENV;

use crate::cli_harness::{run_taxis, run_taxis_ok};

pub const TEST_AUTHORITY_HEX: &str =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

pub fn run_taxis_with_auth(cwd: &Path, args: &[&str], auth_secret: Option<&str>) -> Output {
    let bin = env!("CARGO_BIN_EXE_taxis");
    let mut cmd = Command::new(bin);
    cmd.current_dir(cwd)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Taxis Harness")
        .env("GIT_AUTHOR_EMAIL", "harness@taxis.local")
        .env("GIT_COMMITTER_NAME", "Taxis Harness")
        .env("GIT_COMMITTER_EMAIL", "harness@taxis.local");
    match auth_secret {
        Some(secret) => {
            cmd.env(AUTHORITY_SECRET_ENV, secret);
        }
        None => {
            cmd.env_remove(AUTHORITY_SECRET_ENV);
        }
    }
    cmd.output().expect("spawn taxis binary")
}

pub fn compliant_kernel_msg(subject: &str, symbol: &str) -> String {
    format!(
        "{subject}\n\n[Project]\nfractal-git\n\n[Why]\nVerify five-tier kernel branch standardization and vault integrity.\n\n[Added]\n- Exercise `{symbol}` across strict fractal workflow.\n\n[Verification]\nAll kernel assertions verified deterministically against `{symbol}`."
    )
}

pub fn init_advisory_committed_repo(repo: &Path) {
    let init = run_taxis(repo, &["init", "--dev"]);
    assert!(
        init.status.success(),
        "taxis init --dev failed: {}",
        String::from_utf8_lossy(&init.stderr)
    );
    fs::write(repo.join("README.md"), "fractal baseline\n").expect("write README.md");
    assert!(run_taxis(repo, &["add", "README.md"]).status.success());
    let msg = compliant_kernel_msg("feat(core): initialize fractal baseline", "README.md");
    let commit = run_taxis(repo, &["commit", "-m", &msg]);
    assert!(
        commit.status.success(),
        "initial commit failed: {}{}",
        String::from_utf8_lossy(&commit.stdout),
        String::from_utf8_lossy(&commit.stderr)
    );
    let sha = run_taxis_ok(repo, &["rev-parse", "refs/fractal/cell/cell-default/main"]);
    run_taxis_ok(repo, &["update-ref", "refs/heads/main", &sha]);
}

pub fn init_strict_repo_with_main_seed(repo: &Path) {
    let init = run_taxis_with_auth(repo, &["init", "--dev", "--strict", "--lock-policy"], None);
    assert!(
        init.status.success(),
        "taxis init --dev --strict --lock-policy failed: {}",
        String::from_utf8_lossy(&init.stderr)
    );
    fs::write(repo.join("README.md"), "kernel strict baseline\n").expect("write README.md");
    assert!(run_taxis(repo, &["add", "README.md"]).status.success());
    let msg = compliant_kernel_msg("feat(core): seed strict kernel baseline", "README.md");
    let commit = run_taxis_with_auth(repo, &["commit", "-m", &msg], Some(TEST_AUTHORITY_HEX));
    assert!(
        commit.status.success(),
        "seed commit failed: {}\n{}",
        String::from_utf8_lossy(&commit.stdout),
        String::from_utf8_lossy(&commit.stderr)
    );
    let sha = run_taxis_ok(repo, &["rev-parse", "refs/fractal/cell/governance/main"]);
    let upd = run_taxis(repo, &["update-ref", "refs/heads/main", &sha]);
    assert!(
        upd.status.success(),
        "seed main ref failed: {}",
        String::from_utf8_lossy(&upd.stderr)
    );
    let head = run_taxis(repo, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    assert!(
        head.status.success(),
        "seed symbolic HEAD failed: {}",
        String::from_utf8_lossy(&head.stderr)
    );
}

pub fn cascade_checkout(repo: &Path, slug: &str, expected_short: &str) {
    let br = run_taxis(repo, &["branch", "--cascade", slug]);
    assert!(
        br.status.success(),
        "taxis branch --cascade {slug} failed: {}\n{}",
        String::from_utf8_lossy(&br.stdout),
        String::from_utf8_lossy(&br.stderr)
    );
    let co = run_taxis(repo, &["checkout", expected_short]);
    assert!(
        co.status.success(),
        "taxis checkout {expected_short} failed: {}\n{}",
        String::from_utf8_lossy(&co.stdout),
        String::from_utf8_lossy(&co.stderr)
    );
}
