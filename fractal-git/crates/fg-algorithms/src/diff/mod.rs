//! Module: fg-algorithms — Tree & Text Difference Facade
//! File Path: crates/fg-algorithms/src/diff/mod.rs

pub mod patch;
pub mod tree_diff;

pub use patch::{
    MyersScratch, PatchGenerator, PatchHunk, PatchHunkRef, PatchLine, PatchLineRef, UnifiedPatch,
    UnifiedPatchRef,
};
pub use tree_diff::{ChangeKind, DiffEntry, TreeDiff, TreeDiffState};
