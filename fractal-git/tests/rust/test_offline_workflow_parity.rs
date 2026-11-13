//! Module: tests::test_offline_workflow_parity — Native Offline Git Workflow Parity Suite
//! File Path: tests/rust/test_offline_workflow_parity.rs
//! Architecture Role: Verifies that Taxis supports the complete offline Git workflow (`add`, `rm`,
//!   `mv`, `restore`, `write-tree`, `commit-tree`, `update-index`, `rev-parse`, `commit`, `clean`,
//!   `fsck`, `gc`, and `clone`) with byte-identical object IDs, index entries, and working-tree state
//!   against the system `git` binary as the differential oracle.
//! Dependencies & Triggers: Executed by `cargo test --test integration_cli`.
//! Responsibilities: Twin-checkout differential comparisons across porcelain staging, low-level index
//!   plumbing, index-backed commit materialization, maintenance hygiene, and local/bundle cloning.
//! Exit Semantics & Design Rationale: Every test creates isolated twin repositories under
//!   `target/test_tmp/offline-workflow-parity/` via RAII cleanup guards and compares resulting Git
//!   tree OIDs, commit payloads, `git status --short`, and `git fsck --full`.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-IDX-001, FGT-STO-001, FGT-CLI-001.

use crate::cli_harness::{scratch_scoped_dir, system_git_available, ScratchDirGuard};
use std::fs;
use std::path::Path;
use std::process::{Command, Output};

/// Allocates an isolated auto-reclaiming scratch directory under `target/test_tmp/offline-workflow-parity`.
fn scratch_dir(label: &str) -> ScratchDirGuard {
    scratch_scoped_dir("offline-workflow-parity", label)
}

fn strip_git_config_env(command: &mut Command) {
    command.env_remove("GIT_CONFIG_COUNT");
    command.env_remove("GIT_CONFIG_PARAMETERS");
    for index in 0..16 {
        command.env_remove(format!("GIT_CONFIG_KEY_{index}"));
        command.env_remove(format!("GIT_CONFIG_VALUE_{index}"));
    }
}

fn git_available() -> bool {
    system_git_available()
}

fn skip_without_git(label: &str) -> bool {
    if git_available() {
        return false;
    }
    if std::env::var_os("TAXIS_REQUIRE_GIT").is_some() {
        panic!("TAXIS_REQUIRE_GIT is set but system git is unavailable: {label}");
    }
    eprintln!("SKIP: git binary unavailable for {label}");
    true
}

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

fn run_git(repo: &Path, args: &[&str]) -> Output {
    let output = git_command(repo)
        .args(args)
        .output()
        .expect("git must execute");
    assert!(
        output.status.success(),
        "git {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn run_taxis(repo: &Path, args: &[&str]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_taxis"));
    strip_git_config_env(&mut command);
    command
        .args(args)
        .current_dir(repo)
        .output()
        .expect("taxis binary must execute")
}

fn run_taxis_ok(repo: &Path, args: &[&str]) -> Output {
    let output = run_taxis(repo, args);
    assert!(
        output.status.success(),
        "taxis {:?} failed (code {:?}): stdout={} stderr={}",
        args,
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn stdout_trimmed(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout)
        .replace("\r\n", "\n")
        .trim()
        .to_string()
}

fn write_file(repo: &Path, rel: &str, contents: &str) {
    let full = repo.join(rel);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).expect("create parent dir");
    }
    fs::write(full, contents).expect("write fixture file");
}

fn build_fixture(repo: &Path) {
    run_git(repo, &["init", "-q", "-b", "main", "."]);
    run_git(repo, &["config", "user.name", "Parity Test"]);
    run_git(repo, &["config", "user.email", "parity@taxis.internal"]);
    run_git(repo, &["config", "core.autocrlf", "false"]);
    write_file(repo, "a.txt", "alpha\n");
    write_file(repo, "dir/b.txt", "beta\n");
    write_file(repo, "keep.txt", "keep\n");
    run_git(repo, &["add", "a.txt", "dir/b.txt", "keep.txt"]);
    let out = git_command(repo)
        .args(["commit", "-q", "-m", "initial fixture"])
        .env("GIT_AUTHOR_DATE", "2026-01-01T00:00:00+0000")
        .env("GIT_COMMITTER_DATE", "2026-01-01T00:00:00+0000")
        .output()
        .expect("git commit");
    assert!(out.status.success());
}

fn twin_fixtures(label: &str) -> (ScratchDirGuard, ScratchDirGuard) {
    let oracle = scratch_dir(&format!("{label}_git"));
    let candidate = scratch_dir(&format!("{label}_taxis"));
    build_fixture(&oracle);
    build_fixture(&candidate);
    (oracle, candidate)
}

#[test]
fn add_rm_mv_stage_parity_matches_system_git() {
    if skip_without_git("add/rm/mv parity") {
        return;
    }
    let (oracle, candidate) = twin_fixtures("stage_ops");

    for repo in [oracle.path(), candidate.path()] {
        write_file(repo, ".gitignore", "*.log\nbuild/\n");
        write_file(repo, "debug.log", "ignored log\n");
        write_file(repo, "build/out.bin", "ignored dir\n");
        write_file(repo, "new_dir/c.txt", "charlie\n");
        write_file(repo, "a.txt", "alpha updated\n");
        fs::remove_file(repo.join("dir/b.txt")).expect("remove b.txt");
    }

    run_git(&oracle, &["add", "-A"]);
    run_taxis_ok(&candidate, &["add", "-A"]);

    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["write-tree"])),
        stdout_trimmed(&run_git(&oracle, &["write-tree"])),
        "taxis add -A must produce byte-identical index tree OID while honoring .gitignore"
    );
    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["status", "--short"])),
        stdout_trimmed(&run_git(&oracle, &["status", "--short"])),
        "git status --short must match after taxis add -A"
    );

    // Test rm --cached and mv
    run_git(&oracle, &["rm", "-q", "--cached", "keep.txt"]);
    run_taxis_ok(&candidate, &["rm", "-q", "--cached", "keep.txt"]);
    assert!(
        candidate.join("keep.txt").is_file(),
        "rm --cached must preserve working-tree file"
    );

    run_git(&oracle, &["mv", "a.txt", "renamed_a.txt"]);
    run_taxis_ok(&candidate, &["mv", "a.txt", "renamed_a.txt"]);

    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["write-tree"])),
        stdout_trimmed(&run_git(&oracle, &["write-tree"])),
        "tree OID after rm --cached and mv must match system git"
    );
    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["status", "--short"])),
        stdout_trimmed(&run_git(&oracle, &["status", "--short"])),
        "status --short after rm --cached and mv must match system git"
    );

    let _ = fs::remove_dir_all(&oracle);
    let _ = fs::remove_dir_all(&candidate);
}

#[test]
fn restore_worktree_and_staged_matches_system_git() {
    if skip_without_git("restore parity") {
        return;
    }
    let (oracle, candidate) = twin_fixtures("restore_ops");

    for repo in [oracle.path(), candidate.path()] {
        write_file(repo, "a.txt", "staged change\n");
    }
    run_git(&oracle, &["add", "a.txt"]);
    run_taxis_ok(&candidate, &["add", "a.txt"]);

    for repo in [oracle.path(), candidate.path()] {
        write_file(repo, "a.txt", "unstaged dirty edit\n");
    }

    // Restore working tree from index first
    run_git(&oracle, &["restore", "a.txt"]);
    run_taxis_ok(&candidate, &["restore", "a.txt"]);
    assert_eq!(
        fs::read_to_string(candidate.join("a.txt")).expect("read candidate a.txt"),
        "staged change\n"
    );

    // Unstage back to HEAD
    run_git(&oracle, &["restore", "--staged", "a.txt"]);
    run_taxis_ok(&candidate, &["restore", "--staged", "a.txt"]);
    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["write-tree"])),
        stdout_trimmed(&run_git(&oracle, &["write-tree"])),
        "restore --staged must reset index entry to HEAD"
    );

    // Restore both staged and worktree from HEAD
    run_git(&oracle, &["restore", "-SW", "--source=HEAD", "a.txt"]);
    run_taxis_ok(&candidate, &["restore", "-SW", "--source=HEAD", "a.txt"]);
    assert_eq!(
        fs::read_to_string(candidate.join("a.txt")).expect("read restored a.txt"),
        "alpha\n"
    );

    let _ = fs::remove_dir_all(&oracle);
    let _ = fs::remove_dir_all(&candidate);
}

#[test]
fn write_tree_commit_tree_update_index_and_rev_parse_parity() {
    if skip_without_git("index plumbing parity") {
        return;
    }
    let (oracle, candidate) = twin_fixtures("index_plumbing");

    let blob_oid = stdout_trimmed(&run_taxis_ok(&candidate, &["hash-object", "-w", "a.txt"]));
    let _ = run_git(&oracle, &["hash-object", "-w", "a.txt"]);

    let cache_spec = format!("100644,{blob_oid},virtual/injected.txt");
    run_git(
        &oracle,
        &["update-index", "--add", "--cacheinfo", &cache_spec],
    );
    run_taxis_ok(
        &candidate,
        &["update-index", "--add", "--cacheinfo", &cache_spec],
    );

    let git_tree = stdout_trimmed(&run_git(&oracle, &["write-tree"]));
    let taxis_tree = stdout_trimmed(&run_taxis_ok(&candidate, &["write-tree"]));
    assert_eq!(
        taxis_tree, git_tree,
        "write-tree OID must be byte-identical"
    );

    let head = stdout_trimmed(&run_git(&oracle, &["rev-parse", "HEAD"]));
    let env_stamp = "1700000000 +0000";
    let git_commit = git_command(&oracle)
        .args([
            "commit-tree",
            &git_tree,
            "-p",
            &head,
            "-m",
            "plumbing commit",
        ])
        .env("GIT_AUTHOR_NAME", "Plumbing Bot")
        .env("GIT_AUTHOR_EMAIL", "bot@taxis.internal")
        .env("GIT_AUTHOR_DATE", env_stamp)
        .env("GIT_COMMITTER_NAME", "Plumbing Bot")
        .env("GIT_COMMITTER_EMAIL", "bot@taxis.internal")
        .env("GIT_COMMITTER_DATE", env_stamp)
        .output()
        .expect("git commit-tree");
    let taxis_commit = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .current_dir(&candidate)
        .args([
            "commit-tree",
            &taxis_tree,
            "-p",
            &head,
            "-m",
            "plumbing commit",
        ])
        .env("GIT_AUTHOR_NAME", "Plumbing Bot")
        .env("GIT_AUTHOR_EMAIL", "bot@taxis.internal")
        .env("GIT_AUTHOR_DATE", env_stamp)
        .env("GIT_COMMITTER_NAME", "Plumbing Bot")
        .env("GIT_COMMITTER_EMAIL", "bot@taxis.internal")
        .env("GIT_COMMITTER_DATE", env_stamp)
        .output()
        .expect("taxis commit-tree");
    assert!(taxis_commit.status.success());
    assert_eq!(
        stdout_trimmed(&taxis_commit),
        stdout_trimmed(&git_commit),
        "commit-tree SHA-1 must be 100% byte-identical with system git"
    );

    for query in [
        &["rev-parse", "HEAD"][..],
        &["rev-parse", "HEAD^{tree}"][..],
        &["rev-parse", "HEAD^{commit}"][..],
        &["rev-parse", ":virtual/injected.txt"][..],
        &["rev-parse", "--abbrev-ref", "HEAD"][..],
        &["rev-parse", "--short=8", "HEAD"][..],
        &["rev-parse", "--is-inside-work-tree"][..],
        &["rev-parse", "--is-bare-repository"][..],
    ] {
        assert_eq!(
            stdout_trimmed(&run_taxis_ok(&candidate, query)),
            stdout_trimmed(&run_git(&oracle, query)),
            "rev-parse {:?} must match system git",
            query
        );
    }

    let _ = fs::remove_dir_all(&oracle);
    let _ = fs::remove_dir_all(&candidate);
}

#[test]
fn commit_from_index_preserves_partial_staging_deletions_and_all_flag() {
    if skip_without_git("index commit parity") {
        return;
    }
    let (oracle, candidate) = twin_fixtures("commit_index");

    // Stage one deletion (`dir/b.txt`) and one addition (`staged.txt`), while leaving `a.txt` unstaged!
    for repo in [oracle.path(), candidate.path()] {
        write_file(repo, "staged.txt", "staged content\n");
        write_file(repo, "a.txt", "unstaged modification\n");
    }
    run_git(&oracle, &["add", "staged.txt"]);
    run_git(&oracle, &["rm", "-q", "dir/b.txt"]);

    run_taxis_ok(&candidate, &["add", "staged.txt"]);
    run_taxis_ok(&candidate, &["rm", "-q", "dir/b.txt"]);

    run_git(&oracle, &["commit", "-q", "-m", "partial index commit"]);
    run_taxis_ok(&candidate, &["commit", "-m", "partial index commit"]);

    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["rev-parse", "HEAD^{tree}"])),
        stdout_trimmed(&run_git(&oracle, &["rev-parse", "HEAD^{tree}"])),
        "taxis commit -m must commit exact .git/index state (preserving staged deletion & excluding unstaged edit)"
    );

    // Now commit unstaged tracked modifications via `-am`
    run_git(&oracle, &["commit", "-q", "-am", "auto stage tracked"]);
    run_taxis_ok(&candidate, &["commit", "-am", "auto stage tracked"]);
    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["rev-parse", "HEAD^{tree}"])),
        stdout_trimmed(&run_git(&oracle, &["rev-parse", "HEAD^{tree}"])),
        "taxis commit -am must stage tracked modifications identically to git commit -am"
    );

    // Verify `--allow-empty`
    run_taxis_ok(
        &candidate,
        &["commit", "--allow-empty", "-m", "empty marker"],
    );
    let fsck = run_git(&candidate, &["fsck", "--full"]);
    assert!(
        fsck.status.success(),
        "git fsck --full must pass after taxis commits"
    );

    let _ = fs::remove_dir_all(&oracle);
    let _ = fs::remove_dir_all(&candidate);
}

#[test]
fn clean_fsck_and_gc_behave_independently_and_safely() {
    if skip_without_git("clean/fsck/gc parity") {
        return;
    }
    let repo = scratch_dir("maintenance_ops");
    build_fixture(&repo);

    write_file(&repo, ".gitignore", "*.ignored\n");
    run_taxis_ok(&repo, &["add", ".gitignore"]);
    run_taxis_ok(&repo, &["commit", "-m", "add gitignore"]);

    write_file(&repo, "untracked.tmp", "temp\n");
    write_file(&repo, "untracked_dir/nested.tmp", "nested\n");
    write_file(&repo, "secret.ignored", "keep unless -x\n");

    // Refuses without -f or -n
    let refused = run_taxis(&repo, &["clean"]);
    assert!(!refused.status.success(), "clean without -f/-n must refuse");
    assert!(repo.join("untracked.tmp").exists());

    // Dry-run lists files without deleting
    let dry = run_taxis_ok(&repo, &["clean", "-nd"]);
    assert!(stdout_trimmed(&dry).contains("Would remove untracked.tmp"));
    assert!(repo.join("untracked.tmp").exists());

    // -fd removes untracked file + dir while keeping ignored file
    run_taxis_ok(&repo, &["clean", "-fd"]);
    assert!(!repo.join("untracked.tmp").exists());
    assert!(!repo.join("untracked_dir").exists());
    assert!(repo.join("secret.ignored").exists());

    // -fx removes ignored file too
    run_taxis_ok(&repo, &["clean", "-fx"]);
    assert!(!repo.join("secret.ignored").exists());

    // fsck & gc pass on intact repository and produce valid packfiles
    run_taxis_ok(&repo, &["fsck"]);
    run_taxis_ok(&repo, &["gc"]);
    run_taxis_ok(&repo, &["fsck"]);
    run_git(&repo, &["fsck", "--full"]);

    // Inject a corrupted loose object and assert `taxis fsck` catches SHA-1/zlib corruption
    let corrupt_fanout = repo.join(".git").join("objects").join("de");
    fs::create_dir_all(&corrupt_fanout).expect("create corrupt fanout");
    fs::write(
        corrupt_fanout.join("adbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
        b"corrupt-zlib-stream",
    )
    .expect("write corrupt loose object");
    let broken_fsck = run_taxis(&repo, &["fsck"]);
    assert!(
        !broken_fsck.status.success(),
        "taxis fsck must fail non-zero when a loose object is corrupted"
    );

    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn clone_local_repo_and_bundle_offline_roundtrip() {
    if skip_without_git("clone offline parity") {
        return;
    }
    let source = scratch_dir("clone_source");
    build_fixture(&source);

    // 1. Local directory clone
    let local_dest = scratch_dir("clone_local_dest");
    let _ = fs::remove_dir_all(&local_dest);
    run_taxis_ok(
        &source,
        &[
            "clone",
            source.to_str().expect("utf8 source"),
            local_dest.to_str().expect("utf8 dest"),
        ],
    );

    assert_eq!(
        stdout_trimmed(&run_git(&local_dest, &["rev-parse", "HEAD"])),
        stdout_trimmed(&run_git(&source, &["rev-parse", "HEAD"])),
        "cloned local repo HEAD must match source HEAD"
    );
    assert_eq!(
        stdout_trimmed(&run_git(&local_dest, &["status", "--short"])),
        "",
        "cloned local working tree and index must be clean"
    );
    assert_eq!(
        fs::read_to_string(local_dest.join("dir/b.txt")).expect("read cloned file"),
        "beta\n"
    );

    // 2. Offline Git bundle v2 clone
    let bundle_dir = scratch_dir("clone_bundle_holder");
    let bundle_file = bundle_dir.join("offline.bundle");
    run_git(
        &source,
        &[
            "bundle",
            "create",
            bundle_file.to_str().expect("utf8 bundle"),
            "--all",
        ],
    );

    let bundle_dest = scratch_dir("clone_bundle_dest");
    let _ = fs::remove_dir_all(&bundle_dest);
    run_taxis_ok(
        &source,
        &[
            "clone",
            bundle_file.to_str().expect("utf8 bundle"),
            bundle_dest.to_str().expect("utf8 bundle dest"),
        ],
    );

    assert_eq!(
        stdout_trimmed(&run_git(&bundle_dest, &["rev-parse", "HEAD"])),
        stdout_trimmed(&run_git(&source, &["rev-parse", "HEAD"])),
        "cloned bundle repo HEAD must match source HEAD"
    );
    assert_eq!(
        stdout_trimmed(&run_git(&bundle_dest, &["status", "--short"])),
        "",
        "cloned bundle working tree and index must be clean"
    );

    let _ = fs::remove_dir_all(&source);
    let _ = fs::remove_dir_all(&local_dest);
    let _ = fs::remove_dir_all(&bundle_dir);
    let _ = fs::remove_dir_all(&bundle_dest);
}

#[test]
fn add_stat_cache_fast_path_preserves_unchanged_and_detects_modified_files() {
    if skip_without_git("add stat-cache fast path") {
        return;
    }
    let (oracle, candidate) = twin_fixtures("stat_cache_fast_path");

    run_taxis_ok(&candidate, &["add", "-A"]);
    run_git(&oracle, &["add", "-A"]);
    let initial_tree = stdout_trimmed(&run_git(&oracle, &["write-tree"]));
    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["write-tree"])),
        initial_tree,
        "initial taxis add -A must preserve tree OID"
    );

    // Second `taxis add -A` with unchanged mtime/size hits stat_cache_trusted fast path
    run_taxis_ok(&candidate, &["add", "-A"]);
    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["write-tree"])),
        initial_tree,
        "repeated taxis add -A on unchanged worktree must remain a no-op"
    );

    // Modifying a file invalidates stat cache and stages the updated blob
    for repo in [oracle.path(), candidate.path()] {
        write_file(repo, "keep.txt", "keep updated content with new length\n");
    }
    run_git(&oracle, &["add", "-A"]);
    run_taxis_ok(&candidate, &["add", "-A"]);
    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["write-tree"])),
        stdout_trimmed(&run_git(&oracle, &["write-tree"])),
        "taxis add -A after file edit must re-hash and update index entry"
    );
}

#[test]
fn cherry_pick_and_revert_shared_delta_engine_roundtrip() {
    if skip_without_git("cherry-pick and revert roundtrip") {
        return;
    }
    let (oracle, candidate) = twin_fixtures("delta_transplant");

    for repo in [oracle.path(), candidate.path()] {
        run_git(repo, &["checkout", "-q", "-b", "feature"]);
        write_file(repo, "feature.txt", "feature payload\n");
        write_file(repo, "a.txt", "alpha from feature\n");
        run_git(repo, &["add", "feature.txt", "a.txt"]);
        run_git(repo, &["commit", "-q", "-m", "feature commit"]);
        run_git(repo, &["checkout", "-q", "main"]);
    }

    let feature_oid_git = stdout_trimmed(&run_git(&oracle, &["rev-parse", "feature"]));
    let feature_oid_taxis = stdout_trimmed(&run_git(&candidate, &["rev-parse", "feature"]));

    run_git(&oracle, &["cherry-pick", &feature_oid_git]);
    run_taxis_ok(&candidate, &["cherry-pick", &feature_oid_taxis]);

    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["rev-parse", "HEAD^{tree}"])),
        stdout_trimmed(&run_git(&oracle, &["rev-parse", "HEAD^{tree}"])),
        "taxis cherry-pick must produce byte-identical root tree OID"
    );

    let picked_oid_git = stdout_trimmed(&run_git(&oracle, &["rev-parse", "HEAD"]));
    let picked_oid_taxis = stdout_trimmed(&run_git(&candidate, &["rev-parse", "HEAD"]));

    run_git(&oracle, &["revert", "--no-edit", &picked_oid_git]);
    run_taxis_ok(&candidate, &["revert", &picked_oid_taxis]);

    assert_eq!(
        stdout_trimmed(&run_git(&candidate, &["rev-parse", "HEAD^{tree}"])),
        stdout_trimmed(&run_git(&oracle, &["rev-parse", "HEAD^{tree}"])),
        "taxis revert must restore exact pre-cherry-pick tree OID"
    );

    let _ = fs::remove_dir_all(&oracle);
    let _ = fs::remove_dir_all(&candidate);
}
