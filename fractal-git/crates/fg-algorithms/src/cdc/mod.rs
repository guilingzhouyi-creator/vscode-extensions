//! Module: fg-algorithms — Content-Defined Chunking Facade
//! File Path: crates/fg-algorithms/src/cdc/mod.rs

pub mod apply_edits;
pub mod fast_cdc;

pub use apply_edits::{apply_edits, EditOp};
pub use fast_cdc::{
    ChunkDescriptor, FastCdcChunker, FastCdcIter, DEFAULT_AVG_CHUNK, DEFAULT_MAX_CHUNK,
    DEFAULT_MIN_CHUNK, GEAR_TABLE,
};
