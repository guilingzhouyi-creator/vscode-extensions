//! Module: tests::test_cli_contract_parity — Command Output and Exit Status Parity With System Git
//! File Path: tests/rust/test_cli_contract_parity.rs
//! Architecture Role: Proves the read and working-copy commands answer with the same bytes, the
//!   same stream, and the same exit statuses as the system git binary.
//! Dependencies & Triggers: Run by cargo test; requires the system git binary as the oracle.
//! Responsibilities: cat-file option matrix and failure diagnoses, ls-tree path filtering and
//!   ordering, show-ref verification and empty-repository status, rev-list argument handling,
//!   status rendering, silent branch mutation, checkout narration, and declared non-UTF-8 commit
//!   messages.
//! Exit Semantics & Design Rationale: Every expectation is produced by running git next to taxis in
//!   an identically built scratch checkout. Re-asserting this crate's own conventions would let a
//!   shared mistake pass, which is exactly how the previous command surface drifted away from git.
//!
//! Domain Governance Rules: FGT-COR-001 (differential parity), FGT-CLI-001.

use crate::cli_harness::{scratch_scoped_dir, system_git_available, ScratchDirGuard};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

/// A well-formed object name that cannot exist in any fixture repository.
const ABSENT_OID: &str = "0123456789012345678901234567890123456789";

/// Allocates an isolated auto-reclaiming scratch directory under `target/test_tmp/cli-parity`.
fn scratch_dir(label: &str) -> ScratchDirGuard {
    scratch_scoped_dir("cli-parity", label)
}

/// Removes the runner's own Git configuration overrides from a child environment.
///
/// The test runner exports GIT_CONFIG_COUNT plus GIT_CONFIG_KEY_n and GIT_CONFIG_VALUE_n entries for
/// its own git invocations. Those are command-scope configuration and outrank every file, so a child
/// that inherits them cannot observe the repository this suite builds. Stripping the whole family
/// keeps the git oracle and taxis on the same three file layers.
fn strip_git_config_env(command: &mut Command) {
    command.env_remove("GIT_CONFIG_COUNT");
    command.env_remove("GIT_CONFIG_PARAMETERS");
    for index in 0..16 {
        command.env_remove(format!("GIT_CONFIG_KEY_{index}"));
        command.env_remove(format!("GIT_CONFIG_VALUE_{index}"));
    }
}

/// Reports whether a usable system `git` is on PATH (memoised in the shared harness).
fn git_available() -> bool {
    system_git_available()
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

/// Builds the baseline git command used for fixture construction and oracle invocation.
///
/// Detached-HEAD advice is disabled so the oracle prints the same single status line taxis prints:
/// git emits its multi-line lecture once per repository, which would make the oracle depend on how
/// many times a test has already detached.
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
        .arg("core.autocrlf=false")
        .arg("-c")
        .arg("advice.detachedHead=false");
    command
}

/// Runs git and fails the test on a non-zero status.
fn run_git(repo: &Path, args: &[&str]) -> Output {
    let output = run_git_raw(repo, args);
    assert!(
        output.status.success(),
        "git {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

/// Runs git without asserting on the exit status, for oracle cases that must fail.
fn run_git_raw(repo: &Path, args: &[&str]) -> Output {
    git_command(repo)
        .args(args)
        .output()
        .expect("the system git binary must be runnable")
}

/// Runs git with the supplied bytes on standard input.
fn run_git_stdin(repo: &Path, args: &[&str], input: &[u8]) -> Output {
    let mut child = git_command(repo)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the system git binary must be spawnable");
    child
        .stdin
        .as_mut()
        .expect("piped stdin")
        .write_all(input)
        .expect("write git stdin");
    child.wait_with_output().expect("git output")
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

/// Decodes captured standard error as text with platform newlines folded to LF.
fn stderr_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).replace("\r\n", "\n")
}

/// Writes one fixture file, creating parent directories as needed.
fn write_file(repo: &Path, name: &str, contents: &str) {
    let path = repo.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("fixture directory");
    }
    fs::write(path, contents).expect("fixture file");
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

/// Builds a repository with a file, a nested file, and one commit.
fn build_fixture(repo: &Path) {
    run_git(repo, &["init", "-q", "-b", "main", "."]);
    write_file(repo, "a.txt", "alpha\n");
    write_file(repo, "dir/b.txt", "beta\n");
    run_git(repo, &["add", "a.txt", "dir/b.txt"]);
    commit_at(repo, "c0 base", "2026-01-01T00:00:00+0000");
}

/// Returns the object id HEAD points at.
fn head_oid(repo: &Path) -> String {
    let output = run_git(repo, &["rev-parse", "HEAD"]);
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Compares git and taxis exit status and stdout for one invocation pair.
fn assert_parity(repo: &Path, git_args: &[&str], taxis_args: &[&str], topic: &str) {
    let git = run_git_raw(repo, git_args);
    let taxis = run_taxis(repo, taxis_args);
    assert_eq!(
        taxis.status.code(),
        git.status.code(),
        "{topic}: exit status differs (git {:?} -> {:?}, taxis {:?} -> {:?}) git stderr={} taxis stderr={}",
        git_args,
        git.status.code(),
        taxis_args,
        taxis.status.code(),
        stderr_text(&git),
        stderr_text(&taxis)
    );
    assert_eq!(
        stdout_text(&taxis),
        stdout_text(&git),
        "{topic}: stdout differs (git {:?}, taxis {:?})",
        git_args,
        taxis_args
    );
}

/// Compares git and taxis exit status, stdout, and stderr for one invocation pair.
fn assert_full_parity(repo: &Path, git_args: &[&str], taxis_args: &[&str], topic: &str) {
    let git = run_git_raw(repo, git_args);
    let taxis = run_taxis(repo, taxis_args);
    assert_eq!(
        taxis.status.code(),
        git.status.code(),
        "{topic}: exit status differs (git {:?}, taxis {:?})",
        git_args,
        taxis_args
    );
    assert_eq!(
        stdout_text(&taxis),
        stdout_text(&git),
        "{topic}: stdout differs"
    );
    assert_eq!(
        stderr_text(&taxis),
        stderr_text(&git),
        "{topic}: stderr differs (git {:?})",
        git_args
    );
}

/// Builds the repo pair a state-mutating command needs: one checkout for the oracle, one for taxis.
///
/// Running both commands in the same checkout would hand the second one a repository the first one
/// already changed, so the comparison would measure the order of the calls instead of their parity.
fn twin_fixtures(label: &str) -> (ScratchDirGuard, ScratchDirGuard) {
    let oracle = scratch_dir(&format!("{label}_git"));
    let candidate = scratch_dir(&format!("{label}_taxis"));
    build_fixture(&oracle);
    build_fixture(&candidate);
    (oracle, candidate)
}

/// The option matrix of `cat-file` must agree on both the printed answer and the exit status.
#[test]
fn cat_file_option_matrix_matches_git() {
    if skip_without_git("cat-file option matrix") {
        return;
    }
    let repo = scratch_dir("cat_file_matrix");
    build_fixture(&repo);

    let cases: Vec<&[&str]> = vec![
        &["cat-file", "-t", "HEAD"],
        &["cat-file", "-s", "HEAD"],
        &["cat-file", "-p", "HEAD"],
        &["cat-file", "-e", "HEAD"],
        &["cat-file", "-t", "HEAD:a.txt"],
        &["cat-file", "-e", "HEAD:a.txt"],
        &["cat-file", "-p", "HEAD:dir/b.txt"],
        &["cat-file", "-s", "HEAD:dir/b.txt"],
        &["cat-file", "-t", "HEAD:dir"],
        &["cat-file", "-t", "HEAD:"],
    ];
    for case in cases {
        assert_parity(&repo, case, case, "cat-file option matrix");
    }

    let mismatch = run_git_raw(&repo, &["cat-file", "tree", "HEAD:a.txt"]);
    assert_eq!(mismatch.status.code(), Some(128));
    assert_full_parity(
        &repo,
        &["cat-file", "tree", "HEAD:a.txt"],
        &["cat-file", "tree", "HEAD:a.txt"],
        "cat-file explicit type mismatch",
    );
    let _ = fs::remove_dir_all(&repo);
}

/// Missing ids and malformed revisions must fail with git's own diagnosis and status.
#[test]
fn cat_file_reports_missing_objects_like_git() {
    if skip_without_git("cat-file failure diagnoses") {
        return;
    }
    let repo = scratch_dir("cat_file_failures");
    build_fixture(&repo);

    let revision_failures: [&[&str]; 8] = [
        &["cat-file", "-e", ABSENT_OID],
        &["cat-file", "-p", ABSENT_OID],
        &["cat-file", "-t", ABSENT_OID],
        &["cat-file", "-s", ABSENT_OID],
        &["cat-file", "blob", ABSENT_OID],
        &["cat-file", "-p", "HEAD:nope"],
        &["cat-file", "-t", "HEAD:nope"],
        &["cat-file", "-p", "nosuchrev:nope"],
    ];
    for case in revision_failures {
        assert_full_parity(&repo, case, case, "cat-file revision failure");
    }

    // `-e` also refuses a missing path inside a resolvable revision, with 128 rather than 1: the
    // well-formed-id shortcut only applies to a bare object name.
    assert_full_parity(
        &repo,
        &["cat-file", "-e", "HEAD:nope"],
        &["cat-file", "-e", "HEAD:nope"],
        "cat-file -e path",
    );

    // A malformed command line is a usage error (129), not a fatal object error.
    for case in [&["cat-file", "-t"][..], &["cat-file", "HEAD"][..]] {
        let git = run_git_raw(&repo, case);
        assert_eq!(git.status.code(), Some(129), "git {:?} status", case);
        assert_parity(&repo, case, case, "cat-file usage error");
    }
    let _ = fs::remove_dir_all(&repo);
}

/// Path filters and trailing slashes select the same rows git selects.
#[test]
fn ls_tree_path_filters_match_git() {
    if skip_without_git("ls-tree path filters") {
        return;
    }
    let repo = scratch_dir("ls_tree_paths");
    build_fixture(&repo);

    let cases: [&[&str]; 6] = [
        &["ls-tree", "HEAD"],
        &["ls-tree", "HEAD", "a.txt", "dir/"],
        &["ls-tree", "HEAD", "dir/", "a.txt"],
        &["ls-tree", "HEAD", "dir"],
        &["ls-tree", "HEAD", "dir/"],
        &["ls-tree", "HEAD", "missing"],
    ];
    for case in cases {
        assert_parity(&repo, case, case, "ls-tree path filter");
    }
    let _ = fs::remove_dir_all(&repo);
}

/// Recursion and subtree inclusion keep git's ordering and row set.
#[test]
fn ls_tree_recursion_matches_git() {
    if skip_without_git("ls-tree recursion") {
        return;
    }
    let repo = scratch_dir("ls_tree_recursion");
    build_fixture(&repo);

    let cases: [&[&str]; 4] = [
        &["ls-tree", "-r", "HEAD", "dir"],
        &["ls-tree", "-t", "-r", "HEAD"],
        &["ls-tree", "-d", "HEAD", "dir"],
        &["ls-tree", "--name-only", "HEAD"],
    ];
    for case in cases {
        assert_parity(&repo, case, case, "ls-tree recursion");
    }
    let _ = fs::remove_dir_all(&repo);
}

/// A non-tree argument is fatal, and a missing tree-ish is a usage error.
#[test]
fn ls_tree_rejects_non_trees_like_git() {
    if skip_without_git("ls-tree non-tree rejection") {
        return;
    }
    let repo = scratch_dir("ls_tree_rejects");
    build_fixture(&repo);

    assert_full_parity(
        &repo,
        &["ls-tree", "HEAD:a.txt"],
        &["ls-tree", "HEAD:a.txt"],
        "ls-tree non-tree argument",
    );
    assert_full_parity(
        &repo,
        &["ls-tree", "nosuch"],
        &["ls-tree", "nosuch"],
        "ls-tree unknown revision",
    );
    assert_full_parity(
        &repo,
        &["ls-tree", ABSENT_OID],
        &["ls-tree", ABSENT_OID],
        "ls-tree absent object",
    );

    let git = run_git_raw(&repo, &["ls-tree"]);
    assert_eq!(git.status.code(), Some(129));
    assert_parity(&repo, &["ls-tree"], &["ls-tree"], "ls-tree usage");
    let _ = fs::remove_dir_all(&repo);
}

/// Pattern matching, `--verify`, and `--head` agree with git row for row.
#[test]
fn show_ref_patterns_and_verify_match_git() {
    if skip_without_git("show-ref patterns") {
        return;
    }
    let repo = scratch_dir("show_ref_patterns");
    build_fixture(&repo);
    run_git(&repo, &["branch", "feature/main"]);
    run_git(&repo, &["tag", "v1"]);

    let cases: [&[&str]; 8] = [
        &["show-ref"],
        &["show-ref", "--head"],
        &["show-ref", "--heads"],
        &["show-ref", "main"],
        &["show-ref", "--verify", "refs/heads/main"],
        &["show-ref", "--verify", "HEAD"],
        &["show-ref", "--verify", "--head", "HEAD"],
        &["show-ref", "--verify", "HEAD", "refs/heads/main"],
    ];
    for case in cases {
        assert_parity(&repo, case, case, "show-ref patterns");
    }

    // A name that is not a reference is fatal even though it may look like one.
    assert_full_parity(
        &repo,
        &["show-ref", "--verify", "missing"],
        &["show-ref", "--verify", "missing"],
        "show-ref verify miss",
    );
    let _ = fs::remove_dir_all(&repo);
}

/// An empty repository answers differently for show-ref and for-each-ref, and `--verify` without a
/// name is a fatal configuration error rather than a usage error.
#[test]
fn show_ref_reports_an_empty_repository_like_git() {
    if skip_without_git("show-ref empty repository") {
        return;
    }
    let repo = scratch_dir("show_ref_empty");
    run_git(&repo, &["init", "-q", "-b", "main", "."]);

    for case in [&["show-ref"][..], &["show-ref", "--head"][..]] {
        let git = run_git_raw(&repo, case);
        assert_eq!(git.status.code(), Some(1), "git {:?} status", case);
        assert_parity(&repo, case, case, "show-ref empty repository");
    }

    assert_parity(
        &repo,
        &["for-each-ref"],
        &["for-each-ref"],
        "for-each-ref empty repository",
    );
    assert_full_parity(
        &repo,
        &["show-ref", "--verify", "HEAD"],
        &["show-ref", "--verify", "HEAD"],
        "show-ref verify HEAD in empty repository",
    );
    assert_parity(
        &repo,
        &["show-ref", "--verify"],
        &["show-ref", "--verify"],
        "show-ref verify without a name",
    );
    let _ = fs::remove_dir_all(&repo);
}

/// rev-list refuses a call without revisions, honours exclusions, and prints the same ids.
#[test]
fn rev_list_requires_a_revision_and_honours_exclusions() {
    if skip_without_git("rev-list arguments") {
        return;
    }
    let repo = scratch_dir("rev_list_args");
    build_fixture(&repo);
    run_git(&repo, &["branch", "side"]);

    for case in [
        &["rev-list"][..],
        &["rev-list", "--count"][..],
        &["rev-list", "-n", "2"][..],
        &["rev-list", "--not"][..],
    ] {
        let git = run_git_raw(&repo, case);
        assert_eq!(git.status.code(), Some(129), "git {:?} status", case);
        assert_parity(&repo, case, case, "rev-list without revisions");
    }

    let cases: [&[&str]; 6] = [
        &["rev-list", "HEAD"],
        &["rev-list", "HEAD", "--not", "HEAD"],
        &["rev-list", "--count", "HEAD"],
        &["rev-list", "--all"],
        &["rev-list", "--not", "--all"],
        &["rev-list", "main", "^side"],
    ];
    for case in cases {
        assert_parity(&repo, case, case, "rev-list revisions");
    }
    let _ = fs::remove_dir_all(&repo);
}

/// `rev-list --count` answers with the number of reachable commits git counts.
#[test]
fn rev_list_counts_reachable_commits_like_git() {
    if skip_without_git("rev-list counts") {
        return;
    }
    let repo = scratch_dir("rev_list_counts");
    run_git(&repo, &["init", "-q", "-b", "main", "."]);
    write_file(&repo, "base.txt", "base\n");
    run_git(&repo, &["add", "base.txt"]);
    commit_at(&repo, "c0 base", "2026-01-01T00:00:00+0000");
    write_file(&repo, "m1.txt", "m1\n");
    run_git(&repo, &["add", "m1.txt"]);
    commit_at(&repo, "m1 main", "2026-01-01T00:00:02+0000");
    run_git(&repo, &["checkout", "-q", "-b", "side", "HEAD~1"]);
    write_file(&repo, "f1.txt", "f1\n");
    run_git(&repo, &["add", "f1.txt"]);
    commit_at(&repo, "f1 side", "2026-01-01T00:00:04+0000");
    run_git(&repo, &["checkout", "-q", "main"]);

    let cases: [&[&str]; 4] = [
        &["rev-list", "--count", "main"],
        &["rev-list", "--count", "side"],
        &["rev-list", "--count", "main", "^side"],
        &["rev-list", "--count", "-n", "2", "main"],
    ];
    for case in cases {
        assert_parity(&repo, case, case, "rev-list count");
    }
    let _ = fs::remove_dir_all(&repo);
}

/// Clean and unborn repositories render the same long status text.
#[test]
fn status_matches_git_for_clean_and_unborn_repositories() {
    if skip_without_git("status rendering") {
        return;
    }
    let clean = scratch_dir("status_clean");
    build_fixture(&clean);
    assert_full_parity(&clean, &["status"], &["status"], "status clean");
    assert_parity(
        &clean,
        &["status", "--short"],
        &["status", "--short"],
        "status clean short",
    );

    let unborn = scratch_dir("status_unborn");
    run_git(&unborn, &["init", "-q", "-b", "main", "."]);
    assert_full_parity(&unborn, &["status"], &["status"], "status unborn");
    assert_parity(
        &unborn,
        &["status", "--short"],
        &["status", "--short"],
        "status unborn short",
    );
    let _ = fs::remove_dir_all(&clean);
    let _ = fs::remove_dir_all(&unborn);
}

/// Creating and renaming a branch prints nothing on success, exactly like git.
#[test]
fn branch_mutation_stays_silent_like_git() {
    if skip_without_git("branch mutation") {
        return;
    }
    let (oracle, candidate) = twin_fixtures("branch_silent");

    let git_created = run_git_raw(&oracle, &["branch", "topic"]);
    let taxis_created = run_taxis(&candidate, &["branch", "topic"]);
    assert_eq!(taxis_created.status.code(), git_created.status.code());
    assert_eq!(stdout_text(&taxis_created), stdout_text(&git_created));
    assert_eq!(stderr_text(&taxis_created), stderr_text(&git_created));

    let git_renamed = run_git_raw(&oracle, &["branch", "-m", "topic", "topic2"]);
    let taxis_renamed = run_taxis(&candidate, &["branch", "-m", "topic", "topic2"]);
    assert_eq!(taxis_renamed.status.code(), git_renamed.status.code());
    assert_eq!(stdout_text(&taxis_renamed), stdout_text(&git_renamed));
    assert_eq!(stderr_text(&taxis_renamed), stderr_text(&git_renamed));

    let git_listed = run_git_raw(&oracle, &["branch"]);
    let taxis_listed = run_taxis(&candidate, &["branch"]);
    assert_eq!(taxis_listed.status.code(), git_listed.status.code());
    assert_eq!(stdout_text(&taxis_listed), stdout_text(&git_listed));

    let _ = fs::remove_dir_all(&oracle);
    let _ = fs::remove_dir_all(&candidate);
}

/// Switching branches is narrated on stderr and keeps stdout empty.
#[test]
fn checkout_reports_branch_switches_like_git() {
    if skip_without_git("checkout branch narration") {
        return;
    }
    let (oracle, candidate) = twin_fixtures("checkout_branch");

    let git_created = run_git_raw(&oracle, &["checkout", "-b", "feat"]);
    let taxis_created = run_taxis(&candidate, &["checkout", "-b", "feat"]);
    assert_eq!(
        taxis_created.status.code(),
        git_created.status.code(),
        "checkout -b status"
    );
    assert_eq!(stdout_text(&taxis_created), stdout_text(&git_created));
    assert_eq!(stderr_text(&taxis_created), stderr_text(&git_created));

    let git_switched = run_git_raw(&oracle, &["checkout", "main"]);
    let taxis_switched = run_taxis(&candidate, &["checkout", "main"]);
    assert_eq!(
        taxis_switched.status.code(),
        git_switched.status.code(),
        "checkout branch status"
    );
    assert_eq!(stdout_text(&taxis_switched), stdout_text(&git_switched));
    assert_eq!(stderr_text(&taxis_switched), stderr_text(&git_switched));

    let _ = fs::remove_dir_all(&oracle);
    let _ = fs::remove_dir_all(&candidate);
}

/// Detaching at an object id prints the single status line git prints with advice disabled.
#[test]
fn checkout_reports_a_detached_head_like_git() {
    if skip_without_git("checkout detached narration") {
        return;
    }
    let (oracle, candidate) = twin_fixtures("checkout_detached");
    let oid = head_oid(&oracle);
    assert_eq!(
        oid,
        head_oid(&candidate),
        "the fixtures must be byte identical"
    );

    let git_detached = run_git_raw(&oracle, &["checkout", &oid]);
    let taxis_detached = run_taxis(&candidate, &["checkout", &oid]);
    assert_eq!(
        taxis_detached.status.code(),
        git_detached.status.code(),
        "checkout detached status"
    );
    assert_eq!(stdout_text(&taxis_detached), stdout_text(&git_detached));
    assert_eq!(stderr_text(&taxis_detached), stderr_text(&git_detached));

    let _ = fs::remove_dir_all(&oracle);
    let _ = fs::remove_dir_all(&candidate);
}

/// A commit that declares ISO-8859-1 in its encoding header is shown as the same text git shows.
#[test]
fn log_decodes_a_declared_non_utf8_commit_message_like_git() {
    if skip_without_git("log declared encoding") {
        return;
    }
    let repo = scratch_dir("log_encoding");
    build_fixture(&repo);

    let tree = {
        let output = run_git(&repo, &["rev-parse", "HEAD^{tree}"]);
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };
    let mut payload = Vec::new();
    payload.extend_from_slice(format!("tree {tree}\n").as_bytes());
    payload.extend_from_slice(b"author Parity Test <parity@taxis.internal> 1767225600 +0000\n");
    payload.extend_from_slice(b"committer Parity Test <parity@taxis.internal> 1767225600 +0000\n");
    payload.extend_from_slice(b"encoding ISO-8859-1\n\n");
    payload.extend_from_slice(b"caf\xe9 latin1 message\n");

    let written = run_git_stdin(
        &repo,
        &["hash-object", "-w", "-t", "commit", "--stdin"],
        &payload,
    );
    assert!(
        written.status.success(),
        "git hash-object failed: {}",
        stderr_text(&written)
    );
    let commit_oid = String::from_utf8_lossy(&written.stdout).trim().to_string();
    run_git(&repo, &["update-ref", "refs/heads/main", &commit_oid]);

    assert_full_parity(
        &repo,
        &["log", "--format=%s"],
        &["log", "--format=%s"],
        "log declared encoding",
    );
    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn diff_cli_parity_working_tree_and_staged() {
    if skip_without_git("diff parity") {
        return;
    }
    let repo = scratch_dir("diff_parity");
    build_fixture(&repo);

    // Modify a file in working tree
    write_file(&repo, "a.txt", "alpha modified\nnew line\n");
    assert_parity(&repo, &["diff"], &["diff"], "working tree diff");
    assert_parity(
        &repo,
        &["diff", "--stat"],
        &["diff", "--stat"],
        "working tree diff --stat",
    );
    assert_parity(
        &repo,
        &["diff", "--name-only"],
        &["diff", "--name-only"],
        "working tree diff --name-only",
    );

    // Stage it
    run_git(&repo, &["add", "a.txt"]);
    assert_parity(
        &repo,
        &["diff", "--cached"],
        &["diff", "--cached"],
        "cached diff",
    );
    assert_parity(
        &repo,
        &["diff", "--staged"],
        &["diff", "--staged"],
        "staged diff",
    );

    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn hash_object_cli_parity() {
    if skip_without_git("hash-object parity") {
        return;
    }
    let repo = scratch_dir("hash_object_parity");
    build_fixture(&repo);

    write_file(&repo, "test_blob.txt", "hello fractal world\n");
    assert_parity(
        &repo,
        &["hash-object", "test_blob.txt"],
        &["hash-object", "test_blob.txt"],
        "hash-object file",
    );

    assert_parity(
        &repo,
        &["hash-object", "-w", "test_blob.txt"],
        &["hash-object", "-w", "test_blob.txt"],
        "hash-object -w file",
    );

    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn tag_cli_parity() {
    if skip_without_git("tag parity") {
        return;
    }
    let (oracle, candidate) = twin_fixtures("tag_parity");

    let git_created = run_git_raw(&oracle, &["tag", "v1.0"]);
    let taxis_created = run_taxis(&candidate, &["tag", "v1.0"]);
    assert_eq!(taxis_created.status.code(), git_created.status.code());
    assert_eq!(stdout_text(&taxis_created), stdout_text(&git_created));
    assert_eq!(stderr_text(&taxis_created), stderr_text(&git_created));

    let git_listed = run_git_raw(&oracle, &["tag"]);
    let taxis_listed = run_taxis(&candidate, &["tag"]);
    assert_eq!(taxis_listed.status.code(), git_listed.status.code());
    assert_eq!(stdout_text(&taxis_listed), stdout_text(&git_listed));

    let git_deleted = run_git_raw(&oracle, &["tag", "-d", "v1.0"]);
    let taxis_deleted = run_taxis(&candidate, &["tag", "-d", "v1.0"]);
    assert_eq!(taxis_deleted.status.code(), git_deleted.status.code());
    assert_eq!(stdout_text(&taxis_deleted), stdout_text(&git_deleted));

    let _ = fs::remove_dir_all(&oracle);
    let _ = fs::remove_dir_all(&candidate);
}

#[test]
fn unarchive_dry_run_cli_contract() {
    let repo = scratch_dir("unarchive_contract");
    run_taxis(&repo, &["init", "--git-compat"]);

    let zip_path = repo.join("test_sample.zip");
    let file = fs::File::create(&zip_path).expect("create zip");
    let mut writer = fg_storage::archive::ZipWriter::new(file);
    writer
        .append_file("sample.txt", 0o644, 1700000000, b"content")
        .expect("append");
    let mut finished = writer.finish().expect("finish");
    finished.flush().expect("flush");

    let out = run_taxis(
        &repo,
        &["unarchive", "--dry-run", zip_path.to_str().unwrap()],
    );
    assert!(out.status.success(), "unarchive --dry-run must succeed");
    let stdout = stdout_text(&out);
    assert!(
        stdout.contains("Taxis SpacePlan Projection"),
        "dry-run header"
    );
    assert!(
        stdout.contains("VIABLE (Safe for execution)"),
        "viable status"
    );

    let _ = fs::remove_dir_all(&repo);
}
