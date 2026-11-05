//! Module: fg-algorithms::pack — Git Packfile Algorithmic Operators
//! File Path: crates/fg-algorithms/src/pack/mod.rs
//! Architecture Role: Domain algorithms for Git packfile creation, sliding-window delta compression,
//!   and object sorting heuristics.
//! Dependencies & Triggers: Consumed by fg-storage PackWriter, RepackEngine, and Taxis CLI.
//! Responsibilities: Export delta searcher, shared delta opcode writers, and sorting heuristics.
//! Exit Semantics & Design Rationale: Pure, high-performance computational primitives with zero allocations in tight loops.
//!
//! Domain Governance Rules: FGT-ALG-001 (packfile delta operators), FGT-COR-001, FGT-PRF-001.

mod delta_opcodes;
pub mod delta_search;
pub mod fossil_matcher;

pub use delta_search::{
    compute_basename_hash, encode_git_delta, find_pack_deltas, write_varint, DeltaResolution,
    PackDeltaChain, PackDeltaItem, DEFAULT_DELTA_WINDOW, MAX_DELTA_DEPTH,
};
pub use fossil_matcher::{
    encode_fossil_git_delta, encode_fossil_git_delta_into, FossilDeltaState, FossilRollingHash,
    FOSSIL_WINDOW_SIZE,
};
