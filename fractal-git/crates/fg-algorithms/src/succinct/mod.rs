//! Module: fg-algorithms::succinct — Quasi-Succinct Data Structures
//! File Path: crates/fg-algorithms/src/succinct/mod.rs
//! Architecture Role: Space-efficient compressed representations for monotonic sequences,
//!   rank-select bitvectors, and sparse indexes.
//! Dependencies & Triggers: Consumed by fg-storage, commit-graph, and index components.
//! Responsibilities: High-density integer and bitset compression without query decompression penalties.
//!
//! Domain Governance Rules: FGT-ALG-001, FGT-COR-001, FGT-PRF-001.

pub mod elias_fano;

pub use elias_fano::{EliasFano, EliasFanoBuilder, EliasFanoIter};
