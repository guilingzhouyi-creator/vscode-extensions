//! Module: fg-topology — Audit Tree ODB Reader & Lineage Traversal Helpers
//! File Path: crates/fg-topology/src/audit_tree/odb_read.rs
//! Architecture Role: Pure-ODB commit header decoding, tree path traversal, parent extraction,
//!   and summary line parsing for `AuditTreeMaterializer`.
//! Dependencies & Triggers: Uses `fg_core::{OdbStore, parse_commit_header, parse_loose_header}`.
//! Responsibilities: Look up blobs in materialized trees without writing to disk.
//! Exit Semantics & Design Rationale: Fails cleanly on corrupted or mismatched Git object kinds.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{parse_commit_header, parse_loose_header, CommitHeader, ObjectKind, Oid};
use fg_core::traits::OdbStore;

pub(crate) fn read_commit_header_oid(
    odb: &impl OdbStore,
    commit_oid: &Oid,
) -> FractalResult<CommitHeader> {
    let raw = odb.read_object(commit_oid)?;
    let (kind, payload) = parse_loose_header(&raw)?;
    if kind != ObjectKind::Commit {
        return Err(FractalError::ObjectCodec(format!(
            "{commit_oid} is a {}, not a commit",
            kind.as_str()
        )));
    }
    parse_commit_header(payload)
}

pub(crate) fn find_blob_in_tree(
    odb: &impl OdbStore,
    tree_oid: &Oid,
    rel_path: &str,
) -> FractalResult<Option<Vec<u8>>> {
    let mut current_tree = *tree_oid;
    let mut segments = rel_path.split('/').peekable();
    while let Some(target_name) = segments.next() {
        let expect_dir = segments.peek().is_some();
        let raw = odb.read_object(&current_tree)?;
        let (kind, payload) = parse_loose_header(&raw)?;
        if kind != ObjectKind::Tree {
            return Err(FractalError::ObjectCodec(format!(
                "{current_tree} is not a tree object"
            )));
        }
        let Some((is_dir, entry_oid)) = lookup_tree_entry(payload, target_name)? else {
            return Ok(None);
        };
        if expect_dir != is_dir {
            return Ok(None);
        }
        if !expect_dir {
            return read_verified_blob(odb, &entry_oid);
        }
        current_tree = entry_oid;
    }
    Ok(None)
}

fn read_verified_blob(odb: &impl OdbStore, entry_oid: &Oid) -> FractalResult<Option<Vec<u8>>> {
    let blob_raw = odb.read_object(entry_oid)?;
    let (blob_kind, blob_payload) = parse_loose_header(&blob_raw)?;
    if blob_kind != ObjectKind::Blob {
        return Err(FractalError::ObjectCodec(format!(
            "{entry_oid} is not a blob object"
        )));
    }
    Ok(Some(blob_payload.to_vec()))
}

pub(crate) fn lookup_tree_entry(payload: &[u8], target: &str) -> FractalResult<Option<(bool, Oid)>> {
    let mut cursor = 0usize;
    while cursor < payload.len() {
        let Some(space_rel) = payload[cursor..].iter().position(|&b| b == b' ') else {
            return Err(FractalError::ObjectCodec("malformed tree entry mode".into()));
        };
        let mode_slice = &payload[cursor..cursor + space_rel];
        let name_start = cursor + space_rel + 1;
        let Some(nul_rel) = payload[name_start..].iter().position(|&b| b == 0) else {
            return Err(FractalError::ObjectCodec("malformed tree entry name".into()));
        };
        let name_slice = std::str::from_utf8(&payload[name_start..name_start + nul_rel])
            .map_err(|_| FractalError::ObjectCodec("non-utf8 tree entry name".into()))?;
        let oid_start = name_start + nul_rel + 1;
        if oid_start + 20 > payload.len() {
            return Err(FractalError::ObjectCodec("truncated tree entry oid".into()));
        }
        if name_slice == target {
            let mut oid_bytes = [0u8; 20];
            oid_bytes.copy_from_slice(&payload[oid_start..oid_start + 20]);
            let is_dir = mode_slice == b"40000" || mode_slice == b"040000";
            return Ok(Some((is_dir, Oid::from_bytes(oid_bytes))));
        }
        cursor = oid_start + 20;
    }
    Ok(None)
}

pub(crate) fn collect_commit_parents(payload: &[u8]) -> FractalResult<Vec<Oid>> {
    let text = std::str::from_utf8(payload)
        .map_err(|_| FractalError::ObjectCodec("commit header is not utf-8".into()))?;
    let mut parents = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            break;
        }
        if let Some(hex) = line.strip_prefix("parent ") {
            parents.push(Oid::from_hex(hex.trim())?);
        }
    }
    Ok(parents)
}

pub(crate) fn extract_commit_summary_line(payload: &[u8]) -> String {
    let text = String::from_utf8_lossy(payload);
    if let Some((_hdr, body)) = text.split_once("\n\n") {
        String::from(body.lines().next().unwrap_or_default().trim())
    } else {
        String::new()
    }
}
