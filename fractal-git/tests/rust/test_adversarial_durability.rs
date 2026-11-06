//! Module: tests::test_adversarial_durability — Adversarial Verification for FastCDC & WAL Durability
//! File Path: tests/rust/test_adversarial_durability.rs
//! Architecture Role: Empirically challenges and falsifies claims regarding:
//!   1. FastCDC Boundary Healing, Shift Invariance, and >= 70% Chunk Reuse under apply_edits
//!   2. Crash-Safe WAL Frame Durability, Torn-Tail Recovery, and Asynchronous CAS Writeback
//!
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001, FGT-STO-001, FGT-ALG-001.

use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

use fractal_git::algorithms::cdc::apply_edits::{apply_edits, EditOp};
use fractal_git::algorithms::cdc::FastCdcChunker;
use fractal_git::core::models::{compute_object_oid, ObjectKind, Oid};
use fractal_git::storage::cas_backend::CasBackend;
use fractal_git::storage::wal_journal::{WalJournal, WalRecord};

fn temp_adversarial_dir(prefix: &str) -> TempDir {
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = fs::create_dir_all(&base);
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(&base)
        .or_else(|_| tempfile::tempdir())
        .expect("create temp dir")
}

#[test]
fn test_adversarial_fastcdc_boundary_healing_and_reuse_stress() {
    let chunker = FastCdcChunker::new(512, 2048, 8192);

    // Generate a realistic 64 KB source file with repetitive identifiers and functions
    let mut file_content = String::with_capacity(64 * 1024);
    file_content.push_str("//! Adversarial stress test payload for FastCDC boundary healing.\n");
    for i in 0..1200 {
        file_content.push_str(&format!(
            "pub fn service_endpoint_{i}(token: u64) -> Result<u64, ()> {{ Ok(token.wrapping_add({i})) }}\n"
        ));
    }
    let original_bytes = file_content.as_bytes();
    let original_chunks = chunker.chunk(original_bytes);
    assert!(
        original_chunks.len() >= 10,
        "Original file should produce >= 10 chunks"
    );

    // Case A: Shift insertion at offset 100 (prefix byte insertion shifting all downstream offsets)
    let shift_insert = b"// INJECTED PADDING PREFIX HEADER LINE FORCING BYTE SHIFTS\n";
    let edit_shift = vec![EditOp::new(100, 0, shift_insert)];
    let shift_chunks = apply_edits(&chunker, original_bytes, &original_chunks, &edit_shift)
        .expect("apply shift edit");

    let mut shift_reused = 0;
    for sc in &shift_chunks {
        if original_chunks.iter().any(|oc| oc.oid == sc.oid) {
            shift_reused += 1;
        }
    }
    let shift_reuse_pct = (shift_reused as f64 / shift_chunks.len() as f64) * 100.0;
    assert!(
        shift_reuse_pct >= 70.0,
        "ADVERSARIAL CHALLENGE: FastCDC boundary healing under shift insertion must achieve >= 70% reuse (got {:.1}%)",
        shift_reuse_pct
    );

    // Case B: In-place middle block edit (middle function rewritten)
    let mid_offset = original_bytes.len() / 2;
    let edit_mid = vec![EditOp::new(
        mid_offset,
        120,
        b"// COMPLETELY OVERWRITTEN FUNCTION BODY IMPLEMENTATION FOR VERIFICATION TEST\n",
    )];
    let mid_chunks =
        apply_edits(&chunker, original_bytes, &original_chunks, &edit_mid).expect("apply mid edit");

    let mut mid_reused = 0;
    for mc in &mid_chunks {
        if original_chunks.iter().any(|oc| oc.oid == mc.oid) {
            mid_reused += 1;
        }
    }
    let mid_reuse_pct = (mid_reused as f64 / mid_chunks.len() as f64) * 100.0;
    assert!(
        mid_reuse_pct >= 80.0,
        "ADVERSARIAL CHALLENGE: In-place localized edit must achieve >= 80% reuse (got {:.1}%)",
        mid_reuse_pct
    );
}

#[test]
fn test_adversarial_wal_frame_durability_and_torn_tail_crash_recovery() {
    let tmp = temp_adversarial_dir("wal_durability");
    let test_dir = tmp.path();
    let wal_path = test_dir.join("durability.wal");

    // 1. Write 3 valid transactional commit records to WAL
    let fake_oid_1 = Oid::from_bytes([0x11; 20]);
    let fake_oid_2 = Oid::from_bytes([0x22; 20]);
    let fake_oid_3 = Oid::from_bytes([0x33; 20]);

    {
        let wal = WalJournal::open(&wal_path).expect("open wal");
        wal.append(&WalRecord::CommitTx {
            tx_id: "tx-durability-01".into(),
            commit_oid: fake_oid_1,
        })
        .expect("append 1");
        wal.append(&WalRecord::CommitTx {
            tx_id: "tx-durability-02".into(),
            commit_oid: fake_oid_2,
        })
        .expect("append 2");
        wal.append(&WalRecord::CommitTx {
            tx_id: "tx-durability-03".into(),
            commit_oid: fake_oid_3,
        })
        .expect("append 3");
    }

    // 2. Simulate torn-tail write (append 7 garbage bytes representing sudden power loss during write)
    {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(&wal_path)
            .expect("open wal for corruption");
        file.write_all(b"CORRUPT").expect("write torn tail");
        file.sync_all().expect("sync");
    }

    // 3. Replay WAL: Crash recovery must recover all 3 valid transactions without failing
    let recovered_wal = WalJournal::open(&wal_path).expect("reopen torn wal");
    let replay = recovered_wal.replay().expect("replay torn wal");

    assert_eq!(
        replay.records.len(),
        3,
        "WAL crash recovery must restore exactly 3 complete transactions"
    );
    assert_eq!(
        replay.discarded_tail_bytes, 7,
        "WAL recovery must identify 7 discarded torn-tail bytes"
    );

    // 4. Verify Asynchronous CAS Writeback can persist recovered payloads
    let cas = CasBackend::without_cache(test_dir.join("cas"));
    let sample_payload = b"Sample durable Git object content written asynchronously";
    let persisted_oid = cas
        .put_block(ObjectKind::Blob, sample_payload)
        .expect("cas writeback");
    let expected_oid = compute_object_oid(ObjectKind::Blob, sample_payload);
    assert_eq!(
        persisted_oid, expected_oid,
        "CAS writeback OID must match computed Git SHA-1"
    );
}
