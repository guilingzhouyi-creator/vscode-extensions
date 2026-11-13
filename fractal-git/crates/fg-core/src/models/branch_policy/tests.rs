//! Module: fg-core — Encrypted Binary Policy Vault Unit Tests
//! File Path: crates/fg-core/src/models/branch_policy/tests.rs
//! Architecture Role: Unit test suite verifying TXPF round-trip encryption, MAC
//!   tamper rejection, cross-repo transplant detection, forged lengths, and TXSL seals.

use super::*;
use crate::error::FractalError;
use crate::models::policy::EnforcementTier;

fn sample_repo_id() -> [u8; POLICY_REPO_ID_LEN] {
    [
        0xA1, 0xB2, 0xC3, 0xD4, 0x05, 0x16, 0x27, 0x38, 0x49, 0x5A, 0x6B, 0x7C, 0x8D, 0x9E, 0xAF,
        0x10,
    ]
}

#[test]
fn sealed_policy_round_trip_hides_plaintext_and_verifies_mac() {
    let payload = SealedPolicyPayload::with_tiers(
        sample_repo_id(),
        EnforcementTier::Strict,
        BranchEnforcementTier::Strict,
        true,
        1_750_000_000,
    );
    let salt = [0x11u8; 16];
    let nonce = [0x22u8; 16];
    let envelope = seal_policy_envelope(&payload, salt, nonce).expect("seal");

    let rendered_lossy = String::from_utf8_lossy(&envelope);
    assert!(
        !rendered_lossy.contains("auto-refactor")
            && !rendered_lossy.contains("fractal-git")
            && !rendered_lossy.contains("strict")
            && !rendered_lossy.contains("\"branch"),
        "encrypted vault must not expose plaintext policy tokens or JSON payloads"
    );

    let decoded = unseal_policy_envelope(&envelope, Some(&sample_repo_id())).expect("unseal");
    assert_eq!(decoded, payload);
}

#[test]
fn tamper_single_bit_or_wrong_repo_id_fails_closed() {
    let payload = SealedPolicyPayload::with_tiers(
        sample_repo_id(),
        EnforcementTier::Strict,
        BranchEnforcementTier::Strict,
        false,
        1_750_000_000,
    );
    let mut envelope = seal_policy_envelope(&payload, [0x33u8; 16], [0x44u8; 16]).expect("seal");

    let other_repo = [0xFFu8; 16];
    let wrong_repo_err =
        unseal_policy_envelope(&envelope, Some(&other_repo)).expect_err("wrong repo_id must fail");
    assert!(matches!(wrong_repo_err, FractalError::AuthProofInvalid(_)));

    envelope[POLICY_VAULT_HEADER_LEN + 5] ^= 0x01;
    let tamper_err = unseal_policy_envelope(&envelope, Some(&sample_repo_id()))
        .expect_err("bit flip must fail HMAC-SM3");
    assert!(matches!(tamper_err, FractalError::AuthProofInvalid(_)));
}

#[test]
fn forged_length_prefix_is_rejected_before_allocating() {
    let payload = SealedPolicyPayload::with_tiers(
        sample_repo_id(),
        EnforcementTier::Strict,
        BranchEnforcementTier::Native,
        false,
        100,
    );
    let mut envelope = seal_policy_envelope(&payload, [0x55u8; 16], [0x66u8; 16]).expect("seal");
    let huge = u32::MAX.to_le_bytes();
    envelope[64..68].copy_from_slice(&huge);
    let err = unseal_policy_envelope(&envelope, Some(&sample_repo_id()))
        .expect_err("forged length must fail");
    assert!(matches!(err, FractalError::PolicyViolation(_)));
}

#[test]
fn seal_record_round_trips_and_rejects_corruption() {
    let id = sample_repo_id();
    let mut seal = encode_seal_record(&id);
    let parsed = verify_seal_record(&seal).expect("verify seal");
    assert_eq!(parsed, id);

    seal[10] ^= 0x80;
    let err = verify_seal_record(&seal).expect_err("tampered seal must fail");
    assert!(matches!(err, FractalError::AuthProofInvalid(_)));
}
