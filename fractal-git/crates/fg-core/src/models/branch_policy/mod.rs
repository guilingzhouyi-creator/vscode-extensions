//! Module: fg-core — Encrypted Binary Branch Policy & Key Derivation Facade
//! File Path: crates/fg-core/src/models/branch_policy/mod.rs
//! Architecture Role: Organizes branch policy types, binary wire codecs, TXPF envelopes,
//!   and implements SM3 key derivation, CTR transformation, and TXSL seal verification.

mod envelope;
mod payload;
#[cfg(test)]
mod tests;
mod types;
mod wire_decode;
mod wire_encode;

use crate::constants::branch::POLICY_SEAL_MAGIC;
use crate::crypto::{hmac_sm3, sm3_hash, Sm3Hasher, SM3_DIGEST_SIZE_BYTES};
use crate::error::{FractalError, FractalResult};
use crate::models::authority::ct_eq_bytes;

pub use envelope::{seal_policy_envelope, unseal_policy_envelope, POLICY_VAULT_HEADER_LEN};
pub use payload::SealedPolicyPayload;
pub use types::{BranchEnforcementTier, BranchPolicySpec};
pub use wire_decode::POLICY_REPO_ID_LEN;

/// Fixed byte length of the companion `TXSL` repository policy seal record.
pub const POLICY_SEAL_RECORD_LEN: usize = 56;

/// Encodes a tamper-evident repository seal binding `repo_id` when installing policy.
#[must_use]
pub fn encode_seal_record(repo_id: &[u8; POLICY_REPO_ID_LEN]) -> [u8; POLICY_SEAL_RECORD_LEN] {
    let mut record = [0u8; POLICY_SEAL_RECORD_LEN];
    record[..4].copy_from_slice(&POLICY_SEAL_MAGIC);
    record[4..6].copy_from_slice(&1u16.to_le_bytes());
    record[6..8].copy_from_slice(&0u16.to_le_bytes());
    record[8..24].copy_from_slice(repo_id);
    let tag = hmac_sm3(&derive_seal_key(), &record[..24]);
    record[24..POLICY_SEAL_RECORD_LEN].copy_from_slice(&tag);
    record
}

/// Verifies a repository policy seal record and extracts its authenticated `repo_id`.
///
/// # Errors
///
/// Returns [`FractalError::AuthProofInvalid`] or [`FractalError::PolicyViolation`] when corrupted.
pub fn verify_seal_record(record: &[u8]) -> FractalResult<[u8; POLICY_REPO_ID_LEN]> {
    if record.len() != POLICY_SEAL_RECORD_LEN {
        return Err(FractalError::PolicyViolation(format!(
            "invalid policy seal length (expected {POLICY_SEAL_RECORD_LEN}, got {})",
            record.len()
        )));
    }
    if record[..4] != POLICY_SEAL_MAGIC {
        return Err(FractalError::PolicyViolation(
            "invalid policy seal magic header".to_owned(),
        ));
    }
    let version = u16::from_le_bytes([record[4], record[5]]);
    if version != 1 {
        return Err(FractalError::PolicyViolation(format!(
            "unsupported policy seal version {version}"
        )));
    }
    let expected_tag = hmac_sm3(&derive_seal_key(), &record[..24]);
    if !ct_eq_bytes(&expected_tag, &record[24..POLICY_SEAL_RECORD_LEN]) {
        return Err(FractalError::AuthProofInvalid(
            "policy seal authentication failed (HMAC-SM3 mismatch)".to_owned(),
        ));
    }
    let mut repo_id = [0u8; POLICY_REPO_ID_LEN];
    repo_id.copy_from_slice(&record[8..24]);
    Ok(repo_id)
}

fn kernel_root_material() -> [u8; 32] {
    const PART_A: [u8; 16] = [
        0x4B, 0x91, 0xE2, 0x07, 0x3A, 0xC4, 0x6F, 0x18, 0x8D, 0x52, 0xB0, 0xE7, 0x11, 0x76, 0x29,
        0xAF,
    ];
    const PART_B: [u8; 16] = [
        0xD4, 0x38, 0x61, 0xBE, 0x95, 0x0C, 0x7A, 0xE3, 0x22, 0xF1, 0x4E, 0x89, 0x57, 0xA6, 0xC0,
        0x1D,
    ];
    let mut hasher = Sm3Hasher::new();
    hasher.update(b"taxis-txpf-kernel-seal-v1:");
    hasher.update(&PART_A);
    hasher.update(&PART_B);
    hasher.finalize()
}

pub(super) fn derive_vault_keys(
    repo_id: &[u8; POLICY_REPO_ID_LEN],
    salt: &[u8; POLICY_REPO_ID_LEN],
) -> ([u8; 32], [u8; 32]) {
    let root = kernel_root_material();
    let mut prk_seed = [0u8; 44];
    prk_seed[..16].copy_from_slice(repo_id);
    prk_seed[16..32].copy_from_slice(salt);
    prk_seed[32..44].copy_from_slice(b"txpf-v1-keys");
    let prk = hmac_sm3(&root, &prk_seed);
    (
        hmac_sm3(&prk, b"txpf-v1-sm3-ctr-enc-key"),
        hmac_sm3(&prk, b"txpf-v1-hmac-sm3-mac-key"),
    )
}

fn derive_seal_key() -> [u8; 32] {
    sm3_hash(&hmac_sm3(&kernel_root_material(), b"txsl-v1-seal-mac-key"))
}

pub(super) fn sm3_ctr_transform(
    enc_key: &[u8; 32],
    nonce: &[u8; 16],
    input_bytes: &[u8],
) -> Vec<u8> {
    let mut output = vec![0u8; input_bytes.len()];
    let mut ctr_block = [0u8; 32];
    ctr_block[..12].copy_from_slice(b"txpf-v1-ctr!");
    ctr_block[12..28].copy_from_slice(nonce);
    let mut offset = 0usize;
    let mut block_index = 0u32;
    while offset < input_bytes.len() {
        ctr_block[28..32].copy_from_slice(&block_index.to_le_bytes());
        let keystream = hmac_sm3(enc_key, &ctr_block);
        let chunk_len = (input_bytes.len() - offset).min(SM3_DIGEST_SIZE_BYTES);
        for inner in 0..chunk_len {
            output[offset + inner] = input_bytes[offset + inner] ^ keystream[inner];
        }
        offset += chunk_len;
        block_index = block_index.wrapping_add(1);
    }
    output
}
