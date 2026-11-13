//! Module: support::cli_harness — Shared CLI Integration Test Harness
//! File Path: tests/rust/support/cli_harness.rs
//! Architecture Role: Centralizes `taxis` and `git` subprocess invocation, temporary directory
//!   provisioning, baseline repository template caching, and assertion helpers for CLI integration test suites.
//! Dependencies & Triggers: Included by CLI integration tests via `#[path = "support/cli_harness.rs"]`.
//! Responsibilities: Resolve the compiled `taxis` binary, execute `taxis`/`git` in isolated
//!   working directories with deterministic author identities, accelerate test fixture initialization
//!   via cached bare and dev repository templates, and assert exit status contracts.
//! Exit Semantics & Design Rationale: Panics with full stdout/stderr context on unexpected status.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-PRF-001`: Zero transient heap allocation guard in hot loops

#![allow(dead_code)]

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use tempfile::TempDir;

#[path = "sandbox_guard.rs"]
mod sandbox_guard;
pub use sandbox_guard::{purge_stale_scratch, ScratchDirGuard};

static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);
static TEST_TMP_BASE: OnceLock<PathBuf> = OnceLock::new();
static PURGED_SUITES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

/// Returns the cached root path for integration test scratch directories (`target/test_tmp`).
///
/// Ensures the base directory is resolved and created at most once per test process,
/// eliminating redundant `create_dir_all` and `current_dir` syscalls across fixtures.
pub fn test_tmp_base() -> &'static Path {
    TEST_TMP_BASE.get_or_init(|| {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&base);
        purge_stale_scratch(&base);
        base
    })
}

/// Allocates a deterministic scratch directory under `target/test_tmp` with `<prefix>_<pid>_<seq>_<label>`.
pub fn scratch_repo(prefix: &str, label: &str) -> PathBuf {
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = test_tmp_base();
    let path = base.join(format!("{prefix}_{}_{count}_{label}", std::process::id()));
    if std::fs::create_dir(&path).is_err() {
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("scratch repository");
    }
    path
}

/// Allocates a deterministic scratch directory wrapped in an auto-reclaiming [`ScratchDirGuard`].
pub fn scratch_repo_guard(prefix: &str, label: &str) -> ScratchDirGuard {
    ScratchDirGuard::new(scratch_repo(prefix, label))
}

/// Allocates an auto-reclaiming scratch directory under `target/test_tmp/<suite>`.
pub fn scratch_scoped_dir(suite: &str, label: &str) -> ScratchDirGuard {
    let base = test_tmp_base().join(suite);
    let _ = std::fs::create_dir_all(&base);
    let purged = PURGED_SUITES.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(mut guard) = purged.lock() {
        if guard.insert(suite.to_string()) {
            purge_stale_scratch(&base);
        }
    }
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = base.join(format!("{}_{}_{}", std::process::id(), count, label));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).expect("create suite scratch directory");
    ScratchDirGuard::new(path)
}

/// Allocates an isolated temporary directory under `target/test_tmp` with the given prefix.
pub fn test_temp_dir(prefix: &str) -> TempDir {
    let base = test_tmp_base();
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(base)
        .or_else(|_| tempfile::tempdir())
        .expect("create temporary test directory")
}

/// Lazily initialized, process-isolated bare Git repository template created once via `git init --bare`.
///
/// Tests can quickly replicate this template into new fixtures via [`provision_bare_repo`]
/// or [`scratch_bare_repo`], reducing per-test initialization overhead by avoiding repeated
/// subprocess execution of `git init --bare`.
pub fn baseline_bare_template() -> &'static Path {
    static TEMPLATE: OnceLock<PathBuf> = OnceLock::new();
    TEMPLATE.get_or_init(|| {
        let path =
            test_tmp_base().join(format!("baseline_bare_template_{}.git", std::process::id()));
        if !path.join("HEAD").exists() {
            let _ = std::fs::create_dir_all(&path);
            let _ = Command::new("git")
                .args(["init", "--quiet", "--bare"])
                .current_dir(&path)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        path
    })
}

/// Lazily initialized, process-isolated `taxis init --dev` repository template.
///
/// Tests can replicate this template via [`provision_dev_repo`] instead of spawning
/// `taxis init --dev` repeatedly across tests.
pub fn baseline_dev_template() -> &'static Path {
    static TEMPLATE: OnceLock<PathBuf> = OnceLock::new();
    TEMPLATE.get_or_init(|| {
        let path = test_tmp_base().join(format!("baseline_dev_template_{}", std::process::id()));
        if !path.join(".taxis").exists() {
            let _ = std::fs::create_dir_all(&path);
            let _ = Command::new(env!("CARGO_BIN_EXE_taxis"))
                .args(["init", "--dev"])
                .current_dir(&path)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        path
    })
}

/// Recursively copies a directory tree, optimized for fast fixture replication without subprocesses.
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        std::fs::create_dir_all(dst)?;
    }
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target_path)?;
        } else {
            std::fs::copy(entry.path(), &target_path)?;
        }
    }
    Ok(())
}

/// Quickly provisions a bare repository by copying the cached baseline bare template,
/// falling back to `git init --bare` if the template is not accessible.
pub fn provision_bare_repo(target: &Path) {
    let template = baseline_bare_template();
    if template.join("HEAD").exists() && copy_dir_recursive(template, target).is_ok() {
        return;
    }
    let _ = Command::new("git")
        .args(["init", "--quiet", "--bare"])
        .current_dir(target)
        .output();
}

/// Quickly provisions a `taxis --dev` repository by copying the cached dev template,
/// falling back to `taxis init --dev` if the template is not accessible.
pub fn provision_dev_repo(target: &Path) {
    let template = baseline_dev_template();
    if template.join(".taxis").exists() && copy_dir_recursive(template, target).is_ok() {
        return;
    }
    let _ = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["init", "--dev"])
        .current_dir(target)
        .output();
}

/// Allocates an isolated bare repository initialized from the cached baseline template.
pub fn scratch_bare_repo(prefix: &str, label: &str) -> PathBuf {
    let repo_path = scratch_repo(prefix, label);
    provision_bare_repo(&repo_path);
    repo_path
}

/// Builds a preconfigured [`Command`] for the `taxis` binary in `cwd`.
pub fn taxis_cmd_in(cwd: &Path, args: &[&str]) -> Command {
    let bin = env!("CARGO_BIN_EXE_taxis");
    let mut cmd = Command::new(bin);
    cmd.current_dir(cwd)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Taxis Harness")
        .env("GIT_AUTHOR_EMAIL", "harness@taxis.local")
        .env("GIT_COMMITTER_NAME", "Taxis Harness")
        .env("GIT_COMMITTER_EMAIL", "harness@taxis.local");
    cmd
}

/// Runs the compiled `taxis` binary in `cwd` with the given arguments.
pub fn run_taxis(cwd: &Path, args: &[&str]) -> Output {
    taxis_cmd_in(cwd, args)
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

/// Builds a preconfigured [`Command`] for system `git` in `cwd`.
pub fn git_cmd_in(cwd: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Taxis Harness")
        .env("GIT_AUTHOR_EMAIL", "harness@taxis.local")
        .env("GIT_COMMITTER_NAME", "Taxis Harness")
        .env("GIT_COMMITTER_EMAIL", "harness@taxis.local");
    cmd
}

/// Runs system `git` in `cwd` with deterministic identity and returns raw output.
pub fn run_git(cwd: &Path, args: &[&str]) -> Output {
    git_cmd_in(cwd, args)
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
    let change_header = if subject.starts_with("fix(") || subject.starts_with("fix!(") {
        "[Fixed / 修复内容]"
    } else if subject.starts_with("refactor(")
        || subject.starts_with("refactor!(")
        || subject.starts_with("perf(")
        || subject.starts_with("perf!(")
    {
        "[Changed / 变更调整]"
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

/// Reports whether the compiled `taxis` binary is executable, probing at most once per process.
pub fn system_taxis_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        let bin = env!("CARGO_BIN_EXE_taxis");
        Command::new(bin)
            .arg("version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    })
}
