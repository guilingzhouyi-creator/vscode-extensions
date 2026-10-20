//! Module: fg-storage — Crash-Safe Write-Ahead Log (WAL) Journal
//! File Path: crates/fg-storage/src/wal_journal.rs
//! Architecture Role: Append-only transaction journal providing crash recovery and idempotency
//!   for uncommitted staging transactions before atomic Git commit materialization.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

/// Transactional operation recorded in the WAL journal.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "op", content = "data")]
pub enum WalRecord {
    BeginTx {
        tx_id: String,
        timestamp_ms: i64,
    },
    StageFile {
        tx_id: String,
        path: String,
        oid: Oid,
    },
    UpdateRef {
        tx_id: String,
        git_ref: String,
        new_oid: Oid,
    },
    CommitTx {
        tx_id: String,
        commit_oid: Oid,
    },
    AbortTx {
        tx_id: String,
        reason: String,
    },
}

/// Append-only WAL journal manager.
pub struct WalJournal {
    journal_path: PathBuf,
}

impl WalJournal {
    /// Opens or creates a WAL journal at target path.
    pub fn open(journal_path: impl Into<PathBuf>) -> FractalResult<Self> {
        let path = journal_path.into();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Ok(Self { journal_path: path })
    }

    /// Appends a new transaction record to the journal with immediate flush.
    pub fn append(&self, record: &WalRecord) -> FractalResult<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.journal_path)?;

        let serialized = serde_json::to_string(record)?;
        writeln!(file, "{}", serialized)?;
        file.sync_all()?;
        Ok(())
    }

    /// Reads all records in the journal in chronological order for recovery.
    pub fn read_all(&self) -> FractalResult<Vec<WalRecord>> {
        if !self.journal_path.exists() {
            return Ok(Vec::new());
        }

        let file = File::open(&self.journal_path)?;
        let reader = BufReader::new(file);
        let mut records = Vec::new();

        for (idx, line_res) in reader.lines().enumerate() {
            let line = line_res?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let record: WalRecord = serde_json::from_str(trimmed).map_err(|parse_err| {
                FractalError::IndexConflict(format!(
                    "WAL journal corrupted at line {}: {}",
                    idx + 1,
                    parse_err
                ))
            })?;
            records.push(record);
        }

        Ok(records)
    }

    /// Truncates / checkpoints the journal after successful atomic commit.
    pub fn checkpoint(&self) -> FractalResult<()> {
        if self.journal_path.exists() {
            std::fs::remove_file(&self.journal_path)?;
        }
        Ok(())
    }
}
