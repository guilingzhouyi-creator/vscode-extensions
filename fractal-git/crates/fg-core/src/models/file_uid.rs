//! Module: fg-core — Invariant File Unique Identifier (FileUid)
//! File Path: crates/fg-core/src/models/file_uid.rs
//! Architecture Role: Immutable 20-byte cryptographic identifier representing invariant file identity
//!   across renames, directory moves, and fractal branch forks.
//! Dependencies & Triggers: Fundamental value object consumed by VirtualInodeTable, SliceAuthorization,
//!   and bounded worktree transaction managers.
//! Responsibilities: Encapsulate 20-byte token, provide deterministic derivation from project context,
//!   and support hex formatting and Serde serialization without heap allocation.
//! Exit Semantics & Design Rationale: Enables O(1) permission validation invariant to file moves,
//!   eliminating name-drift vulnerability in multi-agent concurrent workflows.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-PRF-001`: Zero-allocation hot path and fixed byte array encapsulation

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::fmt;

use super::hex::{decode_fixed_hex, encode_hex, HexDecodeError};
use crate::error::{FractalError, FractalResult};

/// Character width of a hexadecimal FileUid rendering.
const HEX_WIDTH: usize = 40;

/// Compact 20-byte immutable file unique identifier.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FileUid([u8; 20]);

impl FileUid {
    /// Zero/Nil FileUid sentinel constant.
    pub const NIL: Self = Self([0u8; 20]);

    /// Constructs a FileUid from a raw 20-byte array.
    pub const fn from_bytes(bytes: [u8; 20]) -> Self {
        Self(bytes)
    }

    /// Borrows the internal 20-byte array.
    pub const fn as_bytes(&self) -> &[u8; 20] {
        &self.0
    }

    /// Deterministically derives a FileUid for a newly tracked file.
    pub fn derive(
        project_id: &str,
        agent_id: &str,
        rel_path: &str,
        epoch_nanos: u64,
        salt: u64,
    ) -> Self {
        let mut hasher = Sha1::new();
        hasher.update(b"TAXIS_FILE_UID_V1\0");
        hasher.update(project_id.as_bytes());
        hasher.update(b"\0");
        hasher.update(agent_id.as_bytes());
        hasher.update(b"\0");
        hasher.update(rel_path.as_bytes());
        hasher.update(b"\0");
        hasher.update(epoch_nanos.to_be_bytes());
        hasher.update(salt.to_be_bytes());

        let result = hasher.finalize();
        let mut bytes = [0u8; 20];
        bytes.copy_from_slice(&result);
        Self(bytes)
    }

    /// Formats the FileUid into a 40-character lowercase hexadecimal string.
    pub fn to_hex(&self) -> String {
        encode_hex(&self.0)
    }

    /// Parses a 40-character hexadecimal string into a FileUid.
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
                "Invalid FileUid hex length: expected {HEX_WIDTH}, got {actual}"
            )),
            HexDecodeError::NonHex => {
                FractalError::ObjectCodec(format!("Invalid hex byte in FileUid '{hex}'"))
            }
        })?;
        Ok(Self(bytes))
    }
}

impl fmt::Debug for FileUid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "FileUid({})", self.to_hex())
    }
}

impl fmt::Display for FileUid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl Serialize for FileUid {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for FileUid {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let hex_string = String::deserialize(deserializer)?;
        Self::from_hex(&hex_string).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_uid_derivation_deterministic() {
        let uid1 = FileUid::derive("my-game", "agent-1", "src/main.rs", 1000, 42);
        let uid2 = FileUid::derive("my-game", "agent-1", "src/main.rs", 1000, 42);
        let uid3 = FileUid::derive("my-game", "agent-1", "src/main.rs", 1001, 42);

        assert_eq!(uid1, uid2);
        assert_ne!(uid1, uid3);
        assert_ne!(uid1, FileUid::NIL);
    }

    #[test]
    fn test_file_uid_hex_roundtrip() {
        let uid = FileUid::derive("auto-refactor", "agent-x", "lib.rs", 9999, 123);
        let hex = uid.to_hex();
        assert_eq!(hex.len(), 40);

        let parsed = FileUid::from_hex(&hex).expect("valid hex");
        assert_eq!(uid, parsed);
    }

    #[test]
    fn test_file_uid_serde_json() {
        let uid = FileUid::derive("governance", "admin", "config.json", 555, 77);
        let serialized = serde_json::to_string(&uid).expect("serialize");
        let deserialized: FileUid = serde_json::from_str(&serialized).expect("deserialize");
        assert_eq!(uid, deserialized);
    }

    #[test]
    fn test_invalid_hex() {
        assert!(FileUid::from_hex("short").is_err());
        assert!(FileUid::from_hex("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz").is_err());
    }
}
