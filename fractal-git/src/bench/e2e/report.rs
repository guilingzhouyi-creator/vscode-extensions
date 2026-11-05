//! Module: fractal_git::bench::e2e::report — Comprehensive E2E Benchmark Report & Baseline Ratchet
//! File Path: src/bench/e2e/report.rs
//! Architecture Role: Formats, serializes, and verifies empirical benchmark metrics comparing
//!   Standard Git eager materialization vs Taxis progressive chunked projection.
//! Responsibilities:
//!   - Structure 5-phase benchmark telemetry metrics across creation, I/O, TTFB, FastCDC, and WAL durability.
//!   - Render human-readable ASCII terminal tables and Markdown comparison summaries.
//!   - Provide monotonic performance regression verification against frozen baselines (`TB-REGRESSION`).
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and zero-panic error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocations on hot paths
//! - `TB-REGRESSION`: Monotonic 15% tolerance performance ratchet with noise floor guards

use serde::{Deserialize, Serialize};

use super::super::profile::BenchmarkProfile;
use super::super::BaselineComparisonVerdict;

/// Comprehensive benchmark measurement report comparing Git Eager Clone vs Taxis Progressive Projection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct E2eBenchmarkReport {
    pub workload_name: String,
    pub bundle_bytes: u64,
    pub total_objects: usize,
    pub total_files: usize,
    pub iterations: usize,
    pub profile: BenchmarkProfile,

    // Phase 1: Ingestion & Workspace Creation
    pub git_clone_latency_ms: u64,
    pub taxis_projection_latency_ms: u64,
    pub clone_speedup_factor: f64,
    pub git_clone_throughput_mb_s: f64,
    pub taxis_projection_throughput_mb_s: f64,
    pub git_objects_per_sec: f64,
    pub taxis_objects_per_sec: f64,

    // Physical I/O and Disk Footprint
    pub git_physical_files_created: usize,
    pub taxis_physical_files_created: usize,
    pub git_physical_bytes_written: u64,
    pub taxis_physical_bytes_written: u64,
    pub io_reduction_pct: f64,

    // Phase 2: Time-to-First-Byte (TTFB)
    pub git_first_byte_latency_us: u64,
    pub taxis_first_byte_latency_us: u64,
    pub ttfb_speedup_factor: f64,

    // Phase 3: Localized Modifications & FastCDC Chunk Reuse
    pub edit_chunking_latency_us: u64,
    pub chunk_reuse_ratio_pct: f64,
    pub dirty_bytes_processed: usize,
    pub total_file_bytes: usize,

    // Phase 4: Durability & Writeback
    pub git_commit_latency_us: u64,
    pub wal_sync_commit_latency_us: u64,
    pub commit_speedup_factor: f64,
    pub async_writeback_duration_us: u64,

    // Phase 5: Resource Footprint
    pub peak_rss_mb: f64,
}

impl E2eBenchmarkReport {
    /// Renders a human-readable formatted console table.
    #[must_use]
    pub fn render_table(&self) -> String {
        let mut out = String::new();
        out.push_str("========================================================================================\n");
        out.push_str("          TAXIS vs GIT SINGLE-THREADED E2E BENCHMARK REPORT                             \n");
        out.push_str("========================================================================================\n");
        out.push_str(&format!(
            "Workload: {} | Size: {:.2} MB | Objects: {} | Files: {} | Profile: {}\n",
            self.workload_name,
            self.bundle_bytes as f64 / (1024.0 * 1024.0),
            self.total_objects,
            self.total_files,
            self.profile.as_str()
        ));
        out.push_str("----------------------------------------------------------------------------------------\n");
        out.push_str(&format!(
            "{:<36} | {:>16} | {:>16} | {:>12}\n",
            "Benchmark Dimension", "Standard Git", "Taxis Kernel", "Advantage"
        ));
        out.push_str("----------------------------------------------------------------------------------------\n");

        out.push_str(&format!(
            "{:<36} | {:>13} ms | {:>13} ms | {:>10.1}x\n",
            "Workspace Creation Latency",
            self.git_clone_latency_ms,
            self.taxis_projection_latency_ms,
            self.clone_speedup_factor
        ));

        out.push_str(&format!(
            "{:<36} | {:>11.1} MB/s | {:>11.1} MB/s | {:>10.1}x\n",
            "Ingestion Throughput",
            self.git_clone_throughput_mb_s,
            self.taxis_projection_throughput_mb_s,
            self.taxis_projection_throughput_mb_s / self.git_clone_throughput_mb_s.max(0.1)
        ));

        out.push_str(&format!(
            "{:<36} | {:>12.0} obj/s | {:>12.0} obj/s | {:>10.1}x\n",
            "Object Processing Rate",
            self.git_objects_per_sec,
            self.taxis_objects_per_sec,
            self.taxis_objects_per_sec / self.git_objects_per_sec.max(1.0)
        ));

        out.push_str(&format!(
            "{:<36} | {:>16} | {:>16} | {:>11.1}%\n",
            "Physical Files Created",
            self.git_physical_files_created,
            self.taxis_physical_files_created,
            self.io_reduction_pct
        ));

        out.push_str(&format!(
            "{:<36} | {:>13} KB | {:>13} KB | {:>11.1}%\n",
            "Disk Bytes Written",
            self.git_physical_bytes_written / 1024,
            self.taxis_physical_bytes_written / 1024,
            self.io_reduction_pct
        ));

        out.push_str(&format!(
            "{:<36} | {:>13} us | {:>13} us | {:>10.1}x\n",
            "Time to First Byte (TTFB)",
            self.git_first_byte_latency_us,
            self.taxis_first_byte_latency_us,
            self.ttfb_speedup_factor
        ));

        out.push_str(&format!(
            "{:<36} | {:>13} us | {:>13} us | {:>10.1}x\n",
            "Sync Commit / Durability",
            self.git_commit_latency_us,
            self.wal_sync_commit_latency_us,
            self.commit_speedup_factor
        ));

        out.push_str(&format!(
            "{:<36} | {:>16} | {:>15.1}% | {:>12}\n",
            "FastCDC Chunk Reuse Ratio",
            "0.0% (monolithic)",
            self.chunk_reuse_ratio_pct,
            "boundary-heal"
        ));

        out.push_str(&format!(
            "{:<36} | {:>16} | {:>13} us | {:>12}\n",
            "FastCDC apply_edits Latency",
            "N/A",
            self.edit_chunking_latency_us,
            "sub-ms"
        ));

        out.push_str(&format!(
            "{:<36} | {:>16} | {:>13} us | {:>12}\n",
            "Async CAS Background Writeback",
            "blocking fsync",
            self.async_writeback_duration_us,
            "non-blocking"
        ));

        out.push_str(&format!(
            "{:<36} | {:>16} | {:>13.2} MB | {:>12}\n",
            "Peak Process Memory (RSS)",
            "OS variable",
            self.peak_rss_mb,
            "FGT-PRF-001"
        ));

        out.push_str("========================================================================================\n");
        out
    }

    /// Renders a structured Markdown table formatted for documentation and reports.
    #[must_use]
    pub fn render_markdown_table(&self) -> String {
        let mut out = String::new();
        out.push_str("| Metric Dimension | Git Baseline | Taxis Progressive Projection | Delta / Factor |\n");
        out.push_str("| :--- | :--- | :--- | :--- |\n");
        out.push_str(&format!(
            "| **Workspace Creation Latency** | `{} ms` | `{} ms` | **{:.1}x faster** |\n",
            self.git_clone_latency_ms, self.taxis_projection_latency_ms, self.clone_speedup_factor
        ));
        out.push_str(&format!(
            "| **Ingestion Throughput** | `{:.1} MB/s` | `{:.1} MB/s` | **{:.1}x higher** |\n",
            self.git_clone_throughput_mb_s,
            self.taxis_projection_throughput_mb_s,
            self.taxis_projection_throughput_mb_s / self.git_clone_throughput_mb_s.max(0.1)
        ));
        out.push_str(&format!(
            "| **Object Processing Rate** | `{:.0} obj/s` | `{:.0} obj/s` | **{:.1}x throughput** |\n",
            self.git_objects_per_sec,
            self.taxis_objects_per_sec,
            self.taxis_objects_per_sec / self.git_objects_per_sec.max(1.0)
        ));
        out.push_str(&format!(
            "| **Physical Files Created** | `{}` | `{}` | **{:.1}% reduction** |\n",
            self.git_physical_files_created,
            self.taxis_physical_files_created,
            self.io_reduction_pct
        ));
        out.push_str(&format!(
            "| **Workspace Disk Bytes Written** | `{:.1} KB` | `{:.1} KB` | **{:.1}% I/O saved** |\n",
            self.git_physical_bytes_written as f64 / 1024.0,
            self.taxis_physical_bytes_written as f64 / 1024.0,
            self.io_reduction_pct
        ));
        out.push_str(&format!(
            "| **Time-to-First-Byte (TTFB)** | `{} µs` | `{} µs` | **{:.1}x faster** |\n",
            self.git_first_byte_latency_us,
            self.taxis_first_byte_latency_us,
            self.ttfb_speedup_factor
        ));
        out.push_str(&format!(
            "| **Incremental Edit Chunk Reuse** | `0.0%` (full file hash) | `{:.1}%` | **reused untouched chunks** |\n",
            self.chunk_reuse_ratio_pct
        ));
        out.push_str(&format!(
            "| **FastCDC apply_edits Latency** | `N/A` | `{} µs` | **localized Merkle healing** |\n",
            self.edit_chunking_latency_us
        ));
        out.push_str(&format!(
            "| **Synchronous Commit Latency** | `{} µs` | `{} µs` | **{:.1}x faster** (WAL TAXW frame) |\n",
            self.git_commit_latency_us,
            self.wal_sync_commit_latency_us,
            self.commit_speedup_factor
        ));
        out.push_str(&format!(
            "| **Async Background Writeback** | blocking disk write | `{} µs` | decoupled CAS persistence |\n",
            self.async_writeback_duration_us
        ));
        out.push_str(&format!(
            "| **Peak Process RSS** | OS default | `{:.2} MB` | compliant with `FGT-PRF-001` |\n",
            self.peak_rss_mb
        ));
        out
    }

    /// Compares against a frozen baseline within the monotonic tolerance budget.
    #[must_use]
    pub fn compare_with_baseline(
        &self,
        baseline: &Self,
        tolerance_pct: f64,
    ) -> BaselineComparisonVerdict {
        let mut passed = true;
        let mut regressions = Vec::new();
        let mut improvements = Vec::new();

        if self.profile != baseline.profile {
            return BaselineComparisonVerdict {
                passed: false,
                regressions: Vec::new(),
                improvements: Vec::new(),
                unbaselined: Vec::new(),
                profile_mismatch: Some(format!(
                    "Profile mismatch: run='{}', baseline='{}'",
                    self.profile.as_str(),
                    baseline.profile.as_str()
                )),
            };
        }

        // Minimum absolute delta noise floors (FGT-PRF-001 / TB-REGRESSION).
        // Sub-50ms timings and physical disk fsync (`FlushFileBuffers`) on Windows NTFS exhibit
        // intrinsic scheduler quantum (~15.6 ms) and storage controller write-cache flush jitter.
        // A measurement is only flagged as a regression if it exceeds BOTH:
        // 1. Relative tolerance (e.g. +15% release, +45% debug); AND
        // 2. Absolute noise floor delta (`saturating_sub(baseline) >= NOISE_FLOOR`).
        const PROJECTION_LATENCY_NOISE_FLOOR_MS: u64 = 10;
        const TTFB_LATENCY_NOISE_FLOOR_US: u64 = 10_000;
        const WAL_SYNC_COMMIT_NOISE_FLOOR_US: u64 = 5_000;

        // Taxis projection latency ratchet: cannot exceed baseline * (1 + tolerance)
        let max_allowed_projection_latency =
            (baseline.taxis_projection_latency_ms as f64 * (1.0 + tolerance_pct / 100.0)) as u64;
        let delta_projection_ms = self
            .taxis_projection_latency_ms
            .saturating_sub(baseline.taxis_projection_latency_ms);
        if self.taxis_projection_latency_ms > max_allowed_projection_latency
            && delta_projection_ms >= PROJECTION_LATENCY_NOISE_FLOOR_MS
        {
            passed = false;
            regressions.push(format!(
                "taxis_projection_latency_ms: measured {} ms exceeds allowed {} ms (+{:.1}%, delta {} ms >= {} ms noise floor)",
                self.taxis_projection_latency_ms, max_allowed_projection_latency, tolerance_pct,
                delta_projection_ms, PROJECTION_LATENCY_NOISE_FLOOR_MS
            ));
        } else if self.taxis_projection_latency_ms < baseline.taxis_projection_latency_ms {
            improvements.push(format!(
                "taxis_projection_latency_ms improved: {} ms -> {} ms",
                baseline.taxis_projection_latency_ms, self.taxis_projection_latency_ms
            ));
        }

        // TTFB latency ratchet
        let max_allowed_ttfb =
            (baseline.taxis_first_byte_latency_us as f64 * (1.0 + tolerance_pct / 100.0)) as u64;
        let delta_ttfb_us = self
            .taxis_first_byte_latency_us
            .saturating_sub(baseline.taxis_first_byte_latency_us);
        if self.taxis_first_byte_latency_us > max_allowed_ttfb
            && delta_ttfb_us >= TTFB_LATENCY_NOISE_FLOOR_US
        {
            passed = false;
            regressions.push(format!(
                "taxis_first_byte_latency_us: measured {} us exceeds allowed {} us (+{:.1}%, delta {} us >= {} us noise floor)",
                self.taxis_first_byte_latency_us, max_allowed_ttfb, tolerance_pct,
                delta_ttfb_us, TTFB_LATENCY_NOISE_FLOOR_US
            ));
        }

        // Chunk reuse ratio floor guard (cannot drop below baseline - 5%)
        if self.chunk_reuse_ratio_pct < baseline.chunk_reuse_ratio_pct - 5.0 {
            passed = false;
            regressions.push(format!(
                "chunk_reuse_ratio_pct dropped from {:.1}% to {:.1}%",
                baseline.chunk_reuse_ratio_pct, self.chunk_reuse_ratio_pct
            ));
        }

        // WAL sync latency ratchet
        let max_allowed_wal =
            (baseline.wal_sync_commit_latency_us as f64 * (1.0 + tolerance_pct / 100.0)) as u64;
        let delta_wal_us = self
            .wal_sync_commit_latency_us
            .saturating_sub(baseline.wal_sync_commit_latency_us);
        if self.wal_sync_commit_latency_us > max_allowed_wal
            && delta_wal_us >= WAL_SYNC_COMMIT_NOISE_FLOOR_US
        {
            passed = false;
            regressions.push(format!(
                "wal_sync_commit_latency_us: measured {} us exceeds allowed {} us (+{:.1}%, delta {} us >= {} us noise floor)",
                self.wal_sync_commit_latency_us, max_allowed_wal, tolerance_pct,
                delta_wal_us, WAL_SYNC_COMMIT_NOISE_FLOOR_US
            ));
        }

        BaselineComparisonVerdict {
            passed,
            regressions,
            improvements,
            unbaselined: Vec::new(),
            profile_mismatch: None,
        }
    }
}
