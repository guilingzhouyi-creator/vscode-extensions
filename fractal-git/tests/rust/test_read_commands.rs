//! Module: tests::test_read_commands — Read Commands Versus the Git Reference Baseline
//! File Path: tests/rust/test_read_commands.rs
//! Architecture Role: Proves `cat-file`, `ls-tree`, `ls-files`, `show-ref`, and `for-each-ref`
//!   answer with Git's bytes, exit statuses, and diagnostics on a repository Git created.
//! Dependencies & Triggers: Run by `cargo test --workspace`; requires the system git binary.
//! Responsibilities: Usage refusals, a missing index, pattern versus exact-ref matching, `--head`,
//!   and the streaming batch form including its missing-object diagnosis.
//! Exit Semantics & Design Rationale: Every expectation is produced by running git next to taxis in
//!   the same checkout. Re-asserting this crate's own conventions would let a shared mistake pass.
//!
//! Domain Governance Rules: FGT-COR-001 (differential parity), FGT-CLI-001.

use crate::cli_harness::system_git_available;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

/// Creates a unique repository-shaped scratch directory.
fn scratch_repo(label: &str) -> PathBuf {
    crate::cli_harness::scratch_repo("taxis_read", label)
}

/// Runs one git subcommand inside `repo`, failing the test on a non-zero status.
fn run_git(repo: &Path, args: &[&str]) -> Output {
    let output = Command::new("git")
        .arg("-c")
        .arg("init.defaultBranch=main")
        .arg("-c")
        .arg("user.name=Taxis Test")
        .arg("-c")
        .arg("user.email=test@taxis.internal")
        .arg("-c")
        .arg("commit.gpgsign=false")
        .arg("-c")
        .arg("core.autocrlf=false")
        .args(args)
        .current_dir(repo)
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

/// Runs the built `taxis` binary inside `repo` and returns its captured output.
fn run_taxis(repo: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(repo)
        .output()
        .expect("the built taxis binary must be runnable")
}

/// Runs `taxis` with `input` on standard input.
fn run_taxis_with_stdin(repo: &Path, args: &[&str], input: &str) -> Output {
    use std::io::Write;
    let mut child = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the built taxis binary must be runnable");
    child
        .stdin
        .as_mut()
        .expect("stdin is piped")
        .write_all(input.as_bytes())
        .expect("write stdin");
    child.wait_with_output().expect("collect output")
}

/// Creates a repository with one commit containing `a.txt`.
fn init_repo(label: &str) -> PathBuf {
    let repo = scratch_repo(label);
    run_git(&repo, &["init", "-q", "."]);
    fs::write(repo.join("a.txt"), "alpha\n").expect("write a.txt");
    run_git(&repo, &["add", "a.txt"]);
    run_git(&repo, &["commit", "-q", "-m", "init"]);
    repo
}

/// Git refuses `ls-tree` without a tree-ish and exits 129; defaulting to HEAD would answer a
/// question the caller never asked.
#[test]
fn ls_tree_requires_an_explicit_treeish() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_repo("ls_tree_usage");
    let git = Command::new("git")
        .args(["ls-tree"])
        .current_dir(&repo)
        .output()
        .expect("git ls-tree");
    assert_eq!(git.status.code(), Some(129));

    let taxis = run_taxis(&repo, &["ls-tree"]);
    assert_eq!(taxis.status.code(), Some(129));
    let stderr = String::from_utf8_lossy(&taxis.stderr);
    assert!(stderr.starts_with("usage:"), "unexpected stderr: {stderr}");
    assert!(
        stderr.contains("ls-tree"),
        "usage must name the command: {stderr}"
    );

    let listed = run_taxis(&repo, &["ls-tree", "HEAD"]);
    assert!(listed.status.success());
    let stdout = String::from_utf8_lossy(&listed.stdout);
    assert!(stdout.contains("a.txt"), "HEAD listing: {stdout}");
    let _ = fs::remove_dir_all(&repo);
}

/// A repository with no index lists nothing and exits 0, which is the state before the first add.
#[test]
fn ls_files_treats_a_missing_index_as_empty() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_repo("ls_files_no_index");
    fs::remove_file(repo.join(".git").join("index")).expect("remove index");

    let git = Command::new("git")
        .args(["ls-files"])
        .current_dir(&repo)
        .output()
        .expect("git ls-files");
    assert_eq!(git.status.code(), Some(0));
    assert!(git.stdout.is_empty());

    let taxis = run_taxis(&repo, &["ls-files"]);
    assert_eq!(taxis.status.code(), Some(0));
    assert!(taxis.stdout.is_empty());
    let _ = fs::remove_dir_all(&repo);
}

/// `show-ref` matches the tail of a reference name, `--verify` requires the full name, `--head`
/// prepends HEAD, and an unknown option is a usage error rather than a silently wider listing.
#[test]
fn show_ref_patterns_verify_and_head_agree_with_git() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_repo("show_ref");
    run_git(&repo, &["branch", "feature/main"]);
    run_git(&repo, &["tag", "v1"]);

    let pattern_taxis = run_taxis(&repo, &["show-ref", "main"]);
    let pattern_git = run_git(&repo, &["show-ref", "main"]);
    assert_eq!(pattern_taxis.stdout, pattern_git.stdout);
    let pattern_text = String::from_utf8_lossy(&pattern_taxis.stdout).to_string();
    assert!(pattern_text.contains("refs/heads/main"));
    assert!(pattern_text.contains("refs/heads/feature/main"));

    let exact_taxis = run_taxis(&repo, &["show-ref", "--verify", "refs/heads/main"]);
    let exact_git = run_git(&repo, &["show-ref", "--verify", "refs/heads/main"]);
    assert_eq!(exact_taxis.status.code(), Some(0));
    assert_eq!(exact_taxis.stdout, exact_git.stdout);

    let loose_taxis = run_taxis(&repo, &["show-ref", "--verify", "main"]);
    assert_eq!(loose_taxis.status.code(), Some(128));
    let stderr = String::from_utf8_lossy(&loose_taxis.stderr);
    assert!(stderr.contains("not a valid ref"), "stderr: {stderr}");

    let unknown_taxis = run_taxis(&repo, &["show-ref", "--frobnicate"]);
    assert_eq!(unknown_taxis.status.code(), Some(129));

    let head_taxis = run_taxis(&repo, &["show-ref", "--head"]);
    let head_git = run_git(&repo, &["show-ref", "--head"]);
    assert_eq!(head_taxis.stdout, head_git.stdout);
    let head_text = String::from_utf8_lossy(&head_taxis.stdout).to_string();
    assert!(head_text
        .lines()
        .next()
        .is_some_and(|line| line.ends_with(" HEAD")));

    let each_head = run_taxis(&repo, &["for-each-ref", "--head"]);
    assert_eq!(each_head.status.code(), Some(129));
    let _ = fs::remove_dir_all(&repo);
}

/// The streaming form answers each revision, reports misses inline, and keeps going; a one-shot
/// lookup would abort the whole run on the first unknown name.
#[test]
fn cat_file_batch_matches_git_byte_for_byte() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_repo("cat_file_batch");
    let request = "HEAD\nnope\n";

    let batch_taxis = run_taxis_with_stdin(&repo, &["cat-file", "--batch"], request);
    let batch_git = run_git_with_stdin(&repo, &["cat-file", "--batch"], request);
    assert_eq!(batch_taxis.status.code(), Some(0));
    assert_eq!(batch_taxis.stdout, batch_git.stdout);
    let batch_text = String::from_utf8_lossy(&batch_taxis.stdout).to_string();
    assert!(batch_text.contains("commit "), "header line: {batch_text}");
    assert!(
        batch_text.contains("nope missing"),
        "miss diagnosis: {batch_text}"
    );

    let check_taxis = run_taxis_with_stdin(&repo, &["cat-file", "--batch-check"], request);
    let check_git = run_git_with_stdin(&repo, &["cat-file", "--batch-check"], request);
    assert_eq!(check_taxis.stdout, check_git.stdout);
    let _ = fs::remove_dir_all(&repo);
}

/// Runs one git subcommand with `input` on standard input.
fn run_git_with_stdin(repo: &Path, args: &[&str], input: &str) -> Output {
    use std::io::Write;
    let mut child = Command::new("git")
        .args(args)
        .current_dir(repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("git must be runnable");
    child
        .stdin
        .as_mut()
        .expect("stdin is piped")
        .write_all(input.as_bytes())
        .expect("write stdin");
    child.wait_with_output().expect("collect output")
}
