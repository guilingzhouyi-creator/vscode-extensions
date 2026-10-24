//! Module: fg-index — Git Index (`.git/index`, DIRC) Reader
//! File Path: crates/fg-index/src/index_file.rs
//! Architecture Role: Decodes the staging index Git writes, so `ls-files` and `status` can compare
//!   against the same bytes Git itself reads. This is the compatibility projection's input; the
//!   Taxis-native staging state lives in the `INDX` section of `repo.txc`.
//! Dependencies & Triggers: Opened by `Repo::open` for a `.git` backend and by every read command
//!   that needs staged state.
//! Responsibilities: Parse and write versions 2, 3, and 4, including the v4 strip-length path
//!   compression, extended flags, the stat sidecar, the trailing extensions section, and the
//!   trailing SHA-1 checksum.
//! Exit Semantics & Design Rationale:
//!   - A version this build does not know is an error, never a best-effort parse. Index versions
//!     change how paths are stored; guessing produces plausible-looking entries under wrong paths,
//!     and a wrong path in a status report sends a user to edit the wrong file.
//!   - Paths are validated for traversal at decode time. `..` components and absolute paths are
//!     rejected here rather than at checkout, because checkout is where such an entry would gain
//!     write access outside the worktree.
//!   - The declared entry count is checked against the remaining bytes before allocation. A forged
//!     count would otherwise reserve gigabytes from a 40-byte file.
//!   - Entry padding is computed from the entry start, not from the path start. Getting that anchor
//!     wrong desynchronizes every entry after the first unpadded one, which happens to be every
//!     entry whose path length is not a multiple of eight.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileMode, IndexStage, Oid};
use sha1::{Digest, Sha1};

use crate::entry::StagingEntry;
use crate::index_tail::{extension_label, parse_extensions, read_u32, verify_checksum};

/// Opaque trailing extension record of an index file.
pub use crate::index_tail::IndexExtension;

/// Magic at the head of an index file, ASCII `DIRC`.
const INDEX_MAGIC: [u8; 4] = *b"DIRC";

/// Lowest index version this build reads.
const INDEX_VERSION_MIN: u32 = 2;

/// Highest index version this build reads.
const INDEX_VERSION_MAX: u32 = 4;

/// Byte length of the index header: magic, version, entry count.
pub(crate) const HEADER_LEN: usize = 12;

/// Byte length of the fixed per-entry fields before the path: ten `u32` stat words.
const STAT_FIELDS_LEN: usize = 40;

/// Byte width of an object id.
pub(crate) const OID_LEN: usize = 20;

/// Byte width of the flags word.
const FLAGS_LEN: usize = 2;

/// Byte width of the extended flags word present in versions 3 and 4.
const EXTENDED_FLAGS_LEN: usize = 2;

/// Alignment that every version 2 and 3 entry is padded to, counted from the entry start.
const ENTRY_ALIGNMENT: usize = 8;

/// Mask selecting the path length out of the flags word.
const FLAG_NAME_LEN_MASK: u16 = 0x0fff;

/// Flag bit marking that an extended flags word follows.
const FLAG_EXTENDED: u16 = 0x4000;

/// Flag bit marking the entry as assume-valid.
const FLAG_ASSUME_VALID: u16 = 0x8000;

/// Bit offset of the stage field inside the flags word.
const FLAG_STAGE_SHIFT: u16 = 12;

/// Mask selecting the two stage bits.
const FLAG_STAGE_MASK: u16 = 0x3000;

/// Ceiling on how many entries a single index may declare.
///
/// A million paths is far beyond any real repository; a larger count can only come from a corrupt
/// or forged header, and it is rejected before any buffer is sized from it.
const MAX_ENTRY_COUNT: u32 = 4 * 1024 * 1024;

/// Longest path the index may record, in bytes.
const MAX_PATH_LEN: usize = 4096;

/// A path length of `0xFFF` means the real length is stored as a trailing NUL-terminated string.
const NAME_LEN_ESCAPE: u32 = 0x0fff;

/// Lowest index version that can carry the extended flags word.
const INDEX_VERSION_EXTENDED: u32 = 3;

/// Extended flag bit marking an entry whose worktree file is intentionally absent.
const FLAG_SKIP_WORKTREE: u16 = 0x4000;

/// Extended flag bit marking an entry staged without a corresponding worktree file.
const FLAG_INTENT_TO_ADD: u16 = 0x2000;

/// Byte length of one extension record header: a four-byte signature and a big-endian length.
pub(crate) const EXTENSION_HEADER_LEN: usize = 8;

/// Smallest possible encoded entry: fixed fields, the flags word, one path byte, one terminator.
const MIN_ENTRY_LEN: usize = STAT_FIELDS_LEN + OID_LEN + FLAGS_LEN + 2;

/// One entry as it exists on disk, including the stat cache.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexEntry {
    /// Worktree-relative path using `/` separators.
    pub path: String,
    /// Kind of file recorded.
    pub mode: FileMode,
    /// Object the entry resolves to.
    pub oid: Oid,
    /// Merge stage the entry belongs to.
    pub stage: IndexStage,
    /// Cached `st_size` from the last hash.
    pub size: u32,
    /// Cached modification time, seconds since the epoch.
    pub mtime_seconds: u32,
    /// Cached modification time nanoseconds.
    pub mtime_nanos: u32,
    /// Whether the entry is marked assume-valid.
    pub assume_valid: bool,
    /// Whether the entry is marked skip-worktree.
    pub skip_worktree: bool,
    /// Whether the entry records an intent-to-add path.
    pub intent_to_add: bool,
}

impl IndexEntry {
    /// Projects the on-disk entry onto the in-memory staging type.
    pub fn to_staging_entry(&self) -> StagingEntry {
        StagingEntry::with_stage(self.path.clone(), self.mode, self.oid, self.stage)
    }
}

/// Worktree stat words of an index entry that Taxis does not otherwise stage.
///
/// Git records the inode change time, device, inode, owner, and group of each worktree file so a
/// later status can spot a clean entry without restatting. Taxis builds index entries in call sites
/// that never look at the filesystem, so those words travel beside the entry table in this sidecar
/// record. A sidecar left at its default writes zeros, which is what earlier Taxis releases always
/// wrote; a caller that does read a real stat supplies the words and a rewrite preserves them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct IndexStat {
    /// Inode change time, whole seconds since the Unix epoch.
    pub ctime_seconds: u32,
    /// Inode change time, nanoseconds within that second.
    pub ctime_nanos: u32,
    /// Device number of the filesystem holding the worktree file.
    pub dev: u32,
    /// Inode number of the worktree file within that filesystem.
    pub ino: u32,
    /// Owning user id.
    pub uid: u32,
    /// Owning group id.
    pub gid: u32,
}

/// A parsed Git index, including the fields a rewrite has to preserve.
#[derive(Debug, Clone)]
pub struct GitIndex {
    path: PathBuf,
    version: u32,
    entries: Vec<IndexEntry>,
    stats: Vec<IndexStat>,
    extensions: Vec<IndexExtension>,
}

impl GitIndex {
    /// Builds an in-memory index image; nothing is written until GitIndex::write runs.
    ///
    /// No stat sidecar and no extension records are attached: a write produces zeros for the words
    /// Taxis never observed and drops nothing, because nothing was read.
    pub fn new(path: impl Into<PathBuf>, version: u32, entries: Vec<IndexEntry>) -> Self {
        Self {
            path: path.into(),
            version,
            entries,
            stats: Vec::new(),
            extensions: Vec::new(),
        }
    }

    /// Attaches the stat sidecar and the trailing extension records used by GitIndex::write.
    ///
    /// The sidecar must stay empty or match the entry count one for one; an encoding request with
    /// any other length is rejected, so a parsed index is never silently truncated.
    #[must_use]
    pub fn with_metadata(mut self, stats: Vec<IndexStat>, extensions: Vec<IndexExtension>) -> Self {
        self.stats = stats;
        self.extensions = extensions;
        self
    }

    /// Loads the index at `path`.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] when the file cannot be read and
    /// [`FractalError::CorruptStore`] for a structural violation.
    pub fn load(path: impl Into<PathBuf>) -> FractalResult<Self> {
        let path = path.into();
        let bytes = fs::read(&path)?;
        Self::parse(bytes, path)
    }

    /// Parses an index already in memory.
    ///
    /// The trailing SHA-1 is verified first, so a truncated file, a file edited behind Git's back,
    /// or a stale copy is refused instead of being interpreted as a different staging state. Only
    /// the checksummed payload is decoded; the trailing extension records are kept verbatim.
    ///
    /// # Errors
    ///
    /// Returns FractalError::CorruptStore when the trailing SHA-1 does not match the payload, when
    /// the header is not a supported DIRC image, or when an entry or extension record cannot be
    /// decoded.
    pub fn parse(bytes: Vec<u8>, path: PathBuf) -> FractalResult<Self> {
        let payload_len = verify_checksum(&bytes, &path)?;
        let payload = &bytes[..payload_len];
        if payload.len() < HEADER_LEN {
            return Err(FractalError::CorruptStore(format!(
                "index '{}' is {} bytes, shorter than the {HEADER_LEN} byte header",
                path.display(),
                payload.len()
            )));
        }
        if payload[..INDEX_MAGIC.len()] != INDEX_MAGIC {
            return Err(FractalError::CorruptStore(format!(
                "index '{}' does not start with the DIRC magic",
                path.display()
            )));
        }
        let version = read_u32(payload, 4);
        if !(INDEX_VERSION_MIN..=INDEX_VERSION_MAX).contains(&version) {
            return Err(FractalError::CorruptStore(format!(
                "index '{}' declares unsupported version {version}",
                path.display()
            )));
        }
        let declared = read_u32(payload, 8);
        if declared > MAX_ENTRY_COUNT {
            return Err(FractalError::CorruptStore(format!(
                "index '{}' declares {declared} entries, above the {MAX_ENTRY_COUNT} entry limit",
                path.display()
            )));
        }
        let declared_len = declared as usize;
        let body_len = payload.len() - HEADER_LEN;
        if declared_len.saturating_mul(MIN_ENTRY_LEN) > body_len {
            return Err(FractalError::CorruptStore(format!(
                "index '{}' declares {declared} entries but only {body_len} bytes remain",
                path.display()
            )));
        }

        let mut entries = Vec::with_capacity(declared_len);
        let mut stats = Vec::with_capacity(declared_len);
        let mut cursor = HEADER_LEN;
        let mut previous_path = String::new();
        for ordinal in 0..declared_len {
            let (entry, stat, after_path) = parse_entry(payload, cursor, version, &previous_path)
                .map_err(|detail| {
                FractalError::CorruptStore(format!(
                    "index '{}' entry {ordinal} at byte {cursor}: {detail}",
                    path.display()
                ))
            })?;
            // Version 4 is the only supported layout that compresses against the previous path.
            if version == INDEX_VERSION_MAX {
                previous_path.clear();
                previous_path.push_str(&entry.path);
            }
            entries.push(entry);
            stats.push(stat);
            cursor = after_path;
        }
        if cursor > payload.len() {
            return Err(FractalError::CorruptStore(format!(
                "index '{}' entry table overruns the checksummed payload at byte {cursor}",
                path.display()
            )));
        }
        let extensions = parse_extensions(payload, cursor, &path)?;
        Ok(Self {
            path,
            version,
            entries,
            stats,
            extensions,
        })
    }

    /// Path this index was loaded from.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Index format version that was parsed.
    pub fn version(&self) -> u32 {
        self.version
    }

    /// Number of entries the index holds.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the index holds no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// All entries, in stored (path, stage) order.
    pub fn entries(&self) -> &[IndexEntry] {
        &self.entries
    }

    /// Entries that belong to the requested merge stage.
    pub fn entries_at_stage(&self, stage: IndexStage) -> impl Iterator<Item = &IndexEntry> {
        self.entries
            .iter()
            .filter(move |entry| entry.stage == stage)
    }

    /// Paths that appear in more than one stage, i.e. unresolved conflicts.
    pub fn conflicted_paths(&self) -> Vec<String> {
        let mut conflicted: Vec<String> = Vec::new();
        for entry in &self.entries {
            if entry.stage == IndexStage::Normal {
                continue;
            }
            if conflicted.last().map(String::as_str) != Some(entry.path.as_str()) {
                conflicted.push(entry.path.clone());
            }
        }
        conflicted
    }

    /// The stat sidecar, aligned one to one with entries when it is not empty.
    pub fn stats(&self) -> &[IndexStat] {
        &self.stats
    }

    /// The trailing extension records, in file order.
    pub fn extensions(&self) -> &[IndexExtension] {
        &self.extensions
    }

    /// Writes this index to path in the version 2 on-disk format.
    ///
    /// The stat sidecar and the trailing extension records are not encoded here; use
    /// GitIndex::write to rewrite the file this value came from without losing them.
    ///
    /// # Errors
    ///
    /// Propagates write_dirc_v2 failures.
    pub fn write_to(&self, path: &Path) -> FractalResult<()> {
        write_dirc_v2(path, &self.entries)
    }

    /// Encodes this index with its parsed version, stat sidecar, and extension records.
    ///
    /// # Errors
    ///
    /// Returns FractalError::CorruptStore when the version is unsupported, the sidecar length does
    /// not match the entry table, an entry path is invalid, or an extended flag cannot be encoded.
    pub fn encode(&self) -> FractalResult<Vec<u8>> {
        encode_index(self.version, &self.entries, &self.stats, &self.extensions)
    }

    /// Rewrites the index file this value was loaded from, preserving everything it recorded.
    ///
    /// The image keeps the parsed version, the ctime, device, inode, owner, and group words, and the
    /// trailing extension records, so a parse and write round-trip does not silently downgrade the
    /// index. The write takes the index lock, syncs the lock file, and renames it over the index,
    /// the same sequence Git uses, so a concurrent Git command sees either the old file or the new
    /// one and never a truncated mix.
    ///
    /// # Errors
    ///
    /// Returns FractalError::Io with an io error whose kind is AlreadyExists when another writer
    /// holds the index lock, and propagates encoding and IO failures.
    pub fn write(&self) -> FractalResult<()> {
        let bytes = self.encode()?;
        write_index_file(&self.path, &bytes)
    }
}

/// Encodes entries into a complete Git DIRC byte buffer, including the trailing SHA-1.
///
/// This is the compatibility entry point used by the plumbing commands. It has no stat sidecar to
/// encode, so the ctime, device, inode, owner, and group words are zero; the header declares
/// version 3 whenever an entry carries skip-worktree or intent-to-add, matching the upgrade Git
/// performs itself, because version 2 has no extended flags word.
///
/// Entries should be pre-sorted by (path, stage) ascending, which is Git's invariant.
///
/// # Errors
///
/// Returns FractalError::CorruptStore if any entry path is invalid.
pub fn encode_dirc_v2(entries: &[IndexEntry]) -> FractalResult<Vec<u8>> {
    let extended = entries
        .iter()
        .any(|entry| entry.skip_worktree || entry.intent_to_add);
    let version = if extended {
        INDEX_VERSION_EXTENDED
    } else {
        INDEX_VERSION_MIN
    };
    encode_index(version, entries, &[], &[])
}

/// Writes entries into path as a DIRC index under the index lock.
///
/// # Errors
///
/// Returns FractalError::Io when the index lock is already held or the file cannot be written, and
/// FractalError::CorruptStore for invalid entries.
pub fn write_dirc_v2(path: &Path, entries: &[IndexEntry]) -> FractalResult<()> {
    let bytes = encode_dirc_v2(entries)?;
    write_index_file(path, &bytes)
}

/// Encodes a complete DIRC image: header, entry table, extension records, trailing checksum.
fn encode_index(
    version: u32,
    entries: &[IndexEntry],
    stats: &[IndexStat],
    extensions: &[IndexExtension],
) -> FractalResult<Vec<u8>> {
    if !(INDEX_VERSION_MIN..=INDEX_VERSION_MAX).contains(&version) {
        return Err(FractalError::CorruptStore(format!(
            "cannot encode index version {version}; this build writes {INDEX_VERSION_MIN} to {INDEX_VERSION_MAX}"
        )));
    }
    if entries.len() > MAX_ENTRY_COUNT as usize {
        return Err(FractalError::CorruptStore(format!(
            "cannot encode {} entries, above the {MAX_ENTRY_COUNT} entry limit",
            entries.len()
        )));
    }
    if !stats.is_empty() && stats.len() != entries.len() {
        return Err(FractalError::CorruptStore(format!(
            "index stat sidecar has {} records for {} entries",
            stats.len(),
            entries.len()
        )));
    }
    let zero_stats = IndexStat::default();
    let mut buffer = Vec::with_capacity(HEADER_LEN + entries.len() * 80 + OID_LEN);
    buffer.extend_from_slice(&INDEX_MAGIC);
    buffer.extend_from_slice(&version.to_be_bytes());
    buffer.extend_from_slice(&(entries.len() as u32).to_be_bytes());

    let mut previous_path = String::new();
    for (ordinal, entry) in entries.iter().enumerate() {
        validate_path(&entry.path).map_err(|path_err| {
            FractalError::CorruptStore(format!(
                "index entry path '{}' is invalid: {path_err}",
                entry.path
            ))
        })?;
        if entry.path.len() > MAX_PATH_LEN {
            return Err(FractalError::CorruptStore(format!(
                "index entry path is longer than {MAX_PATH_LEN} bytes"
            )));
        }
        let stat = stats.get(ordinal).unwrap_or(&zero_stats);
        let extended = entry.skip_worktree || entry.intent_to_add;
        if extended && version < INDEX_VERSION_EXTENDED {
            return Err(FractalError::CorruptStore(format!(
                "index version {version} cannot record skip-worktree or intent-to-add for '{}'",
                entry.path
            )));
        }
        write_entry(&mut buffer, version, entry, stat, extended, &previous_path);
        // Version 4 is the only supported layout that compresses against the previous path.
        if version == INDEX_VERSION_MAX {
            previous_path.clear();
            previous_path.push_str(&entry.path);
        }
    }

    for extension in extensions {
        let length = u32::try_from(extension.data.len()).map_err(|_| {
            FractalError::CorruptStore(format!(
                "extension '{}' payload exceeds the 32-bit length field",
                extension_label(&extension.signature)
            ))
        })?;
        buffer.extend_from_slice(&extension.signature);
        buffer.extend_from_slice(&length.to_be_bytes());
        buffer.extend_from_slice(&extension.data);
    }

    append_checksum(&mut buffer);
    Ok(buffer)
}

/// Appends one encoded entry, honouring the version's path layout and extended flags word.
fn write_entry(
    buffer: &mut Vec<u8>,
    version: u32,
    entry: &IndexEntry,
    stat: &IndexStat,
    extended: bool,
    previous_path: &str,
) {
    let entry_start = buffer.len();
    buffer.extend_from_slice(&stat.ctime_seconds.to_be_bytes());
    buffer.extend_from_slice(&stat.ctime_nanos.to_be_bytes());
    buffer.extend_from_slice(&entry.mtime_seconds.to_be_bytes());
    buffer.extend_from_slice(&entry.mtime_nanos.to_be_bytes());
    buffer.extend_from_slice(&stat.dev.to_be_bytes());
    buffer.extend_from_slice(&stat.ino.to_be_bytes());
    buffer.extend_from_slice(&entry.mode.to_u32().to_be_bytes());
    buffer.extend_from_slice(&stat.uid.to_be_bytes());
    buffer.extend_from_slice(&stat.gid.to_be_bytes());
    buffer.extend_from_slice(&entry.size.to_be_bytes());
    buffer.extend_from_slice(entry.oid.as_bytes());

    let name_len = entry.path.len().min(usize::from(FLAG_NAME_LEN_MASK)) as u16;
    let stage_bits = (entry.stage.to_u8() as u16) << FLAG_STAGE_SHIFT;
    let mut flags = stage_bits | name_len;
    if entry.assume_valid {
        flags |= FLAG_ASSUME_VALID;
    }
    if extended {
        flags |= FLAG_EXTENDED;
    }
    buffer.extend_from_slice(&flags.to_be_bytes());
    if extended {
        let mut extended_flags = 0u16;
        if entry.skip_worktree {
            extended_flags |= FLAG_SKIP_WORKTREE;
        }
        if entry.intent_to_add {
            extended_flags |= FLAG_INTENT_TO_ADD;
        }
        buffer.extend_from_slice(&extended_flags.to_be_bytes());
    }

    if version == INDEX_VERSION_MAX {
        let common = common_prefix_len(previous_path, &entry.path);
        let strip = previous_path.len() - common;
        buffer.extend_from_slice(&encode_offset_varint(strip as u64));
        buffer.extend_from_slice(&entry.path.as_bytes()[common..]);
        buffer.push(0);
    } else {
        buffer.extend_from_slice(entry.path.as_bytes());
        buffer.push(0);
        let consumed = buffer.len() - entry_start;
        let padded = align_up(consumed, ENTRY_ALIGNMENT);
        buffer.resize(entry_start + padded, 0);
    }
}

/// Length in bytes of the common prefix of two index paths, kept on UTF-8 boundaries.
fn common_prefix_len(left: &str, right: &str) -> usize {
    let mut common = left
        .bytes()
        .zip(right.bytes())
        .take_while(|(left_byte, right_byte)| left_byte == right_byte)
        .count();
    while common > 0 && !(left.is_char_boundary(common) && right.is_char_boundary(common)) {
        common -= 1;
    }
    common
}

/// Encodes a version 4 path strip count; the exact inverse of read_offset_varint.
fn encode_offset_varint(mut value: u64) -> Vec<u8> {
    let mut encoded = vec![(value & 0x7f) as u8];
    value >>= 7;
    while value != 0 {
        value -= 1;
        encoded.insert(0, 0x80 | (value & 0x7f) as u8);
        value >>= 7;
    }
    encoded
}

/// Appends the trailing SHA-1 of everything written so far.
fn append_checksum(buffer: &mut Vec<u8>) {
    let mut hasher = Sha1::new();
    hasher.update(&buffer[..]);
    let checksum: [u8; OID_LEN] = hasher.finalize().into();
    buffer.extend_from_slice(&checksum);
}

/// Writes an index image under the index lock and renames it into place.
fn write_index_file(path: &Path, bytes: &[u8]) -> FractalResult<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let lock_path = index_lock_path(path);
    let mut lock_file = open_index_lock(&lock_path)?;
    let written = lock_file
        .write_all(bytes)
        .and_then(|()| lock_file.sync_all());
    drop(lock_file);
    if let Err(error) = written {
        let _ = fs::remove_file(&lock_path);
        return Err(FractalError::Io(error));
    }
    if let Err(error) = fs::rename(&lock_path, path) {
        let _ = fs::remove_file(&lock_path);
        return Err(FractalError::Io(error));
    }
    Ok(())
}

/// Returns the lock path Git uses for an index file: the index path plus the suffix .lock.
fn index_lock_path(path: &Path) -> PathBuf {
    let mut lock_name = path.as_os_str().to_os_string();
    lock_name.push(".lock");
    PathBuf::from(lock_name)
}

/// Creates the index lock exclusively, reporting an already-held lock as AlreadyExists.
fn open_index_lock(lock_path: &Path) -> FractalResult<std::fs::File> {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock_path)
    {
        Ok(file) => Ok(file),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            Err(FractalError::Io(std::io::Error::new(
                ErrorKind::AlreadyExists,
                format!(
                    "unable to create index lock '{}': already held by another writer",
                    lock_path.display()
                ),
            )))
        }
        Err(error) => Err(FractalError::Io(error)),
    }
}

/// Parses one entry, returning it, its stat sidecar record, and the cursor of the next entry.
fn parse_entry(
    bytes: &[u8],
    start: usize,
    version: u32,
    previous_path: &str,
) -> Result<(IndexEntry, IndexStat, usize), String> {
    let stat_end = start
        .checked_add(STAT_FIELDS_LEN)
        .ok_or_else(|| "entry start overflows usize".to_string())?;
    if stat_end + OID_LEN + FLAGS_LEN > bytes.len() {
        return Err("entry is truncated inside its fixed fields".to_string());
    }

    let stat = IndexStat {
        ctime_seconds: read_u32(bytes, start),
        ctime_nanos: read_u32(bytes, start + 4),
        dev: read_u32(bytes, start + 16),
        ino: read_u32(bytes, start + 20),
        uid: read_u32(bytes, start + 28),
        gid: read_u32(bytes, start + 32),
    };
    let mtime_seconds = read_u32(bytes, start + 8);
    let mtime_nanos = read_u32(bytes, start + 12);
    let mode_word = read_u32(bytes, start + 24);
    let size = read_u32(bytes, start + 36);
    let mode = FileMode::from_u32(mode_word)
        .map_err(|_| format!("unsupported file mode {mode_word:#o}"))?;

    let mut raw_oid = [0u8; OID_LEN];
    raw_oid.copy_from_slice(&bytes[stat_end..stat_end + OID_LEN]);
    let oid = Oid::from_bytes(raw_oid);

    let flags = u16::from_be_bytes([bytes[stat_end + OID_LEN], bytes[stat_end + OID_LEN + 1]]);
    let stage = decode_stage(flags)?;
    let mut cursor = stat_end + OID_LEN + FLAGS_LEN;

    let mut extended = 0u16;
    if version >= INDEX_VERSION_EXTENDED && flags & FLAG_EXTENDED != 0 {
        if cursor + EXTENDED_FLAGS_LEN > bytes.len() {
            return Err("entry is truncated inside its extended flags".to_string());
        }
        extended = u16::from_be_bytes([bytes[cursor], bytes[cursor + 1]]);
        cursor += EXTENDED_FLAGS_LEN;
    }

    let (path, after_path) = if version == INDEX_VERSION_MAX {
        read_v4_path(bytes, cursor, previous_path)?
    } else {
        read_v2_path(bytes, cursor, start, flags)?
    };

    if path.is_empty() {
        return Err("entry records an empty path".to_string());
    }
    if path.len() > MAX_PATH_LEN {
        return Err(format!("entry path is longer than {MAX_PATH_LEN} bytes"));
    }
    validate_path(&path)?;

    Ok((
        IndexEntry {
            path,
            mode,
            oid,
            stage,
            size,
            mtime_seconds,
            mtime_nanos,
            assume_valid: flags & FLAG_ASSUME_VALID != 0,
            skip_worktree: extended & FLAG_SKIP_WORKTREE != 0,
            intent_to_add: extended & FLAG_INTENT_TO_ADD != 0,
        },
        stat,
        after_path,
    ))
}

/// Decodes the two stage bits into a closed enum.
fn decode_stage(flags: u16) -> Result<IndexStage, String> {
    match (flags & FLAG_STAGE_MASK) >> FLAG_STAGE_SHIFT {
        0 => Ok(IndexStage::Normal),
        1 => Ok(IndexStage::Base),
        2 => Ok(IndexStage::Ours),
        3 => Ok(IndexStage::Theirs),
        other => Err(format!("index entry declares stage {other}, outside 0..=3")),
    }
}

/// Reads a version 2 or 3 path: NUL-terminated, then padded to 8 bytes from the entry start.
///
/// The terminator counts toward the padded length. Git computes the entry size as
/// `(62 + namelen + 8) & ~7`, which is the same as rounding `62 + namelen + 1` up to a multiple of
/// eight. Rounding `62 + namelen` instead is eight bytes short whenever that sum is already a
/// multiple of eight, and every following entry then reads from the wrong offset. The failure only
/// appears on paths whose length makes the sum a multiple of eight, which is why a short fixture can
/// pass while a real index desynchronizes several hundred entries in.
fn read_v2_path(
    bytes: &[u8],
    cursor: usize,
    entry_start: usize,
    flags: u16,
) -> Result<(String, usize), String> {
    let declared_len = u32::from(flags & FLAG_NAME_LEN_MASK);
    let (raw_end, after_nul) = if declared_len == NAME_LEN_ESCAPE {
        let terminator = bytes
            .get(cursor..)
            .and_then(|rest| rest.iter().position(|byte| *byte == 0))
            .ok_or_else(|| "path has no NUL terminator".to_string())?;
        (cursor + terminator, cursor + terminator + 1)
    } else {
        let end = cursor + declared_len as usize;
        if end >= bytes.len() {
            return Err(format!(
                "declared path length {declared_len} runs past the file"
            ));
        }
        if bytes[end] != 0 {
            return Err(format!(
                "declared path length {declared_len} is not followed by a NUL terminator"
            ));
        }
        (end, end + 1)
    };

    let path = std::str::from_utf8(&bytes[cursor..raw_end])
        .map_err(|utf_err| format!("path is not UTF-8: {utf_err}"))?
        .to_string();

    let consumed = after_nul - entry_start;
    Ok((path, entry_start + align_up(consumed, ENTRY_ALIGNMENT)))
}

/// Reads a version 4 path: a strip count, then the shared suffix as a NUL-terminated string.
///
/// The varint counts how many bytes to drop from the end of the previous path; the remaining prefix
/// plus the suffix is the path. A larger count means a longer shared prefix, which is how Git keeps
/// adjacent paths compact. Version 4 entries are not padded, so the next entry starts right after
/// the terminator.
fn read_v4_path(
    bytes: &[u8],
    cursor: usize,
    previous_path: &str,
) -> Result<(String, usize), String> {
    let (strip_len, consumed) = read_offset_varint(bytes, cursor)?;
    let suffix_start = cursor + consumed;
    let terminator = bytes
        .get(suffix_start..)
        .and_then(|rest| rest.iter().position(|byte| *byte == 0))
        .ok_or_else(|| "version 4 path suffix has no NUL terminator".to_string())?;
    let suffix_end = suffix_start + terminator;

    let strip = usize::try_from(strip_len)
        .map_err(|_| "version 4 strip count does not fit this platform".to_string())?;
    if strip > previous_path.len() {
        return Err(format!(
            "version 4 entry strips {strip} bytes from a {}-byte previous path",
            previous_path.len()
        ));
    }
    let prefix_end = previous_path.len() - strip;
    if !previous_path.is_char_boundary(prefix_end) {
        return Err(format!(
            "version 4 entry strips {strip} bytes, splitting a UTF-8 sequence"
        ));
    }
    let suffix = std::str::from_utf8(&bytes[suffix_start..suffix_end])
        .map_err(|utf_err| format!("path suffix is not UTF-8: {utf_err}"))?;

    let mut path = String::with_capacity(prefix_end + suffix.len());
    path.push_str(&previous_path[..prefix_end]);
    path.push_str(suffix);
    Ok((path, suffix_end + 1))
}

/// Reads the version 4 prefix-length varint (same shape as a pack offset varint).
fn read_offset_varint(bytes: &[u8], start: usize) -> Result<(u64, usize), String> {
    let mut byte = *bytes
        .get(start)
        .ok_or_else(|| "version 4 prefix varint is missing".to_string())?;
    let mut cursor = start + 1;
    let mut value = u64::from(byte & 0x7f);
    while byte & 0x80 != 0 {
        byte = *bytes
            .get(cursor)
            .ok_or_else(|| "version 4 prefix varint is truncated".to_string())?;
        cursor += 1;
        value = value
            .checked_add(1)
            .and_then(|current| current.checked_shl(7))
            .map(|current| current | u64::from(byte & 0x7f))
            .ok_or_else(|| "version 4 prefix varint overflows u64".to_string())?;
    }
    Ok((value, cursor - start))
}

/// Rejects paths that would escape the worktree if materialized.
fn validate_path(path: &str) -> Result<(), String> {
    if path.starts_with('/') || path.starts_with('\\') {
        return Err(format!("path '{path}' is absolute"));
    }
    if path.contains('\\') {
        return Err(format!(
            "path '{path}' uses a backslash; the index stores '/' separators"
        ));
    }
    for component in path.split('/') {
        if component == ".." {
            return Err(format!("path '{path}' contains a '..' component"));
        }
        if component.is_empty() && !path.ends_with('/') {
            return Err(format!("path '{path}' contains an empty component"));
        }
    }
    if path.contains('\0') {
        return Err("path contains an interior NUL".to_string());
    }
    Ok(())
}

/// Rounds `value` up to the next multiple of `alignment`.
fn align_up(value: usize, alignment: usize) -> usize {
    let remainder = value % alignment;
    if remainder == 0 {
        value
    } else {
        value + (alignment - remainder)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        align_up, append_checksum, encode_dirc_v2, validate_path, GitIndex, IndexEntry,
        IndexExtension, IndexStat, HEADER_LEN, INDEX_MAGIC,
    };
    use fg_core::models::{FileMode, IndexStage, Oid};
    use std::path::PathBuf;

    /// Builds a version 2 index with one entry at `path` with `oid`.
    fn version_two_index(path: &str, oid: Oid) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&INDEX_MAGIC);
        out.extend_from_slice(&2u32.to_be_bytes());
        out.extend_from_slice(&1u32.to_be_bytes());
        for _ in 0..10 {
            out.extend_from_slice(&0u32.to_be_bytes());
        }
        // Patch the fields the reader inspects: mtime seconds, mode, size.
        let entry_start = HEADER_LEN;
        out[entry_start + 8..entry_start + 12].copy_from_slice(&1_700_000_000u32.to_be_bytes());
        out[entry_start + 24..entry_start + 28].copy_from_slice(&0o100_644u32.to_be_bytes());
        out[entry_start + 36..entry_start + 40].copy_from_slice(&42u32.to_be_bytes());
        out.extend_from_slice(oid.as_bytes());
        out.extend_from_slice(&((path.len() as u16) & 0x0fff).to_be_bytes());
        out.extend_from_slice(path.as_bytes());
        // The NUL terminator counts toward the padded length, exactly as Git computes it.
        out.push(0);
        let consumed = out.len() - entry_start;
        out.resize(entry_start + align_up(consumed, 8), 0);
        append_checksum(&mut out);
        out
    }

    /// Recomputes the trailing SHA-1 of an edited fixture so a test reaches the guard it targets.
    fn reseal(mut bytes: Vec<u8>) -> Vec<u8> {
        bytes.truncate(bytes.len() - 20);
        append_checksum(&mut bytes);
        bytes
    }

    /// Builds one stage-0 regular-file entry with the given path and object id seed.
    fn sample_entry(path: &str, seed: u8) -> IndexEntry {
        IndexEntry {
            path: path.to_string(),
            mode: FileMode::RegularFile,
            oid: Oid::from_bytes([seed; 20]),
            stage: IndexStage::Normal,
            size: 12,
            mtime_seconds: 1_700_000_000,
            mtime_nanos: 0,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        }
    }

    #[test]
    fn reads_a_single_regular_file_entry() {
        let oid = Oid::from_bytes([0x2a; 20]);
        let bytes = version_two_index("src/main.rs", oid);
        let index = GitIndex::parse(bytes, PathBuf::from("index")).expect("parse");
        assert_eq!(index.version(), 2);
        assert_eq!(index.len(), 1);
        let entry = &index.entries()[0];
        assert_eq!(entry.path, "src/main.rs");
        assert_eq!(entry.mode, FileMode::RegularFile);
        assert_eq!(entry.oid, oid);
        assert_eq!(entry.stage, IndexStage::Normal);
        assert_eq!(entry.size, 42);
        assert_eq!(entry.mtime_seconds, 1_700_000_000);
    }

    #[test]
    fn rejects_a_file_without_the_dirc_magic() {
        let mut bytes = version_two_index("a.txt", Oid::ZERO);
        bytes[..4].copy_from_slice(b"XXXX");
        assert!(GitIndex::parse(bytes, PathBuf::from("index")).is_err());
    }

    #[test]
    fn rejects_an_unknown_index_version() {
        let mut bytes = version_two_index("a.txt", Oid::ZERO);
        bytes[4..8].copy_from_slice(&7u32.to_be_bytes());
        assert!(GitIndex::parse(reseal(bytes), PathBuf::from("index")).is_err());
    }

    #[test]
    fn rejects_a_forged_entry_count() {
        let mut bytes = version_two_index("a.txt", Oid::ZERO);
        bytes[8..12].copy_from_slice(&0xffff_ffffu32.to_be_bytes());
        assert!(GitIndex::parse(reseal(bytes), PathBuf::from("index")).is_err());
    }

    #[test]
    fn rejects_a_truncated_entry() {
        let bytes = version_two_index("a.txt", Oid::ZERO);
        let truncated = bytes[..HEADER_LEN + 10].to_vec();
        assert!(GitIndex::parse(truncated, PathBuf::from("index")).is_err());
    }

    #[test]
    fn reports_conflicted_paths_that_occupy_several_stages() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&INDEX_MAGIC);
        bytes.extend_from_slice(&2u32.to_be_bytes());
        bytes.extend_from_slice(&2u32.to_be_bytes());
        for stage_word in [1u16, 2u16] {
            let entry_start = bytes.len();
            for _ in 0..10 {
                bytes.extend_from_slice(&0u32.to_be_bytes());
            }
            bytes[entry_start + 24..entry_start + 28].copy_from_slice(&0o100_644u32.to_be_bytes());
            bytes.extend_from_slice(&[0x11u8; 20]);
            bytes.extend_from_slice(&((3u16 | (stage_word << 12)) & 0x3fff).to_be_bytes());
            bytes.extend_from_slice(b"a.c");
            bytes.push(0);
            let consumed = bytes.len() - entry_start;
            bytes.resize(entry_start + align_up(consumed, 8), 0);
        }
        append_checksum(&mut bytes);
        let index = GitIndex::parse(bytes, PathBuf::from("index")).expect("parse");
        assert_eq!(index.conflicted_paths(), vec!["a.c".to_string()]);
        assert_eq!(index.entries_at_stage(IndexStage::Base).count(), 1);
        assert_eq!(index.entries_at_stage(IndexStage::Ours).count(), 1);
    }

    #[test]
    fn rejects_a_path_that_escapes_the_worktree() {
        assert!(validate_path("../../etc/passwd").is_err());
        assert!(validate_path("/etc/passwd").is_err());
        assert!(validate_path("src/../out.txt").is_err());
        assert!(validate_path("src\\main.rs").is_err());
    }

    #[test]
    fn accepts_ordinary_relative_paths() {
        assert!(validate_path("src/main.rs").is_ok());
        assert!(validate_path("a b/c-d_e.txt").is_ok());
    }

    #[test]
    fn aligns_from_the_entry_start() {
        assert_eq!(align_up(62, 8), 64);
        assert_eq!(align_up(64, 8), 64);
        assert_eq!(align_up(1, 8), 8);
    }

    #[test]
    fn roundtrip_encode_and_parse_matches_entries() {
        let entries = vec![
            IndexEntry {
                path: "README.md".to_string(),
                mode: FileMode::RegularFile,
                oid: Oid::from_bytes([0x12; 20]),
                stage: IndexStage::Normal,
                size: 1024,
                mtime_seconds: 1_700_000_100,
                mtime_nanos: 0,
                assume_valid: false,
                skip_worktree: false,
                intent_to_add: false,
            },
            IndexEntry {
                path: "scripts/run.sh".to_string(),
                mode: FileMode::ExecutableFile,
                oid: Oid::from_bytes([0x34; 20]),
                stage: IndexStage::Normal,
                size: 256,
                mtime_seconds: 1_700_000_200,
                mtime_nanos: 0,
                assume_valid: false,
                skip_worktree: false,
                intent_to_add: false,
            },
        ];

        let bytes = encode_dirc_v2(&entries).expect("encode");
        let parsed = GitIndex::parse(bytes, PathBuf::from("index")).expect("parse");
        assert_eq!(parsed.version(), 2);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed.entries()[0].path, "README.md");
        assert_eq!(parsed.entries()[0].mode, FileMode::RegularFile);
        assert_eq!(parsed.entries()[0].oid, Oid::from_bytes([0x12; 20]));
        assert_eq!(parsed.entries()[0].size, 1024);
        assert_eq!(parsed.entries()[1].path, "scripts/run.sh");
        assert_eq!(parsed.entries()[1].mode, FileMode::ExecutableFile);
        assert_eq!(parsed.entries()[1].oid, Oid::from_bytes([0x34; 20]));
        assert_eq!(parsed.entries()[1].size, 256);
    }

    #[test]
    fn roundtrip_preserves_the_stat_sidecar() {
        let entries = vec![sample_entry("src/main.rs", 0x2a)];
        let stats = vec![IndexStat {
            ctime_seconds: 1_700_000_500,
            ctime_nanos: 123_456_789,
            dev: 0x0102_0304,
            ino: 0x0a0b_0c0d,
            uid: 1000,
            gid: 1000,
        }];
        let bytes = GitIndex::new(PathBuf::from("index"), 2, entries)
            .with_metadata(stats.clone(), Vec::new())
            .encode()
            .expect("encode");
        let parsed = GitIndex::parse(bytes.clone(), PathBuf::from("index")).expect("parse");
        assert_eq!(parsed.stats(), stats.as_slice());
        assert_eq!(parsed.encode().expect("re-encode"), bytes);
    }

    #[test]
    fn roundtrip_preserves_unknown_extensions() {
        let entries = vec![sample_entry("a.txt", 1), sample_entry("b.txt", 2)];
        let extensions = vec![
            IndexExtension {
                signature: *b"TREE",
                data: vec![9, 8, 7],
            },
            IndexExtension {
                signature: *b"UNTR",
                data: Vec::new(),
            },
        ];
        let bytes = GitIndex::new(PathBuf::from("index"), 2, entries)
            .with_metadata(Vec::new(), extensions.clone())
            .encode()
            .expect("encode");
        let parsed = GitIndex::parse(bytes.clone(), PathBuf::from("index")).expect("parse");
        assert_eq!(parsed.extensions(), extensions.as_slice());
        assert_eq!(parsed.encode().expect("re-encode"), bytes);
    }

    #[test]
    fn version_four_roundtrip_reconstructs_shared_prefixes() {
        let entries = vec![
            sample_entry("src/alpha.rs", 1),
            sample_entry("src/alphabeta.rs", 2),
            sample_entry("src/beta.rs", 3),
        ];
        let bytes = GitIndex::new(PathBuf::from("index"), 4, entries.clone())
            .encode()
            .expect("encode");
        let parsed = GitIndex::parse(bytes, PathBuf::from("index")).expect("parse");
        assert_eq!(parsed.version(), 4);
        assert_eq!(parsed.entries(), entries.as_slice());
    }

    #[test]
    fn writing_a_skip_worktree_entry_upgrades_to_version_three() {
        let mut entry = sample_entry("a.txt", 4);
        entry.skip_worktree = true;
        let bytes = encode_dirc_v2(std::slice::from_ref(&entry)).expect("encode");
        let parsed = GitIndex::parse(bytes, PathBuf::from("index")).expect("parse");
        assert_eq!(parsed.version(), 3);
        assert!(parsed.entries()[0].skip_worktree);
    }

    #[test]
    fn rejects_a_tampered_trailing_checksum() {
        let mut bytes = encode_dirc_v2(&[sample_entry("a.txt", 1)]).expect("encode");
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        let error = GitIndex::parse(bytes, PathBuf::from("index")).expect_err("tampered checksum");
        assert!(
            error.to_string().contains("checksum mismatch"),
            "expected a checksum diagnostic, got: {error}"
        );
    }
}
