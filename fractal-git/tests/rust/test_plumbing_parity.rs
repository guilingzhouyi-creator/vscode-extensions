//! Module: tests::test_plumbing_parity — Log, Rev-List and Config Parity With System Git
//! File Path: tests/rust/test_plumbing_parity.rs
//! Architecture Role: Proves the history walker, rev-list revision arguments, log --all reference
//!   enumeration, and layered config loading answer with the same bytes and exit statuses as the
//!   system git binary.
//! Dependencies & Triggers: Run by cargo test; requires the system git binary as the oracle.
//! Responsibilities: Date-ordered log parity, --all tip enumeration, revision and exclusion
//!   arguments for rev-list, true reachable counts, and autocrlf inherited from a global config.
//! Exit Semantics & Design Rationale: Every expectation is produced by running git next to taxis in
//!   the same scratch checkout. Re-asserting this crate's own conventions would let a shared
//!   mistake pass, which is exactly how the previous history walk and rev-list arguments drifted.
//!
//! Domain Governance Rules: FGT-COR-001 (differential parity), FGT-CLI-001.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Monotonic counter keeping scratch directory names unique within one process.
static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Creates a unique scratch directory under the workspace tmp tree.
///
/// Scratch repositories live inside the workspace so the child processes under test can write them;
/// the system temporary directory is not writable for every runner this suite executes under.
fn scratch_dir(label: &str) -> PathBuf {
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("the crate directory has a parent workspace root");
    let base = workspace_root.join("tmp").join("plumbing-parity");
    let _ = fs::create_dir_all(&base);
    let path = base.join(format!("{}_{}_{}", std::process::id(), count, label));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("scratch directory");
    path
}

/// Removes the runner's own Git configuration overrides from a child environment.
///
/// The test runner exports GIT_CONFIG_COUNT plus GIT_CONFIG_KEY_n and GIT_CONFIG_VALUE_n entries for
/// its own git invocations. Those are command-scope configuration and outrank every file, so a child
/// that inherits them cannot observe the global config this suite is trying to exercise. Stripping
/// the whole family keeps the git oracle and taxis on the same three file layers.
fn strip_git_config_env(command: &mut Command) {
    command.env_remove("GIT_CONFIG_COUNT");
    command.env_remove("GIT_CONFIG_PARAMETERS");
    for index in 0..16 {
        command.env_remove(format!("GIT_CONFIG_KEY_{index}"));
        command.env_remove(format!("GIT_CONFIG_VALUE_{index}"));
    }
}

/// Reports whether the system git binary can be executed.
fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Skips the calling test when git is absent, unless the suite must not degrade.
fn skip_without_git(label: &str) -> bool {
    if git_available() {
        return false;
    }
    if std::env::var_os("TAXIS_REQUIRE_GIT").is_some() {
        panic!("TAXIS_REQUIRE_GIT is set but the system git binary is unavailable: {label}");
    }
    eprintln!("SKIP: git binary unavailable, parity for {label} is NOT verified");
    true
}

/// Builds the baseline git command used for fixture construction.
fn git_command(repo: &Path) -> Command {
    let mut command = Command::new("git");
    strip_git_config_env(&mut command);
    command
        .current_dir(repo)
        .arg("-c")
        .arg("init.defaultBranch=main")
        .arg("-c")
        .arg("user.name=Parity Test")
        .arg("-c")
        .arg("user.email=parity@taxis.internal")
        .arg("-c")
        .arg("commit.gpgsign=false")
        .arg("-c")
        .arg("core.autocrlf=false");
    command
}

/// Runs git and fails the test on a non-zero status.
fn run_git(repo: &Path, args: &[&str]) -> Output {
    let output = git_command(repo)
        .args(args)
        .output()
        .expect("the system git binary must be runnable");
    assert!(
        output.status.success(),
        "git {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

/// Runs the built taxis binary inside repo and returns its captured output.
fn run_taxis(repo: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(repo)
        .output()
        .expect("the built taxis binary must be runnable")
}

/// Decodes captured standard output as text with platform newlines folded to LF.
fn stdout_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).replace("\r\n", "\n")
}

/// Writes one fixture file.
fn write_file(repo: &Path, name: &str, contents: &str) {
    fs::write(repo.join(name), contents).expect("fixture file");
}

/// Creates one commit with fixed author and committer dates.
fn commit_at(repo: &Path, message: &str, stamp: &str) {
    let output = git_command(repo)
        .args(["commit", "-q", "--allow-empty", "-m", message])
        .env("GIT_AUTHOR_DATE", stamp)
        .env("GIT_COMMITTER_DATE", stamp)
        .output()
        .expect("the system git binary must be runnable");
    assert!(
        output.status.success(),
        "git commit {:?} failed: {}",
        message,
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Builds a history whose breadth-first order and commit-date order disagree.
///
/// The merge tip is newest, the main parent is second-oldest, and the side parent is newer than the
/// main one. A breadth-first walk lists the main parent before the side parent, so this fixture fails
/// any walker that does not break ties by committer date.
fn build_history(repo: &Path) {
    run_git(repo, &["init", "-q", "-b", "main", "."]);
    write_file(repo, "base.txt", "base\n");
    run_git(repo, &["add", "base.txt"]);
    commit_at(repo, "c0 base", "2026-01-01T00:00:00+0000");

    write_file(repo, "m1.txt", "m1\n");
    run_git(repo, &["add", "m1.txt"]);
    commit_at(repo, "m1 main", "2026-01-01T00:00:02+0000");

    run_git(repo, &["checkout", "-q", "-b", "side", "HEAD~1"]);
    write_file(repo, "f1.txt", "f1\n");
    run_git(repo, &["add", "f1.txt"]);
    commit_at(repo, "f1 side", "2026-01-01T00:00:04+0000");

    write_file(repo, "f2.txt", "f2\n");
    run_git(repo, &["add", "f2.txt"]);
    commit_at(repo, "f2 side", "2026-01-01T00:00:05+0000");

    run_git(repo, &["checkout", "-q", "main"]);
    let output = git_command(repo)
        .args(["merge", "-q", "--no-ff", "-m", "M merge", "side"])
        .env("GIT_AUTHOR_DATE", "2026-01-01T00:00:06+0000")
        .env("GIT_COMMITTER_DATE", "2026-01-01T00:00:06+0000")
        .output()
        .expect("the system git binary must be runnable");
    assert!(
        output.status.success(),
        "git merge failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Builds the git argument vector for a rev-list invocation.
fn rev_list_args<'a>(args: &'a [&'a str]) -> Vec<&'a str> {
    let mut full = vec!["rev-list"];
    full.extend_from_slice(args);
    full
}

/// Compares git and taxis stdout and exit status for one invocation pair.
fn assert_parity(repo: &Path, git_args: &[&str], taxis_args: &[&str], topic: &str) {
    let git = run_git(repo, git_args);
    let taxis = run_taxis(repo, taxis_args);
    assert_eq!(
        taxis.status.code(),
        git.status.code(),
        "{topic}: exit status differs (git {:?}, taxis {:?}) stderr={}",
        git_args,
        taxis_args,
        String::from_utf8_lossy(&taxis.stderr)
    );
    assert_eq!(
        stdout_text(&taxis),
        stdout_text(&git),
        "{topic}: stdout differs (git {:?}, taxis {:?})",
        git_args,
        taxis_args
    );
}

#[test]
fn log_orders_commits_like_git_date_order() {
    if skip_without_git("log date order") {
        return;
    }
    let repo = scratch_dir("log_order");
    build_history(&repo);
    let expected = "M merge\nf2 side\nf1 side\nm1 main\nc0 base\n";
    let git = run_git(&repo, &["log", "--date-order", "--format=%s"]);
    assert_eq!(stdout_text(&git), expected, "fixture date order");
    let taxis = run_taxis(&repo, &["log", "--format=%s"]);
    assert_eq!(
        stdout_text(&taxis),
        stdout_text(&git),
        "taxis log order differs from git log --date-order"
    );
    assert_eq!(taxis.status.code(), git.status.code());
}

#[test]
fn log_all_walks_every_reference_tip() {
    if skip_without_git("log --all") {
        return;
    }
    let repo = scratch_dir("log_all");
    build_history(&repo);
    let git = run_git(&repo, &["log", "--all", "--format=%s"]);
    let taxis = run_taxis(&repo, &["log", "--all", "--format=%s"]);
    assert_eq!(
        stdout_text(&taxis),
        stdout_text(&git),
        "taxis log --all differs from git log --all"
    );
    assert!(
        stdout_text(&taxis).contains("f1 side"),
        "log --all must reach the side branch tip"
    );
}

#[test]
fn log_all_is_quiet_in_an_unborn_repository() {
    if skip_without_git("log --all unborn") {
        return;
    }
    let repo = scratch_dir("log_all_unborn");
    run_git(&repo, &["init", "-q", "-b", "main", "."]);
    let git = run_git(&repo, &["log", "--all", "--format=%s"]);
    let taxis = run_taxis(&repo, &["log", "--all", "--format=%s"]);
    assert_eq!(stdout_text(&taxis), "", "log --all must print nothing");
    assert_eq!(taxis.status.code(), Some(0), "log --all must exit 0");
    assert_eq!(stdout_text(&taxis), stdout_text(&git));
}

#[test]
fn rev_list_counts_reachable_commits_for_revision_arguments() {
    if skip_without_git("rev-list --count revisions") {
        return;
    }
    let repo = scratch_dir("rev_list_count");
    build_history(&repo);
    let cases: [(&[&str], &str); 5] = [
        (&["--count", "main"], "5\n"),
        (&["--count", "side"], "3\n"),
        (&["--count", "main", "^side"], "2\n"),
        (&["--count", "main", "--not", "side"], "2\n"),
        (&["--count", "-n", "2", "main"], "2\n"),
    ];
    for (args, expected) in cases {
        let git = run_git(&repo, &rev_list_args(args));
        let taxis = run_taxis(&repo, &rev_list_args(args));
        assert_eq!(
            stdout_text(&git),
            expected,
            "git fixture count for {:?}",
            args
        );
        assert_eq!(
            stdout_text(&taxis),
            expected,
            "taxis rev-list {:?} count differs",
            args
        );
        assert_eq!(
            taxis.status.code(),
            git.status.code(),
            "exit status for {:?}",
            args
        );
    }
}

#[test]
fn rev_list_prints_oids_for_revision_and_exclusion_arguments() {
    if skip_without_git("rev-list oids") {
        return;
    }
    let repo = scratch_dir("rev_list_oids");
    build_history(&repo);
    let cases: [&[&str]; 3] = [&["main"], &["side"], &["main", "^side"]];
    for args in cases {
        assert_parity(
            &repo,
            &rev_list_args(args),
            &rev_list_args(args),
            "rev-list oid list",
        );
    }
    // A leading --not flips every following revision, including a bare branch name.
    let args: &[&str] = &["--not", "side", "main"];
    let git = run_git(&repo, &rev_list_args(args));
    let taxis = run_taxis(&repo, &rev_list_args(args));
    assert_eq!(stdout_text(&taxis), stdout_text(&git));
}

/// Writes a global git config whose core.autocrlf is provided through an include file.
fn included_global_config(config_root: &Path) -> PathBuf {
    let included = config_root.join("autocrlf.cfg");
    fs::write(&included, "[core]\n\tautocrlf = true\n").expect("included config");
    let global = config_root.join("gitconfig");
    fs::write(
        &global,
        "[include]\n\tpath = autocrlf.cfg\n[user]\n\tname = CRLF Test\n\temail = crlf@taxis.internal\n[commit]\n\tgpgsign = false\n",
    )
    .expect("global config");
    global
}

/// Runs git with only the supplied global config as ambient configuration.
fn isolated_git(repo: &Path, global: &Path) -> Command {
    let mut command = Command::new("git");
    strip_git_config_env(&mut command);
    command
        .current_dir(repo)
        .env("GIT_CONFIG_GLOBAL", global)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .arg("-c")
        .arg("commit.gpgsign=false");
    command
}

/// Runs git with the supplied global config and fails the test on a non-zero status.
fn run_isolated_git(repo: &Path, args: &[&str], global: &Path) -> Output {
    let output = isolated_git(repo, global)
        .args(args)
        .output()
        .expect("the system git binary must be runnable");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

/// Runs taxis with the supplied global config as its only ambient configuration.
fn run_taxis_with_global(repo: &Path, args: &[&str], global: &Path) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_taxis"));
    strip_git_config_env(&mut command);
    command
        .args(args)
        .current_dir(repo)
        .env("GIT_CONFIG_GLOBAL", global)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .expect("the built taxis binary must be runnable")
}

/// Builds one commit whose index stores LF while the worktree holds CRLF.
fn build_crlf_repository(repo: &Path, global: &Path) {
    run_isolated_git(repo, &["init", "-q", "-b", "main", "."], global);
    fs::write(repo.join("a.txt"), "one\r\n").expect("write a.txt");
    run_isolated_git(repo, &["add", "a.txt"], global);
    run_isolated_git(repo, &["commit", "-q", "-m", "init"], global);
    fs::write(repo.join("a.txt"), "one\r\n").expect("rewrite a.txt");
}

/// Compares git and taxis under one explicit global config.
fn assert_parity_isolated(repo: &Path, args: &[&str], global: &Path, topic: &str) {
    let git = run_isolated_git(repo, args, global);
    let taxis = run_taxis_with_global(repo, args, global);
    assert_eq!(
        stdout_text(&taxis),
        stdout_text(&git),
        "{topic}: stdout differs, taxis stderr={}",
        String::from_utf8_lossy(&taxis.stderr)
    );
    assert_eq!(
        stdout_text(&taxis),
        "",
        "{topic}: a clean tree must print nothing"
    );
    assert_eq!(
        taxis.status.code(),
        git.status.code(),
        "{topic}: exit status differs"
    );
}

#[test]
fn status_honours_autocrlf_inherited_through_an_include_file() {
    if skip_without_git("status autocrlf include") {
        return;
    }
    let repo = scratch_dir("crlf_include_repo");
    let config_root = scratch_dir("crlf_include_config");
    let global = included_global_config(&config_root);
    build_crlf_repository(&repo, &global);
    let reported = run_isolated_git(&repo, &["config", "--get", "core.autocrlf"], &global);
    assert_eq!(
        stdout_text(&reported).trim(),
        "true",
        "oracle must see autocrlf"
    );
    assert_parity_isolated(
        &repo,
        &["status", "--short"],
        &global,
        "status with global autocrlf",
    );
}

#[test]
fn status_honours_autocrlf_set_directly_in_the_global_config() {
    if skip_without_git("status autocrlf global") {
        return;
    }
    let repo = scratch_dir("crlf_global_repo");
    let config_root = scratch_dir("crlf_global_config");
    let global = config_root.join("gitconfig");
    fs::write(
        &global,
        "[core]\n\tautocrlf = true\n[user]\n\tname = CRLF Test\n\temail = crlf@taxis.internal\n[commit]\n\tgpgsign = false\n",
    )
    .expect("global config");
    build_crlf_repository(&repo, &global);
    assert_parity_isolated(
        &repo,
        &["status", "--short"],
        &global,
        "status with global autocrlf",
    );
}
