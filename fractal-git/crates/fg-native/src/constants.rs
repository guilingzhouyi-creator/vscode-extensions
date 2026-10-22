//! Module: fg-native — TAXC Physical Format Constants
//! File Path: crates/fg-native/src/constants.rs
//! Architecture Role: Single source of truth for every TAXC magic number, width, and ceiling.
//! Dependencies & Triggers: Consumed by container.rs, section codecs, and `taxis doctor`.
//! Responsibilities: Declare header/trailer geometry, alignment, version, and structural ceilings
//!   so that no codec re-derives a width or a magic literal.
//! Exit Semantics & Design Rationale:
//!   - Every constant carries the physical reason it holds that value; widths are dictated by the
//!     on-disk layout in the approved plan (§14.3.2), not by implementation convenience.
//!   - Ceilings exist to bound allocation from untrusted input: a forged `section_cnt` must be
//!     rejected before any buffer is sized from it.

/// Container magic, ASCII `TAXC`, written as four literal bytes.
pub const TAXC_MAGIC: [u8; 4] = *b"TAXC";

/// Container magic interpreted as the little-endian word produced by reading those four bytes.
///
/// The magic is stored as literal ASCII (`54 41 58 43` on disk). All integer fields in this format
/// are little-endian, and the magic is compared through the same little-endian reader, so the
/// comparison word must be built with `from_le_bytes`; using `from_be_bytes` here would reject
/// every container this writer produces.
pub const TAXC_MAGIC_WORD: u32 = u32::from_le_bytes(TAXC_MAGIC);

/// Format version understood by this build.
pub const TAXC_FORMAT_VERSION: u16 = 1;

/// Byte length of the container header.
pub const HEADER_LEN: usize = 24;

/// Byte length of one section-table entry.
///
/// Widths are dictated by the fields themselves: `tag` (4) + `offset` (8) + `length` (8) +
/// `crc32c` (4) + `flags` (4). The sum is 28, not the 24 that a naive reading of the field list
/// suggests; writing 24 here would desynchronize the table from the payload region and make every
/// container unparseable.
pub const SECTION_ENTRY_LEN: usize = 28;

/// Byte length of the container trailer.
pub const TRAILER_LEN: usize = 8;

/// Mandatory payload alignment for every section.
pub const SECTION_ALIGNMENT: u64 = 8;

/// Structural ceiling on the number of sections a container may declare.
///
/// The eight defined section tags leave ample headroom; a larger count can only come from a
/// forged or corrupted header, so it is rejected before any allocation is sized from it.
pub const MAX_SECTION_COUNT: u32 = 64;

/// Ceiling on the number of records a single section may declare.
pub const MAX_RECORD_COUNT: usize = 16 * 1024 * 1024;

/// Ceiling on the byte length of any single length-prefixed string field.
pub const MAX_FIELD_LEN: usize = 1 << 20;

/// Minimum viable container length: header, trailer, and zero sections.
pub const MIN_CONTAINER_LEN: usize = HEADER_LEN + TRAILER_LEN;

/// Header flag: one or more section payloads are zlib-compressed.
pub const FLAG_ZLIB_SECTIONS: u16 = 1 << 0;

/// Header flag: the container is logically read-only.
pub const FLAG_READ_ONLY: u16 = 1 << 1;

/// Section flag: this section's payload is zlib-compressed.
pub const SECTION_FLAG_ZLIB: u32 = 1 << 0;

/// Conventional branch a freshly initialized repository has its head attached to.
pub const DEFAULT_BRANCH_REF: &str = "refs/heads/main";

/// Name of the container file inside a repository directory.
pub const CONTAINER_FILE_NAME: &str = "repo.txc";

/// Name of the directory, inside a repository directory, that holds the native object store.
pub const OBJECTS_DIR_NAME: &str = "objects";

/// Name of the directory, inside a repository directory, that holds the write-ahead journal.
pub const JOURNAL_DIR_NAME: &str = "log";

/// Name of the guard file written inside a repository directory.
///
/// The file is named `.git` on purpose: Git treats a directory containing `.git` as a repository
/// root and stops descending into it, which is what keeps `git add -A` from swallowing the native
/// store's contents into the host repository's index.
pub const GUARD_FILE_NAME: &str = ".git";

/// Contents of the guard file: a self-referential gitdir pointer.
pub const GUARD_FILE_CONTENT: &str = "gitdir: .\n";
