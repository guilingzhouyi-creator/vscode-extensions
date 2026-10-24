//! Module: taxis_cmd::tree_view — Shared Worktree & Commit Tree Infrastructure
//! File Path: src/bin/taxis_cmd/tree_view.rs
//! Architecture Role: Shared foundational tree walking, entry extraction, and filesystem
//!   stat cache validation. Decouples low-level tree inspection from higher-level porcelain
//!   status, diff, checkout, and merge dispatchers.
//! Dependencies & Triggers: Consumed by checkout, diff, merge, rebase, status, and reset.
//! Responsibilities: Flatten commit/tree objects to hierarchical path maps, validate lstat cache
//!   timestamps and sizes, map filesystem permissions to Git FileMode, and format records.
//! Exit Semantics & Design Rationale:
//!   - Zero-allocation where possible; returns immutable entry references.
//!   - Path comparison and sorting rules strictly match canonical Git sorting.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-OBJ-001`: Git plumbing byte parity and tree sorting guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::collections::BTreeMap;
use std::fs;

use fg_core::error::FractalResult;
use fg_core::models::{FileMode, Oid};
use fg_index::IndexEntry;

#[allow(unused_imports)]
pub use fg_algorithms::traverse::{
    commit_tree_oid, flatten_commit_tree_with, flatten_tree_with, FlattenedTreeEntry,
};

use super::repo_view::RepoView;

/// ASCII NUL delimiter byte for `-z` command outputs.
pub const NUL: u8 = 0;

/// One flattened tree entry: mode and object id. Re-exported from fg_algorithms.
pub type TreeEntry = FlattenedTreeEntry;

/// A path that exists on one side of a tree comparison, with its payload pre-read for similarity.
#[derive(Debug, Clone)]
pub struct SideBlob {
    pub path: String,
    pub entry: TreeEntry,
    pub payload: Vec<u8>,
}

/// Flattens the tree a commit names into a path-to-entry map.
///
/// # Errors
///
/// Propagates object reads and tree decoding errors from `RepoView`.
pub fn flatten_commit_tree(
    view: &RepoView,
    commit: &Oid,
) -> FractalResult<BTreeMap<String, TreeEntry>> {
    flatten_commit_tree_with(commit, &|oid| view.object(oid).map(|o| o.payload))
}

/// Flattens one tree recursively into `flat`.
pub fn flatten_tree(
    view: &RepoView,
    tree_oid: &Oid,
    prefix: &str,
    flat: &mut BTreeMap<String, TreeEntry>,
) -> FractalResult<()> {
    flatten_tree_with(
        tree_oid,
        prefix,
        &|oid| view.object(oid).map(|o| o.payload),
        flat,
    )
}

/// Flattens a tree revision that is already known to be a tree into `flat`.
pub fn flatten_tree_for_diff(
    view: &RepoView,
    tree_oid: &Oid,
    prefix: &str,
    flat: &mut BTreeMap<String, TreeEntry>,
) -> FractalResult<()> {
    flatten_tree(view, tree_oid, prefix, flat)
}

/// Reports whether the cached size and modification time match filesystem metadata.
pub fn stat_cache_matches(staged: &IndexEntry, metadata: &fs::Metadata) -> bool {
    if metadata.len() != u64::from(staged.size) {
        return false;
    }
    mtime_matches(staged, metadata)
}

/// Reports whether the entry is racy against the index file's own timestamp.
///
/// An entry whose recorded modification time is not older than the index file was written in the
/// same second cannot be trusted to the stat cache: a worktree edit made within that second, of the
/// same size, would reproduce both the size and the timestamp the cache compares. Git calls these
/// entries racy and falls back to a content comparison for exactly this reason; treating them as
/// clean is how a same-second rewrite goes unreported.
pub fn entry_is_racy(staged: &IndexEntry, index_timestamp: Option<u64>) -> bool {
    match index_timestamp {
        Some(timestamp) => u64::from(staged.mtime_seconds) >= timestamp,
        None => false,
    }
}

/// Reports whether the stat cache alone may answer unchanged for this entry.
///
/// This is the size and timestamp match minus the racy window, which [`stat_cache_matches`] cannot
/// exclude on its own. Callers that skip hashing when the cache matches must use this predicate.
pub fn stat_cache_trusted(
    staged: &IndexEntry,
    metadata: &fs::Metadata,
    index_timestamp: Option<u64>,
) -> bool {
    stat_cache_matches(staged, metadata) && !entry_is_racy(staged, index_timestamp)
}

/// Reports whether only the modification time still matches, ignoring the size.
pub fn mtime_matches(staged: &IndexEntry, metadata: &fs::Metadata) -> bool {
    let mtime = metadata.modified().ok().and_then(|time| {
        time.duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|elapsed| (elapsed.as_secs() as u32, elapsed.subsec_nanos()))
    });
    match mtime {
        Some((seconds, nanos)) => {
            seconds == staged.mtime_seconds
                && (staged.mtime_nanos == 0 || nanos == staged.mtime_nanos)
        }
        None => false,
    }
}

/// Maps filesystem metadata onto the mode a tree would record.
pub fn worktree_mode(
    metadata: &fs::Metadata,
    staged: FileMode,
    trust_executable_bit: bool,
) -> FileMode {
    if metadata.file_type().is_symlink() {
        return FileMode::Symlink;
    }
    if !trust_executable_bit {
        return match staged {
            FileMode::ExecutableFile => FileMode::ExecutableFile,
            _ => FileMode::RegularFile,
        };
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 != 0 {
            return FileMode::ExecutableFile;
        }
    }
    FileMode::RegularFile
}

/// Writes one record to the given sink, honouring the `-z` terminator.
pub fn write_record(
    sink: &mut impl std::io::Write,
    text: &str,
    nul_terminated: bool,
) -> std::io::Result<()> {
    sink.write_all(text.as_bytes())?;
    if nul_terminated {
        sink.write_all(&[NUL])
    } else {
        sink.write_all(b"\n")
    }
}

#[cfg(test)]
mod tests {
    use super::entry_is_racy;
    use fg_core::models::{FileMode, Oid};
    use fg_index::{IndexEntry, IndexStage};

    fn staged_with_mtime(mtime_seconds: u32) -> IndexEntry {
        IndexEntry {
            path: "a.txt".to_string(),
            mode: FileMode::RegularFile,
            oid: Oid::from_bytes([0u8; 20]),
            stage: IndexStage::Normal,
            size: 4,
            mtime_seconds,
            mtime_nanos: 0,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        }
    }

    #[test]
    fn entries_not_older_than_the_index_are_racy() {
        assert!(entry_is_racy(
            &staged_with_mtime(1_700_000_000),
            Some(1_700_000_000)
        ));
        assert!(entry_is_racy(
            &staged_with_mtime(1_700_000_005),
            Some(1_700_000_000)
        ));
        assert!(!entry_is_racy(
            &staged_with_mtime(1_699_999_999),
            Some(1_700_000_000)
        ));
        assert!(!entry_is_racy(&staged_with_mtime(1_700_000_000), None));
    }
}
