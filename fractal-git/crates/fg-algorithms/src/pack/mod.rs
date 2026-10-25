//! Module: fg-algorithms::pack — Git Packfile Algorithmic Operators
//! File Path: crates/fg-algorithms/src/pack/mod.rs
//! Architecture Role: Domain algorithms for Git packfile creation, sliding-window delta compression,
//!   and object sorting heuristics.
//! Dependencies & Triggers: Consumed by fg-storage PackWriter, RepackEngine, and Taxis CLI.
//! Responsibilities: Export delta searcher, delta encoder, and sorting heuristics.
//! Exit Semantics & Design Rationale: Pure, high-performance computational primitives with zero allocations in tight loops.

pub mod delta_search;

pub use delta_search::{
    compute_basename_hash, encode_git_delta, find_pack_deltas, DeltaResolution, PackDeltaChain,
    PackDeltaItem, DEFAULT_DELTA_WINDOW, MAX_DELTA_DEPTH,
};
