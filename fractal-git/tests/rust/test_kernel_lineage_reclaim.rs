//! Module: tests::test_kernel_lineage_reclaim — Cryptographic TXLN Lineage & Tamper Rejection
//! File Path: tests/rust/test_kernel_lineage_reclaim.rs
//! Architecture Role: Verifies cryptographic HMAC-SM3 `TXLN` lineage ledger persistence across
//!   fork/merge/reclaim workflows and fail-closed rejection upon byte corruption.
//! Dependencies & Triggers: Executed via `tests/integration_cli.rs`.
//! Responsibilities: Assert authenticated TXLN receipts and reclaim blocks on MAC tampering.
//! Exit Semantics & Design Rationale: Fails test binary on missing receipt or undetected tamper.

use std::fs;

use fg_core::models::BranchEnforcementTier;
use fg_topology::lineage::{LineageEventKind, LineageLedger, LineageRecordParams};

use crate::branch_test_fixtures::{
    cascade_checkout, compliant_kernel_msg, init_strict_repo_with_main_seed,
};
use crate::cli_harness::{run_taxis, test_temp_dir};

#[test]
fn lineage_ledger_verification_and_tamper_fail_closed_on_reclaim() {
    let tmp = test_temp_dir("fgt_lineage_txln_");
    let repo = tmp.path();
    init_strict_repo_with_main_seed(repo);

    cascade_checkout(repo, "integration", "integration");
    cascade_checkout(repo, "fractal-git", "cell/fractal-git/main");
    cascade_checkout(repo, "k1", "cell/fractal-git/card/k1/main");
    cascade_checkout(repo, "worker-1", "cell/fractal-git/card/k1/sub/worker-1");
    fs::write(repo.join("worker.rs"), "pub fn work() {}\n").expect("write worker.rs");
    assert!(run_taxis(repo, &["add", "worker.rs"]).status.success());
    let worker_msg = compliant_kernel_msg("feat(worker): seed mergeable commit", "worker.rs");
    assert!(run_taxis(repo, &["commit", "-m", &worker_msg])
        .status
        .success());
    assert!(
        run_taxis(repo, &["checkout", "cell/fractal-git/card/k1/main"])
            .status
            .success()
    );
    assert!(run_taxis(
        repo,
        &[
            "merge",
            "--reclaim",
            "cell/fractal-git/card/k1/sub/worker-1",
        ]
    )
    .status
    .success());

    assert!(run_taxis(repo, &["checkout", "cell/fractal-git/main"])
        .status
        .success());
    cascade_checkout(repo, "k2", "cell/fractal-git/card/k2/main");
    assert!(run_taxis(repo, &["checkout", "cell/fractal-git/main"])
        .status
        .success());

    let ledger = LineageLedger::open(&repo.join(".taxis"));
    let receipts = ledger.verify_all().expect("verify TXLN lineage ledger");
    assert!(
        receipts
            .iter()
            .any(|r| r.event_kind == LineageEventKind::Merge)
            && receipts
                .iter()
                .any(|r| r.event_kind == LineageEventKind::Fork),
        "lineage ledger must contain verified Fork & Merge receipts"
    );

    let reclaim_k2 = run_taxis(
        repo,
        &[
            "reclaim",
            "--branch",
            "cell/fractal-git/card/k2/main",
            "--verify-lineage",
        ],
    );
    assert!(
        reclaim_k2.status.success(),
        "reclaim --verify-lineage failed on forked branch: {}",
        String::from_utf8_lossy(&reclaim_k2.stderr)
    );

    cascade_checkout(repo, "k3", "cell/fractal-git/card/k3/main");
    assert!(run_taxis(repo, &["checkout", "cell/fractal-git/main"])
        .status
        .success());
    let ledger_file = ledger.ledger_path().to_path_buf();
    let mut raw_txln = fs::read(&ledger_file).expect("read TXLN ledger");
    let tail_idx = raw_txln.len().saturating_sub(2);
    raw_txln[tail_idx] ^= 0xFF;
    fs::write(&ledger_file, &raw_txln).expect("corrupt TXLN ledger");

    let tampered_reclaim = run_taxis(
        repo,
        &[
            "reclaim",
            "--branch",
            "cell/fractal-git/card/k3/main",
            "--verify-lineage",
        ],
    );
    assert!(
        !tampered_reclaim.status.success(),
        "reclaim --verify-lineage MUST fail closed when TXLN MAC is tampered"
    );

    let _ = BranchEnforcementTier::Strict;
    let _ = LineageRecordParams {
        event_kind: LineageEventKind::Reclaim,
        cell_id: "fractal-git",
        source_ref: "cell/fractal-git/card/k3/main",
        target_ref: "reclaimed",
        commit_oid_hex: "",
        parent_oid_hex: "",
    };
}
