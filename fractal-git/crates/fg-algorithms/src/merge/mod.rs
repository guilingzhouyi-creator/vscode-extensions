//! Module: fg-algorithms — Merge Operators Facade
//! File Path: crates/fg-algorithms/src/merge/mod.rs

pub mod three_way;
pub mod virtual_base;

pub use three_way::{
    CanonicalConflictEntry, CanonicalMergeResult, ConflictEntry, FastPathMerge, ThreeWayMerge,
    ThreeWayMergeResult,
};
pub use virtual_base::VirtualMergeBaseSynthesizer;
