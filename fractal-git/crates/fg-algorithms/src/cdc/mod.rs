//! Module: fg-algorithms — Content-Defined Chunking Facade
//! File Path: crates/fg-algorithms/src/cdc/mod.rs

pub mod fast_cdc;

pub use fast_cdc::{ChunkDescriptor, FastCdcChunker, DEFAULT_AVG_CHUNK, DEFAULT_MAX_CHUNK, DEFAULT_MIN_CHUNK};
