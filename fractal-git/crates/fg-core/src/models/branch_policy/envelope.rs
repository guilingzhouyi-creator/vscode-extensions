//! Module: fg-core — Authenticated Policy Envelope (`TXPF` v1)
//! File Path: crates/fg-core/src/models/branch_policy/envelope.rs
//! Architecture Role: Pure-Rust SM3-CTR + HMAC-SM3 authenticated encryption and
//!   length/header validation for the binary `.taxis-policy.txp` policy vault.
//! Dependencies & Triggers: Uses `fg_core::constants::branch`, `fg_core::crypto`,
//!   `fg_core::error`, and constant-time comparison primitives.

use crate::constants::branch::{POLICY_MAX_PAYLOAD_LEN, POLICY_VAULT_MAGIC, POLICY_VAULT_VERSION};
use crate::crypto::{hmac_sm3, SM3_DIGEST_SIZE_BYTES};
use crate::error::{FractalError, FractalResult};
use crate::models::authority::ct_eq_bytes;

use super::payload::SealedPolicyPayload;
use super::wire_decode::POLICY_REPO_ID_LEN;
use super::{derive_vault_keys, sm3_ctr_transform};

/// Fixed byte length of the `TXPF` encrypted policy container header.
pub const POLICY_VAULT_HEADER_LEN: usize = 68;

struct EnvelopeHeader {
    repo_id: [u8; POLICY_REPO_ID_LEN],
    salt: [u8; POLICY_REPO_ID_LEN],
    nonce: [u8; POLICY_REPO_ID_LEN],
    revision: u64,
    cipher_len: usize,
}

fn parse_envelope_header(envelope: &[u8]) -> FractalResult<EnvelopeHeader> {
    let min_total = POLICY_VAULT_HEADER_LEN + SM3_DIGEST_SIZE_BYTES + 1;
    if envelope.len() < min_total {
        return Err(FractalError::PolicyViolation(format!(
            "policy vault file too short ({} < {min_total} bytes)",
            envelope.len()
        )));
    }
    if envelope[..4] != POLICY_VAULT_MAGIC {
        return Err(FractalError::PolicyViolation(
            "invalid policy vault magic header; file is corrupted or non-Taxis format".to_owned(),
        ));
    }
    let version = u16::from_le_bytes([envelope[4], envelope[5]]);
    if version != POLICY_VAULT_VERSION {
        return Err(FractalError::PolicyViolation(format!(
            "unsupported policy vault format version {version}"
        )));
    }
    let mut repo_id = [0u8; POLICY_REPO_ID_LEN];
    repo_id.copy_from_slice(&envelope[8..24]);
    let mut salt = [0u8; POLICY_REPO_ID_LEN];
    salt.copy_from_slice(&envelope[24..40]);
    let mut nonce = [0u8; POLICY_REPO_ID_LEN];
    nonce.copy_from_slice(&envelope[40..56]);
    let mut rev_bytes = [0u8; 8];
    rev_bytes.copy_from_slice(&envelope[56..64]);
    let cipher_len_u32 =
        u32::from_le_bytes([envelope[64], envelope[65], envelope[66], envelope[67]]);
    let cipher_len = usize::try_from(cipher_len_u32).map_err(|_| {
        FractalError::PolicyViolation("policy cipher length exceeds addressable size".to_owned())
    })?;
    if cipher_len == 0 || cipher_len > POLICY_MAX_PAYLOAD_LEN {
        return Err(FractalError::PolicyViolation(format!(
            "forged or out-of-bounds policy cipher length {cipher_len}"
        )));
    }
    let expected_total = POLICY_VAULT_HEADER_LEN
        .checked_add(cipher_len)
        .and_then(|value| value.checked_add(SM3_DIGEST_SIZE_BYTES))
        .ok_or_else(|| FractalError::PolicyViolation("policy vault size overflow".to_owned()))?;
    if envelope.len() != expected_total {
        return Err(FractalError::PolicyViolation(format!(
            "policy vault byte length mismatch (expected {expected_total}, got {})",
            envelope.len()
        )));
    }
    Ok(EnvelopeHeader {
        repo_id,
        salt,
        nonce,
        revision: u64::from_le_bytes(rev_bytes),
        cipher_len,
    })
}

/// Seals `payload` into an encrypted, HMAC-SM3 authenticated `TXPF` binary envelope.
///
/// # Errors
///
/// Returns [`FractalError::PolicyViolation`] when serialization exceeds format ceilings.
pub fn seal_policy_envelope(
    payload: &SealedPolicyPayload,
    salt: [u8; POLICY_REPO_ID_LEN],
    nonce: [u8; POLICY_REPO_ID_LEN],
) -> FractalResult<Vec<u8>> {
    let plaintext = payload.encode_binary()?;
    let cipher_len_u32 = u32::try_from(plaintext.len()).map_err(|_| {
        FractalError::PolicyViolation("sealed policy length overflows u32".to_owned())
    })?;
    let (enc_key, mac_key) = derive_vault_keys(&payload.repo_id, &salt);
    let ciphertext = sm3_ctr_transform(&enc_key, &nonce, &plaintext);

    let mut envelope =
        Vec::with_capacity(POLICY_VAULT_HEADER_LEN + ciphertext.len() + SM3_DIGEST_SIZE_BYTES);
    envelope.extend_from_slice(&POLICY_VAULT_MAGIC);
    envelope.extend_from_slice(&POLICY_VAULT_VERSION.to_le_bytes());
    envelope.extend_from_slice(&0u16.to_le_bytes());
    envelope.extend_from_slice(&payload.repo_id);
    envelope.extend_from_slice(&salt);
    envelope.extend_from_slice(&nonce);
    envelope.extend_from_slice(&payload.revision.to_le_bytes());
    envelope.extend_from_slice(&cipher_len_u32.to_le_bytes());
    envelope.extend_from_slice(&ciphertext);

    let auth_tag = hmac_sm3(&mac_key, &envelope);
    envelope.extend_from_slice(&auth_tag);
    Ok(envelope)
}

/// Verifies integrity, authenticity, and repository binding of a `TXPF` binary envelope,
/// then decrypts and decodes its [`SealedPolicyPayload`].
///
/// # Errors
///
/// Returns [`FractalError::AuthProofInvalid`] on MAC mismatch or cross-repo transplant,
/// and [`FractalError::PolicyViolation`] on malformed framing.
pub fn unseal_policy_envelope(
    envelope: &[u8],
    expected_repo_id: Option<&[u8; POLICY_REPO_ID_LEN]>,
) -> FractalResult<SealedPolicyPayload> {
    let hdr = parse_envelope_header(envelope)?;
    if let Some(bound_id) = expected_repo_id {
        if !ct_eq_bytes(&hdr.repo_id, bound_id) {
            return Err(FractalError::AuthProofInvalid(
                "policy vault repository binding mismatch (cross-repository copy rejected)"
                    .to_owned(),
            ));
        }
    }
    let (enc_key, mac_key) = derive_vault_keys(&hdr.repo_id, &hdr.salt);
    let authenticated_end = POLICY_VAULT_HEADER_LEN + hdr.cipher_len;
    let computed_tag = hmac_sm3(&mac_key, &envelope[..authenticated_end]);
    if !ct_eq_bytes(&computed_tag, &envelope[authenticated_end..]) {
        return Err(FractalError::AuthProofInvalid(
            "policy vault authentication failed (HMAC-SM3 mismatch; external modification detected)"
                .to_owned(),
        ));
    }
    let plaintext = sm3_ctr_transform(
        &enc_key,
        &hdr.nonce,
        &envelope[POLICY_VAULT_HEADER_LEN..authenticated_end],
    );
    let decoded = SealedPolicyPayload::decode_binary(&plaintext)?;
    if !ct_eq_bytes(&decoded.repo_id, &hdr.repo_id) || decoded.revision != hdr.revision {
        return Err(FractalError::AuthProofInvalid(
            "policy vault header and encrypted payload binding mismatch".to_owned(),
        ));
    }
    Ok(decoded)
}
