//! Test Suite: Hosted Small Project Repository Git Parity — Remote & Collaboration
//! File Path: tests/rust/test_hosted_git_remote_parity.rs
//! Architecture Role: End-to-end integration test suite verifying Taxis equivalence with system Git across push --dry-run, dual-ref publishing, clone, pull, 3-way merge, conflict abort, and two-peer collaborative synchronization.
//! Dependencies & Triggers: Mounted in `tests/integration_cli.rs`.
//! Responsibilities: Assert deterministic behavioral and binary format parity with Git.
//! Exit Semantics & Design Rationale: Fails immediately if any command diverges from Git semantics.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-OBJ-001`: Git object binary equivalence guard

use std::fs;
use std::path::Path;

use crate::cli_harness::{
    compliant_msg, run_git, run_git_ok, run_taxis, run_taxis_ok, test_temp_dir,
};

#[test]
fn test_push_dry_run_real_disk_sync_clone_pull_and_git_export() {
    let tmp = test_temp_dir("hosted_sync_export_");
    let src_repo = tmp.path().join("src-repo");
    let bare_remote = tmp.path().join("remote.git");

    run_taxis_ok(tmp.path(), &["init", "src-repo"]);
    fs::write(src_repo.join("main.rs"), "fn main() {}\n").expect("write main.rs");
    run_taxis_ok(&src_repo, &["add", "main.rs"]);
    let m1 = compliant_msg("feat(main): add application entry point", "main");
    run_taxis_ok(&src_repo, &["commit", "-m", &m1]);

    // Initialize bare Git remote if system git is available
    let git_init = run_git(tmp.path(), &["init", "--bare", "remote.git"]);
    if !git_init.status.success() {
        assert!(
            std::env::var_os("TAXIS_REQUIRE_GIT").is_none(),
            "TAXIS_REQUIRE_GIT is set but git init --bare failed: {}",
            String::from_utf8_lossy(&git_init.stderr)
        );
        return;
    }

    let remote_path_str = bare_remote.to_string_lossy().into_owned();
    run_taxis_ok(&src_repo, &["remote", "add", "origin", &remote_path_str]);

    // 1. Push with --dry-run must NOT create refs on remote
    run_taxis_ok(&src_repo, &["push", "--dry-run", "origin", "main"]);
    assert!(
        !bare_remote.join("refs/heads/main").is_file(),
        "push --dry-run must not mutate remote refs on disk"
    );

    // 2. Real push must write objects and publish both refs/heads/main and refs/fractal/cell/...
    run_taxis_ok(&src_repo, &["push", "origin", "main"]);
    assert!(
        bare_remote.join("refs/heads/main").is_file(),
        "real push must publish refs/heads/main on remote"
    );
    assert!(
        bare_remote
            .join("refs/fractal/cell/cell-default/main")
            .is_file(),
        "real push must preserve refs/fractal/cell/cell-default/main on remote"
    );
    let _ = run_git_ok(&bare_remote, &["fsck", "--strict"]);

    // 3. Clone from bare remote and verify origin/HEAD + pull into unborn HEAD
    verify_clone_and_unborn_pull(tmp.path(), &remote_path_str);

    // 4. git-export from src_repo and verify git log & git fsck --strict
    verify_git_export_parity(&src_repo);
}

fn verify_clone_and_unborn_pull(root: &Path, remote_path_str: &str) {
    let cloned_dir = root.join("cloned-repo");
    let cloned_str = cloned_dir.to_string_lossy().into_owned();
    run_taxis_ok(root, &["clone", remote_path_str, &cloned_str]);
    assert!(
        cloned_dir.join("main.rs").is_file(),
        "cloned repo must materialize worktree files"
    );
    let sym_out = run_taxis_ok(&cloned_dir, &["symbolic-ref", "refs/remotes/origin/HEAD"]);
    assert_eq!(sym_out, "refs/remotes/origin/main");

    // Pull into a fresh unborn repository
    let pull_dir = root.join("pull-unborn");
    run_taxis_ok(root, &["init", "pull-unborn"]);
    run_taxis_ok(&pull_dir, &["remote", "add", "origin", remote_path_str]);
    run_taxis_ok(&pull_dir, &["pull", "origin", "main"]);
    assert!(
        pull_dir.join("main.rs").is_file(),
        "pull into unborn HEAD must fast-forward and materialize main.rs"
    );
}

fn verify_git_export_parity(src_repo: &Path) {
    run_taxis_ok(src_repo, &["git-export"]);
    let git_log = run_git_ok(src_repo, &["log", "--oneline"]);
    assert!(
        git_log.contains("add application entry point"),
        "exported .git must be directly readable by system git log: {git_log}"
    );
    let _ = run_git_ok(src_repo, &["fsck", "--strict"]);
}

#[test]
fn test_multi_branch_lifecycle_merge_ff_three_way_and_conflict_abort() {
    let tmp = test_temp_dir("hosted_branches_merge_");
    let repo = tmp.path().join("branch-lab");
    run_taxis_ok(tmp.path(), &["init", "branch-lab"]);

    fs::write(repo.join("core.rs"), "pub fn version() -> u32 { 1 }\n").expect("write core.rs");
    run_taxis_ok(&repo, &["add", "core.rs"]);
    run_taxis_ok(
        &repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(core): initialize version function", "version"),
        ],
    );
    let base_oid = run_taxis_ok(&repo, &["rev-parse", "HEAD"]);

    // Branch creation, rename, and deletion guards
    run_taxis_ok(&repo, &["branch", "feat-ff"]);
    run_taxis_ok(&repo, &["branch", "feat-3way"]);
    run_taxis_ok(&repo, &["branch", "scratch-br"]);
    run_taxis_ok(&repo, &["branch", "-m", "scratch-br", "renamed-br"]);
    let branches_out = run_taxis_ok(&repo, &["branch"]);
    assert!(
        branches_out.contains("feat-ff")
            && branches_out.contains("feat-3way")
            && branches_out.contains("renamed-br"),
        "branch listing must include created and renamed branches: {branches_out}"
    );
    run_taxis_ok(&repo, &["branch", "-D", "renamed-br"]);

    // Advance feat-ff and verify unmerged branch deletion guard before fast-forward merge
    run_taxis_ok(&repo, &["checkout", "feat-ff"]);
    fs::write(repo.join("ff.rs"), "pub fn fast_forward() {}\n").expect("write ff.rs");
    run_taxis_ok(&repo, &["add", "ff.rs"]);
    run_taxis_ok(
        &repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(ff): add fast_forward helper", "fast_forward"),
        ],
    );
    run_taxis_ok(&repo, &["checkout", "main"]);
    let unmerged_del = run_taxis(&repo, &["branch", "-d", "feat-ff"]);
    assert!(
        !unmerged_del.status.success(),
        "branch -d must refuse deleting unmerged branch feat-ff"
    );

    // Fast-forward merge feat-ff into main, then delete merged branch with -d
    run_taxis_ok(&repo, &["merge", "feat-ff"]);
    assert!(
        repo.join("ff.rs").is_file(),
        "fast-forward merge must materialize ff.rs on main"
    );
    run_taxis_ok(&repo, &["branch", "-d", "feat-ff"]);

    // Advance feat-3way and main independently to test merge-base, --ff-only refusal, and --no-ff 3-way merge
    verify_three_way_merge_and_conflict_abort(&repo, &base_oid);
}

fn verify_three_way_merge_and_conflict_abort(repo: &Path, base_oid: &str) {
    run_taxis_ok(repo, &["checkout", "feat-3way"]);
    fs::write(repo.join("three_way.rs"), "pub fn branch_work() {}\n").expect("write three_way.rs");
    run_taxis_ok(repo, &["add", "three_way.rs"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(three_way): add branch_work function", "branch_work"),
        ],
    );

    run_taxis_ok(repo, &["checkout", "main"]);
    fs::write(repo.join("main_extra.rs"), "pub fn trunk_work() {}\n").expect("write main_extra.rs");
    run_taxis_ok(repo, &["add", "main_extra.rs"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(main_extra): add trunk_work function", "trunk_work"),
        ],
    );

    let mb_out = run_taxis_ok(repo, &["merge-base", "main", "feat-3way"]);
    assert_eq!(
        mb_out, base_oid,
        "merge-base must identify common ancestor commit"
    );
    let is_anc = run_taxis(repo, &["merge-base", "--is-ancestor", base_oid, "main"]);
    assert!(is_anc.status.success(), "base_oid must be ancestor of main");
    let not_anc = run_taxis(repo, &["merge-base", "--is-ancestor", "feat-3way", "main"]);
    assert!(
        !not_anc.status.success(),
        "diverged feat-3way must not be ancestor of main"
    );

    let ff_only = run_taxis(repo, &["merge", "--ff-only", "feat-3way"]);
    assert!(
        !ff_only.status.success(),
        "merge --ff-only must reject diverged branch"
    );

    run_taxis_ok(repo, &["merge", "--no-ff", "feat-3way"]);
    assert!(
        repo.join("three_way.rs").is_file() && repo.join("main_extra.rs").is_file(),
        "3-way merge must materialize files from both branches"
    );
    let head_commit_raw = run_taxis_ok(repo, &["cat-file", "-p", "HEAD"]);
    let parent_count = head_commit_raw
        .lines()
        .filter(|l| l.starts_with("parent "))
        .count();
    assert_eq!(
        parent_count, 2,
        "3-way merge commit must record 2 parents: {head_commit_raw}"
    );

    // Conflict detection and merge --abort restoration
    run_taxis_ok(repo, &["checkout", "-b", "conflict-br"]);
    fs::write(repo.join("core.rs"), "pub fn version() -> u32 { 999 }\n").expect("conflict side A");
    run_taxis_ok(repo, &["add", "core.rs"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(core): bump version to 999 on branch", "version"),
        ],
    );

    run_taxis_ok(repo, &["checkout", "main"]);
    fs::write(repo.join("core.rs"), "pub fn version() -> u32 { 2 }\n").expect("conflict side B");
    run_taxis_ok(repo, &["add", "core.rs"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(core): bump version to 2 on main", "version"),
        ],
    );

    let conflict_merge = run_taxis(repo, &["merge", "conflict-br"]);
    assert!(
        !conflict_merge.status.success(),
        "conflicting merge must exit non-zero"
    );
    run_taxis_ok(repo, &["merge", "--abort"]);
    let restored_core = fs::read_to_string(repo.join("core.rs")).expect("read core.rs after abort");
    assert_eq!(restored_core, "pub fn version() -> u32 { 2 }\n");
}

#[test]
fn test_two_peer_collaborative_remote_push_fetch_and_pull() {
    let tmp = test_temp_dir("hosted_two_peer_collab_");
    let bare_origin = tmp.path().join("origin.git");
    let dev_a = tmp.path().join("dev-a");
    let dev_b = tmp.path().join("dev-b");

    let git_init = run_git(tmp.path(), &["init", "--bare", "origin.git"]);
    if !git_init.status.success() {
        assert!(
            std::env::var_os("TAXIS_REQUIRE_GIT").is_none(),
            "TAXIS_REQUIRE_GIT is set but git init --bare failed"
        );
        return;
    }
    let origin_str = bare_origin.to_string_lossy().into_owned();

    // Peer A initializes, commits on main and a feature branch, and pushes both to origin
    run_taxis_ok(tmp.path(), &["init", "dev-a"]);
    fs::write(dev_a.join("shared.rs"), "pub fn v1() {}\n").expect("write shared.rs");
    run_taxis_ok(&dev_a, &["add", "shared.rs"]);
    run_taxis_ok(
        &dev_a,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(shared): add initial v1 API", "v1"),
        ],
    );
    run_taxis_ok(&dev_a, &["remote", "add", "origin", &origin_str]);
    run_taxis_ok(&dev_a, &["push", "origin", "main"]);

    // Peer B clones origin, adds a commit on main, and pushes back to origin
    let dev_b_str = dev_b.to_string_lossy().into_owned();
    run_taxis_ok(tmp.path(), &["clone", &origin_str, &dev_b_str]);
    fs::write(dev_b.join("peer_b.rs"), "pub fn from_peer_b() {}\n").expect("write peer_b.rs");
    run_taxis_ok(&dev_b, &["add", "peer_b.rs"]);
    run_taxis_ok(
        &dev_b,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(peer_b): add peer_b contribution", "from_peer_b"),
        ],
    );
    let peer_b_head = run_taxis_ok(&dev_b, &["rev-parse", "HEAD"]);
    run_taxis_ok(&dev_b, &["push", "origin", "main"]);

    // Peer A fetches origin, verifies remote-tracking ref updated, then pulls origin main
    run_taxis_ok(&dev_a, &["fetch", "origin"]);
    let fetched_tip = run_taxis_ok(&dev_a, &["rev-parse", "refs/remotes/origin/main"]);
    assert_eq!(
        fetched_tip, peer_b_head,
        "fetch must update refs/remotes/origin/main to Peer B's pushed commit"
    );

    run_taxis_ok(&dev_a, &["pull", "origin", "main"]);
    assert!(
        dev_a.join("peer_b.rs").is_file(),
        "pull origin main must fast-forward Peer A and materialize peer_b.rs"
    );
    assert_eq!(run_taxis_ok(&dev_a, &["rev-parse", "HEAD"]), peer_b_head);
    let _ = run_git_ok(&bare_origin, &["fsck", "--strict"]);
}
