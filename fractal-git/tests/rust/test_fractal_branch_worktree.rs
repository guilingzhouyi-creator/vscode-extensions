//! Module: tests::test_fractal_branch_worktree — Fractal Worktree Allocation & Scope Tests
//! File Path: tests/rust/test_fractal_branch_worktree.rs
//! Architecture Role: Verifies `taxis worktree add` rejects tier skips and scope escapes
//!   while permitting valid direct-parent allocations with strictly subsumed path scopes.
//! Dependencies & Triggers: Executed via `tests/integration_cli.rs`.
//! Responsibilities: Validate hierarchy tier checks and TopologyVerifier scope subsumption.
//! Exit Semantics & Design Rationale: Fails test binary on unauthorized worktree materialization.

use crate::branch_test_fixtures::init_advisory_committed_repo;
use crate::cli_harness::{run_taxis, run_taxis_ok, test_temp_dir};

#[test]
fn fractal_worktree_allocation_and_scope_enforced() {
    let tmp = test_temp_dir("fgt_wt_scope_");
    let repo = tmp.path();
    init_advisory_committed_repo(repo);

    run_taxis_ok(repo, &["checkout", "-b", "integration"]);
    run_taxis_ok(repo, &["checkout", "-b", "cell/fractal-git/main"]);

    run_taxis_ok(repo, &["checkout", "main"]);
    let skip_wt = run_taxis(
        repo,
        &[
            "worktree",
            "add",
            "wt-skip",
            "--cell",
            "fractal-git",
            "--card",
            "k1",
            "--scope",
            "fractal-git/src/",
        ],
    );
    assert!(
        !skip_wt.status.success(),
        "tier-skipping worktree allocation from main must fail"
    );

    let bad_scope = run_taxis(
        repo,
        &[
            "worktree",
            "add",
            "wt-bad-scope",
            "--cell",
            "fractal-git",
            "--card",
            "k1",
            "--branch",
            "cell/fractal-git/main",
            "--parent-scope",
            "fractal-git/crates/",
            "--scope",
            "auto-refactor/src/",
        ],
    );
    assert!(
        !bad_scope.status.success(),
        "worktree scope escaping parent scope must fail"
    );

    let ok_wt = run_taxis(
        repo,
        &[
            "worktree",
            "add",
            "wt-ok",
            "--cell",
            "fractal-git",
            "--card",
            "k1",
            "--branch",
            "cell/fractal-git/main",
            "--parent-scope",
            "fractal-git/crates/",
            "--scope",
            "fractal-git/crates/fg-topology/",
        ],
    );
    assert!(
        ok_wt.status.success(),
        "valid subsumed worktree must succeed: {}{}",
        String::from_utf8_lossy(&ok_wt.stdout),
        String::from_utf8_lossy(&ok_wt.stderr)
    );
}
