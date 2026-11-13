//! Module: tests::test_fractal_branch_fork_merge — Fractal Hierarchy Fork & Merge Tests
//! File Path: tests/rust/test_fractal_branch_fork_merge.rs
//! Architecture Role: Verifies `taxis branch`, `checkout`, `switch`, `merge`, and `rebase`
//!   enforce the five-tier branch hierarchy in kernel without skipping tiers or crossing cells.
//! Dependencies & Triggers: Executed via `tests/integration_cli.rs`.
//! Responsibilities: Test advisory derivation chains, cross-cell rejections, and rebase limits.
//! Exit Semantics & Design Rationale: Fails test binary on any illegal hierarchy transition.

use std::fs;

use crate::branch_test_fixtures::{compliant_kernel_msg, init_advisory_committed_repo};
use crate::cli_harness::{run_taxis, run_taxis_ok, test_temp_dir};

#[test]
fn fractal_branch_derivation_and_switch_enforced() {
    let tmp = test_temp_dir("fgt_branch_fork_");
    let repo = tmp.path();
    init_advisory_committed_repo(repo);

    let int_br = run_taxis(repo, &["branch", "integration"]);
    assert!(
        int_br.status.success(),
        "main -> integration must pass: {}",
        String::from_utf8_lossy(&int_br.stderr)
    );

    let skip_br = run_taxis(repo, &["branch", "cell/fractal-git/card/k1"]);
    assert!(
        !skip_br.status.success(),
        "main -> card tier skip must be rejected"
    );
    let skip_msg = format!(
        "{}{}",
        String::from_utf8_lossy(&skip_br.stdout),
        String::from_utf8_lossy(&skip_br.stderr)
    );
    assert!(
        skip_msg.contains("FGT-TOP-001"),
        "expected FGT-TOP-001, got: {skip_msg}"
    );

    let skip_co = run_taxis(
        repo,
        &[
            "checkout",
            "-b",
            "cell/fractal-git/card/k1/sub/fg-construct",
        ],
    );
    assert!(
        !skip_co.status.success(),
        "checkout -b skipping to sub tier must be rejected"
    );

    run_taxis_ok(repo, &["checkout", "integration"]);
    run_taxis_ok(repo, &["branch", "cell/fractal-git/main"]);
    run_taxis_ok(repo, &["checkout", "cell/fractal-git/main"]);
    run_taxis_ok(repo, &["switch", "-c", "feat/fractal-git/k1"]);
    run_taxis_ok(repo, &["branch", "cell/fractal-git/card/feat-k1/sub/s1"]);

    let cross_co = run_taxis(
        repo,
        &[
            "checkout",
            "-b",
            "cell/webgames/card/k2",
            "cell/fractal-git/main",
        ],
    );
    assert!(
        !cross_co.status.success(),
        "cross-cell checkout -b must be rejected"
    );
}

#[test]
fn fractal_merge_and_rebase_hierarchy_enforced() {
    let tmp = test_temp_dir("fgt_merge_rebase_");
    let repo = tmp.path();
    init_advisory_committed_repo(repo);

    run_taxis_ok(repo, &["checkout", "-b", "integration"]);
    run_taxis_ok(repo, &["checkout", "-b", "cell/webgames/main"]);
    run_taxis_ok(repo, &["checkout", "integration"]);
    run_taxis_ok(repo, &["checkout", "-b", "cell/fractal-git/main"]);

    fs::write(repo.join("cell.txt"), "cell v1\n").expect("write cell.txt");
    run_taxis_ok(repo, &["add", "cell.txt"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "--cell",
            "fractal-git",
            "-m",
            &compliant_kernel_msg("feat(core): cell main commit", "cell.txt"),
        ],
    );

    run_taxis_ok(repo, &["checkout", "-b", "feat/fractal-git/k1"]);
    run_taxis_ok(
        repo,
        &["checkout", "-b", "cell/fractal-git/card/feat-k1/sub/s1"],
    );

    fs::write(repo.join("sub.txt"), "subagent v1\n").expect("write sub.txt");
    run_taxis_ok(repo, &["add", "sub.txt"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "--cell",
            "fractal-git",
            "-m",
            &compliant_kernel_msg("feat(core): subagent deliverable", "sub.txt"),
        ],
    );

    run_taxis_ok(repo, &["checkout", "main"]);
    let illegal_merge = run_taxis(repo, &["merge", "cell/fractal-git/card/feat-k1/sub/s1"]);
    assert!(
        !illegal_merge.status.success(),
        "merging subagent directly into main must fail"
    );

    run_taxis_ok(repo, &["checkout", "cell/fractal-git/main"]);
    let cross_merge = run_taxis(repo, &["merge", "cell/webgames/main"]);
    assert!(!cross_merge.status.success(), "cross-cell merge must fail");

    run_taxis_ok(repo, &["checkout", "feat/fractal-git/k1"]);
    let bad_rebase = run_taxis(repo, &["rebase", "main"]);
    assert!(
        !bad_rebase.status.success(),
        "card branch must not rebase directly onto main"
    );
    let ok_rebase = run_taxis(repo, &["rebase", "cell/fractal-git/main"]);
    assert!(
        ok_rebase.status.success(),
        "card branch rebase onto cell/fractal-git/main must succeed: {}{}",
        String::from_utf8_lossy(&ok_rebase.stdout),
        String::from_utf8_lossy(&ok_rebase.stderr)
    );

    let ok_merge = run_taxis(repo, &["merge", "cell/fractal-git/card/feat-k1/sub/s1"]);
    assert!(
        ok_merge.status.success(),
        "sub -> card merge must succeed: {}{}",
        String::from_utf8_lossy(&ok_merge.stdout),
        String::from_utf8_lossy(&ok_merge.stderr)
    );
}
