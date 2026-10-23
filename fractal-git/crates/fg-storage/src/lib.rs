//! Module: fg-storage — Storage Engines Facade
//! File Path: crates/fg-storage/src/lib.rs
//! Architecture Role: Concrete storage backends: the Git loose object store, the Git pack/idx/midx
//!   reader, the Taxis-native immutable CAS block store, the crash-safe WAL journal, and the
//!   LayerVFS materializer bridge.
//! Dependencies & Triggers: Upstream of Taxis CLI and storage benchmark suites.
//! Responsibilities: Central facade for object storage and the compatibility object router.
//! Exit Semantics & Design Rationale:
//!   - Both delta codecs are exported under distinct names. `DeltaOp` speaks Taxis' block format and
//!     `GitDeltaOp` speaks Git's pack format; they are not interchangeable, and a caller that reached
//!     for the wrong one would corrupt objects without any error.

pub mod backends;
pub mod cas_backend;
pub mod cas_bridge;
pub mod commit_graph;
pub mod commit_materializer;
pub mod delta_codec;
pub mod delta_git;
pub mod loose;
pub mod projection;
pub mod wal_journal;

pub use backends::{
    DeltaBaseSource, MultiPackIndex, OdbRouter, PackFile, PackIndex, PackLocation, PackedObject,
    DEFAULT_ROUTER_CACHE_BYTES, MAX_CHAIN_DEPTH,
};
pub use cas_backend::CasBackend;
pub use cas_bridge::{CasFileDescriptor, CasToGitMaterializer, MaterializeRequest};
pub use commit_graph::{CommitGraphEntry, CommitGraphReader, CommitGraphWriter};
pub use commit_materializer::{
    materialize_commit, serialize_commit_payload, serialize_tree_payload,
    CommitMaterializationRequest, MaterializedCommit,
};
pub use delta_codec::{
    apply_delta_program, decode_block_payload, generate_delta_program, select_block_encoding,
    DeltaOp, EncodedBlock, MAX_DELTA_CHAIN_DEPTH,
};
pub use delta_git::{apply_git_delta, decode_git_delta, GitDelta, GitDeltaOp};
pub use loose::{write_loose_object, LooseOdb};
pub use projection::{export_native_to_git, import_git_to_native, ExportReport, ImportReport};
pub use wal_journal::{WalJournal, WalRecord};

// Re-export InMemoryIndexTree from fg-index for storage convenience
pub use fg_index::InMemoryIndexTree;
