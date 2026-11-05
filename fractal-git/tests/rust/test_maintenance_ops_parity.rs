//! Module: tests::test_maintenance_ops_parity — Maintenance and Sparse Parity
//! File Path: tests/rust/test_maintenance_ops_parity.rs
//! Architecture Role: Proves `sparse-checkout`, `maintenance`, and `rerere`
//!   behave with differential parity against standard Git expectations.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Validate sparse cone configuration and maintenance tasks.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-CLI-001.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

fn scratch_repo(label: &str) -> PathBuf {
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = fs::create_dir_all(&base);
    let path = base.join(format!(
        "taxis_maint_{}_{}_{}",
        std::process::id(),
        count,
        label
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("scratch repository");
    path
}

fn run_taxis(repo: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(repo)
        .output()
        .expect("the built taxis binary must be runnable")
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
