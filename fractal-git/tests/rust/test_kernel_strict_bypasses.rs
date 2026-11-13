//! Module: tests::test_kernel_strict_bypasses — Strict Bypass Closure & Worktree Zero-Residue
//! File Path: tests/rust/test_kernel_strict_bypasses.rs
//! Architecture Role: Verifies Strict mode rejects `checkout -b/-B`, `switch -c/--orphan`,
//!   `update-ref`, `symbolic-ref`, `rebase`, `-D`, `-m`, anonymous worktrees with zero residue,
//!   and unauthenticated `--bypass-branch-guard` overrides.
//! Dependencies & Triggers: Executed via `tests/integration_cli.rs`.
//! Responsibilities: Test bypass closure, cross-cell merge blocking, and audited overrides.
//! Exit Semantics & Design Rationale: Fails test binary on any bypass leak or disk residue.

use crate::branch_test_fixtures::{
    cascade_checkout, init_strict_repo_with_main_seed, run_taxis_with_auth, TEST_AUTHORITY_HEX,
};
use crate::cli_harness::{run_taxis, run_taxis_ok, test_temp_dir};

#[test]
fn strict_mode_closes_all_bypass_vectors_and_enforces_worktree_zero_residue() {
    let tmp = test_temp_dir("fgt_strict_bypasses_");
    let repo = tmp.path();
    init_strict_repo_with_main_seed(repo);

    cascade_checkout(repo, "integration", "integration");
    cascade_checkout(repo, "fractal-git", "cell/fractal-git/main");
    cascade_checkout(repo, "k1", "cell/fractal-git/card/k1/main");
    let sha = run_taxis_ok(repo, &["rev-parse", "HEAD"]);

    assert!(run_taxis(repo, &["checkout", "integration"])
        .status
        .success());
    cascade_checkout(repo, "webgames", "cell/webgames/main");
    assert!(
        run_taxis(repo, &["checkout", "cell/fractal-git/card/k1/main"])
            .status
            .success()
    );

    let update_rogue_cmd = ["update-ref", "refs/heads/rogue", &sha];
    let rejected_cmds: Vec<&[&str]> = vec![
        &["checkout", "-b", "rogue-checkout"],
        &["switch", "-c", "rogue-switch"],
        &["switch", "--orphan", "rogue-orphan"],
        &["checkout", "-B", "main"],
        &update_rogue_cmd,
        &["symbolic-ref", "HEAD", "refs/heads/rogue"],
        &["branch", "-D", "integration"],
        &["branch", "-m", "main", "evil"],
        &[
            "branch",
            "-m",
            "cell/fractal-git/card/k1/main",
            "cell/webgames/card/k1/main",
        ],
        &["rebase", "main"],
    ];
    for cmd in rejected_cmds {
        let out = run_taxis_with_auth(repo, cmd, None);
        assert!(
            !out.status.success(),
            "Strict bypass command {cmd:?} MUST be rejected"
        );
    }

    assert!(run_taxis(repo, &["checkout", "cell/fractal-git/main"])
        .status
        .success());
    let cross_merge = run_taxis(repo, &["merge", "cell/webgames/main"]);
    assert!(
        !cross_merge.status.success(),
        "cross-cell merge must fail closed in Strict mode"
    );

    let wt_anon = repo.join("wt-anon");
    let anon_out = run_taxis(repo, &["worktree", "add", "wt-anon", "--full"]);
    assert!(!anon_out.status.success());
    assert!(
        !wt_anon.exists(),
        "anonymous worktree reject must leave 0 residue"
    );

    let wt_bad = repo.join("wt-bad");
    let bad_br_out = run_taxis(
        repo,
        &[
            "worktree", "add", "wt-bad", "--branch", "rogue-wt", "--full",
        ],
    );
    assert!(!bad_br_out.status.success());
    assert!(
        !wt_bad.exists(),
        "invalid branch worktree reject must leave 0 residue"
    );

    let unauth_bypass = run_taxis_with_auth(
        repo,
        &[
            "branch",
            "emergency-hotfix",
            "--bypass-branch-guard",
            "--bypass-reason",
            "urgent production recovery override",
        ],
        None,
    );
    assert!(!unauth_bypass.status.success());

    let auth_bypass = run_taxis_with_auth(
        repo,
        &[
            "branch",
            "emergency-hotfix",
            "--bypass-branch-guard",
            "--bypass-reason",
            "urgent production recovery override",
        ],
        Some(TEST_AUTHORITY_HEX),
    );
    assert!(
        auth_bypass.status.success(),
        "authorized audited bypass failed: {}\n{}",
        String::from_utf8_lossy(&auth_bypass.stdout),
        String::from_utf8_lossy(&auth_bypass.stderr)
    );

    assert!(
        run_taxis(repo, &["checkout", "cell/fractal-git/card/k1/main"])
            .status
            .success()
    );
    let wt_valid = run_taxis(
        repo,
        &[
            "worktree",
            "add",
            "wt-valid",
            "--cascade",
            "worker-wt",
            "--full",
        ],
    );
    assert!(
        wt_valid.status.success(),
        "valid worktree cascade failed: {}\n{}",
        String::from_utf8_lossy(&wt_valid.stdout),
        String::from_utf8_lossy(&wt_valid.stderr)
    );
    assert!(repo.join("wt-valid").is_dir());
}
