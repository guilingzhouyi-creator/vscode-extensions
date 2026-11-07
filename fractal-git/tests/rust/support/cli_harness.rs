//! Module: support::cli_harness — Shared CLI Integration Test Harness
//! File Path: tests/rust/support/cli_harness.rs
//! Architecture Role: Centralizes `taxis` and `git` subprocess invocation, temporary directory
//!   provisioning, and assertion helpers for CLI integration test suites.
//! Dependencies & Triggers: Included by CLI integration tests via `#[path = "support/cli_harness.rs"]`.
//! Responsibilities: Resolve the compiled `taxis` binary, execute `taxis`/`git` in isolated
//!   working directories with deterministic author identities, and assert exit status contracts.
//! Exit Semantics & Design Rationale: Panics with full stdout/stderr context on unexpected status.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use tempfile::TempDir;

static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Allocates a deterministic scratch directory under `target/test_tmp` with `<prefix>_<pid>_<seq>_<label>`.
pub fn scratch_repo(prefix: &str, label: &str) -> PathBuf {
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = std::fs::create_dir_all(&base);
    let path = base.join(format!("{prefix}_{}_{count}_{label}", std::process::id()));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).expect("scratch repository");
    path
}

/// Allocates an isolated temporary directory under `target/test_tmp` with the given prefix.
pub fn test_temp_dir(prefix: &str) -> TempDir {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("test_tmp");
    let _ = std::fs::create_dir_all(&base);
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(&base)
        .or_else(|_| tempfile::tempdir())
        .expect("create temporary test directory")
}

/// Runs the compiled `taxis` binary in `cwd` with the given arguments.
pub fn run_taxis(cwd: &Path, args: &[&str]) -> Output {
    let bin = env!("CARGO_BIN_EXE_taxis");
    Command::new(bin)
        .current_dir(cwd)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Taxis Harness")
        .env("GIT_AUTHOR_EMAIL", "harness@taxis.local")
        .env("GIT_COMMITTER_NAME", "Taxis Harness")
        .env("GIT_COMMITTER_EMAIL", "harness@taxis.local")
        .output()
        .expect("spawn taxis binary")
}

/// Runs `taxis` in `cwd`, asserts exit code 0, and returns trimmed stdout.
pub fn run_taxis_ok(cwd: &Path, args: &[&str]) -> String {
    let out = run_taxis(cwd, args);
    assert!(
        out.status.success(),
        "taxis {:?} failed (status {:?}):\nstdout: {}\nstderr: {}",
        args,
        out.status.code(),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Runs system `git` in `cwd` with deterministic identity and returns raw output.
pub fn run_git(cwd: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .current_dir(cwd)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Taxis Harness")
        .env("GIT_AUTHOR_EMAIL", "harness@taxis.local")
        .env("GIT_COMMITTER_NAME", "Taxis Harness")
        .env("GIT_COMMITTER_EMAIL", "harness@taxis.local")
        .output()
        .expect("spawn system git binary")
}

/// Runs `taxis` in `dir`, returning `(exit_code, stdout, stderr)`.
pub fn run_in(dir: &Path, args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(dir)
        .output()
        .expect("taxis must run");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    )
}

/// Runs system `git` in `cwd`, asserts exit code 0, and returns trimmed stdout.
pub fn run_git_ok(cwd: &Path, args: &[&str]) -> String {
    let out = run_git(cwd, args);
    assert!(
        out.status.success(),
        "git {:?} failed (status {:?}):\nstdout: {}\nstderr: {}",
        args,
        out.status.code(),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Returns a workspace-strict compliant commit message citing the changed file/symbol.
pub fn compliant_commit_msg(subject: &str, symbol_or_file: &str) -> String {
    let change_header = if subject.starts_with("fix(") {
        "[Fixed / 修复内容]"
    } else {
        "[Added / 新增内容]"
    };
    format!(
        "{subject}\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 验证托管小项目仓库的端到端 Git 等价性与双引用同步契约。\n\n\
         {change_header}\n- 新增或更新 `{symbol_or_file}` 实现代码与配套测试用例验证。\n\n\
         [Verification / 验证结论]\n- 通过系统 git fsck 与命令输出对拍验证 `{symbol_or_file}` 行为一致。"
    )
}

pub use compliant_commit_msg as compliant_msg;

/// Reports whether a usable system `git` binary is on PATH, probing at most once per process.
///
/// Thirteen test modules used to define their own copy of this predicate and call it on every
/// test, so a single `integration_cli` run spawned `git --version` dozens of times for an answer
/// that cannot change while the process lives. The probe costs roughly the same as a real git
/// invocation, which made the redundant calls a measurable share of wall clock. Caching the
/// verdict keeps the same fail-soft semantics — an absent or broken git still reports `false`
/// rather than panicking — while collapsing the repeated spawns to one.
pub fn system_git_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        Command::new("git")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    })
}
