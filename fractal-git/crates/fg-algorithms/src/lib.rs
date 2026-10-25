//! Module: fg-algorithms — Algorithmic Operators for Fractal Git
//! File Path: crates/fg-algorithms/src/lib.rs
//! Architecture Role: Pure algorithmic computational operators including FastCDC chunking,
//!   tree & text difference calculation, three-way merge reconciliation,
//!   commit graph DAG traversal, Bayesian quality scoring models, and synthetic
//!   benchmark topology generators.
//! Dependencies & Triggers: Upstream of fg-storage, fg-topology, and Taxis CLI.
//! Responsibilities: High-performance algorithmic engine exports and algebraic conflict operators.
//! Exit Semantics & Design Rationale: Zero-allocation and cache-friendly computational primitives.

pub mod blame;
pub mod bloom;
pub mod cdc;
pub mod diff;
pub mod math;
pub mod merge;
pub mod pack;
pub mod poset;
pub mod synthetic;
pub mod traverse;

pub use blame::{BlameEngine, BlameHunk, BlameLine};
pub use bloom::PathBloomFilter;
pub use cdc::{apply_edits, ChunkDescriptor, EditOp, FastCdcChunker, FastCdcIter, GEAR_TABLE};
pub use diff::{
    decimal_width, detect_renames, pprint_rename, scale_linear, shared_suffix_len, split_lines,
    stat_graph, text_ends_with_newline, truncate_stat_name, BlobRef, ChangeKind, Compaction,
    DiffEntry, PatchGenerator, PatchHunk, PatchHunkRef, PatchLine, PatchLineRef, RenameHit, Side,
    StatLayout, TreeDiff, TreeDiffState, UnifiedPatch, UnifiedPatchRef, DEFAULT_HUNK_CONTEXT,
    DEFAULT_RENAME_SCORE, MAX_RENAME_SCORE,
};
pub use math::{compute_jeffreys_credible_lower, evaluate_score_envelope, PosteriorScoreEstimate};
pub use merge::{
    AlgebraicMerge, BlockMergeResult, BlockThreeWayMerge, CanonicalConflictEntry,
    CanonicalMergeResult, ConflictEntry, FastPathMerge, TextMergeResult, TextThreeWayMerge,
    ThreeWayMerge, ThreeWayMergeResult, VirtualMergeBaseSynthesizer,
};
pub use pack::{
    encode_git_delta, find_pack_deltas, DeltaResolution, PackDeltaChain, PackDeltaItem,
    DEFAULT_DELTA_WINDOW, MAX_DELTA_DEPTH,
};
pub use poset::CorrectedCommitDate;
pub use synthetic::{
    generate_commit_chain, generate_diamond_dag, generate_monorepo_trees, SyntheticCommitChain,
    SyntheticDag, SyntheticMonorepo,
};
pub use traverse::{
    commit_tree_oid, flatten_commit_tree_with, flatten_tree_with, DagWalker, FastOidHasher,
    FastOidSet, FlattenedTreeEntry, SmallParentList,
};
