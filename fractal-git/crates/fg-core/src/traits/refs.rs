//! Module: fg-core — Reference Store Abstraction Trait
//! File Path: crates/fg-core/src/traits/refs.rs
//! Architecture Role: Decouples reference resolution, reading, and atomic CAS updating
//!   from physical storage mechanisms (loose ref files, packed-refs, in-memory refs).

use crate::error::FractalResult;
use crate::models::Oid;

/// Abstract interface for Git reference management backends.
pub trait RefStore: Send + Sync {
    /// Reads the OID pointed to by target reference string.
    fn get_ref(&self, ref_name: &str) -> FractalResult<Option<Oid>>;

    /// Atomically updates a reference with compare-and-swap (CAS) safety.
    fn update_ref(
        &self,
        ref_name: &str,
        new_oid: &Oid,
        expected_old: Option<&Oid>,
    ) -> FractalResult<()>;

    /// Deletes a reference.
    fn delete_ref(&self, ref_name: &str) -> FractalResult<bool>;
}
