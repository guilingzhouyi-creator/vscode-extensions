//! Module: fg-index — Staging Entry & Multi-Stage State
//! File Path: crates/fg-index/src/entry.rs
//! Architecture Role: Canonical Git index stage representation (Stage 0 normal, Stage 1 base,
//!   Stage 2 ours, Stage 3 theirs) and staged file entry descriptors.

use fg_core::models::Oid;
use fg_object::FileMode;

/// Canonical Git index conflict stages during merges.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum IndexStage {
    /// Stage 0: Clean, non-conflicting entry.
    Normal = 0,
    /// Stage 1: Common ancestor (base) entry.
    Base = 1,
    /// Stage 2: Target branch (ours) entry.
    Ours = 2,
    /// Stage 3: Source branch (theirs) entry.
    Theirs = 3,
}

/// A single staged file entry within the in-memory index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VirtualIndexEntry {
    pub path: String,
    pub mode: FileMode,
    pub oid: Oid,
    pub stage: IndexStage,
    pub is_sparse_dir: bool,
}

impl VirtualIndexEntry {
    /// Creates a clean stage-0 file entry.
    pub fn new(path: impl Into<String>, mode: FileMode, oid: Oid) -> Self {
        Self {
            path: path.into(),
            mode,
            oid,
            stage: IndexStage::Normal,
            is_sparse_dir: false,
        }
    }

    /// Creates an entry with an explicit merge stage.
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
            is_sparse_dir: false,
        }
    }

    /// Creates a collapsed sparse directory entry pointing directly to a pre-computed GitTree OID.
    /// Aligns with Git's canonical Sparse Index `S_IFDIR` truncation design.
    pub fn new_sparse_dir(path: impl Into<String>, tree_oid: Oid) -> Self {
        Self {
            path: path.into(),
            mode: FileMode::Directory,
            oid: tree_oid,
            stage: IndexStage::Normal,
            is_sparse_dir: true,
        }
    }

    /// Checks if this entry represents a clean staged state (Stage 0).
    pub fn is_clean(&self) -> bool {
        self.stage == IndexStage::Normal
    }

    /// Checks if this entry is a collapsed sparse directory subtree.
    pub fn is_sparse_dir(&self) -> bool {
        self.is_sparse_dir
    }
}
