//! Module: fg-topology — Persistent Mechanical Code Provenance Store
//! File Path: crates/fg-topology/src/provenance.rs
//! Architecture Role: Manages persistent, atomic write-and-load operations for the
//!   Mechanical Code Chunk Provenance Ledger (MCPL) under `.taxis/provenance.json`.
//! Dependencies & Triggers: Invoked by Taxis commit pipeline and provenance query tools.
//! Responsibilities: Load historical provenance records, batch append new block entries,
//!   and perform atomic crash-safe saves.
//! Exit Semantics & Design Rationale:
//!   - Atomic write via staging file prevents partial JSON reads during concurrent access.
//!   - Objective physical timestamp ledger enables deterministic dispute arbitration.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::fs;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{BlockProvenanceEntry, ProvenanceLedger};

/// Canonical file name for persistent mechanical provenance ledger.
pub const PROVENANCE_FILE: &str = "provenance.json";

/// Disk storage driver for repository-wide mechanical provenance ledger.
#[derive(Debug, Clone)]
pub struct DiskProvenanceStore {
    file_path: PathBuf,
    staging_dir: PathBuf,
}

impl DiskProvenanceStore {
    /// Creates a provenance store rooted at `git_dir`.
    pub fn new(git_dir: impl AsRef<Path>) -> Self {
        let root = git_dir.as_ref();
        Self {
            file_path: root.join(PROVENANCE_FILE),
            staging_dir: root.to_path_buf(),
        }
    }

    /// Loads the active provenance ledger, returning an empty ledger if absent.
    pub fn load_or_create(&self) -> FractalResult<ProvenanceLedger> {
        if !self.file_path.is_file() {
            return Ok(ProvenanceLedger::new());
        }

        let bytes = fs::read(&self.file_path).map_err(FractalError::Io)?;
        let ledger: ProvenanceLedger =
            serde_json::from_slice(&bytes).map_err(FractalError::Json)?;

        Ok(ledger)
    }

    /// Atomically persists the ledger to disk using a unique temporary file.
    pub fn save(&self, ledger: &ProvenanceLedger) -> FractalResult<()> {
        if let Some(parent) = self.file_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(FractalError::Io)?;
            }
        }

        let seq = std::process::id();
        let tmp_path = self.staging_dir.join(format!(".provenance-{seq}.tmp"));

        let json_bytes = serde_json::to_vec_pretty(ledger).map_err(FractalError::Json)?;

        fs::write(&tmp_path, &json_bytes).map_err(FractalError::Io)?;

        if let Err(rename_err) = fs::rename(&tmp_path, &self.file_path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(FractalError::Io(rename_err));
        }

        Ok(())
    }

    /// Appends a batch of newly derived block provenance entries and atomically persists them.
    pub fn record_batch(&self, entries: Vec<BlockProvenanceEntry>) -> FractalResult<()> {
        if entries.is_empty() {
            return Ok(());
        }
        let mut ledger = self.load_or_create()?;
        for entry in entries {
            ledger.record(entry);
        }
        self.save(&ledger)
    }
}
