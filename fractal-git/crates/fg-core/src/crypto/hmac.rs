//! Module: fg-core::crypto::hmac — Sovereign HMAC-SM3 Implementation
//! File Path: crates/fg-core/src/crypto/hmac.rs
//! Architecture Role: RFC 2104 compliant HMAC-SM3 message authentication code.
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001 (zero transient heap allocation).

use super::sm3::{sm3_hash, Sm3Hasher, SM3_BLOCK_SIZE_BYTES, SM3_DIGEST_SIZE_BYTES};

/// Computes RFC 2104 compliant HMAC-SM3 over the given secret key and message payload.
pub fn hmac_sm3(secret_key: &[u8], message_payload: &[u8]) -> [u8; SM3_DIGEST_SIZE_BYTES] {
    let mut normalized_key = [0u8; SM3_BLOCK_SIZE_BYTES];
    if secret_key.len() > SM3_BLOCK_SIZE_BYTES {
        let key_digest = sm3_hash(secret_key);
        normalized_key[..SM3_DIGEST_SIZE_BYTES].copy_from_slice(&key_digest);
    } else {
        normalized_key[..secret_key.len()].copy_from_slice(secret_key);
    }
    let mut inner_padded_key = [0x36u8; SM3_BLOCK_SIZE_BYTES];
    let mut outer_padded_key = [0x5cu8; SM3_BLOCK_SIZE_BYTES];
    for byte_index in 0..SM3_BLOCK_SIZE_BYTES {
        inner_padded_key[byte_index] ^= normalized_key[byte_index];
        outer_padded_key[byte_index] ^= normalized_key[byte_index];
    }
    let mut inner_hasher = Sm3Hasher::new();
    inner_hasher.update(&inner_padded_key);
    inner_hasher.update(message_payload);
    let inner_digest = inner_hasher.finalize();

    let mut outer_hasher = Sm3Hasher::new();
    outer_hasher.update(&outer_padded_key);
    outer_hasher.update(&inner_digest);
    outer_hasher.finalize()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hmac_sm3_deterministic() {
        let secret_key = b"key-secret-64-byte-aligned-token-for-taxis-kernel-governance-000";
        let message_payload = b"payload";
        let mac_first = hmac_sm3(secret_key, message_payload);
        assert_ne!(mac_first, [0u8; SM3_DIGEST_SIZE_BYTES]);
        let mac_second = hmac_sm3(secret_key, message_payload);
        assert_eq!(mac_first, mac_second);
    }
}
