//! Module: taxis_cmd::daemon_scheduler — Scheduler Telemetry & Baseline State Updates
//! File Path: src/bin/taxis_cmd/daemon_scheduler/wal_telemetry.rs
//! Architecture Role: Reads and updates [`SchedulerTelemetry`] score histories and per-ref
//!   audited baselines cleanly around sealed snapshot audits.
//! Dependencies & Triggers: Invoked by `materialize.rs`.
//! Responsibilities: Maintain 64-entry rolling score history and snapshot blob maps.
//! Exit Semantics & Design Rationale: Never panics on poisoned mutexes; returns fallback state.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use fg_core::models::Oid;
use fractal_git::audit_runner::NativeAuditOutcome;

use super::{AuditedSnapshotBaseline, SchedulerTelemetry};

pub(super) struct TelemetryUpdate<'a> {
    pub(super) telemetry: &'a Arc<Mutex<SchedulerTelemetry>>,
    pub(super) audit_ref_key: String,
    pub(super) review_id: String,
    pub(super) tree_oid: Oid,
    pub(super) commit_oid: Oid,
    pub(super) target_ref: String,
    pub(super) blobs: BTreeMap<String, Oid>,
    pub(super) outcome: &'a NativeAuditOutcome,
}

pub(super) fn read_telemetry_inputs(
    telemetry: &Arc<Mutex<SchedulerTelemetry>>,
    audit_ref_key: &str,
) -> (Vec<f64>, Option<String>, Option<AuditedSnapshotBaseline>) {
    match telemetry.lock() {
        Ok(guard) => (
            guard.score_history.clone(),
            guard.last_evidence_digest.clone(),
            guard.audited_baselines.get(audit_ref_key).cloned(),
        ),
        Err(_) => (Vec::new(), None, None),
    }
}

pub(super) fn update_telemetry_after_audit(update: TelemetryUpdate<'_>) {
    let Ok(mut guard) = update.telemetry.lock() else {
        return;
    };
    let comp = update
        .outcome
        .evidence
        .measurements
        .ten_dimensions
        .as_ref()
        .map_or(0.0, |dims| dims.composite_score);
    let sqale_minutes = update
        .outcome
        .evidence
        .measurements
        .quant_metrics
        .as_ref()
        .map_or(0.0, |quant| quant.sqale_minutes);
    guard.last_review_id = Some(update.review_id);
    guard.last_tree_oid = Some(update.tree_oid.to_hex());
    guard.last_audit_commit_oid = Some(update.commit_oid.to_hex());
    guard.last_audit_ref = Some(update.target_ref);
    guard.last_composite_score = Some(comp);
    guard.last_decision =
        Some(format!("{:?}", update.outcome.receipt.payload.decision).to_lowercase());
    guard.last_evidence_digest = Some(update.outcome.evidence_digest_hex.clone());
    guard.score_history.push(comp);
    if guard.score_history.len() > 64 {
        guard.score_history.remove(0);
    }
    guard.audited_baselines.insert(
        update.audit_ref_key,
        AuditedSnapshotBaseline {
            tree_oid: update.tree_oid,
            composite_score: comp,
            sqale_minutes,
            blobs: update.blobs,
        },
    );
}
