//! Module: tests::test_e2e_clone_benchmark — End-to-End Single-Threaded Clone & Projection Integration Test
//! File Path: tests/rust/test_e2e_clone_benchmark.rs
//! Architecture Role: Integration test verifying end-to-end functionality of the single-threaded
//!   clone and progressive projection benchmark harness, asserting Git differential correctness,
//!   I/O reduction, TTFB speedups, FastCDC apply_edits chunk reuse, and WAL durability writeback.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001, FGT-STO-001, FGT-ALG-001, TST-DEN-001, TB-REGRESSION.

use fractal_git::bench::{
    E2eBenchmarkOptions, E2eBenchmarkReport, E2eBenchmarkRunner, E2eWorkload,
};

#[test]
fn test_workload_fixture_creation_and_parity() {
    let workload = E2eWorkload::resolve_or_create_default().expect("resolve default workload");
    assert!(
        workload.bundle_path.exists(),
        "workload bundle must exist on disk"
    );
    assert!(
        workload.bundle_bytes > 0,
        "workload bundle size must be non-zero"
    );
    assert_eq!(
        workload.total_objects, 23,
        "workload must have authentic dynamic object count"
    );
    assert_eq!(
        workload.total_files, 6,
        "workload must have authentic dynamic file count at HEAD"
    );
}

#[test]
fn test_e2e_single_threaded_clone_and_projection_benchmark() {
    let options = E2eBenchmarkOptions {
        workload_path: None,
        iterations: 1,
        target_file: "crates/core/src/lib.rs".to_string(),
        scoped_path: "crates/core".to_string(),
        single_threaded: true,
    };

    let report = E2eBenchmarkRunner::run_benchmark(&options)
        .expect("E2E single-threaded benchmark must complete successfully");

    // Phase 1 Assertions: Ingestion & Workspace Creation
    assert!(
        report.git_clone_latency_ms > 0,
        "Git clone latency must be measured"
    );
    assert!(
        report.taxis_projection_latency_ms > 0,
        "Taxis projection latency must be measured"
    );
    assert!(
        report.clone_speedup_factor >= 1.0,
        "Taxis progressive projection must be faster or equal to Git eager clone"
    );
    assert!(
        report.git_physical_files_created > 0,
        "Git clone must materialize physical files"
    );
    assert_eq!(
        report.taxis_physical_files_created, 0,
        "Taxis VirtualMemory progressive projection must create 0 physical working tree files"
    );
    assert!(
        report.git_physical_bytes_written > 0,
        "Git clone must write physical file bytes"
    );
    assert!(
        report.io_reduction_pct >= 90.0,
        "Taxis virtual projection must achieve >= 90% physical I/O reduction"
    );

    // Phase 2 Assertions: TTFB
    assert!(report.git_first_byte_latency_us > 0);
    assert!(report.taxis_first_byte_latency_us > 0);
    assert!(
        report.ttfb_speedup_factor >= 1.0,
        "Taxis TTFB must be faster or equal to Git TTFB"
    );

    // Phase 3 Assertions: FastCDC apply_edits Chunk Reuse
    assert!(
        report.chunk_reuse_ratio_pct >= 70.0,
        "FastCDC apply_edits must achieve high chunk reuse ratio on localized edits (got {:.1}%)",
        report.chunk_reuse_ratio_pct
    );
    assert!(
        report.edit_chunking_latency_us > 0,
        "FastCDC localized chunking latency must be measured"
    );

    // Phase 4 Assertions: Durability & Writeback
    assert!(report.wal_sync_commit_latency_us > 0);
    assert!(report.async_writeback_duration_us > 0);
    assert!(
        report.commit_speedup_factor >= 0.8,
        "WAL TAXW framed append must outperform or match full git commit within margin (got {:.2}x)",
        report.commit_speedup_factor
    );
}

#[test]
fn test_e2e_baseline_serialization_and_ratchet() {
    let options = E2eBenchmarkOptions {
        workload_path: None,
        iterations: 1,
        target_file: "crates/core/src/lib.rs".to_string(),
        scoped_path: "crates/core".to_string(),
        single_threaded: true,
    };

    let report = E2eBenchmarkRunner::run_benchmark(&options).expect("benchmark run");

    // Serialization / Deserialization idempotency
    let serialized = serde_json::to_string_pretty(&report).expect("serialize baseline");
    let deserialized: E2eBenchmarkReport =
        serde_json::from_str(&serialized).expect("deserialize baseline");
    assert_eq!(report.workload_name, deserialized.workload_name);
    assert_eq!(
        report.git_clone_latency_ms,
        deserialized.git_clone_latency_ms
    );
    assert_eq!(
        report.taxis_projection_latency_ms,
        deserialized.taxis_projection_latency_ms
    );
    assert_eq!(
        report.git_physical_files_created,
        deserialized.git_physical_files_created
    );
    assert_eq!(
        report.taxis_physical_files_created,
        deserialized.taxis_physical_files_created
    );
    assert!((report.clone_speedup_factor - deserialized.clone_speedup_factor).abs() < 1e-4);
    assert!((report.chunk_reuse_ratio_pct - deserialized.chunk_reuse_ratio_pct).abs() < 1e-4);

    // Compare with itself (must pass 15% tolerance)
    let self_verdict = report.compare_with_baseline(&deserialized, 15.0);
    assert!(
        self_verdict.passed,
        "identical baseline comparison must pass"
    );

    // Artificially regressed report (+50% latency) must fail ratchet
    let mut regressed = report.clone();
    regressed.taxis_projection_latency_ms = (report.taxis_projection_latency_ms * 2).max(100);
    let fail_verdict = regressed.compare_with_baseline(&report, 15.0);
    assert!(
        !fail_verdict.passed,
        "50% latency regression must fail the 15% tolerance ratchet"
    );
    assert!(!fail_verdict.regressions.is_empty());
}

#[test]
fn test_markdown_and_console_table_rendering() {
    let options = E2eBenchmarkOptions {
        workload_path: None,
        iterations: 1,
        target_file: "crates/core/src/lib.rs".to_string(),
        scoped_path: "crates/core".to_string(),
        single_threaded: true,
    };

    let report = E2eBenchmarkRunner::run_benchmark(&options).expect("benchmark run");
    let table = report.render_table();
    assert!(table.contains("TAXIS vs GIT SINGLE-THREADED E2E BENCHMARK REPORT"));
    assert!(table.contains("Workspace Creation Latency"));
    assert!(table.contains("FastCDC Chunk Reuse Ratio"));

    let md_table = report.render_markdown_table();
    assert!(md_table.contains(
        "| Metric Dimension | Git Baseline | Taxis Progressive Projection | Delta / Factor |"
    ));
    assert!(md_table.contains("Workspace Creation Latency"));
    assert!(md_table.contains("Time-to-First-Byte (TTFB)"));
}
