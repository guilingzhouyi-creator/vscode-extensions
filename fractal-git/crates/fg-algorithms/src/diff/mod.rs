//! Module: fg-algorithms — Tree & Text Difference Facade
//! File Path: crates/fg-algorithms/src/diff/mod.rs
//! Architecture Role: Re-exports the three stages of a text comparison and the whole-tree diff, so a
//!   caller renders a patch without knowing the pipeline's shape.
//! Dependencies & Triggers: Used by every caller that renders or counts a text patch.
//! Responsibilities: Keep the public surface of `patch`, `compact`, `xdiff`, `xdiff_prepare`,
//!   `rename`, and `tree_diff` in one place.
//! Exit Semantics & Design Rationale: The stages are exported individually as well as through
//!   `PatchGenerator`, because a caller comparing against `git diff` sometimes needs the changed flags
//!   before they become hunks — a stat summary, for instance, counts them without rendering.

pub mod compact;
pub mod patch;
pub mod rename;
pub mod tree_diff;
pub mod xdiff;
pub mod xdiff_prepare;

pub use compact::{Compaction, Side};
pub use patch::{
    split_lines, text_ends_with_newline, PatchGenerator, PatchHunk, PatchHunkRef, PatchLine,
    PatchLineRef, UnifiedPatch, UnifiedPatchRef, DEFAULT_HUNK_CONTEXT,
};
pub use rename::{
    detect_renames, BlobRef, RenameHit, DEFAULT_RENAME_SCORE, MAX_SCORE as MAX_RENAME_SCORE,
};
pub use tree_diff::{ChangeKind, DiffEntry, TreeDiff, TreeDiffState};
