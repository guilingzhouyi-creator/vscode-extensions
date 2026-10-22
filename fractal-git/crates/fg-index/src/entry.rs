//! Module: fg-index — Staging Entry
//! File Path: crates/fg-index/src/entry.rs
//! Architecture Role: The in-memory staging entry that every add, status, and commit path reads
//!   and writes, plus the canonical four-stage merge slot it may occupy.
//! Dependencies & Triggers: Utilized by the lockless staging tree, the merge engine, and the
//!   worktree slots; projected onto the on-disk INDX section by fg-native.
//! Responsibilities: Represent one staged path with its mode, object id, merge stage, and
//!   sparse-checkout marker.
//! Exit Semantics & Design Rationale:
//!   - The stage type is [`fg_core::models::IndexStage`], not a local copy. The on-disk INDX
//!     section decodes the same byte, so two enums would let the writer emit a value the reader
//!     rejects — a corruption only visible after a round trip.
//!   - The sparse-directory marker is derived from the mode and the trailing `/` rather than being
//!     an independent boolean. An independent flag can contradict the path it describes, and no
//!     consumer would know which one to trust.
//!   - The name is `StagingEntry`, not `VirtualIndexEntry`: "virtual" described a former design in
//!     which the tree was synthesized on read. The entry is concrete staging state now, and a name
//!     that asserts otherwise misleads every new reader.

use fg_core::models::{FileMode, IndexStage, Oid};

/// A single staged file entry within the in-memory index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagingEntry {
    /// Worktree-relative path using `/` separators; sparse directories end with `/`.
    pub path: String,
    /// Kind of file recorded.
    pub mode: FileMode,
    /// Object the entry resolves to.
    pub oid: Oid,
    /// Merge stage the entry belongs to.
    pub stage: IndexStage,
}

impl StagingEntry {
    /// Creates a resolved (stage 0) entry.
    pub fn new(path: impl Into<String>, mode: FileMode, oid: Oid) -> Self {
        Self {
            path: path.into(),
            mode,
            oid,
            stage: IndexStage::Normal,
        }
    }

    /// Creates an entry occupying an explicit merge stage.
    pub fn with_stage(
        path: impl Into<String>,
        mode: FileMode,
        oid: Oid,
        stage: IndexStage,
    ) -> Self {
        Self {
            path: path.into(),
            mode,
            oid,
            stage,
        }
    }

    /// Creates a collapsed sparse-checkout entry pointing at a pre-computed tree object.
    ///
    /// The path carries a trailing `/` because that is how Git distinguishes a collapsed subtree
    /// from a directory that still has staged children.
    pub fn new_sparse_directory(path: impl Into<String>, tree_oid: Oid) -> Self {
        let mut sparse_path = path.into();
        if !sparse_path.ends_with('/') {
            sparse_path.push('/');
        }
        Self {
            path: sparse_path,
            mode: FileMode::Directory,
            oid: tree_oid,
            stage: IndexStage::Normal,
        }
    }

    /// Reports whether this entry represents resolved content.
    pub fn is_resolved(&self) -> bool {
        self.stage.is_resolved()
    }

    /// Reports whether this entry is a collapsed sparse-checkout subtree.
    ///
    /// Derived from the two facts that define it rather than stored separately, so the marker can
    /// never disagree with the path it describes.
    pub fn is_sparse_directory(&self) -> bool {
        self.mode.is_tree() && self.path.ends_with('/')
    }
}

#[cfg(test)]
mod tests {
    use fg_core::models::{FileMode, IndexStage, Oid};

    use super::StagingEntry;

    fn oid_from(seed: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = seed;
        Oid::from_bytes(raw)
    }

    #[test]
    fn new_entry_is_resolved() {
        let entry = StagingEntry::new("a.txt", FileMode::RegularFile, oid_from(1));
        assert!(entry.is_resolved());
        assert_eq!(entry.stage, IndexStage::Normal);
        assert!(!entry.is_sparse_directory());
    }

    #[test]
    fn conflict_entry_is_not_resolved() {
        let entry = StagingEntry::with_stage(
            "a.txt",
            FileMode::RegularFile,
            oid_from(1),
            IndexStage::Theirs,
        );
        assert!(!entry.is_resolved());
    }

    #[test]
    fn sparse_directory_appends_missing_slash() {
        let entry = StagingEntry::new_sparse_directory("vendor", oid_from(2));
        assert_eq!(entry.path, "vendor/");
        assert!(entry.is_sparse_directory());
    }

    #[test]
    fn sparse_directory_keeps_existing_slash() {
        let entry = StagingEntry::new_sparse_directory("vendor/", oid_from(2));
        assert_eq!(entry.path, "vendor/");
    }

    #[test]
    fn directory_without_slash_is_not_sparse() {
        let entry = StagingEntry::new("src", FileMode::Directory, oid_from(3));
        assert!(!entry.is_sparse_directory());
    }

    #[test]
    fn regular_file_with_slash_is_not_sparse() {
        let entry = StagingEntry::new("weird/", FileMode::RegularFile, oid_from(4));
        assert!(!entry.is_sparse_directory());
    }
}
