//! Module: fg-core — Policy Vault Binary Wire Decoders
//! File Path: crates/fg-core/src/models/branch_policy/wire_decode.rs
//! Architecture Role: Bounds-checked little-endian primitive decoders for `.taxis-policy.txp`.
//! Dependencies & Triggers: Uses `fg_core::error` and `fg_core::models::EnforcementTier`.
//! Responsibilities: Decode booleans, fixed IDs, integers, NUL-guarded UTF-8 strings, and bounded lists.
//! Exit Semantics & Design Rationale: Rejects truncated slices, invalid UTF-8, embedded NULs,
//!   and list counts above `MAX_POLICY_LIST_ITEMS` before pre-allocating memory.

use crate::error::{FractalError, FractalResult};
use crate::models::policy::EnforcementTier;

/// Size in bytes of the repository identifier embedded inside every policy envelope.
pub const POLICY_REPO_ID_LEN: usize = 16;

const MAX_POLICY_LIST_ITEMS: usize = 256;

pub(super) fn commit_tier_from_u8(value: u8) -> FractalResult<EnforcementTier> {
    match value {
        0 => Ok(EnforcementTier::Native),
        1 => Ok(EnforcementTier::Conventional),
        2 => Ok(EnforcementTier::Strict),
        other => Err(FractalError::PolicyViolation(format!(
            "invalid commit enforcement tier byte '{other}' in policy payload"
        ))),
    }
}

fn take_slice<'a>(
    payload: &'a [u8],
    cursor: &mut usize,
    width: usize,
    field: &'static str,
) -> FractalResult<&'a [u8]> {
    let end = cursor.checked_add(width).ok_or_else(|| {
        FractalError::PolicyViolation(format!("policy offset overflow reading '{field}'"))
    })?;
    if end > payload.len() {
        return Err(FractalError::PolicyViolation(format!(
            "truncated policy payload while reading '{field}'"
        )));
    }
    let slice = &payload[*cursor..end];
    *cursor = end;
    Ok(slice)
}

pub(super) fn read_u8(
    payload: &[u8],
    cursor: &mut usize,
    field: &'static str,
) -> FractalResult<u8> {
    Ok(take_slice(payload, cursor, 1, field)?[0])
}

pub(super) fn read_bool(
    payload: &[u8],
    cursor: &mut usize,
    field: &'static str,
) -> FractalResult<bool> {
    match read_u8(payload, cursor, field)? {
        0 => Ok(false),
        1 => Ok(true),
        other => Err(FractalError::PolicyViolation(format!(
            "invalid boolean byte '{other}' for '{field}'"
        ))),
    }
}

pub(super) fn read_u16(
    payload: &[u8],
    cursor: &mut usize,
    field: &'static str,
) -> FractalResult<u16> {
    let bytes = take_slice(payload, cursor, 2, field)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

pub(super) fn read_u64(
    payload: &[u8],
    cursor: &mut usize,
    field: &'static str,
) -> FractalResult<u64> {
    let bytes = take_slice(payload, cursor, 8, field)?;
    let mut word = [0u8; 8];
    word.copy_from_slice(bytes);
    Ok(u64::from_le_bytes(word))
}

pub(super) fn read_i64(
    payload: &[u8],
    cursor: &mut usize,
    field: &'static str,
) -> FractalResult<i64> {
    let bytes = take_slice(payload, cursor, 8, field)?;
    let mut word = [0u8; 8];
    word.copy_from_slice(bytes);
    Ok(i64::from_le_bytes(word))
}

pub(super) fn read_fixed_16(
    payload: &[u8],
    cursor: &mut usize,
    field: &'static str,
) -> FractalResult<[u8; POLICY_REPO_ID_LEN]> {
    let bytes = take_slice(payload, cursor, POLICY_REPO_ID_LEN, field)?;
    let mut fixed = [0u8; POLICY_REPO_ID_LEN];
    fixed.copy_from_slice(bytes);
    Ok(fixed)
}

pub(super) fn read_len_str(
    payload: &[u8],
    cursor: &mut usize,
    field: &'static str,
) -> FractalResult<String> {
    let byte_len = usize::from(read_u16(payload, cursor, field)?);
    let raw = take_slice(payload, cursor, byte_len, field)?;
    let decoded = std::str::from_utf8(raw).map_err(|utf_err| {
        FractalError::PolicyViolation(format!("non-UTF8 policy string in '{field}': {utf_err}"))
    })?;
    if decoded.as_bytes().contains(&0) {
        return Err(FractalError::PolicyViolation(format!(
            "NUL byte inside policy string '{field}'"
        )));
    }
    Ok(decoded.to_owned())
}

pub(super) fn read_str_list(
    payload: &[u8],
    cursor: &mut usize,
    field: &'static str,
) -> FractalResult<Vec<String>> {
    let count = usize::from(read_u16(payload, cursor, field)?);
    if count > MAX_POLICY_LIST_ITEMS {
        return Err(FractalError::PolicyViolation(format!(
            "policy list '{field}' count {count} exceeds ceiling {MAX_POLICY_LIST_ITEMS}"
        )));
    }
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        entries.push(read_len_str(payload, cursor, field)?);
    }
    Ok(entries)
}

pub(super) fn read_pair_list(
    payload: &[u8],
    cursor: &mut usize,
    field: &'static str,
) -> FractalResult<Vec<(String, String)>> {
    let count = usize::from(read_u16(payload, cursor, field)?);
    if count > MAX_POLICY_LIST_ITEMS {
        return Err(FractalError::PolicyViolation(format!(
            "policy pair list '{field}' count {count} exceeds ceiling {MAX_POLICY_LIST_ITEMS}"
        )));
    }
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let alias = read_len_str(payload, cursor, field)?;
        let canonical = read_len_str(payload, cursor, field)?;
        entries.push((alias, canonical));
    }
    Ok(entries)
}
