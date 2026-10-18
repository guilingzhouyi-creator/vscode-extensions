//! Module: fg-storage — Storage Engines Facade
//! File Path: crates/fg-storage/src/lib.rs
//! Architecture Role: Concrete Git storage backends, including LooseOdb, immutable CAS block
//!   store (CasBackend), crash-safe WAL journal (WalJournal), and LayerVFS materializer bridge.

pub mod cas_backend;
pub mod cas_bridge;
pub mod loose;
pub mod wal_journal;

pub use cas_backend::CasBackend;
pub use cas_bridge::{CasFileDescriptor, CasToGitMaterializer, MaterializeRequest};
pub use loose::{write_loose_object, LooseOdb};
pub use wal_journal::{WalJournal, WalRecord};

// Re-export InMemoryIndexTree from fg-index for storage convenience
pub use fg_index::InMemoryIndexTree;
