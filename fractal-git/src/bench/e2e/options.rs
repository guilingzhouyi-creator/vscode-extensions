//! Module: fractal_git::bench::e2e::options — E2E Benchmark Harness Configuration & System Metrics
//! File Path: src/bench/e2e/options.rs
//! Architecture Role: Encapsulates runtime options, working tree scanning heuristics, and cross-platform
//!   peak resident set size (RSS) query instrumentation for the single-threaded clone & projection harness.
//! Responsibilities:
//!   - Provide default and user-configured parameters for E2E benchmark suites.
//!   - Accurately scan and sum physical working tree files and bytes, filtering VCS metadata (.git/.taxis).
//!   - Query OS kernel for current process peak RSS memory counters without transient heap overhead.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and zero-panic error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocations on hot paths
//! - `FGT-SAF-001`: Strict unsafe memory query boundary isolation

use std::fs;
use std::path::{Path, PathBuf};

/// Cross-platform helper retrieving peak resident set size (RSS) in megabytes.
#[must_use]
pub fn get_peak_rss_mb() -> f64 {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct PROCESS_MEMORY_COUNTERS {
            cb: u32,
            page_fault_count: u32,
            peak_working_set_size: usize,
            working_set_size: usize,
            quota_peak_paged_pool_usage: usize,
            quota_paged_pool_usage: usize,
            quota_peak_non_paged_pool_usage: usize,
            quota_non_paged_pool_usage: usize,
            pagefile_usage: usize,
            peak_pagefile_usage: usize,
        }

        extern "system" {
            fn GetCurrentProcess() -> isize;
            fn K32GetProcessMemoryInfo(
                process: isize,
                pmc: *mut PROCESS_MEMORY_COUNTERS,
                cb: u32,
            ) -> i32;
        }

        let mut counters = std::mem::MaybeUninit::<PROCESS_MEMORY_COUNTERS>::zeroed();
        // SAFETY:
        // - Preconditions: `counters.as_mut_ptr()` provides an aligned, non-null pointer to uninitialized `PROCESS_MEMORY_COUNTERS` memory; `(*p).cb` is initialized to `size_of::<PROCESS_MEMORY_COUNTERS>()`.
        // - Invariants: `GetCurrentProcess()` returns a pseudo-handle that does not require closing; Win32 reads `cb` and fills at most `cb` bytes without retaining pointers.
        // - Postconditions: Non-zero return indicates `counters` has been populated with current process memory statistics.
        let ok = unsafe {
            let p = counters.as_mut_ptr();
            (*p).cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            K32GetProcessMemoryInfo(GetCurrentProcess(), p, (*p).cb)
        };
        if ok != 0 {
            // SAFETY:
            // - Preconditions: `ok != 0` confirms `K32GetProcessMemoryInfo` succeeded and initialized all bytes of `counters`.
            // - Invariants: `PROCESS_MEMORY_COUNTERS` contains only integer/pointer-sized scalar fields without drop glue.
            // - Postconditions: `counters.assume_init()` safely produces a valid, fully initialized `PROCESS_MEMORY_COUNTERS` value.
            let init = unsafe { counters.assume_init() };
            (init.peak_working_set_size as f64) / (1024.0 * 1024.0)
        } else {
            0.0
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(status) = fs::read_to_string("/proc/self/status") {
            for line in status.lines() {
                if line.starts_with("VmHWM:") || line.starts_with("VmPeak:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(kb) = parts[1].parse::<f64>() {
                            return kb / 1024.0;
                        }
                    }
                }
            }
        }
        0.0
    }
}

/// Recursively scans directory regular files, returning `(file_count, total_bytes)`.
/// Skips `.git` and `.taxis` metadata folders.
#[must_use]
pub fn count_working_tree_files(root: &Path) -> (usize, u64) {
    let mut files = 0;
    let mut bytes = 0u64;

    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            if name == ".git" || name == ".taxis" {
                continue;
            }
            if path.is_file() {
                files += 1;
                if let Ok(meta) = entry.metadata() {
                    bytes += meta.len();
                }
            } else if path.is_dir() {
                let (sub_files, sub_bytes) = count_working_tree_files(&path);
                files += sub_files;
                bytes += sub_bytes;
            }
        }
    }

    (files, bytes)
}

/// Configuration options for the E2E single-threaded benchmark harness.
#[derive(Debug, Clone)]
pub struct E2eBenchmarkOptions {
    /// Optional explicit path to a real-world Git bundle or repository.
    /// When None, the deterministic bundled fixture is utilized.
    pub workload_path: Option<PathBuf>,
    /// Number of measurement iterations (fastest sample retained).
    pub iterations: usize,
    /// Target file to read for Time-To-First-Byte (TTFB) latency.
    pub target_file: String,
    /// Subpath prefix to test progressive scoped projection.
    pub scoped_path: String,
    /// Whether single-threaded execution is strictly enforced.
    pub single_threaded: bool,
}

impl Default for E2eBenchmarkOptions {
    fn default() -> Self {
        Self {
            workload_path: None,
            iterations: 3,
            target_file: "crates/core/src/lib.rs".to_string(),
            scoped_path: "crates/core".to_string(),
            single_threaded: true,
        }
    }
}
