//! Module: fg-core — Policy Vault Binary Wire Encoders
//! File Path: crates/fg-core/src/models/branch_policy/wire_encode.rs
//! Architecture Role: Bounds-checked little-endian primitive encoders for `.taxis-policy.txp`.
//! Dependencies & Triggers: Uses `fg_core::error` and `fg_core::models::EnforcementTier`.
//! Responsibilities: Encode enforcement tiers, NUL-guarded UTF-8 strings, and bounded lists.
//! Exit Semantics & Design Rationale: Rejects embedded NUL bytes and u16 length overflows fail-closed.

use crate::error::{FractalError, FractalResult};
use crate::models::policy::EnforcementTier;

pub(super) fn commit_tier_to_u8(tier: EnforcementTier) -> u8 {
    match tier {
        EnforcementTier::Native => 0,
        EnforcementTier::Conventional => 1,
        EnforcementTier::Strict => 2,
    }
}

pub(super) fn write_len_str(out: &mut Vec<u8>, text: &str) -> FractalResult<()> {
    if text.as_bytes().contains(&0) {
        return Err(FractalError::PolicyViolation(
            "policy string field contains forbidden NUL byte".to_owned(),
        ));
    }
    let byte_len = u16::try_from(text.len()).map_err(|_| {
        FractalError::PolicyViolation("policy string field length exceeds u16 ceiling".to_owned())
    })?;
    out.extend_from_slice(&byte_len.to_le_bytes());
    out.extend_from_slice(text.as_bytes());
    Ok(())
}

pub(super) fn write_str_list(out: &mut Vec<u8>, entries: &[String]) -> FractalResult<()> {
    let count = u16::try_from(entries.len()).map_err(|_| {
        FractalError::PolicyViolation("policy string list exceeds u16 count ceiling".to_owned())
    })?;
    out.extend_from_slice(&count.to_le_bytes());
    for entry in entries {
        write_len_str(out, entry.as_str())?;
    }
    Ok(())
}

pub(super) fn write_pair_list(
    out: &mut Vec<u8>,
    entries: &[(String, String)],
) -> FractalResult<()> {
    let count = u16::try_from(entries.len()).map_err(|_| {
        FractalError::PolicyViolation("policy alias list exceeds u16 count ceiling".to_owned())
    })?;
    out.extend_from_slice(&count.to_le_bytes());
    for (left, right) in entries {
        write_len_str(out, left.as_str())?;
        write_len_str(out, right.as_str())?;
    }
    Ok(())
}
