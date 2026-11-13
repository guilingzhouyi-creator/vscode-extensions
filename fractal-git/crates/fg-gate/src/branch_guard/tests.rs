//! Module: fg-gate — Branch Governance Guard Unit Tests
//! File Path: crates/fg-gate/src/branch_guard/tests.rs
//! Architecture Role: Regression suite proving Strict ad-hoc/4-segment rejection,
//!   5-tier derivation, trunk rename/delete protection, and ref mutation enforcement.

use super::*;
use crate::test_support::TempDir;
use fg_core::models::{BranchEnforcementTier, EnforcementTier};
use fg_topology::PolicyVaultStore;

fn strict_floor(tmp: &TempDir) -> BranchGovernanceFloor {
    let git_dir = tmp.path().join(".taxis");
    std::fs::create_dir_all(&git_dir).expect("mkdir");
    PolicyVaultStore::initialize_or_regenerate(
        &git_dir,
        EnforcementTier::Strict,
        BranchEnforcementTier::Strict,
        false,
    )
    .expect("seal vault");
    BranchGovernanceFloor::resolve(&git_dir)
}

#[test]
fn strict_rejects_adhoc_wip_four_seg_and_unknown_cell() {
    let tmp = TempDir::new().expect("tempdir");
    let floor = strict_floor(&tmp);
    assert_eq!(floor.tier, BranchEnforcementTier::Strict);

    for invalid in [
        "wip-scratch",
        "temp/hack",
        "arbitrary-branch",
        "cell/fractal-git/card/k1",
        "cell/nonexistent/main",
    ] {
        let result = BranchGuard::check_branch_creation(
            &floor,
            Some("cell/fractal-git/main"),
            invalid,
            None,
        );
        assert!(
            result.is_err(),
            "Strict must reject non-canonical branch '{invalid}'"
        );
    }
}

#[test]
fn strict_accepts_five_tier_canonical_hierarchy() {
    let tmp = TempDir::new().expect("tempdir");
    let floor = strict_floor(&tmp);

    assert!(BranchGuard::check_branch_creation(&floor, Some("main"), "integration", None).is_ok());
    assert!(BranchGuard::check_branch_creation(
        &floor,
        Some("integration"),
        "cell/fractal-git/main",
        None
    )
    .is_ok());
    assert!(BranchGuard::check_branch_creation(
        &floor,
        Some("cell/fractal-git/main"),
        "cell/fractal-git/card/phase-5/main",
        None
    )
    .is_ok());
    assert!(BranchGuard::check_branch_creation(
        &floor,
        Some("cell/fractal-git/card/phase-5/main"),
        "cell/fractal-git/card/phase-5/sub/fg-construct",
        None
    )
    .is_ok());
}

#[test]
fn rename_and_delete_protections_block_trunk_and_cross_cell() {
    let tmp = TempDir::new().expect("tempdir");
    let floor = strict_floor(&tmp);

    assert!(BranchGuard::check_branch_rename(
        &floor,
        "cell/fractal-git/card/k1/main",
        "cell/webgames/card/k1/main",
        false
    )
    .is_err());
    assert!(BranchGuard::check_branch_rename(
        &floor,
        "cell/fractal-git/card/k1",
        "cell/fractal-git/card/k1/main",
        true
    )
    .is_ok());
    assert!(BranchGuard::check_branch_delete(&floor, "integration", true, true).is_err());
    assert!(BranchGuard::check_branch_delete(&floor, "cell/fractal-git/main", true, false).is_err());
    assert!(BranchGuard::check_branch_delete(&floor, "cell/fractal-git/main", true, true).is_ok());
}

#[test]
fn ref_mutation_blocks_rogue_head_in_strict_and_allows_remotes() {
    let tmp = TempDir::new().expect("tempdir");
    let floor = strict_floor(&tmp);

    assert!(BranchGuard::check_ref_mutation(&floor, "refs/heads/rogue", false, false).is_err());
    assert!(BranchGuard::check_ref_mutation(
        &floor,
        "refs/heads/cell/fractal-git/card/k1/main",
        false,
        false
    )
    .is_ok());
    assert!(BranchGuard::check_ref_mutation(&floor, "refs/remotes/origin/foo", false, false).is_ok());
}
