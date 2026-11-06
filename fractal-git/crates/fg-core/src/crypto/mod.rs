//! Module: fg-core::crypto — Sovereign Cryptographic Algorithms
//! File Path: crates/fg-core/src/crypto/mod.rs
//! Architecture Role: Domain cryptography primitives supporting domestic national standards.
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001.

pub mod hmac;
pub mod sm3;

pub use hmac::hmac_sm3;
pub use sm3::{sm3_hash, Sm3Hasher, SM3_BLOCK_SIZE_BYTES, SM3_DIGEST_SIZE_BYTES};
