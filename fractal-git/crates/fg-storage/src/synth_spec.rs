//! Module: fg-storage — Synth Repo Specification
//! File Path: crates/fg-storage/src/synth_spec.rs
//! Architecture Role: Declares the shape of a synthetic history and the totals a measurement reads
//!   back from it, so the cost of a bounded history window can be measured against a known workload.
//! Dependencies & Triggers: Consumed by the history-window benchmark and its integration test.
//! Responsibilities: Write a linear or fan-out history of commits and blobs straight into a loose
//!   object store, and report the byte totals a measurement needs.
//! Exit Semantics & Design Rationale:
//!   - Objects are written through [`OdbStore`], never by spawning `git`. A subprocess would put its
//!     own startup, fork, and index behaviour inside every measurement, which is exactly the cost
//!     the benchmark is trying to isolate.
//!   - Every byte is derived from the seed with a fixed SplitMix64 stream. Re-running with the same
//!     spec must produce byte-identical objects, otherwise a recorded baseline describes a workload
//!     nobody can reproduce.
//!   - The reported totals are measured from what was written, not computed from the spec. A spec
//!     field can be satisfied only approximately once churn reuses blobs, and a benchmark that
//!     trusts the request instead of the result measures its own optimism.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `TST-DEN-001`: Deterministic test isolation and offline reproducibility
//! - `FGT-PRF-001`: Zero transient heap allocation on hot paths

use std::path::PathBuf;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;

/// Shape of the synthetic history to generate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SynthRepoSpec {
    /// Number of commits in the linear history.
    pub commits: u32,
    /// Number of files the working tree holds at any commit.
    pub working_tree_files: u32,
    /// Approximate byte size of each file's payload.
    pub bytes_per_file: u32,
    /// Fraction of files rewritten per commit, as percent in `1..=100`.
    ///
    /// This is the single knob that separates a history whose blobs deduplicate heavily from one
    /// where every commit introduces new content, which is what decides the per-commit byte cost.
    pub churn_percent: u32,
    /// Deterministic seed for payload bytes.
    pub seed: u64,
}

impl Default for SynthRepoSpec {
    fn default() -> Self {
        Self {
            commits: 64,
            working_tree_files: 32,
            bytes_per_file: 256,
            churn_percent: 10,
            seed: 0x5EED_1234_ABCD_0001,
        }
    }
}

impl SynthRepoSpec {
    /// Rejects a spec whose fields cannot produce a measurable history.
    ///
    /// A zero-commit or zero-file history has no working tree to compare against, and a churn of
    /// zero makes every commit reuse one tree, so the history would cost nothing to store and the
    /// measurement would describe an artifact of the request rather than a repository.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::PolicyViolation`] naming the field that cannot be honoured.
    pub fn validate(&self) -> FractalResult<()> {
        if self.commits == 0 {
            return Err(FractalError::PolicyViolation(
                "synthetic history needs at least one commit".into(),
            ));
        }
        if self.working_tree_files == 0 {
            return Err(FractalError::PolicyViolation(
                "synthetic history needs at least one file".into(),
            ));
        }
        if self.bytes_per_file == 0 {
            return Err(FractalError::PolicyViolation(
                "synthetic history needs non-empty file payloads".into(),
            ));
        }
        if self.churn_percent == 0 || self.churn_percent > 100 {
            return Err(FractalError::PolicyViolation(format!(
                "churn must be within 1..=100 percent, got {}",
                self.churn_percent
            )));
        }
        Ok(())
    }

    /// Smallest number of files rewritten in one commit.
    #[must_use]
    pub fn churn_batch(&self) -> u32 {
        let scaled = u64::from(self.working_tree_files) * u64::from(self.churn_percent) / 100;
        u32::try_from(scaled.max(1)).unwrap_or(self.working_tree_files)
    }
}

/// Totals measured from what the generator actually wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SynthRepoStats {
    /// Commits written.
    pub commits: u32,
    /// Distinct blob objects written.
    pub blobs: u64,
    /// Tree objects written, including intermediate directories.
    pub trees: u64,
    /// Total uncompressed payload bytes across every written object.
    pub payload_bytes: u64,
    /// Uncompressed bytes of the working tree at the final commit.
    pub working_tree_bytes: u64,
    /// Uncompressed payload bytes of the objects the final commit actually references.
    ///
    /// Distinct from [`Self::working_tree_bytes`], which counts file contents only. This one also
    /// includes the tree objects reachable from the final commit, so subtracting it from
    /// [`Self::payload_bytes`] leaves exactly the objects a shallow clone could skip.
    pub final_checkout_bytes: u64,
}

impl SynthRepoStats {
    /// Bytes of history a bounded window could avoid fetching.
    ///
    /// Measured as everything written minus what the final checkout references. Subtracting only the
    /// file contents would undercount when a short history rewrites no file twice: the tree objects
    /// of the final commit would then be charged to history, and for a low-churn short history the
    /// subtraction could reach zero even though history clearly exists.
    #[must_use]
    pub fn history_bytes(&self) -> u64 {
        self.payload_bytes.saturating_sub(self.final_checkout_bytes)
    }

    /// Uncompressed bytes per commit of history.
    #[must_use]
    pub fn history_bytes_per_commit(&self) -> f64 {
        if self.commits == 0 {
            return 0.0;
        }
        self.history_bytes() as f64 / f64::from(self.commits)
    }
}

/// A generated repository root and the totals measured while writing it.
#[derive(Debug, Clone)]
pub struct SynthRepo {
    /// Directory holding the generated `.git`.
    pub root: PathBuf,
    /// Object id of the final commit.
    pub head: Oid,
    /// Measured totals.
    pub stats: SynthRepoStats,
}

impl SynthRepo {
    /// Path to the generated repository's git directory.
    #[must_use]
    pub fn git_dir(&self) -> PathBuf {
        self.root.join(".git")
    }
}
