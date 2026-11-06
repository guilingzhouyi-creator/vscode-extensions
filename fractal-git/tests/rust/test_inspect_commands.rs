//! Test Suite: Repository Inspection Commands
//! File Path: tests/rust/test_inspect_commands.rs
//!
//! These commands are read-only, so the properties worth pinning are about *answers* rather than
//! mutations: a search must report "nothing found" through its exit status, a count must reflect
//! what is actually on disk, and an unset attribute must be distinguishable from an explicitly
//! unset one.

use std::io::Write;
use std::path::Path;
use std::process::Command;

use crate::cli_harness::{run_in, test_temp_dir};

/// Initializes a repository, stages two files and commits them.
fn seeded_repo(dir: &Path) {
    let status = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["init", "--dev", "--workspace"])
        .arg(dir)
        .current_dir(dir)
        .status()
        .expect("init must run");
    assert!(status.success());

    let mut one = std::fs::File::create(dir.join("one.txt")).expect("create one");
    writeln!(one, "alpha line").expect("write one");
    writeln!(one, "needle here").expect("write one");
    let mut two = std::fs::File::create(dir.join("two.txt")).expect("create two");
    writeln!(two, "nothing relevant").expect("write two");
    let mut attrs = std::fs::File::create(dir.join(".gitattributes")).expect("create attrs");
    writeln!(attrs, "*.txt text=auto").expect("write attrs");

    run_in(dir, &["add", "one.txt"]);
    run_in(dir, &["add", "two.txt"]);

    let message = "feat(core): 建立检查命令验证用提交\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 需要内容与提交来验证检查类命令。\n\n\
         [Added / 新增内容]\n- 新增 one.txt 与 two.txt。\n\n\
         [Verification / 验证结论]\n- 检查命令可读取索引与提交。";
    let (code, stdout, stderr) = run_in(dir, &["commit", "-m", message]);
    assert_eq!(code, 0, "commit failed: {stdout}{stderr}");
}

#[test]
fn grep_finds_tracked_content_and_reports_the_line() {
    let dir = test_temp_dir("grep-hit-");
    seeded_repo(dir.path());

    let (code, stdout, _) = run_in(dir.path(), &["grep", "needle"]);
    assert_eq!(code, 0, "a match must exit 0");
    assert!(
        stdout.contains("one.txt:2:needle here"),
        "the match must name the file and line, got:\n{stdout}"
    );
    assert!(
        !stdout.contains("two.txt"),
        "a file without the pattern must not appear:\n{stdout}"
    );
}

#[test]
fn grep_exits_one_when_nothing_matched() {
    // The exit status is the entire value of `grep` in a script; returning 0 for "no match" would
    // make `if taxis grep pattern` unconditionally true.
    let dir = test_temp_dir("grep-miss-");
    seeded_repo(dir.path());

    let (code, stdout, _) = run_in(dir.path(), &["grep", "absent-token"]);
    assert_eq!(code, 1, "no match must exit 1 like git");
    assert!(stdout.trim().is_empty(), "no match must print nothing");
}

#[test]
fn grep_is_case_sensitive_unless_asked_otherwise() {
    let dir = test_temp_dir("grep-case-");
    seeded_repo(dir.path());

    let (strict_code, _, _) = run_in(dir.path(), &["grep", "NEEDLE"]);
    assert_eq!(strict_code, 1, "default matching is case sensitive");

    let (loose_code, stdout, _) = run_in(dir.path(), &["grep", "-i", "NEEDLE"]);
    assert_eq!(loose_code, 0, "-i must make the match case insensitive");
    assert!(stdout.contains("needle here"), "got:\n{stdout}");
}

#[test]
fn grep_ignores_untracked_files() {
    // `grep` answers "what would be committed", so a scratch file must not appear.
    let dir = test_temp_dir("grep-untracked-");
    seeded_repo(dir.path());
    let mut scratch = std::fs::File::create(dir.path().join("scratch.txt")).expect("create");
    writeln!(scratch, "needle in a scratch file").expect("write");

    let (code, stdout, _) = run_in(dir.path(), &["grep", "needle"]);
    assert_eq!(code, 0);
    assert!(
        !stdout.contains("scratch.txt"),
        "untracked content must not be searched:\n{stdout}"
    );
}

#[test]
fn count_objects_reports_the_objects_that_exist() {
    let dir = test_temp_dir("count-");
    seeded_repo(dir.path());

    let (code, stdout, _) = run_in(dir.path(), &["count-objects"]);
    assert_eq!(code, 0);
    let count: usize = stdout
        .split_whitespace()
        .next()
        .and_then(|token| token.parse().ok())
        .unwrap_or_else(|| panic!("expected a leading count, got: {stdout:?}"));
    assert!(
        count >= 3,
        "a commit with two files has at least a commit, a tree and blobs, got {count}"
    );
}

#[test]
fn check_attr_distinguishes_set_from_unspecified() {
    let dir = test_temp_dir("attr-");
    seeded_repo(dir.path());

    let (set_code, set_out, _) = run_in(dir.path(), &["check-attr", "text", "--", "one.txt"]);
    assert_eq!(set_code, 0);
    assert!(
        set_out.contains("text: auto"),
        "an assigned value must be reported verbatim:\n{set_out}"
    );

    let (none_code, none_out, _) = run_in(dir.path(), &["check-attr", "diff", "--", "one.txt"]);
    assert_eq!(none_code, 0);
    assert!(
        none_out.contains("diff: unspecified"),
        "an attribute no rule mentions is 'unspecified', not empty:\n{none_out}"
    );
}

#[test]
fn var_lists_configuration_and_reports_absence_through_status() {
    let dir = test_temp_dir("var-");
    seeded_repo(dir.path());

    let (list_code, list_out, _) = run_in(dir.path(), &["var", "-l"]);
    assert_eq!(list_code, 0);
    assert!(
        !list_out.trim().is_empty(),
        "a repository always has some configuration, got nothing"
    );

    let (miss_code, miss_out, _) = run_in(dir.path(), &["var", "no.such.key"]);
    assert_eq!(miss_code, 1, "an unset variable must exit 1");
    assert!(miss_out.trim().is_empty());
}

#[test]
fn shortlog_and_describe_answer_despite_an_unborn_head() {
    // The engineering edition commits to a sandbox ref while HEAD still names the protected trunk,
    // so these read-only commands must not report an empty repository that plainly is not empty.
    let dir = test_temp_dir("inspect-unborn-");
    seeded_repo(dir.path());

    let (shortlog_code, shortlog_out, _) = run_in(dir.path(), &["shortlog"]);
    assert_eq!(shortlog_code, 0);
    assert!(
        !shortlog_out.trim().is_empty(),
        "shortlog must summarise the commit that exists:\n{shortlog_out}"
    );

    let (describe_code, describe_out, describe_err) = run_in(dir.path(), &["describe"]);
    assert_eq!(
        describe_code, 0,
        "describe must answer for an existing commit: {describe_err}"
    );
    assert!(
        describe_out.trim().len() >= 7,
        "describe must print at least a short id, got:\n{describe_out}"
    );
}
