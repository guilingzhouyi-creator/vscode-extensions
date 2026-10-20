//! Module: fg-index — Lockless Staging Index Facade
//! File Path: crates/fg-index/src/lib.rs
//! Architecture Role: Manages lockless in-memory staging state, multi-stage conflict slots
//!   during Agent branch merges, and hierarchical Git Tree reconstruction.
//! Dependencies & Triggers: Upstream of fg-storage, fg-topology, and Taxis CLI index workflows.
//! Responsibilities: Staging index slots, lockless staging tree, and stage conflict resolution.
//! Exit Semantics & Design Rationale: Provides lock-free staging without touching disk ODB.

pub mod conflict_stage;
pub mod entry;
pub mod lockless_tree;

pub use conflict_stage::ConflictStageSlot;
pub use entry::{IndexStage, VirtualIndexEntry};
pub use lockless_tree::InMemoryIndexTree;

/// Backwards-compatibility alias for InMemoryIndexTree.
pub type InMemoryTreeBuilder = InMemoryIndexTree;
