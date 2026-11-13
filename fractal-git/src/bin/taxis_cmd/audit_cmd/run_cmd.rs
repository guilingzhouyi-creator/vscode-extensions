//! Module: taxis_cmd::audit_cmd — Synchronous & Queued Audit Trigger Runner
//! File Path: src/bin/taxis_cmd/audit_cmd/run_cmd.rs
//! Architecture Role: Executes `taxis audit run`, scheduling an immediate asynchronous daemon
//!   audit when available or running synchronous in-process ODB sealing for `--sync`/`--commit`.
//! Dependencies & Triggers: Delegates `--snapshot-dir` to `snapshot_preview`.
//! Responsibilities: Seal audit trees on `refs/fractal/audit/...` without touching worktree.
//! Exit Semantics & Design Rationale: Fails cleanly via `CliTag` structured errors.

use std::path::Path;
use std::sync::{Arc, Mutex};

use fractal_git::constants::cli::CliTag;
use fractal_git::IpcMessage;

use crate::taxis_cmd::common::{find_arg_value, print_json, reject, CliContext};
use crate::taxis_cmd::daemon::daemon_scheduler::{
    execute_background_audit_cycle, execute_ref_audit_cycle, parse_archetype_flag,
    resolve_audit_target_ref, SchedulerTelemetry,
};
use crate::taxis_cmd::daemon::daemon_transport::{probe_daemon_alive, send_daemon_ipc_request};
use crate::taxis_cmd::daemon::DaemonHotSession;

use super::snapshot_preview::handle_snapshot_dir_audit;

pub(super) fn handle_audit_run(ctx: &CliContext) {
    if let Some(snapshot_dir) = find_arg_value(&ctx.args, &["--snapshot-dir"]) {
        handle_snapshot_dir_audit(ctx, Path::new(snapshot_dir));
        return;
    }

    let target_ref = find_arg_value(&ctx.args, &["--ref"]);
    let force_sync = ctx
        .args
        .iter()
        .any(|arg| arg == "--sync" || arg == "--commit");

    if !force_sync && probe_daemon_alive(&ctx.git_dir).is_some() {
        if let Ok(IpcMessage::AuditStatus {
            active,
            paused,
            queued_jobs,
            last_review_id,
            last_tree_oid,
            last_audit_commit_oid,
            last_composite_score,
            last_decision,
            writes_audit_logs_dir,
        }) = send_daemon_ipc_request(
            &ctx.git_dir,
            &IpcMessage::ScheduleAudit {
                target_ref: target_ref.map(str::to_owned),
                force: true,
            },
        ) {
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "ok": true,
                    "scheduled": true,
                    "active": active,
                    "paused": paused,
                    "queued_jobs": queued_jobs,
                    "last_review_id": last_review_id,
                    "last_tree_oid": last_tree_oid,
                    "last_audit_commit_oid": last_audit_commit_oid,
                    "last_composite_score": last_composite_score,
                    "last_decision": last_decision,
                    "writes_audit_logs_dir": writes_audit_logs_dir,
                }));
            } else {
                println!("[taxis audit] scheduled async audit (queued_jobs={queued_jobs})");
            }
            return;
        }
    }

    let archetype = parse_archetype_flag(&ctx.args);
    let telemetry = Arc::new(Mutex::new(SchedulerTelemetry::default()));
    let audit_commit_oid = match target_ref {
        Some(ref_name) => execute_ref_audit_cycle(&ctx.git_dir, ref_name, &telemetry, archetype),
        None => {
            let session = Arc::new(Mutex::new(DaemonHotSession::open(&ctx.git_dir)));
            execute_background_audit_cycle(&ctx.git_dir, &session, &telemetry, None, archetype)
        }
    }
    .unwrap_or_else(|err| reject(CliTag::ERROR, err.to_string()));

    let snap = telemetry.lock().ok();
    let audit_ref = snap
        .as_ref()
        .and_then(|val| val.last_audit_ref.clone())
        .unwrap_or_else(|| resolve_audit_target_ref(target_ref).to_git_ref());
    let score = snap.as_ref().and_then(|val| val.last_composite_score);
    let decision = snap.as_ref().and_then(|val| val.last_decision.clone());

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "ok": true,
            "scheduled": false,
            "audit_ref": audit_ref,
            "audit_commit_oid": audit_commit_oid,
            "composite_score": score,
            "decision": decision,
            "writes_audit_logs_dir": false,
        }));
    } else {
        println!(
            "[taxis audit] materialized ref={} commit={} decision={}",
            audit_ref,
            audit_commit_oid.as_deref().unwrap_or("none"),
            decision.as_deref().unwrap_or("none")
        );
    }
}
