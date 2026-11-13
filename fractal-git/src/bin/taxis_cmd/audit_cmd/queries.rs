//! Module: taxis_cmd::audit_cmd — Audit Artifact & Lineage Query Handlers
//! File Path: src/bin/taxis_cmd/audit_cmd/queries.rs
//! Architecture Role: Implements `taxis audit latest` and `taxis audit trace` against live daemon
//!   IPC or offline ODB Fractal Audit Trees.
//! Dependencies & Triggers: Uses `AuditTreeMaterializer` and `daemon_scheduler::query_latest_audit_report`.
//! Responsibilities: Return sealed JSON or Markdown summaries directly from Git objects.
//! Exit Semantics & Design Rationale: Works cleanly offline without spawning any child processes.

use fg_topology::audit_tree::{AuditCommitTrace, AuditTreeMaterializer};
use fractal_git::constants::cli::CliTag;
use fractal_git::{IpcMessage, LooseOdb};
use serde_json::Value;

use crate::taxis_cmd::common::{find_arg_value, print_json, reject, CliContext};
use crate::taxis_cmd::daemon::daemon_scheduler::{query_latest_audit_report, resolve_audit_target_ref};
use crate::taxis_cmd::daemon::daemon_transport::{read_daemon_meta, send_daemon_ipc_request};

pub(super) fn handle_audit_latest(ctx: &CliContext) {
    let target_ref = find_arg_value(&ctx.args, &["--ref"]).map(str::to_owned);
    let response = if read_daemon_meta(&ctx.git_dir).is_some() {
        send_daemon_ipc_request(
            &ctx.git_dir,
            &IpcMessage::QueryAuditReport {
                target_ref: target_ref.clone(),
            },
        )
        .unwrap_or_else(|_| {
            query_latest_audit_report(&ctx.git_dir, target_ref.as_deref())
                .unwrap_or_else(|err| reject(CliTag::ERROR, err.to_string()))
        })
    } else {
        query_latest_audit_report(&ctx.git_dir, target_ref.as_deref())
            .unwrap_or_else(|err| reject(CliTag::ERROR, err.to_string()))
    };

    let IpcMessage::AuditReportResponse {
        found,
        audit_ref,
        commit_oid,
        evidence_json,
        receipt_json,
        aas_json,
    } = response
    else {
        reject(
            CliTag::ERROR,
            "unexpected daemon IPC response for audit latest query",
        );
    };

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "ok": true,
            "found": found,
            "audit_ref": audit_ref,
            "commit_oid": commit_oid,
            "evidence": parse_opt_json(evidence_json.as_deref()),
            "receipt": parse_opt_json(receipt_json.as_deref()),
            "aas": parse_opt_json(aas_json.as_deref()),
            "writes_audit_logs_dir": false,
        }));
    } else if found {
        let parsed_ref = resolve_audit_target_ref(target_ref.as_deref());
        let odb = LooseOdb::new(&ctx.git_dir);
        if let Ok(Some(md)) = AuditTreeMaterializer::read_audit_artifact(
            &odb,
            &ctx.git_dir,
            &parsed_ref,
            "reports/summary.md",
        ) {
            println!("{}", String::from_utf8_lossy(&md));
        } else {
            println!(
                "[taxis audit] ref={} commit={}",
                audit_ref.as_deref().unwrap_or("none"),
                commit_oid.as_deref().unwrap_or("none")
            );
        }
    } else {
        println!(
            "[taxis audit] no materialized audit artifacts on {}",
            audit_ref.as_deref().unwrap_or("refs/fractal/audit/trunk")
        );
    }
}

pub(super) fn handle_audit_trace(ctx: &CliContext) {
    let target_ref = find_arg_value(&ctx.args, &["--ref"]);
    let limit = find_arg_value(&ctx.args, &["--limit"])
        .and_then(|val| val.parse::<usize>().ok())
        .unwrap_or(10);
    let audit_ref = resolve_audit_target_ref(target_ref);
    let odb = LooseOdb::new(&ctx.git_dir);
    let traces =
        AuditTreeMaterializer::inspect_audit_lineage(&odb, &ctx.git_dir, &audit_ref, limit)
            .unwrap_or_else(|err| reject(CliTag::ERROR, err.to_string()));

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "ok": true,
            "audit_ref": audit_ref.to_git_ref(),
            "count": traces.len(),
            "commits": traces,
            "writes_audit_logs_dir": false,
        }));
    } else if traces.is_empty() {
        println!("[taxis audit] empty lineage on {}", audit_ref.to_git_ref());
    } else {
        for trace in &traces {
            print_trace_line(trace);
        }
    }
}

fn print_trace_line(trace: &AuditCommitTrace) {
    println!(
        "{} ({}) {}",
        trace.commit_oid.to_hex(),
        trace.timestamp_sec,
        trace.summary
    );
}

fn parse_opt_json(raw: Option<&str>) -> Value {
    raw.and_then(|txt| serde_json::from_str::<Value>(txt).ok())
        .unwrap_or(Value::Null)
}
