//! Module: Window Scaling Probe — History Bytes per Commit
//! File Path: examples/window_probe.rs
//! Architecture Role: Reports the measured per-commit history cost across a grid of commit counts
//!   and churn rates, so the size at which history overtakes the working tree is observed rather
//!   than assumed.
//! Dependencies & Triggers: Run manually; not part of the test suite.
//! Responsibilities: Generate synthetic histories, print uncompressed and on-disk totals, and the
//!   crossover between one checkout and the history behind it.
//! Exit Semantics & Design Rationale:
//!   - Two size columns are reported because they answer different questions. Uncompressed payload
//!     is what a reader must materialize; on-disk bytes are what a clone transfers. A window's
//!     value depends on the second, so measuring only the first would overstate the saving.
//!   - The crossover column is the number of commits whose history costs as much as one checkout.
//!     Below it, a bounded window cannot save more than a fraction; above it, the window dominates.
//!   - Generation runs in-process through the object store, so no `git` subprocess is measured.
//!   - `TAXIS_PROBE_CHURN_LOW=1` adds the low-churn band. This repository measures about 2 percent
//!     effective churn, so a grid starting at 10 percent describes a workload no current repository
//!     here actually produces.

use std::path::Path;

use fractal_git::storage::{generate, SynthRepoSpec};

/// Sums the bytes of every file under `dir`, which for a generated repository is its compressed
/// on-disk footprint.
fn directory_bytes(dir: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            total += directory_bytes(&entry.path());
        } else {
            total += metadata.len();
        }
    }
    total
}

fn main() {
    // `std::env::temp_dir()` is not writable in this sandbox, so the scratch tree lives under the
    // build directory, which the workspace already owns.
    let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("window_probe");
    let _ = std::fs::create_dir_all(&base);

    let wide = std::env::var("TAXIS_PROBE_WIDE").is_ok();
    let real = std::env::var("TAXIS_PROBE_REAL").is_ok();
    let low_churn = std::env::var("TAXIS_PROBE_CHURN_LOW").is_ok();

    let commits_axis: &[u32] = if wide { &[16, 64, 256] } else { &[8, 32] };
    let churn_axis: &[u32] = if low_churn {
        &[1, 2, 3, 5]
    } else if wide {
        &[10, 50, 90]
    } else {
        &[10, 90]
    };
    let (files, file_bytes): (u32, u32) = if real { (4511, 2800) } else { (16, 256) };

    println!(
        "working tree: {files} files x {file_bytes} B = {} B",
        u64::from(files) * u64::from(file_bytes)
    );
    println!(
        "{:>8} {:>6} {:>12} {:>14} {:>14} {:>12} {:>12}",
        "commits", "churn", "checkout_B", "hist_payload", "hist_disk", "disk/commit", "crossover"
    );

    for &churn in churn_axis {
        for &commits in commits_axis {
            let spec = SynthRepoSpec {
                commits,
                working_tree_files: files,
                bytes_per_file: file_bytes,
                churn_percent: churn,
                seed: 0xA5A5_0000 + u64::from(commits) * 7 + u64::from(churn),
            };
            let root = base.join(format!("c{commits}_h{churn}"));
            let _ = std::fs::remove_dir_all(&root);

            let repo = match generate(&root, spec) {
                Ok(repo) => repo,
                Err(err) => {
                    println!("commits={commits} churn={churn} generation failed: {err}");
                    continue;
                }
            };

            let stats = repo.stats;
            let disk_bytes = directory_bytes(&root);
            // `disk_bytes` is the whole store, so it still contains the final checkout. Reporting it
            // as history made the per-commit cost rise with churn: a wider checkout is not history.
            // The checkout's on-disk share is estimated from its payload share, because only the
            // payload side knows which objects the head commit references.
            let checkout_disk = if stats.payload_bytes > 0 {
                disk_bytes.saturating_mul(stats.final_checkout_bytes) / stats.payload_bytes
            } else {
                0
            };
            let history_disk = disk_bytes.saturating_sub(checkout_disk);
            let payload_per_commit = stats.history_bytes_per_commit();
            let disk_per_commit = if commits > 0 {
                history_disk as f64 / f64::from(commits)
            } else {
                0.0
            };
            let crossover = if payload_per_commit > 0.0 {
                format!(
                    "{:.0}",
                    stats.working_tree_bytes as f64 / payload_per_commit
                )
            } else {
                "n/a".to_string()
            };

            println!(
                "{:>8} {:>6} {:>12} {:>14} {:>14} {:>12.0} {:>12}",
                stats.commits,
                churn,
                stats.working_tree_bytes,
                stats.history_bytes(),
                history_disk,
                disk_per_commit,
                crossover
            );

            let _ = std::fs::remove_dir_all(&root);
        }
    }

    let _ = std::fs::remove_dir_all(&base);
}
