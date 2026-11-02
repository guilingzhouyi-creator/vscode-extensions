//! Module: fg-core — Atomic Object Identifier (Oid)
//! File Path: crates/fg-core/src/models/oid.rs
//! Architecture Role: Pure immutable 40-character hexadecimal and 20-byte binary
//!   Git OID representation.
//! Dependencies & Triggers: Fundamental value object used by all Taxis crates and CLI.
//! Responsibilities: Hex encoding/decoding, Serde serialization, and byte array encapsulation.
//! Exit Semantics & Design Rationale: Provides compact copyable representation with zero
//!   heap allocations and strict hex validation.

use serde::{Deserialize, Serialize};
use std::fmt;

use super::hex::{decode_fixed_hex, encode_hex, HexDecodeError};
use crate::error::{FractalError, FractalResult};

/// Character width of a hexadecimal OID rendering.
const HEX_WIDTH: usize = 40;

/// Compact 20-byte cryptographic object identifier representing standard Git SHA-1 hashes.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Oid([u8; 20]);

impl Oid {
    /// Zero OID constant (40 zeros).
    pub const ZERO: Self = Self([0u8; 20]);

    /// Constructs an Oid from 20 raw bytes.
    pub const fn from_bytes(bytes: [u8; 20]) -> Self {
        Self(bytes)
    }

    /// Parses a 40-character hexadecimal string into an Oid.
    ///
    /// # Errors
    ///
    /// Returns a typed codec error when the trimmed input is not exactly 40 bytes or holds a
    /// character outside the hexadecimal alphabet. Multi-byte input is rejected rather than
    /// sliced, so no character boundary can be crossed.
    pub fn from_hex(hex_str: &str) -> FractalResult<Self> {
        let hex = hex_str.trim();
        let bytes = decode_fixed_hex::<20>(hex).map_err(|decode_err| match decode_err {
            HexDecodeError::Length { actual, .. } => FractalError::ObjectCodec(format!(
                "Invalid OID hex length: expected {HEX_WIDTH}, got {actual}"
            )),
            HexDecodeError::NonHex => {
                FractalError::ObjectCodec(format!("Invalid hex byte in OID '{hex}'"))
            }
        })?;
        Ok(Self(bytes))
    }

    /// Access raw 20-byte binary slice.
    pub fn as_bytes(&self) -> &[u8; 20] {
        &self.0
    }

    /// Returns lowercase 40-character hexadecimal representation.
    pub fn to_hex(&self) -> String {
        encode_hex(&self.0)
    }

    /// Derives an Oid from an SM3 32-byte digest by prefix projection.
    pub fn from_sm3(digest: [u8; 32]) -> Self {
        let mut bytes = [0u8; 20];
        bytes.copy_from_slice(&digest[..20]);
        Self(bytes)
    }
}

/// Cryptographic hash algorithm families for object identification and audit chains.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HashAlgorithm {
    /// Git standard SHA-1 (160 bits / 20 bytes).
    Sha1,
    /// Modern Git SHA-256 (256 bits / 32 bytes).
    Sha256,
    /// Chinese National Standard SM3 (GB/T 32918.4 / GM/T 0004-2012, 256 bits / 32 bytes).
    Sm3,
}

impl HashAlgorithm {
    /// Returns the canonical lowercase string identifier of this hash algorithm.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Sha1 => "sha1",
            Self::Sha256 => "sha256",
            Self::Sm3 => "sm3",
        }
    }

    /// Returns the digest byte length produced by this algorithm.
    pub const fn digest_len(&self) -> usize {
        match self {
            Self::Sha1 => 20,
            Self::Sha256 | Self::Sm3 => 32,
        }
    }
}

/// Multi-algorithm cryptographic object identifier for sovereign and standard Git trees.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Serialize, Deserialize)]
pub enum TypedOid {
    Sha1([u8; 20]),
    Sha256([u8; 32]),
    Sm3([u8; 32]),
}

impl TypedOid {
    /// Returns the underlying hash algorithm family of this typed OID.
    pub const fn algorithm(&self) -> HashAlgorithm {
        match self {
            Self::Sha1(_) => HashAlgorithm::Sha1,
            Self::Sha256(_) => HashAlgorithm::Sha256,
            Self::Sm3(_) => HashAlgorithm::Sm3,
        }
    }

    /// Renders the full hexadecimal representation of the digest.
    pub fn to_hex(&self) -> String {
        match self {
            Self::Sha1(bytes) => encode_hex(bytes),
            Self::Sha256(bytes) | Self::Sm3(bytes) => encode_hex(bytes),
        }
    }

    /// Borrows the raw digest byte slice.
    pub fn as_slice(&self) -> &[u8] {
        match self {
            Self::Sha1(bytes) => bytes,
            Self::Sha256(bytes) | Self::Sm3(bytes) => bytes,
        }
    }

    /// Projects this typed OID onto a canonical 20-byte Git plumbing OID.
    pub fn to_standard_oid(&self) -> Oid {
        match self {
            Self::Sha1(bytes) => Oid::from_bytes(*bytes),
            Self::Sha256(bytes) | Self::Sm3(bytes) => {
                let mut truncated = [0u8; 20];
                truncated.copy_from_slice(&bytes[..20]);
                Oid::from_bytes(truncated)
            }
        }
    }
}

impl fmt::Debug for Oid {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "Oid({})", self.to_hex())
    }
}

impl fmt::Display for Oid {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.to_hex())
    }
}

impl Serialize for Oid {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        if serializer.is_human_readable() {
            serializer.serialize_str(&self.to_hex())
        } else {
            serializer.serialize_bytes(&self.0)
        }
    }
}

impl<'de> Deserialize<'de> for Oid {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct OidVisitor;

        impl<'de> serde::de::Visitor<'de> for OidVisitor {
            type Value = Oid;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a 40-character hex string or 20 raw bytes for Oid")
            }

            fn visit_str<E>(self, hex_text: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Oid::from_hex(hex_text).map_err(serde::de::Error::custom)
            }

            fn visit_bytes<E>(self, byte_slice: &[u8]) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                if byte_slice.len() == 20 {
                    let mut buffer = [0u8; 20];
                    buffer.copy_from_slice(byte_slice);
                    Ok(Oid::from_bytes(buffer))
                } else {
                    Err(serde::de::Error::invalid_length(byte_slice.len(), &self))
                }
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::SeqAccess<'de>,
            {
                let mut buffer = [0u8; 20];
                for (index, byte_slot) in buffer.iter_mut().enumerate() {
                    *byte_slot = seq
                        .next_element()?
                        .ok_or_else(|| serde::de::Error::invalid_length(index, &self))?;
                }
                Ok(Oid::from_bytes(buffer))
            }
        }

        if deserializer.is_human_readable() {
            deserializer.deserialize_str(OidVisitor)
        } else {
            deserializer.deserialize_bytes(OidVisitor)
        }
    }
}

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

/// Lightweight direct-indexing hasher for uniformly distributed 20-byte Oid digests.
#[derive(Default)]
pub struct FastOidHasher(u64);

impl Hasher for FastOidHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        if bytes.len() >= 8 {
            let mut arr = [0u8; 8];
            arr.copy_from_slice(&bytes[..8]);
            self.0 = u64::from_ne_bytes(arr);
        } else {
            for &byte_val in bytes {
                self.0 = self.0.wrapping_mul(31).wrapping_add(byte_val as u64);
            }
        }
    }
}

/// Zero-allocation, high-throughput HashSet specialized for 20-byte Oids.
pub type FastOidSet = HashSet<Oid, BuildHasherDefault<FastOidHasher>>;

/// Zero-allocation, high-throughput HashMap specialized for 20-byte Oids.
pub type FastOidMap<V> = HashMap<Oid, V, BuildHasherDefault<FastOidHasher>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_typed_oid_and_sm3_projection() {
        let sm3_bytes = [0x5au8; 32];
        let typed = TypedOid::Sm3(sm3_bytes);
        assert_eq!(typed.algorithm(), HashAlgorithm::Sm3);
        assert_eq!(typed.as_slice().len(), 32);
        let standard = typed.to_standard_oid();
        assert_eq!(standard.as_bytes(), &sm3_bytes[..20]);
        let direct = Oid::from_sm3(sm3_bytes);
        assert_eq!(standard, direct);
    }
}
