//! Module: fg-storage — Storage Engines Facade
//! File Path: crates/fg-storage/src/lib.rs
//! Architecture Role: Concrete Git storage backends, including LooseOdb, immutable CAS block
//!   store (CasBackend), crash-safe WAL journal (WalJournal), and LayerVFS materializer bridge.
//! Dependencies & Triggers: Upstream of Taxis CLI and storage benchmark suites.
//! Responsibilities: Central facade for loose ODB, CAS backend, WAL, and Git Commit-Graph.
//! Exit Semantics & Design Rationale: Standardizes persistent storage models with crash safety.

pub mod cas_backend;
pub mod cas_bridge;
pub mod commit_graph;
pub mod loose;
pub mod wal_journal;

pub use cas_backend::CasBackend;
pub use cas_bridge::{CasFileDescriptor, CasToGitMaterializer, MaterializeRequest};
pub use commit_graph::{CommitGraphEntry, CommitGraphReader, CommitGraphWriter};
pub use loose::{write_loose_object, LooseOdb};
pub use wal_journal::{WalJournal, WalRecord};

// Re-export InMemoryIndexTree from fg-index for storage convenience
pub use fg_index::InMemoryIndexTree;
