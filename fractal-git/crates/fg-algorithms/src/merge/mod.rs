//! Module: fg-algorithms — Merge Operators Facade
//! File Path: crates/fg-algorithms/src/merge/mod.rs

pub mod three_way;

pub use three_way::{ConflictEntry, ThreeWayMerge, ThreeWayMergeResult};
