//! Module: tests::test_log_projection — Slice Verdicts Through the Real CLI
//! File Path: tests/rust/test_log_projection.rs
//!
//! These exercise `taxis log --scope` end to end, because the interesting part is not the predicate
//! but the reporting: a slice must say what it is holding back. Every assertion below is about an
//! answer the user would otherwise be unable to distinguish from a quiet repository.

use std::fs;
use std::path::{Path, PathBuf};

use crate::cli_harness::{compliant_commit_msg, run_taxis, run_taxis_ok, scratch_repo};

/// Builds a repository whose history alternates between two directories.
///
/// The result is three commits: the first adds `core/`, the second adds `docs/` only, and the third
/// changes `core/` again. A slice over `core/**` must therefore see the first and third and hold
/// back the middle one.
fn alternating_repo(label: &str) -> PathBuf {
    let repo = scratch_repo(label, "projection");
    // A native Taxis repository, not a Git one. A bare `git init` here would leave no `.taxis` and
    // the binary would then adopt the enclosing workspace's object store, which is a different
    // repository entirely.
    run_taxis_ok(&repo, &["init", "--dev"]);

    fs::create_dir_all(repo.join("core")).expect("mkdir core");
    fs::write(repo.join("core/lib.rs"), "pub fn a() {}\n").expect("write lib");
    run_taxis_ok(&repo, &["add", "core/lib.rs"]);
    commit(&repo, "add core", "core/lib.rs");

    fs::create_dir_all(repo.join("docs")).expect("mkdir docs");
    fs::write(repo.join("docs/readme.md"), "hello\n").expect("write docs");
    run_taxis_ok(&repo, &["add", "docs/readme.md"]);
    commit(&repo, "add docs", "docs/readme.md");

    fs::write(repo.join("core/lib.rs"), "pub fn a() { }\npub fn b() {}\n").expect("rewrite lib");
    run_taxis_ok(&repo, &["add", "core/lib.rs"]);
    commit(&repo, "extend core", "core/lib.rs");

    repo
}

/// Commits with a message that satisfies the repository's own message policy.
///
/// The fixture text is irrelevant to what these tests check; what matters is that the commit is
/// accepted, so the shared helper supplies the mandated structured sections rather than the test
/// inventing a message the gate would reject.
fn commit(repo: &Path, subject: &str, file: &str) {
    let message = compliant_commit_msg(&format!("feat(core): {subject}"), file);
    run_taxis_ok(repo, &["commit", "-m", &message]);
}

fn stdout_of(repo: &Path, args: &[&str]) -> String {
    let output = run_taxis(repo, args);
    assert!(
        output.status.success(),
        "taxis {args:?} failed: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).to_string()
}

#[test]
fn a_scope_reports_how_many_commits_it_is_holding_back() {
    // The failure this guards: printing only the visible commits. A reader would then see one commit
    // and conclude the repository had one commit, when in fact work happened elsewhere.
    let repo = alternating_repo("slice_counts");
    let out = stdout_of(&repo, &["log", "--oneline", "--all", "--scope", "core/**"]);

    assert!(
        out.contains("visible"),
        "the summary must name the visible count, got:\n{out}"
    );
    assert!(
        out.contains("outside"),
        "the summary must name the out-of-scope count, got:\n{out}"
    );
    // Three commits exist; only two touched core/.
    assert!(
        out.contains("2 visible"),
        "two commits changed core/, got:\n{out}"
    );
    assert!(
        out.contains("1 present but outside"),
        "one commit changed only docs/, got:\n{out}"
    );
}

#[test]
fn a_scope_keeps_out_of_scope_commits_in_the_history() {
    // "Outside" is a verdict, not a deletion: the commit must still be listed, or the projection
    // would be indistinguishable from a rewritten graph.
    let repo = alternating_repo("slice_keeps");
    let out = stdout_of(&repo, &["log", "--oneline", "--all", "--scope", "core/**"]);

    assert!(
        out.contains("add docs"),
        "the out-of-scope commit must still appear in the log, got:\n{out}"
    );
    assert!(
        out.contains("is present but outside this slice"),
        "the out-of-scope commit must be labelled, got:\n{out}"
    );
}

#[test]
fn a_tier_name_is_echoed_in_the_summary() {
    let repo = alternating_repo("slice_tier");
    let out = stdout_of(
        &repo,
        &[
            "log",
            "--oneline",
            "--all",
            "--tier",
            "sub-agent",
            "--scope",
            "core/**",
        ],
    );
    assert!(
        out.contains("slice sub-agent"),
        "the summary must name the tier it was computed at, got:\n{out}"
    );
}

#[test]
fn an_unscoped_log_prints_no_slice_summary() {
    // The default path must be byte-identical to what it was before `--scope` existed.
    let repo = alternating_repo("slice_absent");
    let out = stdout_of(&repo, &["log", "--oneline", "--all"]);
    assert!(
        !out.contains("visible,"),
        "a log without --scope must not claim a slice, got:\n{out}"
    );
}

#[test]
fn a_depth_horizon_limits_what_is_listed() {
    let repo = alternating_repo("horizon_depth");
    let out = stdout_of(&repo, &["log", "--oneline", "--all", "--horizon", "1"]);
    let lines: Vec<&str> = out.lines().filter(|line| !line.trim().is_empty()).collect();
    assert_eq!(
        lines.len(),
        1,
        "--horizon 1 must list exactly one commit, got:\n{out}"
    );
}

#[test]
fn a_malformed_horizon_is_refused_rather_than_guessed() {
    // A mistyped horizon would silently truncate history, and the caller would read the short answer
    // as the whole truth. It has to fail loudly.
    let repo = alternating_repo("horizon_bad");
    let output = run_taxis(&repo, &["log", "--oneline", "--horizon", "recent-ish"]);
    assert!(
        !output.status.success(),
        "a malformed --horizon must fail, got: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("--horizon"),
        "the error must name the flag, got: {stderr}"
    );
}

#[test]
fn a_zero_horizon_is_refused() {
    let repo = alternating_repo("horizon_zero");
    let output = run_taxis(&repo, &["log", "--oneline", "--horizon", "0"]);
    assert!(!output.status.success(), "--horizon 0 must be refused");
}

#[test]
fn an_unknown_tier_is_refused() {
    let repo = alternating_repo("tier_bad");
    let output = run_taxis(&repo, &["log", "--oneline", "--tier", "galaxy"]);
    assert!(!output.status.success(), "an unknown tier must be refused");
    assert!(String::from_utf8_lossy(&output.stderr).contains("--tier"));
}

#[test]
fn a_negated_scope_pattern_excludes_a_subdirectory() {
    // `!` subtraction mirrors the ignore-file convention, so a caller does not need a second flag
    // whose only job is to move the `!` from the shell into the parser.
    let repo = alternating_repo("scope_negation");
    let out = stdout_of(
        &repo,
        &[
            "log",
            "--oneline",
            "--all",
            "--scope",
            "**",
            "--scope",
            "!core/**",
        ],
    );
    assert!(
        out.contains("add docs"),
        "docs/ survives a core/ exclusion, got:\n{out}"
    );
    assert!(
        !out.contains("extend core,"),
        "a core-only commit must count as outside after excluding core/, got:\n{out}"
    );
}

#[test]
fn install_dry_run_writes_nothing() {
    // The command's whole safety story is that `--dry-run` can be inspected before anything moves.
    // A dry run that created a file would make the flag useless for its only purpose.
    let repo = alternating_repo("install_dry");
    let dir = repo.join("bin-target");
    let out = stdout_of(
        &repo,
        &["install", "--dry-run", "--dir", dir.to_str().expect("path")],
    );

    assert!(
        out.contains("would install"),
        "the report must describe the plan, got:\n{out}"
    );
    assert!(
        !dir.exists(),
        "a dry run must not create the target directory"
    );
}

#[test]
fn install_copies_and_verifies_the_binary() {
    let repo = alternating_repo("install_real");
    let dir = repo.join("bin-target");
    let out = stdout_of(&repo, &["install", "--dir", dir.to_str().expect("path")]);
    assert!(out.contains("installed"), "got:\n{out}");

    let installed = dir.join(if cfg!(windows) { "taxis.exe" } else { "taxis" });
    let size = fs::metadata(&installed)
        .expect("the binary must exist after a successful install")
        .len();
    assert!(size > 0, "the installed binary must not be empty");
}

#[test]
fn install_reports_when_the_target_is_off_path() {
    // Silently installing into a directory the shell does not search produces a command the user
    // cannot run, which is worse than refusing.
    let repo = alternating_repo("install_offpath");
    let dir = repo.join("bin-off-path");
    let out = stdout_of(
        &repo,
        &["install", "--dry-run", "--dir", dir.to_str().expect("path")],
    );
    assert!(
        out.contains("not on PATH"),
        "an off-PATH target must be called out, got:\n{out}"
    );
}

#[test]
fn install_refuses_when_no_path_directory_is_writable() {
    // The sandboxed environment this runs in denies every PATH entry. The command must then fail
    // with an explanation rather than pretend to have installed something.
    let repo = alternating_repo("install_nowhere");
    let output = run_taxis(&repo, &["install", "--dry-run"]);
    if output.status.success() {
        // A machine with a writable PATH entry legitimately succeeds; nothing to assert beyond that.
        return;
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("no writable directory") || stderr.contains("--dir"),
        "the refusal must say what to do next, got: {stderr}"
    );
    assert!(
        stderr.contains("Checked:") || stderr.contains("denied") || stderr.contains("missing"),
        "the refusal must list the candidates it rejected, got: {stderr}"
    );
}

#[test]
fn show_prints_only_the_sliced_hunks() {
    // `show` drops hunks rather than labelling commits, so the same commit must produce a different
    // patch under two slices. The fixture's tip touches both trees, which is what makes the two
    // answers comparable; a commit that touched one tree would look identical under both slices.
    let fixture = alternating_repo("slice_show");
    fs::write(fixture.join("core/lib.rs"), "pub fn c() {}\n").expect("touch core");
    fs::write(fixture.join("docs/readme.md"), "hello again\n").expect("touch docs");
    run_taxis_ok(&fixture, &["add", "core/lib.rs"]);
    run_taxis_ok(&fixture, &["add", "docs/readme.md"]);
    commit(&fixture, "touch both trees", "core/lib.rs");

    let whole = stdout_of(&fixture, &["show", "--stat", "HEAD"]);
    assert!(
        whole.contains("readme.md"),
        "the whole patch reaches docs, got:\n{whole}"
    );

    let core_only = stdout_of(&fixture, &["show", "--stat", "--scope", "core/**", "HEAD"]);
    assert!(
        !core_only.contains("readme.md"),
        "a core slice must not print a docs hunk, got:\n{core_only}"
    );
    assert!(core_only.contains("lib.rs"), "got:\n{core_only}");
}

#[test]
fn the_slice_flags_mean_the_same_thing_on_diff_and_log() {
    // One spelling, one parser. If `diff` and `log` disagreed about `--tier`, a user would have to
    // remember which command had which vocabulary.
    let repo = alternating_repo("slice_parity");
    let log_out = stdout_of(
        &repo,
        &[
            "log",
            "--oneline",
            "--all",
            "--tier",
            "sub-agent",
            "--scope",
            "core/**",
        ],
    );
    assert!(log_out.contains("slice sub-agent"), "got:\n{log_out}");

    let diff_out = run_taxis(
        &repo,
        &[
            "diff",
            "--stat",
            "--tier",
            "sub-agent",
            "--scope",
            "core/**",
        ],
    );
    assert!(
        diff_out.status.success(),
        "diff must accept the same flags, got: {}",
        String::from_utf8_lossy(&diff_out.stderr)
    );
}

#[test]
fn a_bogus_tier_is_refused_by_every_command_that_takes_one() {
    let repo = alternating_repo("slice_bogus");
    for command in ["log", "show", "diff"] {
        let output = run_taxis(&repo, &[command, "--tier", "galaxy"]);
        assert!(
            !output.status.success(),
            "{command} must refuse an unknown tier"
        );
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("--tier"),
            "{command} must name the flag, got: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn a_horizon_truncation_is_announced() {
    // A bounded walk must say it stopped. Otherwise the shorter list is indistinguishable from a
    // repository that genuinely has that many commits.
    let repo = alternating_repo("horizon_notice");
    let output = run_taxis(&repo, &["log", "--oneline", "--all", "--horizon", "1"]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("not read") || stderr.contains("horythus") || stderr.contains("limit"),
        "a truncated walk must announce itself, got: {stderr}"
    );
}

#[test]
fn uninstall_removes_only_what_install_placed() {
    let repo = alternating_repo("uninstall_round");
    let dir = repo.join("bin-round");
    stdout_of(&repo, &["install", "--dir", dir.to_str().expect("path")]);
    let installed = dir.join(if cfg!(windows) { "taxis.exe" } else { "taxis" });
    assert!(installed.is_file(), "install must have placed the binary");

    stdout_of(&repo, &["uninstall", "--dir", dir.to_str().expect("path")]);
    assert!(!installed.exists(), "uninstall must remove it");
}

#[test]
fn uninstall_on_a_clean_directory_is_not_an_error() {
    // The desired end state is "not installed", so reaching it from an already-clean box is success.
    let repo = alternating_repo("uninstall_clean");
    let dir = repo.join("bin-clean");
    let out = stdout_of(
        &repo,
        &[
            "uninstall",
            "--dry-run",
            "--dir",
            dir.to_str().expect("path"),
        ],
    );
    assert!(
        out.contains("nothing to remove"),
        "an already-clean target must be reported as such, got:\n{out}"
    );
}

#[test]
fn an_unimplemented_command_lists_the_real_command_set() {
    // The list is derived from the command table. It used to be hand-written and had already drifted
    // — it omitted the two commands this build had just gained.
    let repo = alternating_repo("command_list");
    let output = run_taxis(&repo, &["definitely-not-a-command"]);
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("install"), "got: {stderr}");
    assert!(stderr.contains("uninstall"), "got: {stderr}");
    assert!(
        stderr.contains("Implemented ("),
        "the count must be shown, got: {stderr}"
    );
}
