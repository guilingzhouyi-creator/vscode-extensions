//! Module: taxis_cmd::daemon_ipc_dispatch — Persistent Stream Auth & IPC Router
//! File Path: src/bin/taxis_cmd/daemon_ipc_dispatch.rs
//! Architecture Role: Authenticates incoming persistent daemon streams and routes IPC frames
//!   to either the background async audit scheduler or `DaemonHotSession`.
//! Dependencies & Triggers: Invoked by `daemon_persistent::accept_next_connection`.
//! Responsibilities: Reject unauthenticated commands, trigger async audits on stage/commit,
//!   and never re-trigger self-owned audit/telemetry refs.
//! Exit Semantics & Design Rationale: Structured `IpcDaemonReceipt` errors protect session locks.

use std::path::Path;
use std::sync::{Arc, Mutex};

use fractal_git::server::{IpcDaemonReceipt, IpcMessage};

use super::daemon_runtime::DaemonHotSession;
use super::daemon_scheduler::{
    is_self_owned_audit_or_telemetry_ref, query_latest_audit_report, AsyncAuditScheduler,
};
use super::daemon_transport::{read_authenticated_request, PlatformListener};

pub(super) struct PersistentStreamContext<'a> {
    pub(super) git_dir: &'a Path,
    pub(super) token_hex: &'a str,
    pub(super) session: &'a Arc<Mutex<DaemonHotSession>>,
    pub(super) scheduler: &'a AsyncAuditScheduler,
}

pub(super) fn handle_persistent_stream<S: std::io::Read + std::io::Write>(
    stream: &mut S,
    require_hello_auth: bool,
    ctx: &PersistentStreamContext<'_>,
) {
    let request = match read_authenticated_request(stream, ctx.token_hex, require_hello_auth) {
        Ok(Some(msg)) => msg,
        Ok(None) => return,
        Err(err) => {
            let err_receipt = build_daemon_error_receipt("auth", &err.to_string());
            let _ = PlatformListener::write_response(
                stream,
                &IpcMessage::DaemonReceipt {
                    receipt: err_receipt,
                },
            );
            return;
        }
    };
    let response = dispatch_persistent_ipc(ctx.git_dir, &request, ctx.session, ctx.scheduler);
    let _ = PlatformListener::write_response(stream, &response);
}

fn dispatch_persistent_ipc(
    git_dir: &Path,
    request: &IpcMessage,
    session: &Arc<Mutex<DaemonHotSession>>,
    scheduler: &AsyncAuditScheduler,
) -> IpcMessage {
    match request {
        IpcMessage::ScheduleAudit { target_ref, force } => {
            let _ = scheduler.notify_trigger(target_ref.as_deref(), *force);
            scheduler.status_message()
        }
        IpcMessage::QueryAuditStatus => scheduler.status_message(),
        IpcMessage::QueryAuditReport { target_ref } => {
            match query_latest_audit_report(git_dir, target_ref.as_deref()) {
                Ok(report_msg) => report_msg,
                Err(err) => IpcMessage::DaemonReceipt {
                    receipt: build_daemon_error_receipt("query_audit_report", &err.to_string()),
                },
            }
        }
        other => {
            let trigger_ref = match other {
                IpcMessage::Stage { .. } => Some(None),
                IpcMessage::Commit { target_ref, .. }
                    if !is_self_owned_audit_or_telemetry_ref(target_ref) =>
                {
                    Some(Some(target_ref.as_str()))
                }
                _ => None,
            };
            let receipt = match session.lock() {
                Ok(mut guard) => guard.execute(other),
                Err(_) => build_daemon_error_receipt("session", "daemon session lock poisoned"),
            };
            if receipt.ok {
                if let Some(target_ref_opt) = trigger_ref {
                    let _ = scheduler.notify_trigger(target_ref_opt, false);
                }
            }
            IpcMessage::DaemonReceipt { receipt }
        }
    }
}

fn build_daemon_error_receipt(command: &str, detail: &str) -> IpcDaemonReceipt {
    IpcDaemonReceipt {
        command: command.to_owned(),
        ok: false,
        latency_us: 0,
        cache_generation: 0,
        cache_hit: false,
        tree_oid: None,
        commit_oid: None,
        target_ref: None,
        entry_count: 0,
        entries: Vec::new(),
        detail: detail.to_owned(),
    }
}
