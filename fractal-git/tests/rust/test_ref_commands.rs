//! Test Suite: Reference Plumbing and Reflog
//! File Path: tests/rust/test_ref_commands.rs
//!
//! These commands are what scripts and agents use to move refs safely, so the properties that matter
//! are the safety ones: a compare-and-swap mismatch must abort, a malformed ref name must be refused
//! before it reaches the store, and a read must not look like a write.
//!
//! `merge-base` is a predicate in `--is-ancestor` form, so it is asserted through the exit status
//! and the absence of output rather than through text, which is how a shell conditional consumes it.

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

/// Runs taxis in `dir`, returning (exit code, stdout, stderr).
fn run_in(dir: &Path, args: &[&str]) -> (i32, String, String) {
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

/// Initializes a repository and creates one commit, returning its object id.
fn repo_with_commit(dir: &Path) -> String {
    let status = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["init", "--dev", "--workspace"])
        .arg(dir)
        .current_dir(dir)
        .status()
        .expect("init must run");
    assert!(status.success());
    let mut handle = std::fs::File::create(dir.join("a.txt")).expect("create file");
    writeln!(handle, "a").expect("write file");
    run_in(dir, &["add", "a.txt"]);

    let message = "feat(core): 建立引用命令验证用提交\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 需要真实提交来验证引用读写。\n\n\
         [Added / 新增内容]\n- 新增 a.txt。\n\n\
         [Verification / 验证结论]\n- 引用命令可读写该提交。";
    let (code, stdout, stderr) = run_in(dir, &["commit", "-m", message]);
    assert_eq!(code, 0, "commit failed: {stdout}{stderr}");
    extract_oid(&stdout).unwrap_or_else(|| panic!("no oid in commit output: {stdout}"))
}

/// Extracts the first 40-hex-character run from `text`.
fn extract_oid(text: &str) -> Option<String> {
    text.split(|character: char| !character.is_ascii_hexdigit())
        .find(|candidate| candidate.len() == 40)
        .map(str::to_string)
}

#[test]
fn symbolic_ref_reports_the_checked_out_branch() {
    let dir = test_temp_dir("refsym-");
    repo_with_commit(dir.path());
    let (code, stdout, _) = run_in(dir.path(), &["symbolic-ref", "HEAD"]);
    assert_eq!(code, 0);
    assert!(
        stdout.trim().starts_with("refs/heads/"),
        "symbolic-ref HEAD must print a fully qualified branch, got: {stdout:?}"
    );
}

#[test]
fn update_ref_round_trips_a_value() {
    let dir = test_temp_dir("refupd-");
    let oid = repo_with_commit(dir.path());

    let (write_code, _, write_err) = run_in(dir.path(), &["update-ref", "refs/heads/side", &oid]);
    assert_eq!(write_code, 0, "write failed: {write_err}");

    let (read_code, stdout, _) = run_in(dir.path(), &["update-ref", "refs/heads/side"]);
    assert_eq!(read_code, 0);
    assert_eq!(
        stdout.trim(),
        oid,
        "reading a ref back must return exactly what was written"
    );
}

#[test]
fn update_ref_refuses_a_malformed_name() {
    let dir = test_temp_dir("refbad-");
    let oid = repo_with_commit(dir.path());

    for bad in ["refs/heads/a..b", "refs/heads/", "refs/heads/x~1"] {
        let (code, _, stderr) = run_in(dir.path(), &["update-ref", bad, &oid]);
        assert_ne!(
            code, 0,
            "a ref name Git forbids must be refused before it reaches the store: {bad}"
        );
        assert!(
            stderr.contains("not a valid ref name") || stderr.contains("may not"),
            "the refusal must explain what was wrong with {bad}: {stderr}"
        );
    }
}

#[test]
fn update_ref_compare_and_swap_mismatch_aborts() {
    let dir = test_temp_dir("refcas-");
    let oid = repo_with_commit(dir.path());
    run_in(dir.path(), &["update-ref", "refs/heads/side", &oid]);

    // The guard says "the ref must currently be this other value", which is false. Proceeding would
    // defeat the whole point of the guard for concurrent agents.
    let wrong = "1111111111111111111111111111111111111111";
    let (code, _, stderr) = run_in(dir.path(), &["update-ref", "refs/heads/side", &oid, wrong]);
    assert_ne!(code, 0, "a stale CAS guard must abort: {stderr}");
    assert!(
        stderr.contains("expected"),
        "the message must say what was expected: {stderr}"
    );

    // And the ref must be untouched.
    let (_, stdout, _) = run_in(dir.path(), &["update-ref", "refs/heads/side"]);
    assert_eq!(stdout.trim(), oid, "a rejected update must not move the ref");
}

#[test]
fn update_ref_deletes_and_then_reports_absence() {
    let dir = test_temp_dir("refdel-");
    let oid = repo_with_commit(dir.path());
    run_in(dir.path(), &["update-ref", "refs/heads/side", &oid]);

    let (delete_code, _, _) = run_in(dir.path(), &["update-ref", "-d", "refs/heads/side"]);
    assert_eq!(delete_code, 0, "delete must succeed");

    let (read_code, _, _) = run_in(dir.path(), &["update-ref", "refs/heads/side"]);
    assert_eq!(
        read_code, 1,
        "reading a deleted ref must exit 1 like git, not 0 with empty output"
    );
}

#[test]
fn merge_base_of_a_commit_with_itself_is_itself() {
    let dir = test_temp_dir("refmb-");
    let oid = repo_with_commit(dir.path());

    let (code, stdout, _) = run_in(dir.path(), &["merge-base", &oid, &oid]);
    assert_eq!(code, 0);
    assert_eq!(stdout.trim(), oid);
}

#[test]
fn is_ancestor_answers_through_the_exit_status_only() {
    let dir = test_temp_dir("refanc-");
    let oid = repo_with_commit(dir.path());

    let (code, stdout, _) = run_in(dir.path(), &["merge-base", "--is-ancestor", &oid, &oid]);
    assert_eq!(code, 0, "a commit is its own ancestor");
    assert!(
        stdout.trim().is_empty(),
        "--is-ancestor is a predicate and must print nothing, got: {stdout:?}"
    );
}

#[test]
fn reflog_shows_the_commit_that_was_made() {
    let dir = test_temp_dir("reflog-");
    let oid = repo_with_commit(dir.path());

    let (code, stdout, _) = run_in(dir.path(), &["reflog"]);
    assert_eq!(code, 0);
    assert!(
        stdout.contains(&oid),
        "the reflog must name the commit the repository actually made, got:\n{stdout}"
    );
    assert!(
        stdout.contains("commit"),
        "the entry must say which command produced it:\n{stdout}"
    );
}

#[test]
fn reflog_honours_a_limit() {
    let dir = test_temp_dir("refloglim-");
    repo_with_commit(dir.path());

    let (code, stdout, _) = run_in(dir.path(), &["reflog", "-n", "1"]);
    assert_eq!(code, 0);
    let entry_lines = stdout
        .lines()
        .filter(|line| line.contains("@{") )
        .count();
    assert!(
        entry_lines <= 1,
        "an explicit limit must be honoured, saw {entry_lines} entries:\n{stdout}"
    );
}
