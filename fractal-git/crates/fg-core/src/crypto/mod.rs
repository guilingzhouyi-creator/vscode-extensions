//! Module: fg-core::crypto — Sovereign Cryptographic Algorithms
//! File Path: crates/fg-core/src/crypto/mod.rs
//! Architecture Role: Domain cryptography primitives supporting domestic national standards.
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001.

pub mod digest;

pub use digest::{hmac_sm3, sm3_hash, Sm3Hasher};
