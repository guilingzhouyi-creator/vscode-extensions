//! Module: tests::test_kernel_cascade_migrate — Five-Tier Cascade & Legacy Card Migration Tests
//! File Path: tests/rust/test_kernel_cascade_migrate.rs
//! Architecture Role: Verifies deterministic five-tier `--cascade` and `--facade` branch derivation
//!   alongside `taxis branch migrate` D/F-safe canonical upgrades.
//! Dependencies & Triggers: Executed via `tests/integration_cli.rs`.
//! Responsibilities: Validate tree output, symbolic HEAD migration, and sub-branch derivation.
//! Exit Semantics & Design Rationale: Fails test binary on D/F errors or malformed branch trees.

use crate::branch_test_fixtures::{
    cascade_checkout, init_strict_repo_with_main_seed, run_taxis_with_auth, TEST_AUTHORITY_HEX,
};
use crate::cli_harness::{run_taxis, run_taxis_ok, test_temp_dir};

#[test]
fn five_tier_cascade_facade_and_legacy_card_migration() {
    let tmp = test_temp_dir("fgt_cascade_df_");
    let repo = tmp.path();
    init_strict_repo_with_main_seed(repo);

    cascade_checkout(repo, "integration", "integration");
    cascade_checkout(repo, "fractal-git", "cell/fractal-git/main");
    cascade_checkout(repo, "k1", "cell/fractal-git/card/k1/main");

    let sub = run_taxis(repo, &["branch", "--cascade", "worker-1"]);
    assert!(
        sub.status.success(),
        "tier 3 -> tier 4 sub cascade must pass with zero D/F collision: {}\n{}",
        String::from_utf8_lossy(&sub.stdout),
        String::from_utf8_lossy(&sub.stderr)
    );
    assert!(
        run_taxis(repo, &["checkout", "cell/fractal-git/card/k1/sub/worker-1"])
            .status
            .success()
    );

    assert!(run_taxis(repo, &["checkout", "cell/fractal-git/main"])
        .status
        .success());
    let facade = run_taxis(
        repo,
        &["branch", "--cascade", "smoke-gate", "--facade", "feat"],
    );
    assert!(
        facade.status.success(),
        "facade cascade from CellMain must pass: {}",
        String::from_utf8_lossy(&facade.stderr)
    );

    let tree_out = run_taxis_ok(repo, &["branch", "--tree"]);
    assert!(tree_out.contains("cell/fractal-git/card/k1/main"));
    assert!(tree_out.contains("cell/fractal-git/card/k1/sub/worker-1"));
    assert!(tree_out.contains("feat/fractal-git/smoke-gate"));

    let head_sha = run_taxis_ok(repo, &["rev-parse", "HEAD"]);
    let advisory_set = run_taxis_with_auth(
        repo,
        &["policy", "set-branch-tier", "advisory"],
        Some(TEST_AUTHORITY_HEX),
    );
    assert!(advisory_set.status.success());
    let legacy_create = run_taxis(
        repo,
        &[
            "update-ref",
            "refs/heads/cell/fractal-git/card/legacy1",
            &head_sha,
        ],
    );
    assert!(legacy_create.status.success());

    assert!(
        run_taxis(repo, &["checkout", "cell/fractal-git/card/legacy1"])
            .status
            .success()
    );

    let strict_restore = run_taxis_with_auth(
        repo,
        &["policy", "set-branch-tier", "strict"],
        Some(TEST_AUTHORITY_HEX),
    );
    assert!(strict_restore.status.success());

    let migrate = run_taxis(
        repo,
        &["branch", "migrate", "cell/fractal-git/card/legacy1"],
    );
    assert!(
        migrate.status.success(),
        "taxis branch migrate failed: {}\n{}",
        String::from_utf8_lossy(&migrate.stdout),
        String::from_utf8_lossy(&migrate.stderr)
    );
    assert!(
        run_taxis(
            repo,
            &["rev-parse", "refs/heads/cell/fractal-git/card/legacy1/main"]
        )
        .status
        .success(),
        "canonical 5-segment /main ref must exist after migration"
    );
    let current_head = run_taxis_ok(repo, &["symbolic-ref", "--short", "HEAD"]);
    assert_eq!(current_head, "cell/fractal-git/card/legacy1/main");

    let post_migrate_sub = run_taxis(repo, &["branch", "--cascade", "worker-after"]);
    assert!(
        post_migrate_sub.status.success(),
        "migrated card must support Tier 4 sub-branch with zero D/F conflict: {}",
        String::from_utf8_lossy(&post_migrate_sub.stderr)
    );
}
