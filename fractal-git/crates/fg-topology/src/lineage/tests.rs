//! Module: fg-topology — Lineage Ledger Unit Tests
//! File Path: crates/fg-topology/src/lineage/tests.rs
//! Architecture Role: Unit test suite proving authenticated TXLN recording and
//!   fail-closed HMAC-SM3 tamper detection.

use super::*;
use fg_core::models::{BranchEnforcementTier, EnforcementTier};
use fg_native::policy_vault::PolicyVaultStore;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static TEST_SEQ: AtomicU64 = AtomicU64::new(0);

fn temp_repo_dir() -> PathBuf {
    let seq = TEST_SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp")
        .join(format!("fg-lineage-test-{}-{seq}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("mkdir");
    dir
}

#[test]
fn lineage_ledger_records_verifies_and_detects_tampering() {
    let repo = temp_repo_dir();
    let _ = PolicyVaultStore::initialize_or_regenerate(
        &repo,
        EnforcementTier::Strict,
        BranchEnforcementTier::Strict,
        false,
    )
    .expect("init vault");

    let ledger = LineageLedger::open(&repo);
    let rec = ledger
        .record(&LineageRecordParams {
            event_kind: LineageEventKind::Fork,
            cell_id: "fractal-git",
            source_ref: "cell/fractal-git/main",
            target_ref: "cell/fractal-git/card/k1/main",
            commit_oid_hex: "1111111111111111111111111111111111111111",
            parent_oid_hex: "0000000000000000000000000000000000000000",
        })
        .expect("append lineage");
    assert_eq!(rec.event_kind, LineageEventKind::Fork);

    let all = ledger.verify_all().expect("verify lineage");
    assert_eq!(all.len(), 1);
    assert!(ledger
        .has_verified_lineage_for("cell/fractal-git/card/k1/main")
        .expect("check ancestor"));

    let mut bytes = fs::read(ledger.ledger_path()).expect("read raw");
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    fs::write(ledger.ledger_path(), bytes).expect("write tampered");

    assert!(
        ledger.verify_all().is_err(),
        "1-bit forgery in lineage receipt must fail HMAC-SM3 verification"
    );
    let _ = fs::remove_dir_all(&repo);
}
