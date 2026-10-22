//! Module: fg-storage — Crash-Safe Write-Ahead Log Journal
//! File Path: crates/fg-storage/src/wal_journal.rs
//! Architecture Role: Append-only transaction journal providing crash recovery and idempotency for
//!   uncommitted staging transactions before atomic commit materialization.
//! Dependencies & Triggers: Written by every staging mutation; replayed on open after a crash.
//! Responsibilities: Append framed records, replay them in order, and truncate after a successful
//!   checkpoint.
//! Exit Semantics & Design Rationale:
//!   - Records are length-and-CRC framed binary blobs, not JSON lines. A JSON line has no length
//!     prefix, so a torn final write is indistinguishable from a valid record that happens to end
//!     at the file boundary; the frame's `record_len` makes that difference explicit.
//!   - A torn tail is discarded, not treated as corruption. The whole point of a write-ahead log is
//!     that the last record may be incomplete; refusing to open the journal after a crash would
//!     make the journal useless exactly when it matters. Damage in a *complete* record is still an
//!     error, because that cannot be explained by a torn write.
//!   - Every record is `fsync`ed before `append` returns. Buffering would let a crash lose a
//!     transaction the caller was already told had been recorded.
//!   - The frame carries a magic word so a JSON file from an older build is rejected outright
//!     rather than being parsed as binary garbage.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Frame magic, ASCII `TAXW`.
pub const WAL_MAGIC: [u8; 4] = *b"TAXW";

/// Frame header width: magic (4) + record length (4) + record CRC32C (4).
pub const WAL_FRAME_HEADER_LEN: usize = 12;

/// Structural ceiling on a single record, guarding allocation against a forged length.
pub const WAL_MAX_RECORD_LEN: usize = 1 << 20;

/// One transactional operation recorded in the journal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WalRecord {
    /// Marks the start of a transaction.
    BeginTx {
        /// Transaction identifier, unique within the journal.
        tx_id: String,
        /// Wall-clock timestamp in milliseconds since the Unix epoch.
        timestamp_ms: i64,
    },
    /// Records that one path was staged at one object id.
    StageFile {
        /// Transaction the staging belongs to.
        tx_id: String,
        /// Worktree-relative path.
        path: String,
        /// Object the path now resolves to.
        oid: Oid,
    },
    /// Records that a reference was advanced.
    UpdateRef {
        /// Transaction the update belongs to.
        tx_id: String,
        /// Fully qualified reference name.
        git_ref: String,
        /// Object the reference now points at.
        new_oid: Oid,
    },
    /// Marks a transaction as durably committed.
    CommitTx {
        /// Transaction identifier.
        tx_id: String,
        /// Commit object the transaction produced.
        commit_oid: Oid,
    },
    /// Marks a transaction as abandoned.
    AbortTx {
        /// Transaction identifier.
        tx_id: String,
        /// Human-facing reason the transaction was abandoned.
        reason: String,
    },
}

/// Discriminant byte for each record kind.
const KIND_BEGIN_TX: u8 = 0;
const KIND_STAGE_FILE: u8 = 1;
const KIND_UPDATE_REF: u8 = 2;
const KIND_COMMIT_TX: u8 = 3;
const KIND_ABORT_TX: u8 = 4;

impl WalRecord {
    /// Renders the record as its canonical byte body.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when a field exceeds the frame ceiling or carries an
    /// interior NUL, both of which the format forbids.
    fn to_body(&self) -> FractalResult<Vec<u8>> {
        let mut body = Vec::with_capacity(64);
        match self {
            Self::BeginTx {
                tx_id,
                timestamp_ms,
            } => {
                body.push(KIND_BEGIN_TX);
                push_string(&mut body, tx_id)?;
                body.extend_from_slice(&timestamp_ms.to_le_bytes());
            }
            Self::StageFile { tx_id, path, oid } => {
                body.push(KIND_STAGE_FILE);
                push_string(&mut body, tx_id)?;
                push_string(&mut body, path)?;
                body.extend_from_slice(oid.as_bytes());
            }
            Self::UpdateRef {
                tx_id,
                git_ref,
                new_oid,
            } => {
                body.push(KIND_UPDATE_REF);
                push_string(&mut body, tx_id)?;
                push_string(&mut body, git_ref)?;
                body.extend_from_slice(new_oid.as_bytes());
            }
            Self::CommitTx { tx_id, commit_oid } => {
                body.push(KIND_COMMIT_TX);
                push_string(&mut body, tx_id)?;
                body.extend_from_slice(commit_oid.as_bytes());
            }
            Self::AbortTx { tx_id, reason } => {
                body.push(KIND_ABORT_TX);
                push_string(&mut body, tx_id)?;
                push_string(&mut body, reason)?;
            }
        }
        Ok(body)
    }

    /// Rebuilds a record from its canonical byte body.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when the body is truncated, carries an unknown kind,
    /// or contains invalid UTF-8.
    fn from_body(body: &[u8]) -> FractalResult<Self> {
        let mut cursor = BodyCursor::new(body);
        let kind = cursor.read_u8()?;
        let record = match kind {
            KIND_BEGIN_TX => Self::BeginTx {
                tx_id: cursor.read_string()?,
                timestamp_ms: cursor.read_i64()?,
            },
            KIND_STAGE_FILE => Self::StageFile {
                tx_id: cursor.read_string()?,
                path: cursor.read_string()?,
                oid: cursor.read_oid()?,
            },
            KIND_UPDATE_REF => Self::UpdateRef {
                tx_id: cursor.read_string()?,
                git_ref: cursor.read_string()?,
                new_oid: cursor.read_oid()?,
            },
            KIND_COMMIT_TX => Self::CommitTx {
                tx_id: cursor.read_string()?,
                commit_oid: cursor.read_oid()?,
            },
            KIND_ABORT_TX => Self::AbortTx {
                tx_id: cursor.read_string()?,
                reason: cursor.read_string()?,
            },
            other => {
                return Err(FractalError::CorruptStore(format!(
                    "WAL record carries unknown kind {other}"
                )))
            }
        };
        cursor.expect_exhausted()?;
        Ok(record)
    }
}

/// Appends a `u16`-length-prefixed UTF-8 string.
///
/// # Errors
///
/// Returns [`FractalError::CorruptStore`] when the text contains a NUL or exceeds the ceiling.
fn push_string(target: &mut Vec<u8>, value: &str) -> FractalResult<()> {
    if value.as_bytes().contains(&0) {
        return Err(FractalError::CorruptStore(
            "WAL string field contains an interior NUL".into(),
        ));
    }
    let length = value.len();
    if length > u16::MAX as usize {
        return Err(FractalError::CorruptStore(format!(
            "WAL string field of {length} bytes exceeds the 16-bit length prefix"
        )));
    }
    target.extend_from_slice(&(length as u16).to_le_bytes());
    target.extend_from_slice(value.as_bytes());
    Ok(())
}

/// Bounds-checked cursor over a record body.
struct BodyCursor<'a> {
    body: &'a [u8],
    offset: usize,
}

impl<'a> BodyCursor<'a> {
    const fn new(body: &'a [u8]) -> Self {
        Self { body, offset: 0 }
    }

    fn take(&mut self, length: usize) -> FractalResult<&'a [u8]> {
        let end = self.offset.saturating_add(length);
        let slice = self.body.get(self.offset..end).ok_or_else(|| {
            FractalError::CorruptStore(format!(
                "WAL record body truncated: needed {length} bytes at offset {}, {} available",
                self.offset,
                self.body.len().saturating_sub(self.offset)
            ))
        })?;
        self.offset = end;
        Ok(slice)
    }

    fn read_u8(&mut self) -> FractalResult<u8> {
        Ok(self.take(1)?[0])
    }

    fn read_i64(&mut self) -> FractalResult<i64> {
        let slice = self.take(8)?;
        let mut word = [0u8; 8];
        word.copy_from_slice(slice);
        Ok(i64::from_le_bytes(word))
    }

    fn read_oid(&mut self) -> FractalResult<Oid> {
        let slice = self.take(20)?;
        let mut raw = [0u8; 20];
        raw.copy_from_slice(slice);
        Ok(Oid::from_bytes(raw))
    }

    fn read_string(&mut self) -> FractalResult<String> {
        let length_prefix = self.take(2)?;
        let length = u16::from_le_bytes([length_prefix[0], length_prefix[1]]) as usize;
        let slice = self.take(length)?;
        std::str::from_utf8(slice)
            .map(str::to_owned)
            .map_err(|utf_err| {
                FractalError::CorruptStore(format!("WAL string field is not UTF-8: {utf_err}"))
            })
    }

    fn expect_exhausted(&self) -> FractalResult<()> {
        if self.offset == self.body.len() {
            Ok(())
        } else {
            Err(FractalError::CorruptStore(format!(
                "WAL record body has {} unexplained trailing bytes",
                self.body.len() - self.offset
            )))
        }
    }
}

/// Outcome of replaying a journal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalReplay {
    /// Records that were read intact, in chronological order.
    pub records: Vec<WalRecord>,
    /// Number of trailing bytes discarded as a torn write.
    pub discarded_tail_bytes: usize,
}

impl WalReplay {
    /// Reports whether the journal had to discard an incomplete trailing record.
    pub const fn had_torn_tail(&self) -> bool {
        self.discarded_tail_bytes > 0
    }
}

/// Append-only WAL journal manager.
pub struct WalJournal {
    journal_path: PathBuf,
}

impl WalJournal {
    /// Opens or creates a WAL journal at `journal_path`.
    ///
    /// # Errors
    ///
    /// Propagates directory-creation and I/O failures.
    pub fn open(journal_path: impl Into<PathBuf>) -> FractalResult<Self> {
        let path = journal_path.into();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Ok(Self { journal_path: path })
    }

    /// Returns the journal file path.
    pub fn path(&self) -> &Path {
        &self.journal_path
    }

    /// Appends one framed record and flushes it to durable storage.
    ///
    /// # Errors
    ///
    /// Propagates record-encoding and I/O failures.
    pub fn append(&self, record: &WalRecord) -> FractalResult<()> {
        let body = record.to_body()?;
        if body.len() > WAL_MAX_RECORD_LEN {
            return Err(FractalError::CorruptStore(format!(
                "WAL record of {} bytes exceeds the {WAL_MAX_RECORD_LEN}-byte ceiling",
                body.len()
            )));
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.journal_path)?;

        file.write_all(&WAL_MAGIC)?;
        file.write_all(&(body.len() as u32).to_le_bytes())?;
        file.write_all(&crc32c(&body).to_le_bytes())?;
        file.write_all(&body)?;
        file.sync_all()?;
        Ok(())
    }

    /// Replays every intact record in chronological order.
    ///
    /// A torn final record is discarded and reported through [`WalReplay::discarded_tail_bytes`];
    /// damage inside a complete record is an error, because a torn write cannot explain it.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when the file does not start with the frame magic, when
    /// a complete record fails its CRC, or when a record body cannot be decoded.
    pub fn replay(&self) -> FractalResult<WalReplay> {
        if !self.journal_path.exists() {
            return Ok(WalReplay {
                records: Vec::new(),
                discarded_tail_bytes: 0,
            });
        }

        let bytes = std::fs::read(&self.journal_path)?;
        if bytes.is_empty() {
            return Ok(WalReplay {
                records: Vec::new(),
                discarded_tail_bytes: 0,
            });
        }
        if bytes.len() < WAL_MAGIC.len() || bytes[..WAL_MAGIC.len()] != WAL_MAGIC {
            return Err(FractalError::CorruptStore(
                "WAL journal does not start with the TAXW frame magic".into(),
            ));
        }

        let mut records = Vec::new();
        let mut cursor = 0usize;

        while cursor < bytes.len() {
            let remaining = bytes.len() - cursor;
            if remaining < WAL_FRAME_HEADER_LEN {
                return Ok(WalReplay {
                    records,
                    discarded_tail_bytes: remaining,
                });
            }

            let header = &bytes[cursor..cursor + WAL_FRAME_HEADER_LEN];
            if header[..4] != WAL_MAGIC {
                return Err(FractalError::CorruptStore(format!(
                    "WAL frame magic mismatch at offset {cursor}"
                )));
            }

            let body_len =
                u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
            if body_len > WAL_MAX_RECORD_LEN {
                return Err(FractalError::CorruptStore(format!(
                    "WAL frame at offset {cursor} declares {body_len} bytes, above the ceiling"
                )));
            }

            let body_start = cursor + WAL_FRAME_HEADER_LEN;
            let body_end = body_start.saturating_add(body_len);
            if body_end > bytes.len() {
                return Ok(WalReplay {
                    records,
                    discarded_tail_bytes: bytes.len() - cursor,
                });
            }

            let stored_crc = u32::from_le_bytes([header[8], header[9], header[10], header[11]]);
            let body = &bytes[body_start..body_end];
            if crc32c(body) != stored_crc {
                return Err(FractalError::CorruptStore(format!(
                    "WAL frame at offset {cursor} fails its CRC: the record is complete but altered"
                )));
            }

            records.push(WalRecord::from_body(body)?);
            cursor = body_end;
        }

        Ok(WalReplay {
            records,
            discarded_tail_bytes: 0,
        })
    }

    /// Reads every intact record, discarding a torn tail.
    ///
    /// # Errors
    ///
    /// Same failure set as [`WalJournal::replay`].
    pub fn read_all(&self) -> FractalResult<Vec<WalRecord>> {
        Ok(self.replay()?.records)
    }

    /// Removes the journal after a successful checkpoint.
    ///
    /// # Errors
    ///
    /// Propagates removal failures other than absence.
    pub fn checkpoint(&self) -> FractalResult<()> {
        match std::fs::remove_file(&self.journal_path) {
            Ok(()) => Ok(()),
            Err(remove_err) if remove_err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(remove_err) => Err(FractalError::Io(remove_err)),
        }
    }
}

/// Computes CRC32C over a byte slice using the same polynomial as the container layer.
///
/// The journal deliberately reuses the container's polynomial so one integrity primitive covers
/// every durable artifact; two polynomials would need two independent implementations and two
/// independent test suites for the same guarantee.
fn crc32c(payload: &[u8]) -> u32 {
    const POLYNOMIAL: u32 = 0x82F6_3B78;
    let mut crc = !0u32;
    for byte in payload {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (POLYNOMIAL & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use fg_core::models::Oid;

    use super::{WalJournal, WalRecord, WAL_MAGIC};

    static SCRATCH: AtomicU64 = AtomicU64::new(0);

    fn scratch_path(label: &str) -> std::path::PathBuf {
        let sequence = SCRATCH.fetch_add(1, Ordering::Relaxed);
        let mut path = std::env::temp_dir();
        path.push("Low");
        path.push("fg-storage-wal");
        let _ = std::fs::create_dir_all(&path);
        path.push(format!("{label}-{}-{sequence}.wal", std::process::id()));
        path
    }

    fn oid_from(seed: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = seed;
        Oid::from_bytes(raw)
    }

    #[test]
    fn crc32c_matches_the_standard_check_value() {
        assert_eq!(super::crc32c(b"123456789"), 0xE306_9283);
    }

    #[test]
    fn every_record_kind_round_trips() {
        let records = vec![
            WalRecord::BeginTx {
                tx_id: "tx-1".to_owned(),
                timestamp_ms: 1_700_000_000_000,
            },
            WalRecord::StageFile {
                tx_id: "tx-1".to_owned(),
                path: "src/lib.rs".to_owned(),
                oid: oid_from(0x11),
            },
            WalRecord::UpdateRef {
                tx_id: "tx-1".to_owned(),
                git_ref: "refs/heads/main".to_owned(),
                new_oid: oid_from(0x22),
            },
            WalRecord::CommitTx {
                tx_id: "tx-1".to_owned(),
                commit_oid: oid_from(0x33),
            },
            WalRecord::AbortTx {
                tx_id: "tx-2".to_owned(),
                reason: "merge conflict".to_owned(),
            },
        ];

        let path = scratch_path("roundtrip");
        let journal = WalJournal::open(&path).expect("open");
        for record in &records {
            journal.append(record).expect("append");
        }

        let replayed = journal.replay().expect("replay");
        assert_eq!(replayed.records, records);
        assert!(!replayed.had_torn_tail());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn empty_journal_replays_to_nothing() {
        let path = scratch_path("empty");
        let journal = WalJournal::open(&path).expect("open");
        assert!(journal.read_all().expect("read").is_empty());
    }

    #[test]
    fn torn_tail_is_discarded_not_fatal() {
        let path = scratch_path("torn");
        let journal = WalJournal::open(&path).expect("open");
        journal
            .append(&WalRecord::BeginTx {
                tx_id: "tx-1".to_owned(),
                timestamp_ms: 1,
            })
            .expect("append");

        // Simulate a crash mid-write: append a header with no body.
        let mut bytes = std::fs::read(&path).expect("read");
        bytes.extend_from_slice(&WAL_MAGIC);
        bytes.extend_from_slice(&64u32.to_le_bytes());
        std::fs::write(&path, &bytes).expect("write");

        let replayed = journal.replay().expect("replay");
        assert_eq!(replayed.records.len(), 1);
        assert!(replayed.had_torn_tail());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn altered_complete_record_is_rejected() {
        let path = scratch_path("altered");
        let journal = WalJournal::open(&path).expect("open");
        journal
            .append(&WalRecord::BeginTx {
                tx_id: "tx-1".to_owned(),
                timestamp_ms: 1,
            })
            .expect("append");

        let mut bytes = std::fs::read(&path).expect("read");
        let last = bytes.len() - 1;
        bytes[last] ^= 0xFF;
        std::fs::write(&path, &bytes).expect("write");

        let error = journal.replay().expect_err("altered record must fail");
        assert!(
            error.to_string().contains("CRC"),
            "error must name the CRC: {error}"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn non_wal_file_is_rejected() {
        let path = scratch_path("json");
        std::fs::write(&path, b"{\"op\":\"BeginTx\"}\n").expect("write");
        let journal = WalJournal::open(&path).expect("open");
        assert!(journal.replay().is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn checkpoint_removes_the_journal() {
        let path = scratch_path("checkpoint");
        let journal = WalJournal::open(&path).expect("open");
        journal
            .append(&WalRecord::BeginTx {
                tx_id: "tx-1".to_owned(),
                timestamp_ms: 1,
            })
            .expect("append");
        journal.checkpoint().expect("checkpoint");
        assert!(!path.exists());
    }

    #[test]
    fn interior_nul_is_rejected() {
        let path = scratch_path("nul");
        let journal = WalJournal::open(&path).expect("open");
        let error = journal
            .append(&WalRecord::AbortTx {
                tx_id: "tx\0bad".to_owned(),
                reason: "x".to_owned(),
            })
            .expect_err("interior NUL must fail");
        assert!(error.to_string().contains("NUL"));
        let _ = std::fs::remove_file(&path);
    }
}
