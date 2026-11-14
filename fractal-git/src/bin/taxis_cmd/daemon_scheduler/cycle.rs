//! Module: taxis_cmd::daemon_scheduler — Audit Cycle Dispatch & Ref Snapshot Loading
//! File Path: src/bin/taxis_cmd/daemon_scheduler/cycle.rs
//! Architecture Role: Resolves either committed ref ODB trees or live `DaemonHotSession` index
//!   snapshots and delegates materialization cleanly without holding session locks.
//! Dependencies & Triggers: Called by worker loop and `taxis audit run`.
//! Responsibilities: Keep hot session lock intervals minimal while supporting explicit `--ref`.
//! Exit Semantics & Design Rationale: Groups cycle inputs in [`CycleDispatchArgs`].

use std::path::Path;
use std::sync::{Arc, Mutex};

use fg_algorithms::scoring::ProjectArchetype;
use fg_core::error::{FractalError, FractalResult};
use fg_core::traits::RefStore;
use fg_topology::refs::DiskRefStore;
use fractal_git::LooseOdb;

use crate::taxis_cmd::daemon::daemon_runtime::DaemonHotSession;

use super::materialize::{materialize_cloned_snapshot, MaterializeArgs};
use super::snapshot_clone::{
    clone_snapshot_under_lock, load_commit_tree_entries, read_ordered_blobs, resolve_repo_name,
    ClonedSnapshotData,
};
use super::SchedulerTelemetry;

pub(super) struct CycleDispatchArgs<'a> {
    pub(super) git_dir: &'a Path,
    pub(super) session: &'a Arc<Mutex<DaemonHotSession>>,
    pub(super) telemetry: &'a Arc<Mutex<SchedulerTelemetry>>,
    pub(super) source_ref: Option<&'a str>,
    pub(super) archetype: ProjectArchetype,
    pub(super) force: bool,
}

pub(super) fn dispatch_scheduled_cycle(
    args: &CycleDispatchArgs<'_>,
) -> FractalResult<Option<String>> {
    if let Some(ref_name) = args.source_ref {
        if let Some(cloned) = load_committed_ref_snapshot(args.git_dir, ref_name)? {
            return materialize_cloned_snapshot(MaterializeArgs {
                git_dir: args.git_dir,
                telemetry: args.telemetry,
                source_ref: Some(ref_name),
                archetype: args.archetype,
                force: args.force,
                cloned,
            });
        }
    }
    run_session_audit_cycle(args)
}

/// Runs one synchronous audit cycle against the hot session ODB and materializes into `refs/fractal/audit/...`.
///
/// # Errors
///
/// Propagates session lock, WAL, ODB, audit engine, or `AuditTreeMaterializer` failures.
pub fn execute_background_audit_cycle(
    git_dir: &Path,
    session: &Arc<Mutex<DaemonHotSession>>,
    telemetry: &Arc<Mutex<SchedulerTelemetry>>,
    source_ref: Option<&str>,
    archetype: ProjectArchetype,
) -> FractalResult<Option<String>> {
    run_session_audit_cycle(&CycleDispatchArgs {
        git_dir,
        session,
        telemetry,
        source_ref,
        archetype,
        force: true,
    })
}

fn run_session_audit_cycle(args: &CycleDispatchArgs<'_>) -> FractalResult<Option<String>> {
    let cloned = {
        let mut guard = args.session.lock().map_err(|_| {
            FractalError::PolicyViolation(String::from("daemon session mutex poisoned"))
        })?;
        guard.refresh_from_disk_if_stale();
        clone_snapshot_under_lock(args.git_dir, &guard)?
    };
    materialize_cloned_snapshot(MaterializeArgs {
        git_dir: args.git_dir,
        telemetry: args.telemetry,
        source_ref: args.source_ref,
        archetype: args.archetype,
        force: args.force,
        cloned,
    })
}

/// Runs one synchronous audit cycle against an explicit ref's committed tree and materializes into `refs/fractal/audit/...`.
///
/// # Errors
///
/// Propagates ref resolution, ODB, WAL, audit engine, or `AuditTreeMaterializer` failures.
pub fn execute_ref_audit_cycle(
    git_dir: &Path,
    source_ref: &str,
    telemetry: &Arc<Mutex<SchedulerTelemetry>>,
    archetype: ProjectArchetype,
) -> FractalResult<Option<String>> {
    let Some(cloned) = load_committed_ref_snapshot(git_dir, source_ref)? else {
        return Ok(None);
    };
    materialize_cloned_snapshot(MaterializeArgs {
        git_dir,
        telemetry,
        source_ref: Some(source_ref),
        archetype,
        force: true,
        cloned,
    })
}

pub(super) fn load_committed_ref_snapshot(
    git_dir: &Path,
    source_ref: &str,
) -> FractalResult<Option<ClonedSnapshotData>> {
    let odb = LooseOdb::new(git_dir);
    let resolved_head_ref = if source_ref == "HEAD" {
        std::fs::read_to_string(git_dir.join("HEAD"))
            .ok()
            .map(|raw| {
                raw.trim()
                    .strip_prefix("ref:")
                    .map_or(raw.trim(), str::trim)
                    .to_owned()
            })
    } else {
        None
    };
    let commit_oid = if let Some(ref head_target) = resolved_head_ref {
        DiskRefStore::new(git_dir)
            .get_ref(head_target)
            .ok()
            .flatten()
    } else {
        DiskRefStore::new(git_dir).get_ref(source_ref)?
    };
    let Some(commit_id) = commit_oid else {
        return Ok(None);
    };
    let (ordered, tree_oid) = load_commit_tree_entries(&odb, &commit_id)?;
    let (files, manifest_paths) = read_ordered_blobs(&odb, &ordered);
    Ok(Some(ClonedSnapshotData {
        repository_id: resolve_repo_name(git_dir),
        head_ref: resolved_head_ref.or_else(|| Some(source_ref.to_owned())),
        head_commit_oid: Some(commit_id),
        tree_oid,
        parent_oids: vec![commit_id],
        ordered,
        files,
        manifest_paths,
    }))
}
