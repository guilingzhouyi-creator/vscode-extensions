//! Module: fg-core — ODB Storage Abstraction Trait
//! File Path: crates/fg-core/src/traits/odb.rs
//! Architecture Role: Decouples high-level git object workflows from physical persistence engines
//!   (in-memory, loose objects, packfiles, LayerVFS CAS).

use crate::error::FractalResult;
use crate::models::Oid;

/// Abstract interface for Git Object Database (ODB) backends.
pub trait OdbStore: Send + Sync {
    /// Reads raw uncompressed object payload for a given OID.
    fn read_object(&self, oid: &Oid) -> FractalResult<Vec<u8>>;

    /// Atomically persists a raw loose object payload and returns its canonical OID.
    fn write_object(&self, object_type: &str, payload: &[u8]) -> FractalResult<Oid>;

    /// Checks existence of an object without fully reading its bytes.
    fn has_object(&self, oid: &Oid) -> bool;
}
