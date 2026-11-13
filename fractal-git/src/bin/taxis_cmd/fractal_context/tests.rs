//! Module: taxis_cmd::fractal_context::tests — Fractal Coordinate Penetration Unit Tests
//! File Path: src/bin/taxis_cmd/fractal_context/tests.rs
//! Architecture Role: Unit test suite verifying Strict HEAD coordinate penetration and `--cascade`.
//! Dependencies & Triggers: Compiled under `#[cfg(test)]` via `fractal_context`.
//! Responsibilities: Validate strict coordinate binding, conflict rejection, and 5-tier derivation.
//! Exit Semantics & Design Rationale: Uses process/sequence-unique temporary directories.

use super::*;
use fg_topology::PolicyVaultStore;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static CTX_SEQ: AtomicU64 = AtomicU64::new(0);

fn temp_dir() -> PathBuf {
    let seq = CTX_SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("fg-ctx-test-{}-{seq}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("refs/heads")).expect("mkdir");
    dir
}

#[test]
fn strict_mode_extracts_head_cell_and_blocks_missing_or_conflicting_cell() {
    let git_dir = temp_dir();
    PolicyVaultStore::initialize_or_regenerate(
        &git_dir,
        EnforcementTier::Strict,
        BranchEnforcementTier::Strict,
        false,
    )
    .expect("init vault");

    fs::write(
        git_dir.join("HEAD"),
        "ref: refs/heads/cell/fractal-git/card/kernel-std/main\n",
    )
    .expect("write HEAD");
    let floor = BranchGovernanceFloor::resolve(&git_dir);

    let coords =
        ActiveFractalCoordinates::resolve(&git_dir, &[], &floor).expect("resolve from HEAD");
    assert_eq!(coords.cell_id, "fractal-git");
    assert_eq!(coords.card_id.as_deref(), Some("kernel-std"));
    assert!(!coords.is_legacy_default_cell);

    let conflict = ActiveFractalCoordinates::resolve(
        &git_dir,
        &["--cell".to_owned(), "webgames".to_owned()],
        &floor,
    );
    assert!(
        conflict.is_err(),
        "cross-cell flag conflict must fail closed"
    );

    fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("write main HEAD");
    let missing = ActiveFractalCoordinates::resolve(&git_dir, &[], &floor);
    assert!(missing.is_err(), "main without --cell must fail in Strict");

    let _ = fs::remove_dir_all(&git_dir);
}

#[test]
fn cascade_derivation_generates_five_tier_df_safe_chain() {
    let git_dir = temp_dir();
    PolicyVaultStore::initialize_or_regenerate(
        &git_dir,
        EnforcementTier::Strict,
        BranchEnforcementTier::Strict,
        false,
    )
    .expect("init vault");
    let floor = BranchGovernanceFloor::resolve(&git_dir);

    fs::write(
        git_dir.join("HEAD"),
        "ref: refs/heads/cell/fractal-git/main\n",
    )
    .expect("HEAD");
    let (parent, card_branch) =
        derive_cascade_short_branch(&git_dir, None, "kernel-std", None, &floor)
            .expect("derive card");
    assert_eq!(parent, "cell/fractal-git/main");
    assert_eq!(card_branch, "cell/fractal-git/card/kernel-std/main");

    let (_, sub_branch) =
        derive_cascade_short_branch(&git_dir, Some(&card_branch), "agent-1", None, &floor)
            .expect("derive sub");
    assert_eq!(sub_branch, "cell/fractal-git/card/kernel-std/sub/agent-1");

    let _ = fs::remove_dir_all(&git_dir);
}
