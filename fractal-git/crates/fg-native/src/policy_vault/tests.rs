//! Module: fg-native — Policy Vault Persistence Unit Tests
//! File Path: crates/fg-native/src/policy_vault/tests.rs
//! Architecture Role: Integration tests verifying MissingAfterInit fail-closed traps,
//!   cross-repository vault transplant rejection, seal tampering, and linked worktree resolution.

use super::*;
use crate::repo_layout::RepoLayout;
use fg_core::models::{BranchEnforcementTier, EnforcementTier};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static VAULT_TEST_SEQ: AtomicU64 = AtomicU64::new(0);

fn temp_workspace(label: &str) -> PathBuf {
    let seq = VAULT_TEST_SEQ.fetch_add(1, Ordering::Relaxed);
    let mut dir = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp")
        .join("fg-policy-vault");
    let _ = std::fs::create_dir_all(&dir);
    dir.push(format!("{label}-{}-{seq}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create workspace");
    dir
}

#[test]
fn delete_hidden_vault_after_init_triggers_missing_after_init_until_regenerated() {
    let ws = temp_workspace("missing-after-init");
    let layout = RepoLayout::dev(&ws);
    let init_repo = layout.initialize().expect("init native repo");

    assert!(matches!(
        PolicyVaultStore::load_state(&init_repo.repo_dir),
        PolicyVaultState::Sealed(_)
    ));

    let deleted = PolicyVaultStore::erase_vault_only(&init_repo.repo_dir).expect("erase vault");
    assert!(deleted);
    assert!(matches!(
        PolicyVaultStore::load_state(&init_repo.repo_dir),
        PolicyVaultState::MissingAfterInit { .. }
    ));

    let regen = PolicyVaultStore::initialize_or_regenerate(
        &init_repo.repo_dir,
        EnforcementTier::Strict,
        BranchEnforcementTier::Strict,
        true,
    )
    .expect("regenerate");
    assert_eq!(regen.payload.branch_floor, BranchEnforcementTier::Strict);
    assert!(matches!(
        PolicyVaultStore::load_state(&init_repo.repo_dir),
        PolicyVaultState::Sealed(loaded) if loaded.payload.locked_by_authority
    ));

    let _ = std::fs::remove_dir_all(&ws);
}

#[test]
fn tamper_and_transplant_across_git_repos_fail_closed() {
    let ws_a = temp_workspace("git-a");
    let ws_b = temp_workspace("git-b");
    let git_a = ws_a.join(".git");
    let git_b = ws_b.join(".git");
    std::fs::create_dir_all(&git_a).expect("git_a");
    std::fs::create_dir_all(&git_b).expect("git_b");

    PolicyVaultStore::initialize_or_regenerate(
        &git_a,
        EnforcementTier::Strict,
        BranchEnforcementTier::Native,
        false,
    )
    .expect("init a");
    PolicyVaultStore::initialize_or_regenerate(
        &git_b,
        EnforcementTier::Strict,
        BranchEnforcementTier::Strict,
        true,
    )
    .expect("init b");

    let bytes_a = std::fs::read(PolicyVaultStore::vault_path(&git_a)).expect("read a");
    std::fs::write(PolicyVaultStore::vault_path(&git_b), &bytes_a).expect("overwrite b");
    assert!(matches!(
        PolicyVaultStore::load_state(&git_b),
        PolicyVaultState::TamperedOrCorrupt { .. }
    ));

    std::fs::remove_file(PolicyVaultStore::seal_path(&git_a)).expect("remove seal");
    assert!(matches!(
        PolicyVaultStore::load_state(&git_a),
        PolicyVaultState::TamperedOrCorrupt { .. }
    ));

    let _ = std::fs::remove_dir_all(&ws_a);
    let _ = std::fs::remove_dir_all(&ws_b);
}

#[test]
fn linked_worktree_commondir_resolves_shared_vault() {
    let ws = temp_workspace("wt-commondir");
    let common_git = ws.join(".git");
    let wt_git = common_git.join("worktrees").join("sub-wt");
    std::fs::create_dir_all(&wt_git).expect("wt_git");
    std::fs::write(wt_git.join("commondir"), "../..\n").expect("commondir");

    PolicyVaultStore::initialize_or_regenerate(
        &common_git,
        EnforcementTier::Strict,
        BranchEnforcementTier::Strict,
        true,
    )
    .expect("init common");

    match PolicyVaultStore::load_state(&wt_git) {
        PolicyVaultState::Sealed(loaded) => {
            assert_eq!(loaded.payload.branch_floor, BranchEnforcementTier::Strict);
        }
        other => panic!("expected Sealed from linked worktree, got {other:?}"),
    }

    let _ = std::fs::remove_dir_all(&ws);
}
