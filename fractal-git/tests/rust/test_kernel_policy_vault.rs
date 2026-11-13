//! Module: tests::test_kernel_policy_vault — Encrypted TXPF Policy Vault Security Tests
//! File Path: tests/rust/test_kernel_policy_vault.rs
//! Architecture Role: Validates binary `.taxis-policy.txp` encryption, deletion recovery,
//!   tamper fail-closed behavior, and AuthoritySecret gates via `taxis policy`.
//! Dependencies & Triggers: Executed via `tests/integration_cli.rs`.
//! Responsibilities: Ensure zero JSON policy emission, MAC tamper detection, and safe recovery.
//! Exit Semantics & Design Rationale: Fails test binary on any unauthenticated mutation or leak.

use std::fs;

use fg_topology::PolicyVaultStore;

use crate::branch_test_fixtures::{
    init_strict_repo_with_main_seed, run_taxis_with_auth, TEST_AUTHORITY_HEX,
};
use crate::cli_harness::{run_taxis, test_temp_dir};

#[test]
fn policy_vault_binary_encryption_deletion_recovery_and_authority_gates() {
    let tmp = test_temp_dir("fgt_vault_sec_");
    let repo = tmp.path();
    init_strict_repo_with_main_seed(repo);

    let taxis_dir = repo.join(".taxis");
    let vault_path = PolicyVaultStore::vault_path(&taxis_dir);
    let seal_path = PolicyVaultStore::seal_path(&taxis_dir);
    assert!(vault_path.is_file(), "hidden .taxis-policy.txp must exist");
    assert!(seal_path.is_file(), "hidden .taxis-policy.seal must exist");
    assert!(
        !taxis_dir.join("policy.json").exists() && !repo.join(".taxis-policy.json").exists(),
        "kernel must never emit JSON policy configuration files"
    );

    let raw_vault = fs::read(&vault_path).expect("read binary vault");
    assert!(
        raw_vault.starts_with(b"TXPF"),
        "vault must begin with TXPF magic"
    );
    let trimmed = raw_vault
        .iter()
        .copied()
        .skip_while(u8::is_ascii_whitespace)
        .collect::<Vec<_>>();
    assert!(!trimmed.starts_with(b"{"), "vault must never be JSON text");
    let vault_lossy = String::from_utf8_lossy(&raw_vault);
    assert!(
        !vault_lossy.contains("workspace-strict") && !vault_lossy.contains("\"strict\""),
        "encrypted TXPF vault must not expose plaintext policy strings"
    );

    let raw_seal = fs::read(&seal_path).expect("read seal");
    assert!(
        raw_seal.starts_with(b"TXSL"),
        "seal must begin with TXSL magic"
    );

    let status_out = run_taxis_with_auth(repo, &["policy", "status", "--json"], None);
    assert!(status_out.status.success());
    let status_txt = String::from_utf8_lossy(&status_out.stdout);
    assert!(
        status_txt.contains("verified") && status_txt.contains("strict"),
        "unexpected policy status output: {status_txt}"
    );

    for cmd in [
        &["policy", "show"][..],
        &["policy", "unlock"][..],
        &["policy", "reset"][..],
        &["policy", "set-branch-tier", "advisory"][..],
    ] {
        let denied = run_taxis_with_auth(repo, cmd, None);
        assert!(
            !denied.status.success(),
            "{cmd:?} must reject without AuthoritySecret"
        );
    }

    let show_ok = run_taxis_with_auth(
        repo,
        &["policy", "show", "--json"],
        Some(TEST_AUTHORITY_HEX),
    );
    assert!(
        show_ok.status.success(),
        "policy show with authority failed: {}",
        String::from_utf8_lossy(&show_ok.stderr)
    );
    assert!(String::from_utf8_lossy(&show_ok.stdout).contains("fractal-git"));

    let add_cell = run_taxis_with_auth(
        repo,
        &["policy", "add-cell", "custom-domain"],
        Some(TEST_AUTHORITY_HEX),
    );
    assert!(add_cell.status.success());

    let original_vault = fs::read(&vault_path).expect("backup vault");
    fs::remove_file(&vault_path).expect("delete hidden vault");

    for blocked in [
        &["branch", "integration"][..],
        &["checkout", "-b", "integration"][..],
        &["doctor"][..],
    ] {
        let out = run_taxis_with_auth(repo, blocked, Some(TEST_AUTHORITY_HEX));
        assert!(
            !out.status.success(),
            "{blocked:?} must fail closed when .taxis-policy.txp is deleted"
        );
    }

    let mut tampered = original_vault.clone();
    let mid = tampered.len() / 2;
    tampered[mid] ^= 0x5A;
    fs::write(&vault_path, &tampered).expect("write tampered vault");
    let tampered_branch = run_taxis(repo, &["branch", "integration"]);
    assert!(
        !tampered_branch.status.success(),
        "tampered .taxis-policy.txp must fail closed"
    );

    fs::remove_file(&vault_path).expect("remove tampered vault");
    let regen = run_taxis_with_auth(
        repo,
        &[
            "policy",
            "init",
            "--branch-tier",
            "strict",
            "--commit-tier",
            "strict",
        ],
        Some(TEST_AUTHORITY_HEX),
    );
    assert!(
        regen.status.success(),
        "policy init recovery failed: {}",
        String::from_utf8_lossy(&regen.stderr)
    );
    let recovered = run_taxis(repo, &["branch", "integration"]);
    assert!(
        recovered.status.success(),
        "branch creation must succeed after policy init recovery: {}",
        String::from_utf8_lossy(&recovered.stderr)
    );
}
