//! Module: fg-index — Lockless Staging Index Facade
//! File Path: crates/fg-index/src/lib.rs
//! Architecture Role: Manages lockless in-memory staging state, multi-stage conflict slots
//!   during Agent branch merges, and hierarchical Git Tree reconstruction.

pub mod conflict_stage;
pub mod entry;
pub mod lockless_tree;

pub use conflict_stage::ConflictStageSlot;
pub use entry::{IndexStage, VirtualIndexEntry};
pub use lockless_tree::InMemoryIndexTree;

/// Backwards-compatibility alias for InMemoryIndexTree.
pub type InMemoryTreeBuilder = InMemoryIndexTree;
