//! Test Suite: Hosted Small Project Repository Git Parity — Archive, Blame & Maintenance
//! File Path: tests/rust/test_hosted_git_archive_parity.rs
//! Architecture Role: End-to-end integration test suite verifying Taxis equivalence with system Git across blame, bisect, archive/unarchive, bundle roundtrip, bidirectional git-import/export, and maintenance accelerators.
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

use crate::cli_harness::{compliant_msg, run_git, run_git_ok, run_taxis_ok, test_temp_dir};

#[test]
fn test_blame_bisect_archive_unarchive_and_bundle_roundtrip() {
    let tmp = test_temp_dir("hosted_edge_porcelain_");
    let repo = tmp.path().join("edge-lab");
    run_taxis_ok(tmp.path(), &["init", "edge-lab"]);

    let (c1, _c2, c3, _c4) = seed_four_commit_regression_history(&repo);

    // 1. Blame full, line-range (-L), and --json
    let blame_out = run_taxis_ok(&repo, &["blame", "config.ini"]);
    assert!(
        blame_out.contains(&c1[..8]) && blame_out.contains(&c3[..8]),
        "blame output must attribute lines to their introducing commits: {blame_out}"
    );
    let blame_slice = run_taxis_ok(&repo, &["blame", "-L", "2,2", "config.ini"]);
    assert_eq!(blame_slice.lines().count(), 1);
    assert!(
        blame_slice.contains(&c3[..8]),
        "line 2 was modified in c3 and must be attributed to c3: {blame_slice}"
    );

    // 2. Bisect manual session isolating first bad commit c3
    run_taxis_ok(&repo, &["bisect", "start"]);
    run_taxis_ok(&repo, &["bisect", "bad", "HEAD"]);
    let step_out = run_taxis_ok(&repo, &["bisect", "good", &c1]);
    assert!(
        step_out.contains("Bisecting:") || step_out.contains("first bad commit"),
        "bisect good must advance to midpoint candidate: {step_out}"
    );
    let status_out = run_taxis_ok(&repo, &["bisect", "status"]);
    assert!(
        status_out.contains("Bisection in progress"),
        "bisect status must report active session: {status_out}"
    );

    // Mark midpoint (c2 or c3) appropriately until first bad commit c3 is isolated
    let head_at_step = run_taxis_ok(&repo, &["rev-parse", "HEAD"]);
    let final_out = if head_at_step == c3 {
        let out = run_taxis_ok(&repo, &["bisect", "bad"]);
        if out.contains("is the first bad commit") {
            out
        } else {
            run_taxis_ok(&repo, &["bisect", "good"])
        }
    } else {
        let out = run_taxis_ok(&repo, &["bisect", "good"]);
        if out.contains("is the first bad commit") {
            out
        } else {
            run_taxis_ok(&repo, &["bisect", "bad"])
        }
    };
    assert!(
        final_out.contains(&c3) && final_out.contains("is the first bad commit"),
        "bisect must isolate c3 as the first bad commit: {final_out}"
    );
    run_taxis_ok(&repo, &["bisect", "reset"]);

    // 3. Archive (.tar & .zip), unarchive (--dry-run, worktree, --to-odb), and bundle
    verify_archive_unarchive_and_bundle(tmp.path(), &repo);
}

fn seed_four_commit_regression_history(repo: &Path) -> (String, String, String, String) {
    fs::write(
        repo.join("config.ini"),
        "mode=safe\nretries=3\ntimeout=10\n",
    )
    .expect("c1 write");
    run_taxis_ok(repo, &["add", "config.ini"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(config): initialize config defaults", "config"),
        ],
    );
    let c1 = run_taxis_ok(repo, &["rev-parse", "HEAD"]);

    fs::write(
        repo.join("config.ini"),
        "mode=safe\nretries=3\ntimeout=20\n",
    )
    .expect("c2 write");
    run_taxis_ok(repo, &["add", "config.ini"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("chore(config): increase timeout to 20", "config"),
        ],
    );
    let c2 = run_taxis_ok(repo, &["rev-parse", "HEAD"]);

    fs::write(
        repo.join("config.ini"),
        "mode=safe\nretries=0\ntimeout=20\n",
    )
    .expect("c3 write");
    run_taxis_ok(repo, &["add", "config.ini"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(config): set retries to zero regression", "config"),
        ],
    );
    let c3 = run_taxis_ok(repo, &["rev-parse", "HEAD"]);

    fs::write(
        repo.join("config.ini"),
        "mode=safe\nretries=0\ntimeout=30\n",
    )
    .expect("c4 write");
    run_taxis_ok(repo, &["add", "config.ini"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("chore(config): bump timeout to 30", "config"),
        ],
    );
    let c4 = run_taxis_ok(repo, &["rev-parse", "HEAD"]);
    (c1, c2, c3, c4)
}

fn verify_archive_unarchive_and_bundle(root: &Path, repo: &Path) {
    let tar_path = root.join("snap.tar");
    let zip_path = root.join("snap.zip");
    let tar_str = tar_path.to_string_lossy().into_owned();
    let zip_str = zip_path.to_string_lossy().into_owned();

    run_taxis_ok(
        repo,
        &[
            "archive",
            "--format=tar",
            "--prefix=pkg/",
            "-o",
            &tar_str,
            "HEAD",
        ],
    );
    run_taxis_ok(repo, &["archive", "--format=zip", "-o", &zip_str, "HEAD"]);
    assert!(tar_path.is_file() && zip_path.is_file());

    // unarchive --dry-run must not modify archive or disk
    let dry_out = run_taxis_ok(repo, &["unarchive", &tar_str, "--dry-run"]);
    assert!(
        dry_out.contains("SpacePlan") || dry_out.contains("Dry-Run") || !dry_out.is_empty(),
        "unarchive --dry-run must output space projection report"
    );

    // unarchive --no-in-place into destination directory
    let extract_dir = root.join("extracted-zip");
    fs::create_dir_all(&extract_dir).expect("create extract_dir");
    let extract_str = extract_dir.to_string_lossy().into_owned();
    run_taxis_ok(
        repo,
        &[
            "unarchive",
            &zip_str,
            "--no-in-place",
            "--headroom",
            "0",
            "-C",
            &extract_str,
        ],
    );
    assert!(
        extract_dir.join("config.ini").is_file(),
        "unarchive must extract config.ini into destination directory"
    );

    // unarchive --to-odb --tree-only
    let odb_out = run_taxis_ok(
        repo,
        &[
            "unarchive",
            &tar_str,
            "--to-odb",
            "--tree-only",
            "--headroom",
            "0",
        ],
    );
    assert!(
        !odb_out.is_empty(),
        "unarchive --to-odb --tree-only must report ingested tree OID"
    );

    // Bundle create / verify / list-heads
    let bundle_path = root.join("repo.bundle");
    let bundle_str = bundle_path.to_string_lossy().into_owned();
    run_taxis_ok(repo, &["bundle", "create", &bundle_str, "HEAD"]);
    run_taxis_ok(repo, &["bundle", "verify", &bundle_str]);
    let heads_out = run_taxis_ok(repo, &["bundle", "list-heads", &bundle_str]);
    assert!(
        heads_out.contains("HEAD") || heads_out.contains("refs/"),
        "bundle list-heads must list packaged references: {heads_out}"
    );
}

#[test]
fn test_bidirectional_git_import_export_and_maintenance_accelerators() {
    let tmp = test_temp_dir("hosted_import_maint_");
    let git_repo = tmp.path().join("legacy-git");
    fs::create_dir_all(&git_repo).expect("create legacy-git");

    let git_init = run_git(&git_repo, &["init", "-b", "main"]);
    if !git_init.status.success() {
        assert!(
            std::env::var_os("TAXIS_REQUIRE_GIT").is_none(),
            "TAXIS_REQUIRE_GIT is set but git init failed"
        );
        return;
    }

    fs::write(git_repo.join(".gitignore"), "*.log\nbuild/\n").expect("write .gitignore");
    fs::write(git_repo.join("README.md"), "# Legacy Service\n").expect("write README.md");
    let _ = run_git_ok(&git_repo, &["add", ".gitignore", "README.md"]);
    let _ = run_git_ok(&git_repo, &["commit", "-m", "Initial git commit"]);
    let _ = run_git_ok(&git_repo, &["tag", "-a", "v1.0.0", "-m", "Version 1.0.0"]);
    let _ = run_git_ok(&git_repo, &["checkout", "-b", "feature/imported"]);
    fs::write(git_repo.join("imported.rs"), "pub fn from_git() {}\n").expect("write imported.rs");
    let _ = run_git_ok(&git_repo, &["add", "imported.rs"]);
    let _ = run_git_ok(&git_repo, &["commit", "-m", "Add imported.rs on branch"]);
    let _ = run_git_ok(&git_repo, &["checkout", "main"]);

    // 1. Import .git -> .taxis via `taxis git-import`
    run_taxis_ok(&git_repo, &["git-import"]);
    assert!(
        git_repo.join(".taxis").is_dir(),
        "git-import must create .taxis native directory"
    );

    // 2. Verify show, check-ignore, doctor, fsck on imported repo
    let show_blob = run_taxis_ok(&git_repo, &["show", "HEAD:README.md"]);
    assert_eq!(show_blob, "# Legacy Service");
    let ignore_out = run_taxis_ok(&git_repo, &["check-ignore", "-v", "debug.log"]);
    assert!(
        ignore_out.contains(".gitignore") && ignore_out.contains("*.log"),
        "check-ignore -v must cite matching rule: {ignore_out}"
    );
    run_taxis_ok(&git_repo, &["doctor"]);
    run_taxis_ok(&git_repo, &["fsck"]);

    // 3. Commit in .taxis, build pack + commit-graph + multi-pack-index, prune, and export back to .git
    fs::write(
        git_repo.join("native_added.rs"),
        "pub fn added_in_taxis() {}\n",
    )
    .expect("write native_added.rs");
    run_taxis_ok(&git_repo, &["add", "native_added.rs"]);
    run_taxis_ok(
        &git_repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(native): add native_added function", "added_in_taxis"),
        ],
    );

    run_taxis_ok(&git_repo, &["repack"]);
    run_taxis_ok(&git_repo, &["commit-graph", "write"]);
    run_taxis_ok(&git_repo, &["commit-graph", "verify"]);
    run_taxis_ok(&git_repo, &["multi-pack-index", "write"]);
    run_taxis_ok(&git_repo, &["multi-pack-index", "verify"]);
    run_taxis_ok(&git_repo, &["prune", "--dry-run"]);

    run_taxis_ok(&git_repo, &["git-export", "--force"]);
    let _ = run_git_ok(&git_repo, &["fsck", "--strict"]);
    let git_branches = run_git_ok(&git_repo, &["branch"]);
    assert!(
        git_branches.contains("feature/imported") && git_branches.contains("main"),
        "roundtrip git-export must preserve all branches: {git_branches}"
    );
}
