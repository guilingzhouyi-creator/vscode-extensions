//! Test Suite: Unattended Commit in the Engineering Edition
//! File Path: tests/rust/test_engineering_default_target.rs
//!
//! Before this suite existed, `init --dev` followed by `add` and `commit` could never succeed
//! unattended: the default target followed HEAD, HEAD named the protected trunk, and the trunk
//! requires a minted human authority token. Every escape route was closed — lowering the policy was
//! refused by the floor — so the ordinary commit command simply did not work without human help.
//!
//! The rule pinned here is narrow on purpose: only the *default* moves to the agent-writable sandbox.
//! Naming the trunk explicitly still demands a token, so promotion stays deliberate.

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

/// A message that satisfies the workspace-strict contract, including bilingual sections.
fn compliant_message(subject: &str) -> String {
    format!(
        "{subject}\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 需要一个满足契约的提交信息来验证默认目标行为。\n\n\
         [Added / 新增内容]\n- 新增 probe.txt。\n\n\
         [Verification / 验证结论]\n- 提交后可由 log 读回该提交。"
    )
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

/// Runs taxis in `dir`, returning (exit code, combined output).
fn run_in(dir: &Path, args: &[&str]) -> (i32, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(dir)
        .output()
        .expect("taxis must run");
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    (output.status.code().unwrap_or(-1), combined)
}

#[test]
fn first_commit_succeeds_without_a_token_or_flags() {
    let dir = test_temp_dir("eng-default-");
    prepared_repo(dir.path());

    let (code, text) = run_in(dir.path(), &["commit", "-m", &compliant_message("feat(core): 验证无令牌首次提交")]);
    assert_eq!(
        code, 0,
        "the ordinary commit command must work unattended, got:\n{text}"
    );
    assert!(
        text.contains("COMMIT_OK"),
        "a successful commit must say so:\n{text}"
    );
}

#[test]
fn the_redirect_to_sandbox_is_announced_not_silent() {
    let dir = test_temp_dir("eng-announce-");
    prepared_repo(dir.path());

    let (_, text) = run_in(dir.path(), &["commit", "-m", &compliant_message("feat(core): 验证默认目标提示")]);
    assert!(
        text.contains("sandbox"),
        "a commit that lands somewhere other than HEAD must say where:\n{text}"
    );
    assert!(
        text.contains("refs/fractal/cell/"),
        "the notice must name the actual ref so the work can be found:\n{text}"
    );
}

#[test]
fn naming_the_trunk_still_requires_a_human_token() {
    let dir = test_temp_dir("eng-trunk-");
    prepared_repo(dir.path());

    let (code, text) = run_in(
        dir.path(),
        &[
            "commit",
            "-m",
            &compliant_message("feat(core): 验证主干仍需人类授权"),
            "--target",
            "refs/heads/main",
        ],
    );
    assert_ne!(
        code, 0,
        "trunk protection must survive the default change, got:\n{text}"
    );
    assert!(
        text.contains("AUTHORITY_BREACH"),
        "the refusal must name the authority boundary:\n{text}"
    );
}

#[test]
fn log_finds_the_commit_even_though_head_is_unborn() {
    let dir = test_temp_dir("eng-log-");
    prepared_repo(dir.path());
    let (commit_code, _) =
        run_in(dir.path(), &["commit", "-m", &compliant_message("feat(core): 验证日志可见性")]);
    assert_eq!(commit_code, 0);

    // HEAD still names the unborn trunk, so a bare `log` must fall back rather than report nothing.
    let (code, text) = run_in(dir.path(), &["log"]);
    assert_eq!(
        code, 0,
        "log must not fail merely because HEAD is unborn, got:\n{text}"
    );
    assert!(
        text.contains("commit "),
        "log must show the commit that exists on another ref:\n{text}"
    );
    assert!(
        text.contains("HEAD is unborn"),
        "the fallback must explain itself instead of silently changing meaning:\n{text}"
    );
}

#[test]
fn an_explicit_bad_revision_still_fails_loudly() {
    // The fallback is only for the *default* revision. Naming a revision that does not exist is a
    // mistake and must not be papered over by showing unrelated history.
    let dir = test_temp_dir("eng-badrev-");
    prepared_repo(dir.path());
    run_in(dir.path(), &["commit", "-m", &compliant_message("feat(core): 验证显式版本解析")]);

    let (code, text) = run_in(dir.path(), &["log", "no-such-revision"]);
    assert_ne!(code, 0, "an unknown revision must fail:\n{text}");
}
