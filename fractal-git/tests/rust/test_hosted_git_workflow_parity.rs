//! Test Suite: Hosted Small Project Repository Git Parity — Workflow & Patch Pipeline
//! File Path: tests/rust/test_hosted_git_workflow_parity.rs
//! Architecture Role: End-to-end integration test suite verifying Taxis equivalence with system Git across stash lifecycle, reset modes, operation undo time-travel, cherry-pick, revert, rebase, and format-patch/am pipeline.
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

use crate::cli_harness::{compliant_msg, run_taxis_ok, test_temp_dir};

#[test]
fn test_stash_lifecycle_reset_modes_and_operation_undo_time_travel() {
    let tmp = test_temp_dir("hosted_stash_reset_undo_");
    let repo = tmp.path().join("state-lab");
    run_taxis_ok(tmp.path(), &["init", "state-lab"]);

    fs::create_dir_all(repo.join("src")).expect("create src dir");
    fs::write(repo.join("src/tracked.rs"), "pub fn state() -> u32 { 1 }\n").expect("write v1");
    run_taxis_ok(&repo, &["add", "src/tracked.rs"]);
    run_taxis_ok(
        &repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(src): add initial state v1", "state"),
        ],
    );
    let c1_oid = run_taxis_ok(&repo, &["rev-parse", "HEAD"]);

    fs::write(repo.join("src/tracked.rs"), "pub fn state() -> u32 { 2 }\n").expect("write v2");
    fs::write(repo.join("src/extra.rs"), "pub fn extra() {}\n").expect("write extra.rs");
    run_taxis_ok(&repo, &["add", "src/tracked.rs", "src/extra.rs"]);
    run_taxis_ok(
        &repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(src): advance state to v2 and add extra", "extra"),
        ],
    );
    let c2_oid = run_taxis_ok(&repo, &["rev-parse", "HEAD"]);

    // 1. Stash push / list / apply / pop / drop on native .taxis repository
    verify_stash_roundtrip(&repo);

    // 2. Path-level reset (`taxis reset HEAD src/tracked.rs`) and diff --cached verification
    fs::write(repo.join("src/tracked.rs"), "pub fn state() -> u32 { 3 }\n")
        .expect("modify tracked.rs");
    run_taxis_ok(&repo, &["add", "src/tracked.rs"]);
    let staged_diff = run_taxis_ok(&repo, &["diff", "--cached", "--name-only"]);
    assert!(
        staged_diff.contains("src/tracked.rs"),
        "diff --cached must report staged src/tracked.rs against effective HEAD: {staged_diff}"
    );
    run_taxis_ok(&repo, &["reset", "HEAD", "src/tracked.rs"]);
    let unstaged_diff = run_taxis_ok(&repo, &["diff", "--cached", "--name-only"]);
    assert!(
        unstaged_diff.is_empty(),
        "path reset must unstage src/tracked.rs from index, got: {unstaged_diff}"
    );
    run_taxis_ok(&repo, &["checkout", "--", "src/tracked.rs"]);

    // 3. Reset --soft, --mixed, --hard and Jujutsu-style `taxis undo` rollback
    run_taxis_ok(&repo, &["reset", "--soft", &c1_oid]);
    assert_eq!(run_taxis_ok(&repo, &["rev-parse", "HEAD"]), c1_oid);
    let soft_cached = run_taxis_ok(&repo, &["diff", "--cached", "--name-only"]);
    assert!(
        soft_cached.contains("src/extra.rs"),
        "reset --soft must keep src/extra.rs staged in index: {soft_cached}"
    );

    run_taxis_ok(&repo, &["undo"]);
    assert_eq!(
        run_taxis_ok(&repo, &["rev-parse", "HEAD"]),
        c2_oid,
        "taxis undo must restore HEAD to c2 after soft reset"
    );

    run_taxis_ok(&repo, &["reset", "--hard", &c1_oid]);
    assert!(
        !repo.join("src/extra.rs").exists(),
        "reset --hard to c1 must remove src/extra.rs from worktree"
    );
    let op_log = run_taxis_ok(&repo, &["op"]);
    assert!(
        op_log.contains("reset"),
        "operation log must record reset entry: {op_log}"
    );

    run_taxis_ok(&repo, &["undo"]);
    assert_eq!(
        run_taxis_ok(&repo, &["rev-parse", "HEAD"]),
        c2_oid,
        "taxis undo must restore HEAD to c2 after hard reset"
    );
    assert!(
        repo.join("src/extra.rs").is_file(),
        "taxis undo after hard reset must re-materialize src/extra.rs in worktree"
    );
}

fn verify_stash_roundtrip(repo: &Path) {
    fs::write(
        repo.join("src/tracked.rs"),
        "pub fn state() -> u32 { 99 }\n",
    )
    .expect("dirty edit");
    run_taxis_ok(repo, &["stash", "push", "-m", "WIP state 99"]);
    assert_eq!(
        fs::read_to_string(repo.join("src/tracked.rs")).expect("read clean tracked.rs"),
        "pub fn state() -> u32 { 2 }\n",
        "stash push must restore worktree to effective HEAD"
    );

    let list_out = run_taxis_ok(repo, &["stash", "list"]);
    assert!(
        list_out.contains("stash@{0}") && list_out.contains("WIP on main"),
        "stash list must display saved stash entry: {list_out}"
    );

    run_taxis_ok(repo, &["stash", "apply"]);
    assert_eq!(
        fs::read_to_string(repo.join("src/tracked.rs")).expect("read applied tracked.rs"),
        "pub fn state() -> u32 { 99 }\n"
    );
    run_taxis_ok(repo, &["checkout", "--", "src/tracked.rs"]);

    run_taxis_ok(repo, &["stash", "pop"]);
    assert_eq!(
        fs::read_to_string(repo.join("src/tracked.rs")).expect("read popped tracked.rs"),
        "pub fn state() -> u32 { 99 }\n"
    );
    assert!(
        run_taxis_ok(repo, &["stash", "list"]).is_empty(),
        "stash list must be empty after stash pop"
    );
    run_taxis_ok(repo, &["checkout", "--", "src/tracked.rs"]);
}

#[test]
fn test_cherry_pick_revert_rebase_and_format_patch_am_pipeline() {
    let tmp = test_temp_dir("hosted_transplant_patch_");
    let repo = tmp.path().join("patch-lab");
    run_taxis_ok(tmp.path(), &["init", "patch-lab"]);

    fs::write(repo.join("base.rs"), "pub fn base() {}\n").expect("write base.rs");
    run_taxis_ok(&repo, &["add", "base.rs"]);
    run_taxis_ok(
        &repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(base): add base module", "base"),
        ],
    );

    // Create topic branch with a feature commit
    run_taxis_ok(&repo, &["checkout", "-b", "topic"]);
    fs::write(repo.join("picked.rs"), "pub fn picked() -> u32 { 7 }\n").expect("write picked.rs");
    run_taxis_ok(&repo, &["add", "picked.rs"]);
    run_taxis_ok(
        &repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(picked): add picked helper", "picked"),
        ],
    );
    let topic_oid = run_taxis_ok(&repo, &["rev-parse", "HEAD"]);

    // Return to main, add an independent commit, then cherry-pick and revert topic_oid
    run_taxis_ok(&repo, &["checkout", "main"]);
    fs::write(repo.join("trunk.rs"), "pub fn trunk() {}\n").expect("write trunk.rs");
    run_taxis_ok(&repo, &["add", "trunk.rs"]);
    run_taxis_ok(
        &repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(trunk): add trunk helper", "trunk"),
        ],
    );

    run_taxis_ok(&repo, &["cherry-pick", &topic_oid]);
    assert!(
        repo.join("picked.rs").is_file(),
        "cherry-pick must transplant picked.rs onto main"
    );

    run_taxis_ok(&repo, &["revert", "HEAD"]);
    assert!(
        !repo.join("picked.rs").exists(),
        "revert HEAD must undo cherry-picked file addition"
    );

    // Export topic_oid via format-patch, check with apply --stat / --check, and apply via `am`
    let patch_text = run_taxis_ok(&repo, &["format-patch", "-1", &topic_oid, "--stdout"]);
    assert!(
        patch_text.contains("Subject: [PATCH") && patch_text.contains("picked.rs"),
        "format-patch --stdout must emit mbox patch: {patch_text}"
    );
    let patch_file = tmp.path().join("0001-picked.patch");
    fs::write(&patch_file, &patch_text).expect("write patch file");
    let patch_file_str = patch_file.to_string_lossy().into_owned();

    let stat_out = run_taxis_ok(&repo, &["apply", "--stat", &patch_file_str]);
    assert!(
        stat_out.contains("picked.rs"),
        "apply --stat must summarize changed file: {stat_out}"
    );
    run_taxis_ok(&repo, &["apply", "--check", &patch_file_str]);
    run_taxis_ok(&repo, &["am", &patch_file_str]);
    assert!(
        repo.join("picked.rs").is_file(),
        "taxis am must apply mailbox patch and materialize picked.rs"
    );

    // Rebase topic onto main
    run_taxis_ok(&repo, &["checkout", "topic"]);
    run_taxis_ok(&repo, &["rebase", "main"]);
    assert!(
        repo.join("trunk.rs").is_file() && repo.join("picked.rs").is_file(),
        "rebased topic branch must contain both trunk.rs and picked.rs"
    );
}
