//! Module: fg-object — Canonical Git Blob Codec
//! File Path: crates/fg-object/src/blob.rs
//! Architecture Role: Pure Git blob object primitives, encoding payload and computing
//!   canonical SHA-1 OID identifiers.

use fg_core::models::Oid;
use sha1::{Digest, Sha1};

/// Canonical Git blob object wrapping uncompressed binary file content and computed OID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitBlob {
    payload: Vec<u8>,
    oid: Oid,
    hex: String,
}

impl GitBlob {
    /// Constructs a canonical GitBlob from raw owned payload bytes, computing its SHA-1 OID.
    pub fn from_bytes(payload: Vec<u8>) -> Self {
        let oid = Self::compute_blob_oid(&payload);
        let hex = oid.to_hex();
        Self { payload, oid, hex }
    }

    /// Access the 40-character SHA-1 hexadecimal identifier.
    pub fn oid(&self) -> &str {
        &self.hex
    }

    /// Access the 40-character SHA-1 hexadecimal identifier (explicit getter).
    pub fn oid_hex(&self) -> &str {
        &self.hex
    }

    /// Access the raw 20-byte Oid representation.
    pub fn raw_oid(&self) -> &Oid {
        &self.oid
    }

    /// Access the raw payload slice.
    pub fn payload(&self) -> &[u8] {
        &self.payload
    }

    /// Returns the raw Git loose object format: `blob <size>\0<payload>`
    pub fn to_raw_object(&self) -> Vec<u8> {
        let mut header_buf = [0u8; 32];
        let header_len = {
            use std::io::Write;
            let mut cursor = std::io::Cursor::new(&mut header_buf[..]);
            let _ = write!(cursor, "blob {}\0", self.payload.len());
            cursor.position() as usize
        };
        let mut raw = Vec::with_capacity(header_len + self.payload.len());
        raw.extend_from_slice(&header_buf[..header_len]);
        raw.extend_from_slice(&self.payload);
        raw
    }

    /// Computes the canonical Git SHA-1 OID for payload bytes with zero heap allocation.
    pub fn compute_blob_oid(payload_bytes: &[u8]) -> Oid {
        let mut header_buf = [0u8; 32];
        let header_len = {
            use std::io::Write;
            let mut cursor = std::io::Cursor::new(&mut header_buf[..]);
            let _ = write!(cursor, "blob {}\0", payload_bytes.len());
            cursor.position() as usize
        };
        let mut hasher = Sha1::new();
        hasher.update(&header_buf[..header_len]);
        hasher.update(payload_bytes);
        let hash: [u8; 20] = hasher.finalize().into();
        Oid::from_bytes(hash)
    }
}
