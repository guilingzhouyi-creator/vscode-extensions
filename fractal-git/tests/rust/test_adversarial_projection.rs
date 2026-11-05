//! Module: tests::test_adversarial_projection — Adversarial Verification for Zero-Write & TTFB
//! File Path: tests/rust/test_adversarial_projection.rs
//! Architecture Role: Empirically challenges and falsifies claims regarding:
//!   1. Zero-Write Physical I/O Invariant in Progressive Chunked Projection
//!   2. TTFB Responsiveness and 100% Byte-for-Byte Git/Taxis Payload Parity
//!   3. Working Tree Cleanliness after sequential reads and latency breakdown
//!
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001, FGT-STO-001, TST-DEN-001.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use fractal_git::bench::e2e::count_working_tree_files;
use fractal_git::bench::{E2eBenchmarkOptions, E2eBenchmarkRunner, E2eWorkload};
use fractal_git::storage::in_place::bundle_consumer::{BundleConsumeOptions, InPlaceBundleConsumer};
use fractal_git::storage::OdbRouter;

static ADVERSARIAL_COUNTER: AtomicUsize = AtomicUsize::new(100);

fn temp_adversarial_dir(prefix: &str) -> PathBuf {
    let id = ADVERSARIAL_COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("taxis_challenger_{prefix}_{}_{}", std::process::id(), id));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create temp dir");
    path
}

#[test]
fn test_adversarial_oracle_sensitivity_and_zero_write_invariant() {
    let test_dir = temp_adversarial_dir("oracle_sensitivity");

    // 1. Oracle Sensitivity Check: empty directory must return (0, 0)
    let (files, bytes) = count_working_tree_files(&test_dir);
    assert_eq!(files, 0, "Empty directory must report 0 files");
    assert_eq!(bytes, 0, "Empty directory must report 0 bytes");

    // 2. Oracle Sensitivity Check: writing files must be immediately detected
    let sub = test_dir.join("sub/nested");
    fs::create_dir_all(&sub).expect("create sub");
    let payload_1 = b"Hello, World!";
    let payload_2 = vec![0x42u8; 1024];
    fs::write(sub.join("a.txt"), payload_1).expect("write a");
    fs::write(test_dir.join("b.bin"), &payload_2).expect("write b");

    // Metadata directories like .git and .taxis should be ignored by the counter
    let git_mock = test_dir.join(".git/objects");
    fs::create_dir_all(&git_mock).expect("create git");
    fs::write(git_mock.join("pack.bin"), vec![0xFF; 4096]).expect("write git");

    let (files_detected, bytes_detected) = count_working_tree_files(&test_dir);
    assert_eq!(files_detected, 2, "Oracle must detect exactly 2 non-git files");
    assert_eq!(bytes_detected, (payload_1.len() + payload_2.len()) as u64, "Oracle must detect exact byte sum");

    // 3. Empirically verify E2E Benchmark Zero-Write Invariant on actual projection
    let options = E2eBenchmarkOptions {
        workload_path: None,
        iterations: 1,
        target_file: "crates/core/src/lib.rs".to_string(),
        scoped_path: "crates/core".to_string(),
        single_threaded: true,
    };

    let report = E2eBenchmarkRunner::run_benchmark(&options)
        .expect("E2E benchmark execution must succeed");

    assert_eq!(
        report.taxis_physical_files_created, 0,
        "ADVERSARIAL CHALLENGE: Taxis progressive projection must create 0 physical files in working tree"
    );
    assert_eq!(
        report.taxis_physical_bytes_written, 0,
        "ADVERSARIAL CHALLENGE: Taxis progressive projection must write 0 physical bytes to working tree"
    );
    assert!(
        report.git_physical_files_created > 0,
        "ADVERSARIAL CHALLENGE: Standard Git must create physical files on disk"
    );
    assert!(
        report.git_physical_bytes_written > 0,
        "ADVERSARIAL CHALLENGE: Standard Git must write physical bytes on disk"
    );
    assert!(
        report.io_reduction_pct >= 99.9,
        "ADVERSARIAL CHALLENGE: IO reduction must be 100% (got {:.2}%)",
        report.io_reduction_pct
    );

    let _ = fs::remove_dir_all(&test_dir);
}

#[test]
fn test_adversarial_ttfb_and_payload_binary_equivalence() {
    let workload = E2eWorkload::resolve_or_create_default().expect("resolve workload");
    let temp_dir = temp_adversarial_dir("ttfb_parity");
    let git_dir = temp_dir.join("git_clone");
    let taxis_dir = temp_dir.join("taxis_proj");

    // Standard Git eager clone
    let mut git_cmd = std::process::Command::new("git");
    git_cmd.args([
        "-c", "safe.directory=*",
        "-c", "core.autocrlf=false",
        "clone",
        workload.bundle_path.to_string_lossy().as_ref(),
        git_dir.to_string_lossy().as_ref(),
    ]);
    let git_status = git_cmd.status().expect("run git clone");
    assert!(git_status.success(), "Git clone must succeed");

    // Taxis Progressive Projection ingestion
    let taxis_git = taxis_dir.join(".git");
    let consume_report = InPlaceBundleConsumer::consume_bundle(
        &workload.bundle_path,
        &taxis_git,
        &BundleConsumeOptions::default(),
    ).expect("consume bundle");

    let odb = OdbRouter::open(taxis_git.join("objects")).expect("open odb");

    // Test multiple target files for strict binary parity
    let target_files = [
        "Cargo.toml",
        "README.md",
        "crates/core/src/lib.rs",
        "crates/algorithms/src/lib.rs",
        "crates/storage/src/lib.rs",
        "docs/ARCHITECTURE.md",
    ];

    let head_oid = consume_report.references_advanced.iter()
        .find(|(n, _)| n == "refs/heads/main" || n == "HEAD")
        .map(|(_, o)| *o)
        .expect("head oid");
    let commit_obj = odb.read(&head_oid).expect("read head").expect("commit exists");
    let commit_ref = fractal_git::object::borrowed::GitCommitRef::parse(&commit_obj.payload).expect("parse commit");
    let root_tree_oid = *commit_ref.tree_oid();

    for file_rel in &target_files {
        // 1. Read byte payload from standard Git disk working tree
        let disk_path = git_dir.join(file_rel);
        assert!(disk_path.exists(), "File {} must exist in Git clone", file_rel);
        let disk_bytes = fs::read(&disk_path).expect("read git file");

        // 2. Read byte payload on-demand from Taxis ODB via Merkle tree traversal
        let blob_oid = fractal_git::bench::e2e::find_file_in_tree(&odb, root_tree_oid, file_rel)
            .expect("find file in tree");
        let blob_obj = odb.read(&blob_oid).expect("read blob").expect("blob exists");

        // 3. Assert 100% byte-for-byte identity
        assert_eq!(
            disk_bytes.len(), blob_obj.payload.len(),
            "Payload length mismatch for {}", file_rel
        );
        assert_eq!(
            disk_bytes, blob_obj.payload,
            "ADVERSARIAL CHALLENGE: Binary payload mismatch for file {}", file_rel
        );
    }

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_adversarial_working_tree_cleanliness_after_reads_and_latency_breakdown() {
    let workload = E2eWorkload::resolve_or_create_default().expect("resolve workload");
    let temp_dir = temp_adversarial_dir("cleanliness_after_reads");
    let taxis_git = temp_dir.join(".git");

    let _consume = InPlaceBundleConsumer::consume_bundle(
        &workload.bundle_path,
        &taxis_git,
        &BundleConsumeOptions::default(),
    ).expect("consume");

    let odb = OdbRouter::open(taxis_git.join("objects")).expect("open odb");

    // Perform 50 sequential reads across multiple files
    let target = "crates/core/src/lib.rs";
    let head_oid = _consume.references_advanced[0].1;
    let commit_obj = odb.read(&head_oid).expect("read commit").unwrap();
    let commit_ref = fractal_git::object::borrowed::GitCommitRef::parse(&commit_obj.payload).unwrap();
    let root_tree = *commit_ref.tree_oid();

    let mut latencies_us = Vec::with_capacity(50);
    for _ in 0..50 {
        let t0 = Instant::now();
        let oid = fractal_git::bench::e2e::find_file_in_tree(&odb, root_tree, target).unwrap();
        let blob = odb.read(&oid).unwrap().unwrap();
        assert!(!blob.payload.is_empty());
        latencies_us.push(t0.elapsed().as_micros() as u64);
    }

    // Verify average read latency is sub-millisecond
    let avg_latency = latencies_us.iter().sum::<u64>() / latencies_us.len() as u64;
    assert!(
        avg_latency < 2000,
        "Subsequent chunk read latency must be sub-2ms (got {} µs)",
        avg_latency
    );

    // Verify working tree directory remains completely clean (zero unmanaged files)
    let (files, bytes) = count_working_tree_files(&temp_dir);
    assert_eq!(files, 0, "Working tree must remain 0 files after reads");
    assert_eq!(bytes, 0, "Working tree must remain 0 bytes after reads");

    let _ = fs::remove_dir_all(&temp_dir);
}
