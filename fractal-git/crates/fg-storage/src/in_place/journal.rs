//! Module: fg-storage — In-Place Decompression WAL Journal & Crash Recovery
//! File Path: crates/fg-storage/src/in_place/journal.rs
//! Architecture Role: Implements write-ahead logging (WAL) for in-place extraction.
//!   Guarantees crash-consistency: no truncation occurs until target file and WAL are synced.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-COR-001, FGT-PRF-001.

use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use serde::{Deserialize, Serialize};

/// Magic header for TIPSE In-Place WAL records.
pub const TIPSE_WAL_MAGIC: &str = "TIPSE-WAL-v1";

/// A discrete log entry recorded during in-place extraction transactions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum InPlaceLogEntry {
    /// Commences an extraction session.
    SessionInit {
        /// Absolute or canonical path of the source archive.
        archive_path: String,
        /// Target destination directory or repository path.
        target_path: String,
        /// Total members planned for extraction.
        total_members: usize,
        /// Initial physical byte length of the source archive.
        initial_archive_len: u64,
    },
    /// Records successful extraction and disk flush of a single member.
    MemberExtracted {
        /// Relative path of the member.
        name: String,
        /// Number of uncompressed bytes extracted.
        extracted_bytes: u64,
        /// Byte offset in archive before truncation.
        local_header_offset: u64,
        /// Checksum of extracted payload.
        crc32: u32,
    },
    /// Records a physical tail truncation committed to the archive.
    BatchTruncated {
        /// New physical byte length of the archive.
        new_len: u64,
        /// Number of bytes freed in this truncation.
        freed_bytes: u64,
    },
    /// Marks the extraction session as completely and cleanly finished.
    SessionCompleted,
}

/// Snapshot of state reconstructed from replaying an in-place WAL journal.
#[derive(Debug, Clone, Default)]
pub struct InPlaceResumeState {
    /// Members successfully extracted and verified on disk.
    pub extracted_members: HashSet<String>,
    /// Last recorded physical byte length after tail truncation.
    pub last_truncated_len: Option<u64>,
    /// Whether the session completed cleanly.
    pub is_completed: bool,
}

/// Append-only write-ahead log for in-place extraction operations.
pub struct InPlaceJournal {
    file: File,
    path: PathBuf,
}

impl InPlaceJournal {
    /// Opens or creates an in-place transaction log at `path`.
    ///
    /// Missing parent directories are created on demand so that logging into a destination tree
    /// that does not exist yet (for example `taxis unarchive -C out/nested`) produces the same
    /// explicit outcome as any other filesystem failure instead of a bare `os error 3` from the
    /// underlying `open` call.
    pub fn open<P: AsRef<Path>>(path: P) -> FractalResult<Self> {
        let path_buf = path.as_ref().to_path_buf();
        if let Some(parent) = path_buf.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent).map_err(FractalError::Io)?;
            }
        }
        let is_new = !path_buf.exists();

        let mut file = OpenOptions::new()
            .read(true)
            .create(true)
            .append(true)
            .open(&path_buf)
            .map_err(FractalError::Io)?;

        if is_new {
            writeln!(file, "{TIPSE_WAL_MAGIC}").map_err(FractalError::Io)?;
            file.sync_all().map_err(FractalError::Io)?;
        }

        Ok(Self {
            file,
            path: path_buf,
        })
    }

    /// Appends a log entry to disk and forces an immediate OS sync barrier (`fsync`).
    pub fn append(&mut self, entry: &InPlaceLogEntry) -> FractalResult<()> {
        let line = serde_json::to_string(entry).map_err(FractalError::Json)?;
        writeln!(self.file, "{line}").map_err(FractalError::Io)?;
        self.file.sync_all().map_err(FractalError::Io)?;
        Ok(())
    }

    /// Replays an existing journal file and constructs the resume state.
    pub fn replay<P: AsRef<Path>>(path: P) -> FractalResult<InPlaceResumeState> {
        let file = File::open(path.as_ref()).map_err(FractalError::Io)?;
        let reader = BufReader::new(file);
        let mut lines = reader.lines();

        // 1. Verify magic header
        if let Some(first_line) = lines.next() {
            let magic = first_line.map_err(FractalError::Io)?;
            if magic.trim() != TIPSE_WAL_MAGIC {
                return Err(FractalError::CorruptStore(format!(
                    "verify WAL magic header: expected '{TIPSE_WAL_MAGIC}', actual '{magic}'"
                )));
            }
        } else {
            return Ok(InPlaceResumeState::default());
        }

        let mut state = InPlaceResumeState::default();

        // 2. Process records
        for line_res in lines {
            let line = line_res.map_err(FractalError::Io)?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let entry: InPlaceLogEntry = match serde_json::from_str(trimmed) {
                Ok(e) => e,
                Err(_) => {
                    // Torn write at EOF: discard last uncommitted record per WAL specification
                    break;
                }
            };

            match entry {
                InPlaceLogEntry::SessionInit { .. } => {}
                InPlaceLogEntry::MemberExtracted { name, .. } => {
                    state.extracted_members.insert(name);
                }
                InPlaceLogEntry::BatchTruncated { new_len, .. } => {
                    state.last_truncated_len = Some(new_len);
                }
                InPlaceLogEntry::SessionCompleted => {
                    state.is_completed = true;
                }
            }
        }

        Ok(state)
    }

    /// Removes the journal file after successful clean completion.
    pub fn remove(self) -> FractalResult<()> {
        drop(self.file);
        if self.path.exists() {
            std::fs::remove_file(&self.path).map_err(FractalError::Io)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_temp_dir(prefix: &str) -> tempfile::TempDir {
        let base = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&base);
        tempfile::Builder::new()
            .prefix(prefix)
            .tempdir_in(&base)
            .or_else(|_| tempfile::tempdir())
            .expect("create test tempdir")
    }

    #[test]
    fn test_inplace_journal_lifecycle_and_replay() {
        let dir = test_temp_dir("inplace_wal_");
        let journal_path = dir.path().join("extraction.wal");

        // 1. Open and record entries
        let mut journal = InPlaceJournal::open(&journal_path).expect("open journal");

        journal
            .append(&InPlaceLogEntry::SessionInit {
                archive_path: "foo.zip".into(),
                target_path: "out/".into(),
                total_members: 2,
                initial_archive_len: 10000,
            })
            .expect("log init");

        journal
            .append(&InPlaceLogEntry::MemberExtracted {
                name: "file1.txt".into(),
                extracted_bytes: 2000,
                local_header_offset: 8000,
                crc32: 0x12345678,
            })
            .expect("log file1");

        journal
            .append(&InPlaceLogEntry::BatchTruncated {
                new_len: 8000,
                freed_bytes: 2000,
            })
            .expect("log trunc");

        // 2. Replay mid-session (simulating process restart)
        let state = InPlaceJournal::replay(&journal_path).expect("replay");
        assert!(!state.is_completed);
        assert_eq!(state.last_truncated_len, Some(8000));
        assert!(state.extracted_members.contains("file1.txt"));
        assert!(!state.extracted_members.contains("file2.txt"));

        // 3. Complete session
        journal
            .append(&InPlaceLogEntry::MemberExtracted {
                name: "file2.txt".into(),
                extracted_bytes: 4000,
                local_header_offset: 0,
                crc32: 0x87654321,
            })
            .expect("log file2");

        journal
            .append(&InPlaceLogEntry::SessionCompleted)
            .expect("log complete");

        let finished_state = InPlaceJournal::replay(&journal_path).expect("replay finished");
        assert!(finished_state.is_completed);
        assert_eq!(finished_state.extracted_members.len(), 2);
    }

    #[test]
    fn test_open_creates_missing_parent_directories() {
        let dir = test_temp_dir("inplace_wal_nested_");
        let nested = dir
            .path()
            .join("out")
            .join("deep")
            .join(".taxis_unarchive.wal");
        assert!(
            !nested.parent().expect("journal parent").exists(),
            "fixture must start without the destination tree"
        );

        let journal = InPlaceJournal::open(&nested).expect("open journal in missing directory");
        drop(journal);

        assert!(nested.is_file(), "journal must be created after mkdir -p");
        let state = InPlaceJournal::replay(&nested).expect("replay freshly created journal");
        assert!(!state.is_completed);
    }
}
