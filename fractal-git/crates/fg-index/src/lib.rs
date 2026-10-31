//! Module: fg-index — Lockless Staging Index Facade
//! File Path: crates/fg-index/src/lib.rs
//! Architecture Role: Manages in-memory staging state, multi-stage conflict slots during Agent
//!   branch merges, hierarchical Git tree reconstruction, and the Git DIRC index reader.
//! Dependencies & Triggers: Upstream of fg-storage, fg-topology, and Taxis CLI index workflows.
//! Responsibilities: Staging slots, the in-memory index, stage conflict resolution, and
//!   compatibility-side index decoding.
//! Exit Semantics & Design Rationale:
//!   - `FileMode` and `IndexStage` are re-exported from `fg-core` rather than redefined here. The
//!     on-disk INDX section decodes the same bytes, so a second definition would let one layer
//!     accept a value the other rejects.
//!   - The entry type is named [`StagingEntry`]; no alias is kept for its former name. Two names
//!     for one type split call sites and hide which name is authoritative.
//!   - [`GitIndex`] is the read-only decode of `\.git/index`; it is a projection input, not a second
//!     authority over staging. Nothing in this crate merges the two representations.
//!
//! Domain Governance Rules: FGT-IDX-001 (index staging facade), FGT-COR-001, FGT-LCK-001.

pub mod attributes;
pub mod config;
mod config_format;
pub mod conflict_stage;
pub mod dirty_guard;
pub mod entry;
pub mod ignore;
pub mod index_file;
pub mod index_tail;
pub mod lockless_tree;
pub mod submodules;
pub mod virtual_inode;

pub use attributes::{blob_has_crlf, to_git_bytes, AttributeSet, AutoCrlf, CrlfAction};
pub use config::{write_config_entry, RepoConfig};
pub use conflict_stage::ConflictStageSlot;
pub use dirty_guard::{DirtyCollision, DirtyCollisionKind, DirtyWorktreeGuard};
pub use entry::StagingEntry;
pub use fg_core::models::quarantine::{
    self, default_quarantine_dir, IsolateMutationRequest, QuarantineLedger, QuarantineRecord,
    QuarantineStatus,
};
pub use ignore::{IgnoreMatch, IgnoreMatcher, IgnorePattern};
pub use index_file::{encode_dirc_v2, write_dirc_v2, GitIndex, IndexEntry};
pub use lockless_tree::InMemoryIndexTree;
pub use submodules::GitModules;
pub use virtual_inode::VirtualInodeTable;

pub use fg_core::models::{FileMode, IndexStage};
