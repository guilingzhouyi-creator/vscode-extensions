//! Module: fg-topology — TXLN Lineage Binary Frame Codec & Key Derivation
//! File Path: crates/fg-topology/src/lineage/codec.rs
//! Architecture Role: Pure-Rust binary framing and HMAC-SM3 authentication codecs for
//!   the tamper-evident TXLN lineage journal.
//! Dependencies & Triggers: Uses `fg_core::{crypto::hmac_sm3, models::ct_eq_bytes}` and
//!   `fg_native::policy_vault::PolicyVaultStore`.
//! Responsibilities: Derive repository-bound MAC keys, encode canonical frame bodies,
//!   and decode/authenticate journal records fail-closed.

use std::path::Path;

use fg_core::crypto::hmac_sm3;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::authority::ct_eq_bytes;
use fg_native::policy_vault::{PolicyVaultState, PolicyVaultStore};

use super::{
    FractalLineageReceipt, LineageEventKind, LineageRecordParams, LINEAGE_MAGIC, LINEAGE_VERSION,
};

pub(super) fn derive_lineage_mac_key(common_dir: &Path) -> [u8; 32] {
    let mut seed = Vec::with_capacity(64);
    seed.extend_from_slice(b"txln-v1-lineage-mac-key:");
    match PolicyVaultStore::load_state(common_dir) {
        PolicyVaultState::Sealed(loaded) => seed.extend_from_slice(&loaded.payload.repo_id),
        _ => seed.extend_from_slice(common_dir.to_string_lossy().as_bytes()),
    }
    hmac_sm3(b"taxis-fractal-lineage-root-v1", &seed)
}

pub(super) fn encode_receipt_body(
    params: &LineageRecordParams<'_>,
    ts: i64,
) -> FractalResult<Vec<u8>> {
    let mut body = Vec::with_capacity(128);
    body.push(params.event_kind as u8);
    body.extend_from_slice(&ts.to_le_bytes());
    write_str(&mut body, params.cell_id)?;
    write_str(&mut body, params.source_ref)?;
    write_str(&mut body, params.target_ref)?;
    write_str(&mut body, params.commit_oid_hex)?;
    write_str(&mut body, params.parent_oid_hex)?;
    Ok(body)
}

fn write_str(out: &mut Vec<u8>, value: &str) -> FractalResult<()> {
    let len = u16::try_from(value.len()).map_err(|_| {
        FractalError::CorruptStore("lineage field length exceeds u16 ceiling".to_owned())
    })?;
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(value.as_bytes());
    Ok(())
}

fn take_bytes<'a>(buf: &'a [u8], cursor: &mut usize, width: usize) -> FractalResult<&'a [u8]> {
    let end = cursor
        .checked_add(width)
        .ok_or_else(|| FractalError::CorruptStore("lineage offset overflow".to_owned()))?;
    if end > buf.len() {
        return Err(FractalError::CorruptStore("truncated lineage receipt frame".to_owned()));
    }
    let slice = &buf[*cursor..end];
    *cursor = end;
    Ok(slice)
}

fn read_str(buf: &[u8], cursor: &mut usize) -> FractalResult<String> {
    let len_bytes = take_bytes(buf, cursor, 2)?;
    let len = usize::from(u16::from_le_bytes([len_bytes[0], len_bytes[1]]));
    let raw = take_bytes(buf, cursor, len)?;
    std::str::from_utf8(raw)
        .map(str::to_owned)
        .map_err(|err| FractalError::CorruptStore(format!("invalid UTF-8 lineage string: {err}")))
}

pub(super) fn decode_and_verify_frame(
    buf: &[u8],
    cursor: &mut usize,
    mac_key: &[u8; 32],
) -> FractalResult<FractalLineageReceipt> {
    let magic = take_bytes(buf, cursor, 4)?;
    if magic != LINEAGE_MAGIC {
        return Err(FractalError::CorruptStore("invalid TXLN lineage frame magic".to_owned()));
    }
    let ver_bytes = take_bytes(buf, cursor, 2)?;
    let version = u16::from_le_bytes([ver_bytes[0], ver_bytes[1]]);
    if version != LINEAGE_VERSION {
        return Err(FractalError::CorruptStore(format!(
            "unsupported lineage frame version '{version}'"
        )));
    }
    let body_start = *cursor;
    let event_kind = LineageEventKind::from_byte(take_bytes(buf, cursor, 1)?[0])?;
    let ts_bytes = take_bytes(buf, cursor, 8)?;
    let mut ts_arr = [0u8; 8];
    ts_arr.copy_from_slice(ts_bytes);
    let timestamp_secs = i64::from_le_bytes(ts_arr);

    let cell_id = read_str(buf, cursor)?;
    let source_ref = read_str(buf, cursor)?;
    let target_ref = read_str(buf, cursor)?;
    let commit_oid_hex = read_str(buf, cursor)?;
    let parent_oid_hex = read_str(buf, cursor)?;
    let body_end = *cursor;

    let tag_slice = take_bytes(buf, cursor, 32)?;
    let expected_tag = hmac_sm3(mac_key, &buf[body_start..body_end]);
    if !ct_eq_bytes(&expected_tag, tag_slice) {
        return Err(FractalError::AuthProofInvalid(
            "lineage receipt HMAC-SM3 verification failed".to_owned(),
        ));
    }
    let mut hmac_tag = [0u8; 32];
    hmac_tag.copy_from_slice(tag_slice);

    Ok(FractalLineageReceipt {
        event_kind,
        cell_id,
        source_ref,
        target_ref,
        commit_oid_hex,
        parent_oid_hex,
        timestamp_secs,
        hmac_tag,
    })
}
