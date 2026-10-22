//! Module: fg-index — Lockless Staging Index Facade
//! File Path: crates/fg-index/src/lib.rs
//! Architecture Role: Manages in-memory staging state, multi-stage conflict slots during Agent
//!   branch merges, and hierarchical Git tree reconstruction.
//! Dependencies & Triggers: Upstream of fg-storage, fg-topology, and Taxis CLI index workflows.
//! Responsibilities: Staging slots, the in-memory index, and stage conflict resolution.
//! Exit Semantics & Design Rationale:
//!   - `FileMode` and `IndexStage` are re-exported from `fg-core` rather than redefined here. The
//!     on-disk INDX section decodes the same bytes, so a second definition would let one layer
//!     accept a value the other rejects.
//!   - The entry type is named [`StagingEntry`]; no alias is kept for its former name. Two names
//!     for one type split call sites and hide which name is authoritative.

pub mod conflict_stage;
pub mod entry;
pub mod lockless_tree;

pub use conflict_stage::ConflictStageSlot;
pub use entry::StagingEntry;
pub use lockless_tree::InMemoryIndexTree;

pub use fg_core::models::{FileMode, IndexStage};
