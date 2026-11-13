//! Module: taxis_cmd::audit_cmd — Worktree-Free Asynchronous & Snapshot Audit CLI Surface
//! File Path: src/bin/taxis_cmd/audit_cmd/mod.rs
//! Architecture Role: Dispatches `taxis audit {status, pause, resume, latest, trace, run}`
//!   commands against the persistent daemon IPC endpoint and ODB Fractal Audit Tree.
//! Dependencies & Triggers: Invoked by `taxis audit` / `taxis aud`.
//! Responsibilities: Never create `.audit-logs/` files on disk; route status/pause/resume.
//! Exit Semantics & Design Rationale: Offline fallback cleanly reports stale daemon sentinels.

mod queries;
mod run_cmd;
mod snapshot_preview;
mod snapshot_walk;

use fg_topology::refs::FractalRef;
use fractal_git::constants::cli::CliTag;
use fractal_git::IpcMessage;

use super::common::{print_json, reject, CliContext};
use super::daemon::daemon_transport::{
    is_audit_paused, notify_daemon_async_audit, probe_daemon_alive, read_daemon_meta,
    resolve_taxis_runtime_dir, send_daemon_ipc_request, set_audit_paused, AUDIT_PAUSE_FILENAME,
};

/// Dispatches `taxis audit {status, pause, resume, latest, trace, run}` commands cleanly.
pub fn handle_audit(ctx: &CliContext) {
    let subcmd = ctx.args.first().map(String::as_str).unwrap_or("status");

    match subcmd {
        "status" => handle_audit_status(ctx),
        "pause" => handle_audit_pause(ctx, true),
        "resume" => handle_audit_pause(ctx, false),
        "latest" => queries::handle_audit_latest(ctx),
        "trace" => queries::handle_audit_trace(ctx),
        "run" => run_cmd::handle_audit_run(ctx),
        arg if arg.starts_with("--") => run_cmd::handle_audit_run(ctx),
        other => reject(
            CliTag::ERROR,
            format!(
                "unknown audit subcommand '{other}'; use status, pause, resume, latest, trace, or run"
            ),
        ),
    }
}

fn handle_audit_pause(ctx: &CliContext, paused: bool) {
    set_audit_paused(&ctx.git_dir, paused)
        .unwrap_or_else(|err| reject(CliTag::ERROR, err.to_string()));
    if !paused {
        notify_daemon_async_audit(&ctx.git_dir, None);
    }
    let pause_file = resolve_taxis_runtime_dir(&ctx.git_dir).join(AUDIT_PAUSE_FILENAME);
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "ok": true,
            "paused": paused,
            "pause_file": pause_file.to_string_lossy(),
            "writes_audit_logs_dir": false,
        }));
    } else {
        println!("[taxis audit] paused={paused}");
    }
}

fn handle_audit_status(ctx: &CliContext) {
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
    }) = send_daemon_ipc_request(&ctx.git_dir, &IpcMessage::QueryAuditStatus)
    {
        if ctx.json_mode {
            print_json(&serde_json::json!({
                "ok": true,
                "mode": "daemon",
                "active": active,
                "paused": paused,
                "stale_daemon_detected": false,
                "queued_jobs": queued_jobs,
                "last_review_id": last_review_id,
                "last_tree_oid": last_tree_oid,
                "last_audit_commit_oid": last_audit_commit_oid,
                "last_composite_score": last_composite_score,
                "last_decision": last_decision,
                "writes_audit_logs_dir": writes_audit_logs_dir,
            }));
        } else {
            println!(
                "[taxis audit] active={active} paused={paused} queued={queued_jobs} last_commit={} score={}",
                last_audit_commit_oid.as_deref().unwrap_or("none"),
                last_composite_score
                    .map(|val| format!("{val:.2}"))
                    .unwrap_or_else(|| String::from("n/a"))
            );
        }
        return;
    }

    let trunk_oid = FractalRef::AuditTrunk
        .read_oid(&ctx.git_dir)
        .ok()
        .flatten()
        .map(|oid| oid.to_hex());
    let paused = is_audit_paused(&ctx.git_dir);
    let daemon_present = read_daemon_meta(&ctx.git_dir).is_some();
    let stale_daemon_detected = daemon_present && probe_daemon_alive(&ctx.git_dir).is_none();

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "ok": true,
            "mode": "offline",
            "active": false,
            "daemon_present": daemon_present,
            "stale_daemon_detected": stale_daemon_detected,
            "paused": paused,
            "queued_jobs": 0,
            "last_audit_commit_oid": trunk_oid,
            "writes_audit_logs_dir": false,
        }));
    } else {
        println!(
            "[taxis audit] offline paused={paused} stale_daemon_detected={stale_daemon_detected} trunk_commit={}",
            trunk_oid.as_deref().unwrap_or("none")
        );
    }
}
