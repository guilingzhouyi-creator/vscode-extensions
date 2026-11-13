//! Module: taxis_cmd::daemon_scheduler — WAL Replay & Startup Telemetry Hydration
//! File Path: src/bin/taxis_cmd/daemon_scheduler/hydration.rs
//! Architecture Role: Replays incomplete audit WAL journals on startup (reclaiming torn tail
//!   bytes safely) and rebuilds ADR-Q history and baseline snapshot maps from `refs/fractal/audit/*`.
//! Dependencies & Triggers: Executed during [`AsyncAuditScheduler::spawn`] and recovery tests.
//! Responsibilities: Hydrate telemetry cleanly without aborting startup on corrupt tail bytes.
//! Exit Semantics & Design Rationale: Truncates clean WAL checkpoints after replay diagnostics.

use std::path::Path;

use fg_core::models::{parse_commit_header, parse_loose_header, ObjectKind, Oid};
use fg_core::traits::OdbStore;
use fg_topology::audit_tree::AuditTreeMaterializer;
use fg_topology::refs::{DiskRefStore, FractalRef};
use fractal_git::constants::refs::REF_AUDIT_PREFIX;
use fractal_git::{LooseOdb, WalJournal};

use crate::taxis_cmd::daemon::daemon_transport::resolve_taxis_runtime_dir;

use super::metadata_read::{apply_latest_metadata, load_tree_blob_map, read_audit_commit_metadata};
use super::{AuditedSnapshotBaseline, SchedulerTelemetry, AUDIT_WAL_FILENAME};

pub(super) fn bootstrap_scheduler_telemetry(git_dir: &Path) -> SchedulerTelemetry {
    let runtime_dir = resolve_taxis_runtime_dir(git_dir);
    if let Ok(journal) = WalJournal::open(runtime_dir.join(AUDIT_WAL_FILENAME)) {
        match journal.replay() {
            Ok(replay) => {
                if replay.discarded_tail_bytes > 0 {
                    fg_core::diag_warn!(
                        "taxis_daemon::scheduler",
                        "reclaimed {} torn tail bytes from audit WAL during startup replay",
                        replay.discarded_tail_bytes
                    );
                }
                let _ = journal.checkpoint();
            }
            Err(err) => {
                fg_core::diag_warn!(
                    "taxis_daemon::scheduler",
                    "audit WAL replay hit corrupt frame ({}); truncating clean WAL",
                    err
                );
                let _ = journal.checkpoint();
            }
        }
    }

    let mut telemetry = SchedulerTelemetry::default();
    let odb = LooseOdb::new(git_dir);
    hydrate_trunk_history(&odb, git_dir, &mut telemetry);
    hydrate_all_audit_baselines(&odb, git_dir, &mut telemetry);
    telemetry
}

fn hydrate_trunk_history(odb: &LooseOdb, git_dir: &Path, telemetry: &mut SchedulerTelemetry) {
    let Ok(traces) =
        AuditTreeMaterializer::inspect_audit_lineage(odb, git_dir, &FractalRef::AuditTrunk, 16)
    else {
        return;
    };
    let mut rev_idx = traces.len();
    while rev_idx > 0 {
        rev_idx -= 1;
        if let Some((evidence, digest_hex, decision)) =
            read_audit_commit_metadata(odb, &traces[rev_idx].tree_oid)
        {
            if let Some(comp) = evidence
                .measurements
                .ten_dimensions
                .as_ref()
                .map(|dims| dims.composite_score)
            {
                telemetry.score_history.push(comp);
            }
            if rev_idx == 0 {
                telemetry.last_evidence_digest = Some(digest_hex);
                apply_latest_metadata(
                    telemetry,
                    &traces[0].commit_oid,
                    &FractalRef::AuditTrunk.to_git_ref(),
                    &evidence,
                    decision,
                );
            }
        }
    }
}

fn hydrate_all_audit_baselines(odb: &LooseOdb, git_dir: &Path, telemetry: &mut SchedulerTelemetry) {
    let Ok(refs) = DiskRefStore::new(git_dir).list_all() else {
        return;
    };
    for (ref_name, commit_oid) in &refs {
        if ref_name.starts_with(REF_AUDIT_PREFIX) {
            hydrate_single_ref_baseline(odb, ref_name, commit_oid, telemetry);
        }
    }
}

fn hydrate_single_ref_baseline(
    odb: &LooseOdb,
    ref_name: &str,
    commit_oid: &Oid,
    telemetry: &mut SchedulerTelemetry,
) {
    let Ok(raw_commit) = odb.read_object(commit_oid) else {
        return;
    };
    let Ok((ObjectKind::Commit, payload)) = parse_loose_header(&raw_commit) else {
        return;
    };
    let Ok(header) = parse_commit_header(payload) else {
        return;
    };
    let Some((evidence, digest_hex, decision)) = read_audit_commit_metadata(odb, &header.tree)
    else {
        return;
    };
    let Ok(snap_tree_oid) = Oid::from_hex(&evidence.binding.snapshot.tree.value) else {
        return;
    };
    let blobs = load_tree_blob_map(odb, &snap_tree_oid);
    let comp = evidence
        .measurements
        .ten_dimensions
        .as_ref()
        .map_or(0.0, |dims| dims.composite_score);
    let sqale_minutes = evidence
        .measurements
        .quant_metrics
        .as_ref()
        .map_or(0.0, |quant| quant.sqale_minutes);
    telemetry.audited_baselines.insert(
        ref_name.to_owned(),
        AuditedSnapshotBaseline {
            tree_oid: snap_tree_oid,
            composite_score: comp,
            sqale_minutes,
            blobs,
        },
    );
    if telemetry.last_audit_commit_oid.is_none() {
        telemetry.last_evidence_digest = Some(digest_hex);
        apply_latest_metadata(telemetry, commit_oid, ref_name, &evidence, decision);
    }
}
