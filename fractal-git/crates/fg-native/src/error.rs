//! Module: fg-native — TAXC Container Error Topology
//! File Path: crates/fg-native/src/error.rs
//! Architecture Role: Strongly-typed failure taxonomy for the native binary container layer.
//! Dependencies & Triggers: Consumed by every TAXC section codec and by `taxis doctor`.
//! Responsibilities: Distinguish every container rejection so that machine triage names the
//!   exact section, offset, and invariant that failed; never collapse causes into one variant.
//! Exit Semantics & Design Rationale:
//!   - One variant per physical invariant (magic, version, alignment, bounds, CRC).
//!   - Section-level failures carry the section tag and byte offset so `taxis doctor` can
//!     report the damage location instead of a generic "corrupt repository" message.
//!   - Zero panic: all variants are produced by checked comparisons, never by slicing.

use thiserror::Error;

/// Result alias for TAXC container operations.
pub type NativeResult<T> = Result<T, NativeError>;

/// Strongly-typed failure taxonomy for the TAXC native container.
#[derive(Debug, Error)]
pub enum NativeError {
    /// Underlying filesystem operation failed.
    #[error("native I/O failure: {0}")]
    Io(#[from] std::io::Error),

    /// The file is shorter than the mandatory header plus trailer.
    #[error("TAXC file truncated: {actual} bytes is below the {minimum}-byte minimum")]
    FileTooShort { actual: usize, minimum: usize },

    /// The leading magic bytes are not `TAXC`.
    #[error("TAXC magic mismatch at offset 0: expected {expected:#010x}, found {found:#010x}")]
    BadMagic { expected: u32, found: u32 },

    /// The trailing magic bytes are not `TAXC`.
    #[error("TAXC trailing magic mismatch at offset {offset}: found {found:#010x}")]
    BadTrailingMagic { offset: usize, found: u32 },

    /// The container declares a format version this build cannot interpret.
    #[error("unsupported TAXC format version {found}; this build understands version {supported}")]
    UnsupportedFormatVersion { found: u16, supported: u16 },

    /// The declared section count exceeds the structural ceiling.
    #[error("section count {declared} exceeds the ceiling of {ceiling}")]
    SectionCountExceeded { declared: u32, ceiling: u32 },

    /// `body_len` disagrees with the real file length.
    #[error("body length mismatch: header declares {declared}, file implies {actual}")]
    BodyLengthMismatch { declared: u64, actual: u64 },

    /// The header plus section-table CRC did not match.
    #[error("header table CRC mismatch: expected {expected:#010x}, computed {computed:#010x}")]
    TableCrcMismatch { expected: u32, computed: u32 },

    /// A section's declared extent leaves the container body.
    #[error(
        "section {tag} out of bounds: offset {offset} + length {length} exceeds body {body_len}"
    )]
    SectionOutOfBounds {
        tag: &'static str,
        offset: u64,
        length: u64,
        body_len: u64,
    },

    /// A section's payload offset is not aligned to the mandated boundary.
    #[error("section {tag} misaligned: offset {offset} is not a multiple of {alignment}")]
    SectionMisaligned {
        tag: &'static str,
        offset: u64,
        alignment: u64,
    },

    /// A section's payload CRC did not match.
    #[error("section {tag} CRC mismatch at offset {offset}: expected {expected:#010x}, computed {computed:#010x}")]
    SectionCrcMismatch {
        tag: &'static str,
        offset: u64,
        expected: u32,
        computed: u32,
    },

    /// The section table lists the same tag twice.
    #[error("duplicate section tag {tag} in section table")]
    DuplicateSection { tag: &'static str },

    /// The section table is not sorted by ascending tag as the format requires.
    #[error("section table not sorted: {tag} appears after {previous}")]
    SectionTableUnsorted {
        tag: &'static str,
        previous: &'static str,
    },

    /// A required section is absent.
    #[error("required section {tag} is missing from the container")]
    MissingSection { tag: &'static str },

    /// Padding bytes between sections were not zero.
    #[error("non-zero padding byte at offset {offset}: found {found:#04x}")]
    NonZeroPadding { offset: usize, found: u8 },

    /// A length-prefixed field claims more bytes than its enclosing section holds.
    #[error("field {field} overruns its section: needs {needed} bytes, {available} remain")]
    FieldOverrun {
        field: &'static str,
        needed: usize,
        available: usize,
    },

    /// A string field was not valid UTF-8.
    #[error("field {field} is not valid UTF-8: {reason}")]
    InvalidUtf8 { field: &'static str, reason: String },

    /// A string field contained an interior NUL, which the format forbids.
    #[error("field {field} contains an interior NUL byte at index {index}")]
    InteriorNul { field: &'static str, index: usize },

    /// A record stream ended in the middle of a record.
    #[error("section {tag} ends mid-record: {remaining} trailing bytes cannot form a record")]
    TruncatedRecord { tag: &'static str, remaining: usize },

    /// An enum-like byte field carried a value outside its closed set.
    #[error("field {field} carries unknown discriminant {value}")]
    UnknownDiscriminant { field: &'static str, value: u8 },

    /// A file mode word is not one of the modes the index may record.
    ///
    /// Modes are `u32` on disk, so this cannot reuse [`NativeError::UnknownDiscriminant`], which
    /// carries a single byte. Accepting an arbitrary mode would let a forged index mark a regular
    /// file as a directory and silently change how the worktree is materialized.
    #[error("index entry carries unsupported file mode {mode:#o}")]
    UnknownFileMode { mode: u32 },

    /// A staging stage byte is not one of the four defined merge stages.
    ///
    /// Clamping instead of rejecting would turn a corrupt index into a silent conflict resolution.
    #[error("index entry carries unsupported stage {stage}")]
    UnknownIndexStage { stage: u8 },

    /// A path field is syntactically unusable as a worktree-relative path.
    ///
    /// Rejecting these at decode time is a containment requirement, not a style preference: a path
    /// such as `../outside` would let a forged index direct a checkout to write outside the
    /// worktree root.
    #[error("index path is not a safe worktree-relative path: {reason}")]
    InvalidPath { reason: &'static str },

    /// Index entries are not strictly ascending by `(path, stage)`.
    ///
    /// The index is searched by binary search on that key, so an out-of-order stream would answer
    /// lookups incorrectly without ever failing; the position is reported so `taxis doctor` can
    /// point at the offending record.
    #[error("index entry at position {position} breaks the ascending (path, stage) order")]
    IndexOutOfOrder { position: usize },

    /// Operation-log entries are not strictly ascending by operation id.
    #[error("operation-log entry at position {position} breaks the ascending id order")]
    OpLogOutOfOrder { position: usize },

    /// A stored operation id disagrees with the id recomputed from its own bytes.
    ///
    /// The container CRC only proves the bytes arrived intact; it cannot prove they were the bytes
    /// that were written. Recomputing the content-derived id is the only check that catches an
    /// edit made before the CRC was refreshed.
    #[error("operation at position {position} has id {stored} but its bytes hash to {recomputed}")]
    OpIdMismatch {
        position: usize,
        stored: String,
        recomputed: String,
    },

    /// An operation listed itself as its own parent, which makes the DAG cyclic.
    #[error("operation-log entry lists itself as a parent, forming a cycle")]
    OpLogCycle,

    /// A promotion record carries an unknown status discriminant.
    #[error("promotion record carries unknown status {status}")]
    UnknownPromotionStatus { status: u8 },

    /// A worktree record carries an unknown storage tier discriminant.
    #[error("worktree record carries unknown tier {tier}")]
    UnknownWorktreeTier { tier: u8 },

    /// A promotion record's declared score is not a finite number.
    ///
    /// `NaN` and infinity survive an IEEE-754 bit round trip, so they would be accepted silently by
    /// the decoder. They are rejected here because a non-finite score makes every comparison in the
    /// ratchet meaningless.
    #[error("promotion record carries a non-finite score")]
    NonFiniteScore,

    /// A worktree record declares a full checkout while also listing scopes.
    ///
    /// The two claims contradict: a full checkout grants everything, a scope list restricts. Picking
    /// one interpretation silently would either over-grant or over-restrict filesystem access, so
    /// the record is refused.
    #[error("worktree record declares a full checkout while also listing scopes")]
    WorktreeScopeConflict,

    /// A declared count would require an implausible allocation.
    #[error("declared count {declared} for {field} exceeds the ceiling of {ceiling}")]
    CountExceeded {
        field: &'static str,
        declared: usize,
        ceiling: usize,
    },

    /// A writer was asked to emit more sections than the format permits.
    #[error("cannot write {requested} sections; the ceiling is {ceiling}")]
    TooManySections { requested: usize, ceiling: usize },

    /// The platform random source could not produce repository identity bytes.
    ///
    /// Generation is refused rather than faked: a timestamp or counter substitute would hand two
    /// repositories the same identity, and the collision surfaces only when both stores resolve to
    /// one directory.
    #[error("cannot read the platform random source for a repository id: {reason}")]
    RandomUnavailable { reason: String },

    /// A textual repository id is not the canonical lowercase hexadecimal spelling.
    #[error("invalid repository id: {reason}")]
    InvalidRepoIdHex { reason: &'static str },

    /// A container already exists where a new repository was about to be created.
    ///
    /// Initialization refuses rather than overwrites: replacing the container would replace the
    /// repository identity and discard the operation log, and neither loss is recoverable.
    #[error("a repository already exists at '{path}'")]
    RepositoryExists { path: String },
}
