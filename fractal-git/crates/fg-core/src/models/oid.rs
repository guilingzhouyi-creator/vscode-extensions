//! Module: fg-core — Atomic Object Identifier (Oid)
//! File Path: crates/fg-core/src/models/oid.rs
//! Architecture Role: Pure immutable 40-character hexadecimal and 20-byte binary
//!   Git OID representation.

use serde::{Deserialize, Serialize};
use std::fmt;

use crate::error::{FractalError, FractalResult};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Oid([u8; 20]);

impl Oid {
    /// Zero OID constant (40 zeros).
    pub const ZERO: Self = Self([0u8; 20]);

    /// Constructs an Oid from 20 raw bytes.
    pub const fn from_bytes(bytes: [u8; 20]) -> Self {
        Self(bytes)
    }

    /// Parses a 40-character hexadecimal string into an Oid.
    pub fn from_hex(hex_str: &str) -> FractalResult<Self> {
        let hex = hex_str.trim();
        if hex.len() != 40 {
            return Err(FractalError::ObjectCodec(format!(
                "Invalid OID hex length: expected 40, got {}",
                hex.len()
            )));
        }

        let mut bytes = [0u8; 20];
        for i in 0..20 {
            bytes[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).map_err(|parse_err| {
                FractalError::ObjectCodec(format!(
                    "Invalid hex byte in OID '{}': {}",
                    hex, parse_err
                ))
            })?;
        }

        Ok(Self(bytes))
    }

    /// Access raw 20-byte binary slice.
    pub fn as_bytes(&self) -> &[u8; 20] {
        &self.0
    }

    /// Returns lowercase 40-character hexadecimal representation.
    pub fn to_hex(&self) -> String {
        let mut hex = String::with_capacity(40);
        for byte in self.0 {
            use std::fmt::Write;
            let _ = write!(&mut hex, "{:02x}", byte);
        }
        hex
    }
}

impl fmt::Debug for Oid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Oid({})", self.to_hex())
    }
}

impl fmt::Display for Oid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_hex())
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
