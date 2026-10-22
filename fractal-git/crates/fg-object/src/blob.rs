//! Module: fg-object — Canonical Git Blob Codec
//! File Path: crates/fg-object/src/blob.rs
//! Architecture Role: Pure Git blob object primitives, encoding payload and computing canonical
//!   SHA-1 object ids.
//! Dependencies & Triggers: Consumed by fg-storage materialization and every worktree write path.
//! Responsibilities: Hold a blob payload, expose its typed object id, and render the loose object
//!   framing Git expects.
//! Exit Semantics & Design Rationale:
//!   - The hex rendering is derived on demand rather than stored beside the id. Keeping both would
//!     allow them to disagree, and a disagreement is undetectable until a push is rejected.
//!   - `oid()` returns the typed value object; `oid_hex()` is the display projection. There is no
//!     third `raw_oid` spelling — three names for one field is how call sites drift apart.

use fg_core::models::{compute_object_oid, raw_object, ObjectKind, Oid};

/// Canonical Git blob object wrapping uncompressed binary file content and its computed object id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitBlob {
    payload: Vec<u8>,
    oid: Oid,
}

impl GitBlob {
    /// Constructs a canonical blob from raw owned payload bytes, computing its SHA-1 object id.
    pub fn from_bytes(payload: Vec<u8>) -> Self {
        let oid = Self::compute_blob_oid(&payload);
        Self { payload, oid }
    }

    /// Returns the typed 20-byte object id.
    pub const fn oid(&self) -> &Oid {
        &self.oid
    }

    /// Returns the 40-character lowercase hexadecimal object id.
    pub fn oid_hex(&self) -> String {
        self.oid.to_hex()
    }

    /// Returns the raw payload slice.
    pub fn payload(&self) -> &[u8] {
        &self.payload
    }

    /// Returns the raw Git loose object format: `blob <size>\0<payload>`
    pub fn to_raw_object(&self) -> Vec<u8> {
        raw_object(ObjectKind::Blob, &self.payload)
    }

    /// Computes the canonical Git SHA-1 object id for payload bytes.
    pub fn compute_blob_oid(payload_bytes: &[u8]) -> Oid {
        compute_object_oid(ObjectKind::Blob, payload_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::GitBlob;

    #[test]
    fn empty_blob_matches_git_object_id() {
        // `git hash-object -t blob /dev/null` yields this well-known id.
        let blob = GitBlob::from_bytes(Vec::new());
        assert_eq!(blob.oid_hex(), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    }

    #[test]
    fn known_content_matches_git_object_id() {
        // `printf 'hello\n' | git hash-object -t blob --stdin`
        let blob = GitBlob::from_bytes(b"hello\n".to_vec());
        assert_eq!(blob.oid_hex(), "ce013625030ba8dba906f756967f9e9ca394464a");
    }

    #[test]
    fn oid_accessors_agree() {
        let blob = GitBlob::from_bytes(b"payload".to_vec());
        assert_eq!(blob.oid().to_hex(), blob.oid_hex());
    }
}
