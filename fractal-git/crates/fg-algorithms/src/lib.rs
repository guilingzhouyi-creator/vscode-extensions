//! Module: fg-algorithms — Algorithmic Operators for Fractal Git
//! File Path: crates/fg-algorithms/src/lib.rs
//! Architecture Role: Pure algorithmic computational operators including FastCDC chunking,
//!   tree & text difference calculation, three-way merge reconciliation,
//!   commit graph DAG traversal, Bayesian quality scoring models, and synthetic
//!   benchmark topology generators.

pub mod bloom;
pub mod cdc;
pub mod diff;
pub mod math;
pub mod merge;
pub mod poset;
pub mod synthetic;
pub mod traverse;

pub use bloom::PathBloomFilter;
pub use cdc::{ChunkDescriptor, FastCdcChunker, FastCdcIter, GEAR_TABLE};
pub use diff::{
    ChangeKind, DiffEntry, MyersScratch, PatchGenerator, PatchHunk, PatchLine, TreeDiff,
    TreeDiffState, UnifiedPatch,
};
pub use math::{compute_jeffreys_credible_lower, evaluate_score_envelope, PosteriorScoreEstimate};
pub use merge::{
    CanonicalConflictEntry, CanonicalMergeResult, ConflictEntry, FastPathMerge, ThreeWayMerge,
    ThreeWayMergeResult, VirtualMergeBaseSynthesizer,
};
pub use poset::CorrectedCommitDate;
pub use synthetic::{
    generate_commit_chain, generate_diamond_dag, generate_monorepo_trees, SyntheticCommitChain,
    SyntheticDag, SyntheticMonorepo,
};
pub use traverse::{DagWalker, FastOidHasher, FastOidSet};
