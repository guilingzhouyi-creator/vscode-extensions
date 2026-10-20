//! Module: fg-algorithms — Merge Operators Facade
//! File Path: crates/fg-algorithms/src/merge/mod.rs
//! Architecture Role: Merge conflict operators, three-way merge, and algebraic merge facades.
//! Dependencies & Triggers: Utilized by lockless tree staging and CLI commit/merge operations.
//! Responsibilities: Re-exports algebraic merge, 3-way merge, and virtual base synthesizer.
//! Exit Semantics & Design Rationale: Exposes cleanly decoupled merge primitives.

pub mod algebraic;
pub mod three_way;
pub mod virtual_base;

pub use algebraic::AlgebraicMerge;
pub use three_way::{
    CanonicalConflictEntry, CanonicalMergeResult, ConflictEntry, FastPathMerge, ThreeWayMerge,
    ThreeWayMergeResult,
};
pub use virtual_base::VirtualMergeBaseSynthesizer;
