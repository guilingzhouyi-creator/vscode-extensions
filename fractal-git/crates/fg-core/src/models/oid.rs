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

/// Cryptographic hash algorithm families for object identification and audit chains.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
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
    pub const fn digest_length(&self) -> usize {
        match self {
            Self::Sha1 => 20,
            Self::Sha256 | Self::Sm3 => 32,
        }
    }

    /// Backward-compatible alias for `digest_length`.
    pub const fn digest_len(&self) -> usize {
        self.digest_length()
    }
}

/// Extended multi-algorithm cryptographic object identifier supporting Git SHA-1 (20 bytes),
/// SHA-256 (32 bytes), and SM3 (32 bytes) with 100% backward compatibility for 20-byte SHA-1 APIs.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Oid {
    algo: HashAlgorithm,
    bytes: [u8; 32],
}

impl Oid {
    /// Zero OID constant (40 zeros in Git SHA-1).
    pub const ZERO: Self = Self {
        algo: HashAlgorithm::Sha1,
        bytes: [0u8; 32],
    };

    /// Constructs an Oid from 20 raw SHA-1 bytes.
    pub const fn from_bytes(raw: [u8; 20]) -> Self {
        let mut bytes = [0u8; 32];
        let mut i = 0;
        while i < 20 {
            bytes[i] = raw[i];
            i += 1;
        }
        Self {
            algo: HashAlgorithm::Sha1,
            bytes,
        }
    }

    /// Constructs an Oid from 20 raw SHA-1 bytes.
    pub const fn from_sha1(raw: [u8; 20]) -> Self {
        Self::from_bytes(raw)
    }

    /// Constructs an Oid from 32 raw SHA-256 bytes.
    pub const fn from_sha256(raw: [u8; 32]) -> Self {
        Self {
            algo: HashAlgorithm::Sha256,
            bytes: raw,
        }
    }

    /// Constructs an Oid from an SM3 32-byte digest preserving full 32-byte digest fidelity.
    pub const fn from_sm3(digest: [u8; 32]) -> Self {
        Self {
            algo: HashAlgorithm::Sm3,
            bytes: digest,
        }
    }

    /// Constructs an Oid from a dynamic slice of either 20 or 32 bytes.
    pub fn from_slice(slice: &[u8]) -> FractalResult<Self> {
        match slice.len() {
            20 => {
                let mut raw = [0u8; 20];
                raw.copy_from_slice(slice);
                Ok(Self::from_bytes(raw))
            }
            32 => {
                let mut raw = [0u8; 32];
                raw.copy_from_slice(slice);
                Ok(Self::from_sha256(raw))
            }
            len => Err(FractalError::ObjectCodec(format!(
                "Invalid raw OID byte length: expected 20 or 32, got {len}"
            ))),
        }
    }

    /// Parses a hexadecimal string into an Oid (40 chars for SHA-1, 64 chars for SHA-256).
    pub fn from_hex(hex_str: &str) -> FractalResult<Self> {
        let hex = hex_str.trim();
        match hex.len() {
            40 => {
                let bytes = decode_fixed_hex::<20>(hex).map_err(|decode_err| match decode_err {
                    HexDecodeError::Length { actual, .. } => FractalError::ObjectCodec(format!(
                        "Invalid OID hex length: expected {HEX_WIDTH}, got {actual}"
                    )),
                    HexDecodeError::NonHex => {
                        FractalError::ObjectCodec(format!("Invalid hex byte in OID '{hex}'"))
                    }
                })?;
                Ok(Self::from_bytes(bytes))
            }
            64 => {
                let bytes = decode_fixed_hex::<32>(hex).map_err(|decode_err| match decode_err {
                    HexDecodeError::Length { actual, .. } => FractalError::ObjectCodec(format!(
                        "Invalid OID hex length: expected 64, got {actual}"
                    )),
                    HexDecodeError::NonHex => {
                        FractalError::ObjectCodec(format!("Invalid hex byte in OID '{hex}'"))
                    }
                })?;
                Ok(Self::from_sha256(bytes))
            }
            actual => Err(FractalError::ObjectCodec(format!(
                "Invalid OID hex length: expected {HEX_WIDTH} or 64, got {actual}"
            ))),
        }
    }

    /// Parses a hexadecimal string with an explicit algorithm requirement.
    pub fn from_hex_with_algorithm(hex_str: &str, algo: HashAlgorithm) -> FractalResult<Self> {
        let hex = hex_str.trim();
        let expected_len = algo.digest_length() * 2;
        if hex.len() != expected_len {
            return Err(FractalError::ObjectCodec(format!(
                "Invalid OID hex length for {}: expected {expected_len}, got {}",
                algo.as_str(),
                hex.len()
            )));
        }
        match algo {
            HashAlgorithm::Sha1 => {
                let bytes = decode_fixed_hex::<20>(hex).map_err(|_| {
                    FractalError::ObjectCodec(format!("Invalid hex byte in OID '{hex}'"))
                })?;
                Ok(Self::from_bytes(bytes))
            }
            HashAlgorithm::Sha256 => {
                let bytes = decode_fixed_hex::<32>(hex).map_err(|_| {
                    FractalError::ObjectCodec(format!("Invalid hex byte in OID '{hex}'"))
                })?;
                Ok(Self::from_sha256(bytes))
            }
            HashAlgorithm::Sm3 => {
                let bytes = decode_fixed_hex::<32>(hex).map_err(|_| {
                    FractalError::ObjectCodec(format!("Invalid hex byte in OID '{hex}'"))
                })?;
                Ok(Self::from_sm3(bytes))
            }
        }
    }

    /// Access primary 20-byte binary array reference (100% backward compatible with Git SHA-1 APIs).
    pub fn as_bytes(&self) -> &[u8; 20] {
        let slice = &self.bytes[..20];
        <&[u8; 20]>::try_from(slice).expect("20-byte slice conversion")
    }

    /// Access variable-length digest slice according to hash algorithm (20 or 32 bytes).
    pub fn as_slice(&self) -> &[u8] {
        &self.bytes[..self.algo.digest_length()]
    }

    /// Returns lowercase hexadecimal representation (40 or 64 characters).
    pub fn to_hex(&self) -> String {
        encode_hex(self.as_slice())
    }

    /// Returns the underlying hash algorithm family of this OID.
    pub const fn algorithm(&self) -> HashAlgorithm {
        self.algo
    }

    /// Self-projection retaining full digest structure.
    pub fn to_canonical_oid(&self) -> Self {
        *self
    }

    /// Backward-compatible alias for `to_canonical_oid`.
    pub fn to_standard_oid(&self) -> Self {
        *self
    }

    /// Converts this Oid into an explicit TypedOid enum.
    pub fn to_typed(&self) -> TypedOid {
        match self.algo {
            HashAlgorithm::Sha1 => TypedOid::Sha1(*self.as_bytes()),
            HashAlgorithm::Sha256 => TypedOid::Sha256(self.bytes),
            HashAlgorithm::Sm3 => TypedOid::Sm3(self.bytes),
        }
    }
}

/// Multi-algorithm cryptographic object identifier enum for sovereign and standard Git trees.
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
        encode_hex(self.as_bytes())
    }

    /// Borrows the raw digest byte slice.
    pub fn as_bytes(&self) -> &[u8] {
        match self {
            Self::Sha1(bytes) => bytes,
            Self::Sha256(bytes) | Self::Sm3(bytes) => bytes,
        }
    }

    /// Backward-compatible alias for `as_bytes`.
    pub fn as_slice(&self) -> &[u8] {
        self.as_bytes()
    }

    /// Projects this typed OID onto a canonical OID without losing 32-byte digest precision.
    pub fn to_canonical_oid(&self) -> Oid {
        match self {
            Self::Sha1(bytes) => Oid::from_bytes(*bytes),
            Self::Sha256(bytes) => Oid::from_sha256(*bytes),
            Self::Sm3(bytes) => Oid::from_sm3(*bytes),
        }
    }

    /// Backward-compatible alias for `to_canonical_oid`.
    pub fn to_standard_oid(&self) -> Oid {
        self.to_canonical_oid()
    }
}

impl From<TypedOid> for Oid {
    fn from(typed: TypedOid) -> Self {
        typed.to_canonical_oid()
    }
}

impl From<Oid> for TypedOid {
    fn from(oid: Oid) -> Self {
        oid.to_typed()
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
            match self.algo {
                HashAlgorithm::Sha1 => serializer.serialize_bytes(self.as_bytes()),
                HashAlgorithm::Sha256 => {
                    let mut buf = [0u8; 33];
                    buf[0] = 0x01;
                    buf[1..33].copy_from_slice(&self.bytes);
                    serializer.serialize_bytes(&buf)
                }
                HashAlgorithm::Sm3 => {
                    let mut buf = [0u8; 33];
                    buf[0] = 0x02;
                    buf[1..33].copy_from_slice(&self.bytes);
                    serializer.serialize_bytes(&buf)
                }
            }
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
                formatter.write_str("a 40/64-character hex string or 20/32/33 raw bytes for Oid")
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
                match byte_slice.len() {
                    20 => {
                        let mut buffer = [0u8; 20];
                        buffer.copy_from_slice(byte_slice);
                        Ok(Oid::from_bytes(buffer))
                    }
                    32 => {
                        let mut buffer = [0u8; 32];
                        buffer.copy_from_slice(byte_slice);
                        Ok(Oid::from_sha256(buffer))
                    }
                    33 => {
                        let mut buffer = [0u8; 32];
                        buffer.copy_from_slice(&byte_slice[1..33]);
                        match byte_slice[0] {
                            0x01 => Ok(Oid::from_sha256(buffer)),
                            0x02 => Ok(Oid::from_sm3(buffer)),
                            tag => Err(serde::de::Error::custom(format!(
                                "Unknown OID algorithm tag {tag} in binary payload"
                            ))),
                        }
                    }
                    len => Err(serde::de::Error::invalid_length(len, &self)),
                }
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::SeqAccess<'de>,
            {
                let mut buffer = Vec::with_capacity(33);
                while let Some(byte_val) = seq.next_element()? {
                    buffer.push(byte_val);
                    if buffer.len() > 33 {
                        return Err(serde::de::Error::invalid_length(buffer.len(), &self));
                    }
                }
                self.visit_bytes(&buffer)
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
        assert_eq!(standard.as_slice(), &sm3_bytes[..]);
        let direct = Oid::from_sm3(sm3_bytes);
        assert_eq!(standard, direct);
        assert_eq!(direct.as_slice().len(), 32);
        assert_eq!(direct.algorithm(), HashAlgorithm::Sm3);
    }

    #[test]
    fn test_oid_binary_serde_preserves_algorithms() {
        use serde::de::Deserialize;
        let oid_sm3 = Oid::from_sm3([0xab; 32]);
        let mut buf_sm3 = [0u8; 33];
        buf_sm3[0] = 0x02;
        buf_sm3[1..33].copy_from_slice(oid_sm3.as_slice());
        let de_sm3 = Oid::deserialize(serde::de::value::BytesDeserializer::<serde::de::value::Error>::new(&buf_sm3))
            .expect("deserialize sm3");
        assert_eq!(de_sm3.algorithm(), HashAlgorithm::Sm3);
        assert_eq!(de_sm3, oid_sm3);

        let oid_sha256 = Oid::from_sha256([0xcd; 32]);
        let mut buf_sha256 = [0u8; 33];
        buf_sha256[0] = 0x01;
        buf_sha256[1..33].copy_from_slice(oid_sha256.as_slice());
        let de_sha256 = Oid::deserialize(serde::de::value::BytesDeserializer::<serde::de::value::Error>::new(&buf_sha256))
            .expect("deserialize sha256");
        assert_eq!(de_sha256.algorithm(), HashAlgorithm::Sha256);
        assert_eq!(de_sha256, oid_sha256);

        let oid_sha1 = Oid::from_bytes([0x12; 20]);
        let de_sha1 = Oid::deserialize(serde::de::value::BytesDeserializer::<serde::de::value::Error>::new(oid_sha1.as_bytes()))
            .expect("deserialize sha1");
        assert_eq!(de_sha1.algorithm(), HashAlgorithm::Sha1);
        assert_eq!(de_sha1, oid_sha1);
    }
}
