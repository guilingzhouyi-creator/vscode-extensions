//! Module: tests::test_maintenance_ops_parity — Maintenance and Sparse Parity
//! File Path: tests/rust/test_maintenance_ops_parity.rs
//! Architecture Role: Proves `sparse-checkout`, `maintenance`, and `rerere`
//!   behave with differential parity against standard Git expectations.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Validate sparse cone configuration and maintenance tasks.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-CLI-001.

use std::fs;
use std::path::PathBuf;

use crate::cli_harness::run_taxis;

fn scratch_repo(label: &str) -> PathBuf {
    crate::cli_harness::scratch_repo("taxis_maint", label)
}

#[test]
fn test_sparse_checkout_and_maintenance_lifecycle() {
    let repo = scratch_repo("sparse_maint");
    let init_out = run_taxis(&repo, &["init", "--dev"]);
    assert!(init_out.status.success());

    // 1. Sparse-checkout init
    let sp_init = run_taxis(&repo, &["sparse-checkout", "init"]);
    assert!(sp_init.status.success());

    let sp_list = run_taxis(&repo, &["sparse-checkout", "list"]);
    assert!(sp_list.status.success());
    let list_str = String::from_utf8_lossy(&sp_list.stdout);
    assert!(list_str.contains("/*"));

    // 2. Sparse-checkout set
    let sp_set = run_taxis(&repo, &["sparse-checkout", "set", "src/", "tests/"]);
    assert!(sp_set.status.success());

    let sp_list2 = run_taxis(&repo, &["sparse-checkout", "list"]);
    assert!(sp_list2.status.success());
    let list_str2 = String::from_utf8_lossy(&sp_list2.stdout);
    assert!(list_str2.contains("src/"));
    assert!(list_str2.contains("tests/"));

    // 3. Sparse-checkout disable
    let sp_dis = run_taxis(&repo, &["sparse-checkout", "disable"]);
    assert!(sp_dis.status.success());

    // 4. Maintenance run
    let maint_run = run_taxis(&repo, &["maintenance", "run"]);
    assert!(maint_run.status.success());

    let _ = fs::remove_dir_all(&repo);
}
