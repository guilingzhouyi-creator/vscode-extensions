//! Module: taxis_cmd::daemon_scheduler — Audit Tree ODB Metadata Readers
//! File Path: src/bin/taxis_cmd/daemon_scheduler/metadata_read.rs
//! Architecture Role: Extracts stored `AnalysisEvidence`, receipt verdicts, and snapshot blob
//!   inventories from persisted `refs/fractal/audit/*` tree objects.
//! Dependencies & Triggers: Called by `hydration.rs` at daemon startup or test restart recovery.
//! Responsibilities: Parse loose ODB audit commit trees safely without mutating disk state.
//! Exit Semantics & Design Rationale: Graceful `Option` returns skip corrupt or superseded objects.

use std::collections::BTreeMap;

use fg_core::crypto::sm3_hash;
use fg_core::models::quality_contracts::{AnalysisEvidence, TrustedReviewReceipt};
use fg_core::models::{parse_loose_header, ObjectKind, Oid};
use fg_core::traits::OdbStore;
use fg_storage::commit_materializer::read_full_tree_entries;
use fractal_git::LooseOdb;

use super::SchedulerTelemetry;

pub(super) fn read_audit_commit_metadata(
    odb: &LooseOdb,
    audit_tree_oid: &Oid,
) -> Option<(AnalysisEvidence, String, Option<String>)> {
    let entries = read_full_tree_entries(odb, audit_tree_oid).ok()?;
    let ev_oid = entries
        .iter()
        .find(|(path, _)| path.as_str() == "evidence/analysis.json")
        .map(|(_, (_mode, oid))| *oid)?;
    let raw_ev = odb.read_object(&ev_oid).ok()?;
    let (ObjectKind::Blob, ev_bytes) = parse_loose_header(&raw_ev).ok()? else {
        return None;
    };
    let evidence = serde_json::from_slice::<AnalysisEvidence>(ev_bytes).ok()?;
    let digest_hex = format_sm3_hex(&sm3_hash(ev_bytes));
    let mut decision = None;
    if let Some((_, (_, rec_oid))) = entries
        .iter()
        .find(|(path, _)| path.as_str() == "receipt/trusted.json")
    {
        if let Ok(raw_rec) = odb.read_object(rec_oid) {
            if let Ok((ObjectKind::Blob, rec_bytes)) = parse_loose_header(&raw_rec) {
                if let Ok(receipt) = serde_json::from_slice::<TrustedReviewReceipt>(rec_bytes) {
                    decision = Some(format!("{:?}", receipt.payload.decision).to_lowercase());
                }
            }
        }
    }
    Some((evidence, digest_hex, decision))
}

pub(super) fn apply_latest_metadata(
    telemetry: &mut SchedulerTelemetry,
    commit_oid: &Oid,
    audit_ref: &str,
    evidence: &AnalysisEvidence,
    decision: Option<String>,
) {
    telemetry.last_review_id = Some(evidence.binding.review_id.clone());
    telemetry.last_tree_oid = Some(evidence.binding.snapshot.tree.value.clone());
    telemetry.last_audit_commit_oid = Some(commit_oid.to_hex());
    telemetry.last_audit_ref = Some(audit_ref.to_owned());
    telemetry.last_composite_score = evidence
        .measurements
        .ten_dimensions
        .as_ref()
        .map(|dims| dims.composite_score);
    if decision.is_some() {
        telemetry.last_decision = decision;
    }
}

pub(super) fn load_tree_blob_map(odb: &LooseOdb, tree_oid: &Oid) -> BTreeMap<String, Oid> {
    let mut out = BTreeMap::new();
    if let Ok(entries) = read_full_tree_entries(odb, tree_oid) {
        for (rel_path, (_mode, oid)) in entries {
            out.insert(rel_path, oid);
        }
    }
    out
}

pub(super) fn format_sm3_hex(digest: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for &byte in digest {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}
