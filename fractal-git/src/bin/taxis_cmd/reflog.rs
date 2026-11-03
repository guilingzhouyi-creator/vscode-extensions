//! Module: taxis_cmd::reflog — Reference Update History Command
//! File Path: src/bin/taxis_cmd/reflog.rs
//! Architecture Role: Implements `taxis reflog`, projecting operation graph ledger entries as reflog records.
//! Dependencies & Triggers: Dispatched by `taxis reflog`, re-exported by `refs.rs`.
//! Responsibilities: Parse CLI flags, read operation graph history, project rows per ref, and format display.
//! Exit Semantics & Design Rationale:
//!   - Exits 0 on normal history output.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TOP-001`: DAG topology traversal guard

use std::collections::BTreeMap;

use fg_core::models::Oid;
use fg_topology::OperationGraph;

use super::common::{fail_fatal, fail_usage, print_json, CliContext};

/// Default number of reflog entries when the caller names no limit.
pub const DEFAULT_REFLOG_LIMIT: usize = 20;

/// Prints usage for `taxis reflog`.
pub fn print_reflog_help() {
    println!(
        "Usage: taxis reflog [--ref <name>] [-n <count>]\n\n\
         Show the reference update history, newest first.\n\n\
         Options:\n\
           --ref <name>        Restrict output to one reference\n\
           -n, --max-count <n> Number of entries to show (default {DEFAULT_REFLOG_LIMIT})"
    );
}

/// Dispatches `taxis reflog`.
pub fn handle_reflog(ctx: &CliContext) {
    let mut only_ref: Option<String> = None;
    let mut limit = DEFAULT_REFLOG_LIMIT;
    let mut cursor = 0usize;
    while cursor < ctx.args.len() {
        let argument = ctx.args[cursor].as_str();
        cursor += 1;
        match argument {
            "-h" | "--help" => {
                print_reflog_help();
                return;
            }
            "--ref" => {
                let Some(value) = ctx.args.get(cursor) else {
                    fail_usage("reflog: --ref requires a reference name");
                };
                only_ref = Some(value.clone());
                cursor += 1;
            }
            "-n" | "--max-count" => {
                let Some(value) = ctx.args.get(cursor) else {
                    fail_usage("reflog: -n requires a count");
                };
                limit = parse_count(value);
                cursor += 1;
            }
            other if other.starts_with("--ref=") => {
                only_ref = Some(other["--ref=".len()..].to_string());
            }
            other if other.starts_with('-') && other.len() > 1 => {
                fail_usage(format!("reflog: unknown option '{other}'"));
            }
            other if !other.is_empty() => {
                only_ref = Some(other.to_string());
            }
            _ => {}
        }
    }

    let operations = match OperationGraph::load_or_init(&ctx.git_dir) {
        Ok(graph) => graph
            .history(usize::MAX)
            .into_iter()
            .cloned()
            .collect::<Vec<_>>(),
        Err(load_err) => fail_fatal(format!("open operation ledger: {load_err}")),
    };

    if ctx.json_mode {
        let entries: Vec<serde_json::Value> = operations
            .iter()
            .rev()
            .take(limit)
            .map(|operation| {
                serde_json::json!({
                    "op_id": operation.op_id.to_hex(),
                    "command": operation.metadata.command,
                    "actor": operation.metadata.actor,
                    "description": operation.metadata.description,
                    "timestamp_ms": operation.metadata.timestamp_ms,
                    "head": operation.view.head_oid.map(|oid| oid.to_hex()),
                    "branches": operation
                        .view
                        .branches
                        .iter()
                        .map(|(name, oid)| serde_json::json!({ "ref": name, "target": oid.to_hex() }))
                        .collect::<Vec<_>>(),
                })
            })
            .collect();
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "reflog",
            "entries": entries
        }));
        return;
    }

    let mut printed = 0usize;
    for operation in operations.iter().rev() {
        for (ref_name, target) in project_reflog_rows(operation, only_ref.as_deref()) {
            if printed >= limit {
                return;
            }
            println!(
                "{} {}@{{{}}}: {}",
                operation.op_id.to_hex(),
                ref_name,
                printed,
                operation.metadata.description
            );
            println!("  -> {}", target.to_hex());
            printed += 1;
        }
    }
}

/// Projects one ledger entry into `(ref, target)` rows, optionally filtered to one ref.
fn project_reflog_rows(
    operation: &fg_topology::Operation,
    only_ref: Option<&str>,
) -> Vec<(String, Oid)> {
    if let Some(filter) = only_ref {
        let short = filter.strip_prefix("refs/heads/").unwrap_or(filter);
        if let Some(target) = operation.view.branches.get(short) {
            return vec![(short.to_string(), *target)];
        }
        if let Some(target) = operation.view.branches.get(filter) {
            return vec![(filter.to_string(), *target)];
        }
        return Vec::new();
    }

    let mut rows: Vec<(String, Oid)> = Vec::new();
    if let Some(head) = operation.view.head_oid {
        rows.push(("HEAD".to_string(), head));
    }
    let ordered: BTreeMap<&String, &Oid> = operation.view.branches.iter().collect();
    for (name, oid) in ordered {
        rows.push((name.clone(), *oid));
    }
    rows
}

/// Parses a positive count, rejecting malformed values rather than defaulting.
fn parse_count(text: &str) -> usize {
    match text.parse::<usize>() {
        Ok(value) if value > 0 => value,
        _ => fail_usage(format!("expected a positive count, got '{text}'")),
    }
}
