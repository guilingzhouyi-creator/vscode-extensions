//! Module: tests::test_kernel_head_penetration — HEAD Coordinate Penetration & Merge Reclaim
//! File Path: tests/rust/test_kernel_head_penetration.rs
//! Architecture Role: Verifies Strict `HEAD` coordinate penetration into commits and blackboard
//!   leases without `cell-default` leakage, plus `taxis merge --reclaim` cleanup.
//! Dependencies & Triggers: Executed via `tests/integration_cli.rs`.
//! Responsibilities: Ensure commits and blackboard bind to active `HEAD` cell/card coordinates.
//! Exit Semantics & Design Rationale: Fails test binary on coordinate drift or cell-default leak.

use std::fs;

use crate::branch_test_fixtures::{
    cascade_checkout, compliant_kernel_msg, init_strict_repo_with_main_seed,
};
use crate::cli_harness::{run_taxis, run_taxis_ok, test_temp_dir};

#[test]
fn head_coordinate_penetration_binds_commit_and_blackboard_without_default_leak() {
    let tmp = test_temp_dir("fgt_head_coord_");
    let repo = tmp.path();
    init_strict_repo_with_main_seed(repo);

    cascade_checkout(repo, "integration", "integration");
    cascade_checkout(repo, "fractal-git", "cell/fractal-git/main");
    cascade_checkout(repo, "k1", "cell/fractal-git/card/k1/main");
    cascade_checkout(repo, "worker-1", "cell/fractal-git/card/k1/sub/worker-1");

    fs::write(repo.join("worker.rs"), "pub fn work() {}\n").expect("write worker.rs");
    assert!(run_taxis(repo, &["add", "worker.rs"]).status.success());
    let commit_msg = compliant_kernel_msg("feat(worker): implement worker feature", "worker.rs");
    let worker_commit = run_taxis(repo, &["commit", "-m", &commit_msg]);
    assert!(
        worker_commit.status.success(),
        "strict worker commit failed: {}\n{}",
        String::from_utf8_lossy(&worker_commit.stdout),
        String::from_utf8_lossy(&worker_commit.stderr)
    );
    assert!(
        run_taxis(repo, &["rev-parse", "HEAD"]).status.success(),
        "commit must advance HEAD cleanly under Strict mode"
    );
    assert!(
        !repo.join(".taxis/refs/fractal/cell/cell-default").exists(),
        "Strict mode commits must never write refs/fractal/cell/cell-default"
    );

    fs::write(repo.join("conflict.rs"), "pub fn clash() {}\n").expect("write conflict.rs");
    assert!(run_taxis(repo, &["add", "conflict.rs"]).status.success());
    let conflict_msg = compliant_kernel_msg("feat(conflict): verify cell mismatch guard", "conflict.rs");
    let clash_commit = run_taxis(repo, &["commit", "--cell", "webgames", "-m", &conflict_msg]);
    assert!(
        !clash_commit.status.success(),
        "explicit --cell contradicting active HEAD cell must reject"
    );

    let bb = run_taxis(
        repo,
        &[
            "blackboard",
            "claim",
            "--agent",
            "worker-1",
            "--file",
            "worker.rs",
            "--scope",
            "work",
            "--ttl",
            "60",
        ],
    );
    assert!(
        bb.status.success(),
        "blackboard claim from HEAD failed: {}\n{}",
        String::from_utf8_lossy(&bb.stdout),
        String::from_utf8_lossy(&bb.stderr)
    );
    let bb_list = run_taxis_ok(repo, &["blackboard", "list", "--json"]);
    assert!(
        bb_list.contains("k1") && !bb_list.contains("cell-default"),
        "blackboard coordinates must penetrate HEAD card/cell: {bb_list}"
    );
    assert!(
        repo.join(".taxis/blackboard/fractal-git/k1.json").is_file()
            || repo.join(".taxis/blackboard/fractal-git/k1.txb").is_file()
            || !repo.join(".taxis/blackboard/cell-default").exists(),
        "blackboard storage must bind to fractal-git, never cell-default"
    );

    let bb_release = run_taxis(repo, &["blackboard", "release", "--agent", "worker-1"]);
    assert!(
        bb_release.status.success(),
        "blackboard release from HEAD failed: {}",
        String::from_utf8_lossy(&bb_release.stderr)
    );

    assert!(
        run_taxis(repo, &["checkout", "cell/fractal-git/card/k1/main"])
            .status
            .success()
    );
    let merge_reclaim = run_taxis(
        repo,
        &[
            "merge",
            "--reclaim",
            "cell/fractal-git/card/k1/sub/worker-1",
        ],
    );
    assert!(
        merge_reclaim.status.success(),
        "merge --reclaim failed: {}\n{}",
        String::from_utf8_lossy(&merge_reclaim.stdout),
        String::from_utf8_lossy(&merge_reclaim.stderr)
    );
    assert!(
        !run_taxis(
            repo,
            &[
                "rev-parse",
                "refs/heads/cell/fractal-git/card/k1/sub/worker-1"
            ]
        )
        .status
        .success(),
        "merged Tier 4 subagent branch must be reclaimed by --reclaim"
    );
}
