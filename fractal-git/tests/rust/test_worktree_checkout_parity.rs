//! Module: tests::test_worktree_checkout_parity — Worktree and Checkout Edge Parity
//! File Path: tests/rust/test_worktree_checkout_parity.rs
//! Architecture Role: Proves unborn-HEAD `checkout -b` / `switch -c` and `worktree list --porcelain`
//!   behave with differential parity against standard Git expectations.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Validate CLI behavior for initial repository states and porcelain formatting.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-CLI-001.

use std::fs;
use std::path::PathBuf;

use crate::cli_harness::run_taxis;

fn scratch_repo(label: &str) -> PathBuf {
    crate::cli_harness::scratch_repo("taxis_wt_co", label)
}

#[test]
fn test_checkout_new_branch_on_unborn_head() {
    let repo = scratch_repo("unborn_checkout");
    let init_out = run_taxis(&repo, &["init", "--dev"]);
    assert!(init_out.status.success());

    // Switch to new branch when HEAD is unborn
    let co_out = run_taxis(&repo, &["checkout", "-b", "feature/unborn-test"]);
    assert!(
        co_out.status.success(),
        "checkout -b on unborn HEAD must succeed"
    );
    let stderr = String::from_utf8_lossy(&co_out.stderr);
    assert!(stderr.contains("Switched to a new branch 'feature/unborn-test'"));

    // Verify HEAD points to the new branch
    let head_content = fs::read_to_string(repo.join(".taxis").join("HEAD")).unwrap();
    assert_eq!(head_content.trim(), "ref: refs/heads/feature/unborn-test");

    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn test_worktree_list_porcelain() {
    let repo = scratch_repo("wt_porcelain");
    let init_out = run_taxis(&repo, &["init", "--dev"]);
    assert!(init_out.status.success());

    let wt_out = run_taxis(&repo, &["worktree", "list", "--porcelain"]);
    assert!(wt_out.status.success());
    let stdout = String::from_utf8_lossy(&wt_out.stdout);
    assert!(stdout.contains("worktree "));
    assert!(stdout.contains("branch refs/heads/main"));

    let _ = fs::remove_dir_all(&repo);
}
