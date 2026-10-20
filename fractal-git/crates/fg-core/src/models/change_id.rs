//! Module: fg-core — Stable Change Identifier (ChangeId)
//! File Path: crates/fg-core/src/models/change_id.rs
//! Architecture Role: Jujutsu-inspired 16-byte immutable stable Change-Id representation,
//!   preserving identity across commits, amends, rebases, and multi-agent evolution.
//! Dependencies & Triggers: Utilized by fg-object, fg-topology, and Taxis CLI.
//! Responsibilities: Hex serialization, deterministic derivation, and format parsing.
//! Exit Semantics & Design Rationale: Provides stable cross-branch mutation tracking without
//!   fragile commit message parsing or patch-id heuristics.

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::fmt;

use crate::error::{FractalError, FractalResult};

/// Immutable 16-byte stable change identifier.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ChangeId([u8; 16]);

impl ChangeId {
    /// Zero ChangeId constant (32 zeros).
    pub const ZERO: Self = Self([0u8; 16]);

    /// Constructs a ChangeId from 16 raw bytes.
    pub const fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }

    /// Access raw 16-byte binary slice.
    pub fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }

    /// Parses a 32-character hexadecimal string into a ChangeId.
    pub fn from_hex(hex_str: &str) -> FractalResult<Self> {
        let trimmed_hex = hex_str.trim();
        if trimmed_hex.len() != 32 {
            return Err(FractalError::ObjectCodec(format!(
                "Invalid ChangeId hex length: expected 32, got {}",
                trimmed_hex.len()
            )));
        }

        let mut byte_buffer = [0u8; 16];
        for index in 0..16 {
            byte_buffer[index] = u8::from_str_radix(&trimmed_hex[index * 2..index * 2 + 2], 16)
                .map_err(|parse_err| {
                    FractalError::ObjectCodec(format!(
                        "Invalid hex byte in ChangeId '{}': {}",
                        trimmed_hex, parse_err
                    ))
                })?;
        }

        Ok(Self(byte_buffer))
    }

    /// Returns lowercase 32-character hexadecimal representation.
    pub fn to_hex(&self) -> String {
        let mut hex_text = String::with_capacity(32);
        for byte_val in self.0 {
            use std::fmt::Write;
            let _ = write!(&mut hex_text, "{:02x}", byte_val);
        }
        hex_text
    }

    /// Deterministically derives a stable ChangeId from actor, card or topic, and timestamp.
    pub fn derive(actor: &str, topic_or_card: &str, timestamp_ms: i64) -> Self {
        let mut hasher = Sha1::new();
        hasher.update(b"change_id\0");
        hasher.update(actor.as_bytes());
        hasher.update(b"\0");
        hasher.update(topic_or_card.as_bytes());
        hasher.update(b"\0");
        hasher.update(timestamp_ms.to_be_bytes());
        let digest_bytes: [u8; 20] = hasher.finalize().into();

        let mut truncated = [0u8; 16];
        truncated.copy_from_slice(&digest_bytes[..16]);
        Self(truncated)
    }
}

impl fmt::Debug for ChangeId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "ChangeId({})", self.to_hex())
    }
}

impl fmt::Display for ChangeId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.to_hex())
    }
}

impl Serialize for ChangeId {
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

impl<'de> Deserialize<'de> for ChangeId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct ChangeIdVisitor;

        impl<'de> serde::de::Visitor<'de> for ChangeIdVisitor {
            type Value = ChangeId;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a 32-character hex string or 16 raw bytes for ChangeId")
            }

            fn visit_str<E>(self, hex_text: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                ChangeId::from_hex(hex_text).map_err(serde::de::Error::custom)
            }

            fn visit_bytes<E>(self, byte_slice: &[u8]) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                if byte_slice.len() == 16 {
                    let mut buffer = [0u8; 16];
                    buffer.copy_from_slice(byte_slice);
                    Ok(ChangeId::from_bytes(buffer))
                } else {
                    Err(serde::de::Error::invalid_length(byte_slice.len(), &self))
                }
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::SeqAccess<'de>,
            {
                let mut buffer = [0u8; 16];
                for (index, byte_slot) in buffer.iter_mut().enumerate() {
                    *byte_slot = seq
                        .next_element()?
                        .ok_or_else(|| serde::de::Error::invalid_length(index, &self))?;
                }
                Ok(ChangeId::from_bytes(buffer))
            }
        }

        if deserializer.is_human_readable() {
            deserializer.deserialize_str(ChangeIdVisitor)
        } else {
            deserializer.deserialize_bytes(ChangeIdVisitor)
        }
    }
}
