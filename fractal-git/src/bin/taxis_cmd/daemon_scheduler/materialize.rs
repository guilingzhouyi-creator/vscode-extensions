//! Module: taxis_cmd::daemon_scheduler — Audit Tree Materializer & WAL Pipeline
//! File Path: src/bin/taxis_cmd/daemon_scheduler/materialize.rs
//! Architecture Role: Deduplicates idle snapshots, records WAL BeginTx/UpdateRef/CommitTx
//!   transactions, evaluates snapshot slices via `audit_runner`, and seals `refs/fractal/audit/*`.
//! Dependencies & Triggers: Uses `AuditTreeMaterializer`, `WalJournal`, and `audit_runner`.
//! Responsibilities: Guarantee crash-resilient persistence of sealed audit artifacts.
//! Exit Semantics & Design Rationale: Bundles snapshot inputs cleanly in [`MaterializeArgs`].

use std::path::Path;
use std::sync::{Arc, Mutex};

use fg_algorithms::scoring::ProjectArchetype;
use fg_core::error::FractalResult;
use fg_core::models::GitSignature;
use fg_gate::audit_engine::SnapshotFileSlice;
use fg_gate::authority::resolve_authority_secret;
use fg_topology::audit_tree::{AuditArtifactEntry, AuditCommitSpec, AuditTreeMaterializer};
use fractal_git::audit_runner::{evaluate_and_seal_snapshot, SnapshotAuditRequest};
use fractal_git::{LooseOdb, WalJournal, WalRecord};

use crate::taxis_cmd::daemon::daemon_transport::resolve_taxis_runtime_dir;

use super::eloc_diff::compute_changed_eloc_against_baseline;
use super::ref_queries::{resolve_audit_target_ref, resolve_or_ephemeral_secret};
use super::snapshot_clone::{now_epoch_ms, ClonedSnapshotData};
use super::wal_telemetry::{read_telemetry_inputs, update_telemetry_after_audit, TelemetryUpdate};
use super::{SchedulerTelemetry, AUDIT_WAL_FILENAME};

pub(super) struct MaterializeArgs<'a> {
    pub(super) git_dir: &'a Path,
    pub(super) telemetry: &'a Arc<Mutex<SchedulerTelemetry>>,
    pub(super) source_ref: Option<&'a str>,
    pub(super) archetype: ProjectArchetype,
    pub(super) force: bool,
    pub(super) cloned: ClonedSnapshotData,
}

pub(super) fn materialize_cloned_snapshot(
    args: MaterializeArgs<'_>,
) -> FractalResult<Option<String>> {
    if args.cloned.files.is_empty() {
        return Ok(None);
    }
    let target_audit_ref =
        resolve_audit_target_ref(args.source_ref.or(args.cloned.head_ref.as_deref()));
    let audit_ref_key = target_audit_ref.to_git_ref();
    let (history_scores, prev_digest, baseline_opt) =
        read_telemetry_inputs(args.telemetry, &audit_ref_key);

    if !args.force
        && baseline_opt
            .as_ref()
            .is_some_and(|prev| prev.tree_oid == args.cloned.tree_oid)
    {
        return Ok(None);
    }

    let now_ms = now_epoch_ms();
    let review_id = format!("rev-{now_ms}");
    let operation_id = format!("op-{now_ms}");
    let runtime_dir = resolve_taxis_runtime_dir(args.git_dir);
    let journal = WalJournal::open(runtime_dir.join(AUDIT_WAL_FILENAME))?;
    journal.append(&WalRecord::BeginTx {
        tx_id: review_id.clone(),
        timestamp_ms: i64::try_from(now_ms).unwrap_or(i64::MAX),
    })?;

    let odb = LooseOdb::new(args.git_dir);
    let changed_eloc = compute_changed_eloc_against_baseline(
        &odb,
        baseline_opt.as_ref(),
        &args.cloned.ordered,
        &args.cloned.files,
    );
    let prev_sqale = baseline_opt.as_ref().map(|base| base.sqale_minutes);
    let prev_comp = baseline_opt.as_ref().map(|base| base.composite_score);

    let secret = resolve_or_ephemeral_secret(args.git_dir)?;
    let key_id = if resolve_authority_secret(args.git_dir).is_ok() {
        "taxis-authority"
    } else {
        "ephemeral-daemon"
    };
    let mut slices = Vec::with_capacity(args.cloned.files.len());
    for (rel_path, content) in &args.cloned.files {
        slices.push(SnapshotFileSlice {
            rel_path: rel_path.as_str(),
            content: content.as_slice(),
        });
    }
    let outcome = evaluate_and_seal_snapshot(&SnapshotAuditRequest {
        repository_id: args.cloned.repository_id.as_str(),
        review_id: review_id.as_str(),
        operation_id: operation_id.as_str(),
        tree_oid: args.cloned.tree_oid,
        parent_oids: &args.cloned.parent_oids,
        archetype: args.archetype,
        previous_scores: &history_scores,
        previous_evidence_digest: prev_digest.as_deref(),
        authority_secret: &secret,
        key_id,
        now_ms,
        changed_eloc,
        net_debt_eliminated: 0.0,
        claims_score_gain: false,
        previous_sqale_minutes: prev_sqale,
        previous_composite_score: prev_comp,
        slices: &slices,
    })?;

    let manifest_bytes = serde_json::to_vec_pretty(&args.cloned.manifest_paths)?;
    let author = GitSignature {
        name: String::from("Taxis Audit Daemon"),
        email: String::from("audit@taxis.internal"),
        timestamp_sec: i64::try_from(now_ms / 1000).unwrap_or(0),
        tz_offset: String::from("+0000"),
    };
    let comp_score = outcome
        .evidence
        .measurements
        .ten_dimensions
        .as_ref()
        .map_or(0.0, |dims| dims.composite_score);
    let summary = format!(
        "[Audit] {} score={comp_score:.2} errors={} warnings={} decision={:?}",
        args.cloned.tree_oid.to_hex(),
        outcome.error_count,
        outcome.warning_count,
        outcome.receipt.payload.decision
    );
    let entries = [
        AuditArtifactEntry {
            path: "manifest/files.json",
            payload: &manifest_bytes,
        },
        AuditArtifactEntry {
            path: "evidence/analysis.json",
            payload: &outcome.evidence_canonical_bytes,
        },
        AuditArtifactEntry {
            path: "receipt/trusted.json",
            payload: &outcome.receipt_canonical_bytes,
        },
        AuditArtifactEntry {
            path: "reports/aas-v1.json",
            payload: &outcome.aas_summary_json,
        },
        AuditArtifactEntry {
            path: "reports/summary.md",
            payload: outcome.markdown_report.as_bytes(),
        },
    ];
    let materialized = AuditTreeMaterializer::materialize_with_upward_rollup(
        &odb,
        args.git_dir,
        &AuditCommitSpec {
            target_ref: &target_audit_ref,
            message: &summary,
            author: &author,
            source_commit: args.cloned.head_commit_oid,
            rollup_parents: &[],
            entries: &entries,
        },
    )?;

    journal.append(&WalRecord::UpdateRef {
        tx_id: review_id.clone(),
        git_ref: materialized.target_ref.clone(),
        new_oid: materialized.commit_oid,
    })?;
    journal.append(&WalRecord::CommitTx {
        tx_id: review_id.clone(),
        commit_oid: materialized.commit_oid,
    })?;
    let _ = journal.checkpoint();

    update_telemetry_after_audit(TelemetryUpdate {
        telemetry: args.telemetry,
        audit_ref_key,
        review_id,
        tree_oid: args.cloned.tree_oid,
        commit_oid: materialized.commit_oid,
        target_ref: materialized.target_ref,
        blobs: args.cloned.ordered,
        outcome: &outcome,
    });

    Ok(Some(materialized.commit_oid.to_hex()))
}
