//! Module: fractal_git::bench::e2e — End-to-End Single-Threaded Clone & Progressive Projection Benchmark Harness
//! File Path: src/bench/e2e/mod.rs
//! Architecture Role: Subsystem facade exposing end-to-end benchmark capabilities comparing Standard Git eager clone
//!   vs Taxis progressive chunked projection, measuring latency, TTFB, FastCDC chunk reuse, and durability writeback.
//! Responsibilities:
//!   - Aggregate options, Merkle projection, telemetry reporting, workload fixtures, and pipeline runner.
//!   - Guard strict single-threaded execution and monotonic regression ratchet tolerance bounds.
//!   - Guarantee substantive facade invariants meeting `ARCH-FAC-001` with zero passthrough trampolines.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and zero-panic error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocations on hot paths
//! - `FGT-STO-001`: Storage layer crash safety and WAL durability guard
//! - `FGT-ALG-001`: FastCDC localized Merkle extent reconstruction and canonical Git tree parity
//! - `ARCH-FAC-001`: Substantive facade volume and multi-domain aggregation guard

pub mod options;
mod phases;
pub mod projection;
pub mod report;
pub mod runner;
pub mod workload;

pub use options::{count_working_tree_files, get_peak_rss_mb, E2eBenchmarkOptions};
pub use projection::{
    create_bench_temp_dir, find_file_in_tree, resolve_blob_from_projected_index,
    resolve_subtree_oid,
};
pub use report::E2eBenchmarkReport;
pub use runner::{materialize_baseline_from_bundle, E2eBenchmarkRunner};
pub use workload::{
    count_files_in_tree, create_deterministic_git_bundle, git_safe_command,
    inspect_workload_bundle, E2eWorkload,
};

/// Validates that an E2E benchmark run configuration adheres to single-threaded isolation.
#[must_use]
pub fn validate_e2e_benchmark_invariants(options: &E2eBenchmarkOptions) -> bool {
    if !options.single_threaded {
        return false;
    }
    if options.iterations == 0 {
        return false;
    }
    if options.target_file.is_empty() || options.scoped_path.is_empty() {
        return false;
    }
    true
}
