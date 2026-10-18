//! Module: fg-algorithms — Algorithmic Operators for Fractal Git
//! File Path: crates/fg-algorithms/src/lib.rs
//! Architecture Role: Pure algorithmic computational operators including FastCDC chunking,
//!   tree & text difference calculation, three-way merge reconciliation, and commit graph DAG traversal.

pub mod cdc;
pub mod diff;
pub mod merge;
pub mod traverse;

pub use cdc::{ChunkDescriptor, FastCdcChunker};
pub use diff::{ChangeKind, DiffEntry, PatchGenerator, PatchHunk, PatchLine, TreeDiff, UnifiedPatch};
pub use merge::{ConflictEntry, ThreeWayMerge, ThreeWayMergeResult};
pub use traverse::DagWalker;
