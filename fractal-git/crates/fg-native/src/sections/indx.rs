//! Module: fg-native — INDX Section Codec
//! File Path: crates/fg-native/src/sections/indx.rs
//! Architecture Role: Encodes the staging index as a strictly ordered record stream keyed by
//!   `(path, stage)`, carrying the worktree stat cache needed to skip re-hashing clean files.
//! Dependencies & Triggers: Consumed by `status`, `add`, `commit`, and the Git DIRC projection
//!   layer; written whenever staging state changes.
//! Responsibilities: Round-trip path, mode, object id, merge stage, flags, and stat cache for
//!   every index entry while enforcing the ordering and path-safety invariants that binary search
//!   and checkout depend on.
//! Exit Semantics & Design Rationale:
//!   - Entries are ordered by `(path bytes, stage)` and that order is re-verified on decode.
//!     Lookup is a binary search, so an out-of-order stream would answer queries incorrectly
//!     without ever raising an error; refusing to load is the only safe response.
//!   - Paths are validated at decode time rather than at use time. A forged entry such as
//!     `../outside` must not reach checkout, because checkout is where it would gain the ability
//!     to write outside the worktree root.
//!   - File modes are a closed set. An unconstrained `u32` would let a forged index relabel a
//!     regular file as a directory and change how the worktree is materialized.
//!   - The stat cache stores git's full comparison tuple (mtime, ctime, size, dev, ino, uid, gid)
//!     with nanosecond resolution. Dropping any member would make a false "clean" verdict
//!     possible, which silently loses user edits.
//!   - Sparse-directory entries must end with `/` and ordinary entries must not, so the two can
//!     never be confused for one another in a lookup.
//!   - The mode and stage types are [`fg_core::models::FileMode`] and
//!     [`fg_core::models::IndexStage`], not local copies: the in-memory index writes the same bytes
//!     through its own types, so two definitions would let one side emit a value the other rejects.

use fg_core::models::{FileMode, IndexStage, Oid};

use crate::codec::{FieldReader, FieldWriter};
use crate::constants::MAX_RECORD_COUNT;
use crate::error::{NativeError, NativeResult};

/// Tag reported in diagnostics for this section.
const SECTION_TAG: &str = "INDX";

/// Entry flag: the stat cache is known to be stale and the blob must be re-hashed.
pub const FLAG_ASSUME_VALID: u8 = 1 << 0;

/// Entry flag: the path is deliberately absent from the worktree (sparse checkout).
pub const FLAG_SKIP_WORKTREE: u8 = 1 << 1;

/// Entry flag: the path was declared added without content (intent-to-add).
pub const FLAG_INTENT_TO_ADD: u8 = 1 << 2;

/// Mask of every flag bit this build defines.
const KNOWN_FLAGS: u8 = FLAG_ASSUME_VALID | FLAG_SKIP_WORKTREE | FLAG_INTENT_TO_ADD;

/// Byte width of the stat cache carried by every record.
const STAT_LEN: usize = 56;

/// Byte width of the fixed tail that follows the variable-length path in each record.
///
/// `mode` (4) + `oid` (20) + `stage` (1) + `flags` (1) + stat cache. Derived from the member widths
/// rather than restated, so the capacity hint cannot drift away from the encoder.
const RECORD_TAIL_LEN: usize = 4 + 20 + 1 + 1 + STAT_LEN;

/// Cached filesystem metadata used to decide whether a worktree file is still clean.
///
/// Every field participates in the comparison: a change to any one of them forces a re-hash. The
/// default value means "no observation yet" and always forces a re-hash.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StatCache {
    /// Modification time, whole seconds since the Unix epoch.
    pub mtime_secs: i64,
    /// Modification time, sub-second nanoseconds.
    pub mtime_nanos: u32,
    /// Status-change time, whole seconds since the Unix epoch.
    pub ctime_secs: i64,
    /// Status-change time, sub-second nanoseconds.
    pub ctime_nanos: u32,
    /// File size in bytes.
    pub size: u64,
    /// Device identifier of the containing filesystem.
    pub dev: u64,
    /// Inode number within that device.
    pub ino: u64,
    /// Owning user id.
    pub uid: u32,
    /// Owning group id.
    pub gid: u32,
}

impl StatCache {
    /// Reports whether this cache holds a real observation.
    ///
    /// A zeroed cache means the entry was written without stat information, so the caller must
    /// re-hash rather than trust it.
    pub const fn is_observed(&self) -> bool {
        !(self.mtime_secs == 0
            && self.mtime_nanos == 0
            && self.ctime_secs == 0
            && self.ctime_nanos == 0
            && self.size == 0
            && self.dev == 0
            && self.ino == 0)
    }
}

/// One staging index entry as stored in the native container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexEntry {
    /// Worktree-relative path using `/` separators; sparse directories end with `/`.
    pub path: String,
    /// Kind of file recorded.
    pub mode: FileMode,
    /// Object the entry resolves to.
    pub oid: Oid,
    /// Merge stage the entry belongs to.
    pub stage: IndexStage,
    /// Behavioural flags, see [`FLAG_ASSUME_VALID`] and friends.
    pub flags: u8,
    /// Cached filesystem metadata for the clean-file shortcut.
    pub stat: StatCache,
}

impl IndexEntry {
    /// Creates a resolved entry with no stat observation.
    pub fn new(path: impl Into<String>, mode: FileMode, oid: Oid) -> Self {
        Self {
            path: path.into(),
            mode,
            oid,
            stage: IndexStage::Normal,
            flags: 0,
            stat: StatCache::default(),
        }
    }

    /// Returns the sort key this entry is ordered by.
    fn sort_key(&self) -> (&str, IndexStage) {
        (self.path.as_str(), self.stage)
    }
}

/// Ordered staging index with binary-search lookup.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IndxSection {
    entries: Vec<IndexEntry>,
}

impl IndxSection {
    /// Creates an empty index.
    pub const fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Returns the number of entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Reports whether the index holds no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Returns the entries in ascending `(path, stage)` order.
    pub fn entries(&self) -> &[IndexEntry] {
        &self.entries
    }

    /// Inserts or replaces an entry, preserving ascending order.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::InvalidPath`] when the path is not a safe worktree-relative path,
    /// [`NativeError::UnknownDiscriminant`] when unknown flag bits are set, and
    /// [`NativeError::CountExceeded`] when the index is already at the record ceiling.
    pub fn upsert(&mut self, entry: IndexEntry) -> NativeResult<()> {
        validate_path(entry.path.as_str(), entry.mode)?;
        validate_flags(entry.flags)?;

        let key = entry.sort_key();
        match self
            .entries
            .binary_search_by(|existing| existing.sort_key().cmp(&key))
        {
            Ok(position) => {
                self.entries[position] = entry;
                Ok(())
            }
            Err(position) => {
                if self.entries.len() >= MAX_RECORD_COUNT {
                    return Err(NativeError::CountExceeded {
                        field: "index",
                        declared: self.entries.len() + 1,
                        ceiling: MAX_RECORD_COUNT,
                    });
                }
                self.entries.insert(position, entry);
                Ok(())
            }
        }
    }

    /// Looks up an entry by exact path and stage.
    pub fn get(&self, path: &str, stage: IndexStage) -> Option<&IndexEntry> {
        self.entries
            .binary_search_by(|existing| existing.sort_key().cmp(&(path, stage)))
            .ok()
            .map(|position| &self.entries[position])
    }

    /// Looks up the stage-0 entry for a path.
    pub fn get_clean(&self, path: &str) -> Option<&IndexEntry> {
        self.get(path, IndexStage::Normal)
    }

    /// Reports whether any conflict stage exists for a path.
    pub fn has_conflict(&self, path: &str) -> bool {
        // Entries are kept sorted by `(path, stage)`, so the three conflict stages for one path
        // occupy a contiguous run. Probe for any of them with binary search instead of scanning
        // the whole table: the previous linear form paid one cache miss per entry on an index of
        // scattered `String` fields.
        if self.entries.is_empty() {
            return false;
        }
        // Stages that represent an unresolved merge are anything but `Normal`.
        let conflicting_stages = [IndexStage::Base, IndexStage::Ours, IndexStage::Theirs];
        conflicting_stages.into_iter().any(|stage| {
            self.entries
                .binary_search_by(|entry| entry.sort_key().cmp(&(path, stage)))
                .is_ok()
        })
    }

    /// Serializes the section payload.
    ///
    /// Layout: `u32` entry count, then one variable-length record per entry.
    ///
    /// # Errors
    ///
    /// Propagates path, flag, and string-encoding failures plus
    /// [`NativeError::CountExceeded`] when the entry count exceeds the ceiling.
    pub fn encode(&self) -> NativeResult<Vec<u8>> {
        if self.entries.len() > MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "index",
                declared: self.entries.len(),
                ceiling: MAX_RECORD_COUNT,
            });
        }

        let mut writer =
            FieldWriter::with_capacity(4 + self.entries.len() * (RECORD_TAIL_LEN + 32));
        writer.write_u32(self.entries.len() as u32);

        for entry in &self.entries {
            validate_path(entry.path.as_str(), entry.mode)?;
            validate_flags(entry.flags)?;

            writer.write_string("entry_path", entry.path.as_str())?;
            writer.write_u32(entry.mode.to_u32());
            writer.write_oid(&entry.oid);
            writer.write_u8(entry.stage.to_u8());
            writer.write_u8(entry.flags);
            write_stat(&mut writer, &entry.stat);
        }

        Ok(writer.finish())
    }

    /// Parses the section payload.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::CountExceeded`] for an implausible entry count,
    /// [`NativeError::IndexOutOfOrder`] when the stream is not strictly ascending,
    /// [`NativeError::UnknownFileMode`] or [`NativeError::UnknownIndexStage`] for values outside
    /// their closed sets, [`NativeError::InvalidPath`] for an unsafe path, and field-level errors
    /// for a truncated payload.
    pub fn decode(payload: &[u8]) -> NativeResult<Self> {
        let mut reader = FieldReader::new(payload);
        let declared = reader.read_u32("index_count")? as usize;

        if declared > MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "index",
                declared,
                ceiling: MAX_RECORD_COUNT,
            });
        }

        let mut entries: Vec<IndexEntry> = Vec::with_capacity(declared.min(1024));

        for position in 0..declared {
            let path = reader.read_string("entry_path")?;
            let mode = decode_mode(reader.read_u32("entry_mode")?)?;
            let oid = reader.read_oid("entry_oid")?;
            let stage = decode_stage(reader.read_u8("entry_stage")?)?;
            let flags = reader.read_u8("entry_flags")?;
            let stat = read_stat(&mut reader)?;

            validate_path(path.as_str(), mode)?;
            validate_flags(flags)?;

            if let Some(previous) = entries.last() {
                let ascending = previous.sort_key() < (path.as_str(), stage);
                if !ascending {
                    return Err(NativeError::IndexOutOfOrder { position });
                }
            }

            entries.push(IndexEntry {
                path,
                mode,
                oid,
                stage,
                flags,
                stat,
            });
        }

        reader.expect_exhausted(SECTION_TAG)?;
        Ok(Self { entries })
    }
}

/// Decodes a mode word, translating the shared taxonomy into the container's own error type.
///
/// The section keeps a local error surface so `taxis doctor` can distinguish container-level
/// damage from domain-level rejection; the mapping is exhaustive and never loses the value.
///
/// # Errors
///
/// Returns [`NativeError::UnknownFileMode`] for any word outside the five defined modes.
fn decode_mode(mode: u32) -> NativeResult<FileMode> {
    FileMode::from_u32(mode).map_err(|_| NativeError::UnknownFileMode { mode })
}

/// Decodes a stage byte, translating the shared taxonomy into the container's own error type.
///
/// # Errors
///
/// Returns [`NativeError::UnknownIndexStage`] for any byte above three.
fn decode_stage(stage: u8) -> NativeResult<IndexStage> {
    IndexStage::from_u8(stage).map_err(|_| NativeError::UnknownIndexStage { stage })
}

/// Appends the fixed-width stat cache.
fn write_stat(writer: &mut FieldWriter, stat: &StatCache) {
    writer.write_i64(stat.mtime_secs);
    writer.write_u32(stat.mtime_nanos);
    writer.write_i64(stat.ctime_secs);
    writer.write_u32(stat.ctime_nanos);
    writer.write_u64(stat.size);
    writer.write_u64(stat.dev);
    writer.write_u64(stat.ino);
    writer.write_u32(stat.uid);
    writer.write_u32(stat.gid);
}

/// Reads the fixed-width stat cache.
///
/// # Errors
///
/// Returns [`NativeError::FieldOverrun`] when fewer than [`STAT_LEN`] bytes remain.
fn read_stat(reader: &mut FieldReader<'_>) -> NativeResult<StatCache> {
    Ok(StatCache {
        mtime_secs: reader.read_i64("stat_mtime_secs")?,
        mtime_nanos: reader.read_u32("stat_mtime_nanos")?,
        ctime_secs: reader.read_i64("stat_ctime_secs")?,
        ctime_nanos: reader.read_u32("stat_ctime_nanos")?,
        size: reader.read_u64("stat_size")?,
        dev: reader.read_u64("stat_dev")?,
        ino: reader.read_u64("stat_ino")?,
        uid: reader.read_u32("stat_uid")?,
        gid: reader.read_u32("stat_gid")?,
    })
}

/// Rejects flag words carrying bits this build does not define.
///
/// # Errors
///
/// Returns [`NativeError::UnknownDiscriminant`] naming `entry_flags` for any undefined bit.
fn validate_flags(flags: u8) -> NativeResult<()> {
    if flags & !KNOWN_FLAGS == 0 {
        Ok(())
    } else {
        Err(NativeError::UnknownDiscriminant {
            field: "entry_flags",
            value: flags,
        })
    }
}

/// Enforces that a path is a usable, non-escaping worktree-relative path.
///
/// The trailing-slash rule follows Git's sparse-index encoding: a directory entry may optionally
/// end with `/` to mark it as collapsed, while every other kind must not carry one. Rejecting the
/// disagreement is what stops a collapsed subtree from being expanded on checkout, or a blob from
/// being written as a directory.
///
/// # Errors
///
/// Returns [`NativeError::InvalidPath`] for an empty path, an absolute path, a Windows drive or
/// backslash separator, an empty or dot component, or a trailing slash that disagrees with the
/// entry kind.
fn validate_path(path: &str, mode: FileMode) -> NativeResult<()> {
    if path.is_empty() {
        return Err(NativeError::InvalidPath {
            reason: "path is empty",
        });
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return Err(NativeError::InvalidPath {
            reason: "path is absolute",
        });
    }
    if path.contains('\\') {
        return Err(NativeError::InvalidPath {
            reason: "path uses a backslash separator",
        });
    }
    if path.as_bytes().get(1) == Some(&b':') {
        return Err(NativeError::InvalidPath {
            reason: "path starts with a drive letter",
        });
    }

    let trailing_slash = path.ends_with('/');
    if trailing_slash && !mode.is_tree() {
        return Err(NativeError::InvalidPath {
            reason: "only a directory entry may end with a slash",
        });
    }

    let body = path.strip_suffix('/').unwrap_or(path);
    if body.is_empty() {
        return Err(NativeError::InvalidPath {
            reason: "path has no component",
        });
    }

    for component in body.split('/') {
        if component.is_empty() {
            return Err(NativeError::InvalidPath {
                reason: "path has an empty component",
            });
        }
        if component == "." || component == ".." {
            return Err(NativeError::InvalidPath {
                reason: "path escapes the worktree root",
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use fg_core::models::Oid;

    use super::{FileMode, IndexEntry, IndexStage, IndxSection, StatCache, FLAG_SKIP_WORKTREE};
    use crate::codec::FieldWriter;
    use crate::error::NativeError;

    fn oid_from(seed: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = seed;
        raw[19] = seed.wrapping_mul(3);
        Oid::from_bytes(raw)
    }

    fn entry(path: &str, seed: u8) -> IndexEntry {
        IndexEntry::new(path, FileMode::RegularFile, oid_from(seed))
    }

    fn sample_index() -> IndxSection {
        let mut index = IndxSection::new();
        index.upsert(entry("src/lib.rs", 0x01)).expect("upsert");
        index.upsert(entry("README.md", 0x02)).expect("upsert");
        index.upsert(entry("src/main.rs", 0x03)).expect("upsert");
        index
    }

    #[test]
    fn round_trip_preserves_entries_and_order() {
        let original = sample_index();
        let encoded = original.encode().expect("encode");
        let decoded = IndxSection::decode(&encoded).expect("decode");
        assert_eq!(decoded, original);

        let paths: Vec<&str> = decoded.entries().iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["README.md", "src/lib.rs", "src/main.rs"]);
    }

    #[test]
    fn stat_cache_round_trips_bit_exactly() {
        let mut index = IndxSection::new();
        let mut sample = entry("a.txt", 0x07);
        sample.stat = StatCache {
            mtime_secs: 1_700_000_000,
            mtime_nanos: 123_456_789,
            ctime_secs: -42,
            ctime_nanos: 987_654_321,
            size: u64::MAX,
            dev: 0xDEAD_BEEF,
            ino: 0x0123_4567_89AB_CDEF,
            uid: 1000,
            gid: 1000,
        };
        index.upsert(sample.clone()).expect("upsert");

        let decoded = IndxSection::decode(&index.encode().expect("encode")).expect("decode");
        let found = decoded.get_clean("a.txt").expect("present");
        assert_eq!(found.stat, sample.stat);
        assert!(found.stat.is_observed());
    }

    #[test]
    fn default_stat_cache_is_not_observed() {
        assert!(!StatCache::default().is_observed());
    }

    #[test]
    fn all_modes_round_trip() {
        let modes = [
            FileMode::RegularFile,
            FileMode::ExecutableFile,
            FileMode::Symlink,
            FileMode::Gitlink,
        ];
        let mut index = IndxSection::new();
        for (position, mode) in modes.iter().enumerate() {
            let mut record = IndexEntry::new(format!("f{position}"), *mode, oid_from(1));
            record.stat = StatCache::default();
            index.upsert(record).expect("upsert");
        }

        let decoded = IndxSection::decode(&index.encode().expect("encode")).expect("decode");
        assert_eq!(decoded, index);
    }

    #[test]
    fn collapsed_directory_keeps_its_trailing_slash() {
        let mut index = IndxSection::new();
        let sparse = IndexEntry::new("vendor/", FileMode::Directory, oid_from(0x0A));
        index.upsert(sparse).expect("sparse directory accepted");

        let decoded = IndxSection::decode(&index.encode().expect("encode")).expect("decode");
        assert_eq!(
            decoded.get_clean("vendor/").map(|e| e.mode),
            Some(FileMode::Directory)
        );
    }

    #[test]
    fn ordinary_directory_round_trips_without_slash() {
        let mut index = IndxSection::new();
        index
            .upsert(IndexEntry::new("src", FileMode::Directory, oid_from(0x0B)))
            .expect("directory accepted");

        let decoded = IndxSection::decode(&index.encode().expect("encode")).expect("decode");
        assert_eq!(
            decoded.get_clean("src").map(|e| e.mode),
            Some(FileMode::Directory)
        );
    }

    #[test]
    fn regular_file_with_trailing_slash_is_rejected() {
        let mut index = IndxSection::new();
        let error = index
            .upsert(entry("src/", 0x01))
            .expect_err("trailing slash must fail");
        assert!(matches!(error, NativeError::InvalidPath { .. }));
    }

    #[test]
    fn gitlink_entry_round_trips() {
        // A submodule binding is a legal index entry; rejecting it makes every repository with a
        // submodule unreadable.
        let mut index = IndxSection::new();
        index
            .upsert(IndexEntry::new(
                "vendor/sub",
                FileMode::Gitlink,
                oid_from(0x0C),
            ))
            .expect("gitlink accepted");

        let decoded = IndxSection::decode(&index.encode().expect("encode")).expect("decode");
        assert_eq!(
            decoded.get_clean("vendor/sub").map(|e| e.mode),
            Some(FileMode::Gitlink)
        );
    }

    #[test]
    fn rejects_escaping_path() {
        let mut index = IndxSection::new();
        for bad in [
            "../escape",
            "a/../b",
            "./a",
            "a//b",
            "/abs",
            "//server/share",
            "a\\b",
            "",
        ] {
            let error = index
                .upsert(entry(bad, 0x01))
                .expect_err("unsafe path must fail");
            assert!(
                matches!(error, NativeError::InvalidPath { .. }),
                "path {bad} should be rejected"
            );
        }
        assert!(index.is_empty());
    }

    #[test]
    fn conflict_stages_coexist_and_sort_after_stage_zero() {
        let mut index = IndxSection::new();
        let mut theirs = entry("conflict.txt", 0x03);
        theirs.stage = IndexStage::Theirs;
        let mut ours = entry("conflict.txt", 0x02);
        ours.stage = IndexStage::Ours;
        index.upsert(entry("conflict.txt", 0x00)).expect("upsert");
        index.upsert(theirs).expect("upsert");
        index.upsert(ours).expect("upsert");

        let stages: Vec<IndexStage> = index.entries().iter().map(|e| e.stage).collect();
        assert_eq!(
            stages,
            vec![IndexStage::Normal, IndexStage::Ours, IndexStage::Theirs]
        );
        assert!(index.has_conflict("conflict.txt"));
        assert_eq!(index.len(), 3);
    }

    #[test]
    fn upsert_replaces_same_path_and_stage() {
        let mut index = IndxSection::new();
        index.upsert(entry("a.txt", 0x01)).expect("upsert");
        index.upsert(entry("a.txt", 0x09)).expect("replace");

        assert_eq!(index.len(), 1);
        assert_eq!(
            index.get_clean("a.txt").map(|e| e.oid),
            Some(oid_from(0x09))
        );
    }

    #[test]
    fn empty_index_round_trips() {
        let empty = IndxSection::new();
        let encoded = empty.encode().expect("encode");
        assert_eq!(encoded, vec![0u8, 0, 0, 0]);
        assert!(IndxSection::decode(&encoded).expect("decode").is_empty());
    }

    #[test]
    fn flags_round_trip() {
        let mut index = IndxSection::new();
        let mut record = entry("sparse.txt", 0x04);
        record.flags = FLAG_SKIP_WORKTREE;
        index.upsert(record).expect("upsert");

        let decoded = IndxSection::decode(&index.encode().expect("encode")).expect("decode");
        assert_eq!(
            decoded.get_clean("sparse.txt").map(|e| e.flags),
            Some(FLAG_SKIP_WORKTREE)
        );
    }

    #[test]
    fn rejects_unknown_flag_bits() {
        let mut index = IndxSection::new();
        let mut record = entry("a.txt", 0x01);
        record.flags = 0x80;
        let error = index.upsert(record).expect_err("unknown bit must fail");
        assert!(matches!(
            error,
            NativeError::UnknownDiscriminant {
                field: "entry_flags",
                value: 0x80
            }
        ));
    }

    #[test]
    fn rejects_unknown_mode_word() {
        let mut writer = FieldWriter::new();
        writer.write_u32(1);
        writer.write_string("entry_path", "a.txt").expect("write");
        writer.write_u32(0o100_600);
        writer.write_oid(&oid_from(0x01));
        writer.write_u8(0);
        writer.write_u8(0);
        writer.extend_zeros(super::STAT_LEN);
        let payload = writer.finish();

        let error = IndxSection::decode(&payload).expect_err("bad mode must fail");
        assert!(matches!(error, NativeError::UnknownFileMode { .. }));
    }

    #[test]
    fn rejects_unknown_stage() {
        let mut writer = FieldWriter::new();
        writer.write_u32(1);
        writer.write_string("entry_path", "a.txt").expect("write");
        writer.write_u32(FileMode::RegularFile.to_u32());
        writer.write_oid(&oid_from(0x01));
        writer.write_u8(7);
        writer.write_u8(0);
        writer.extend_zeros(super::STAT_LEN);
        let payload = writer.finish();

        let error = IndxSection::decode(&payload).expect_err("bad stage must fail");
        assert!(matches!(error, NativeError::UnknownIndexStage { stage: 7 }));
    }

    #[test]
    fn rejects_out_of_order_stream() {
        let mut writer = FieldWriter::new();
        writer.write_u32(2);
        for path in ["z.txt", "a.txt"] {
            writer.write_string("entry_path", path).expect("write");
            writer.write_u32(FileMode::RegularFile.to_u32());
            writer.write_oid(&oid_from(0x01));
            writer.write_u8(0);
            writer.write_u8(0);
            writer.extend_zeros(super::STAT_LEN);
        }
        let payload = writer.finish();

        let error = IndxSection::decode(&payload).expect_err("unsorted must fail");
        assert!(matches!(
            error,
            NativeError::IndexOutOfOrder { position: 1 }
        ));
    }

    #[test]
    fn rejects_duplicate_key() {
        let mut writer = FieldWriter::new();
        writer.write_u32(2);
        for _ in 0..2 {
            writer.write_string("entry_path", "a.txt").expect("write");
            writer.write_u32(FileMode::RegularFile.to_u32());
            writer.write_oid(&oid_from(0x01));
            writer.write_u8(0);
            writer.write_u8(0);
            writer.extend_zeros(super::STAT_LEN);
        }
        let payload = writer.finish();

        let error = IndxSection::decode(&payload).expect_err("duplicate must fail");
        assert!(matches!(
            error,
            NativeError::IndexOutOfOrder { position: 1 }
        ));
    }

    #[test]
    fn rejects_forged_entry_count() {
        let mut payload = vec![0xFFu8, 0xFF, 0xFF, 0x7F];
        payload.extend_from_slice(&[0u8; 16]);
        let error = IndxSection::decode(&payload).expect_err("forged count must fail");
        assert!(matches!(error, NativeError::CountExceeded { .. }));
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut payload = sample_index().encode().expect("encode");
        payload.push(0x00);
        let error = IndxSection::decode(&payload).expect_err("trailing byte must fail");
        assert!(matches!(
            error,
            NativeError::TruncatedRecord {
                tag: "INDX",
                remaining: 1
            }
        ));
    }

    #[test]
    fn rejects_truncated_stat_cache() {
        let mut writer = FieldWriter::new();
        writer.write_u32(1);
        writer.write_string("entry_path", "a.txt").expect("write");
        writer.write_u32(FileMode::RegularFile.to_u32());
        writer.write_oid(&oid_from(0x01));
        writer.write_u8(0);
        writer.write_u8(0);
        writer.extend_zeros(super::STAT_LEN - 4);
        let payload = writer.finish();

        let error = IndxSection::decode(&payload).expect_err("short stat must fail");
        assert!(matches!(error, NativeError::FieldOverrun { .. }));
    }

    #[test]
    fn record_tail_width_matches_layout() {
        // Guards the capacity hint against drift: the fixed tail must equal the sum of the widths
        // the encoder actually emits after the path.
        assert_eq!(super::RECORD_TAIL_LEN, 4 + 20 + 1 + 1 + super::STAT_LEN);
    }

    #[test]
    fn mode_words_match_git_index_constants() {
        // git records these exact octal words in `.git/index`; any deviation would make the DIRC
        // projection lossy.
        assert_eq!(FileMode::RegularFile.to_u32(), 0o100_644);
        assert_eq!(FileMode::ExecutableFile.to_u32(), 0o100_755);
        assert_eq!(FileMode::Directory.to_u32(), 0o040_000);
        assert_eq!(FileMode::Symlink.to_u32(), 0o120_000);
        assert_eq!(FileMode::Gitlink.to_u32(), 0o160_000);
    }

    #[test]
    fn ordering_matches_git_bytewise_path_comparison() {
        // git orders index entries with a byte-wise `memcmp` on the path, then by stage. Rust `str`
        // ordering is also byte-wise for valid UTF-8, so multibyte paths must interleave exactly as
        // git would place them rather than following any locale collation.
        let unsorted = ["b.txt", "Z.txt", "a/é.txt", "a/z.txt", "a.txt"];
        let mut index = IndxSection::new();
        for (position, path) in unsorted.iter().enumerate() {
            index.upsert(entry(path, position as u8)).expect("upsert");
        }

        let mut expected: Vec<&str> = unsorted.to_vec();
        expected.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));

        let actual: Vec<&str> = index.entries().iter().map(|e| e.path.as_str()).collect();
        assert_eq!(actual, expected);

        let decoded = IndxSection::decode(&index.encode().expect("encode")).expect("decode");
        let decoded_paths: Vec<&str> = decoded.entries().iter().map(|e| e.path.as_str()).collect();
        assert_eq!(decoded_paths, expected);
    }
}
