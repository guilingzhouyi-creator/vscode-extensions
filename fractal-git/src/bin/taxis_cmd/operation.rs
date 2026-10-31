//! Module: taxis_cmd::operation — Operation Log Inspection & Recording
//! File Path: src/bin/taxis_cmd/operation.rs
//! Architecture Role: Displays recorded Operation Log DAG history, outputs JSON arrays of
//!   historical repository mutations, and provides the unified helper for recording HEAD-advancing
//!   operations across commit, reset, merge, rebase, cherry-pick, and revert.
//! Dependencies & Triggers: Dispatched by `taxis operation` / `taxis op`, and called by mutating
//!   commands to append snapshots to `OperationGraph`.
//! Responsibilities: Formats and outputs the repository's chronological operation ledger and
//!   captures atomic branch/HEAD snapshots.
//! Exit Semantics & Design Rationale: Exits 0 on query; displays informative message if empty.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::collections::BTreeMap;
use std::path::Path;

use fg_core::models::{current_unix_seconds, Oid};
use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, OperationGraph, RepoViewSnapshot};

use super::common::{print_json, CliContext};

/// Parameters for recording a HEAD-advancing repository operation.
pub(crate) struct HeadOperationSpec<'a> {
    pub git_dir: &'a Path,
    pub head_oid: Oid,
    pub branch_or_ref: Option<&'a str>,
    pub actor: &'a str,
    pub command: &'a str,
    pub description: String,
}

/// Records a repository state snapshot into the `OperationGraph` (best-effort).
pub(crate) fn record_head_operation(spec: HeadOperationSpec<'_>) {
    let Ok(mut op_graph) = OperationGraph::load_or_init(spec.git_dir) else {
        return;
    };
    let current_time_ms = current_unix_seconds().saturating_mul(1000);
    let ref_store = DiskRefStore::new(spec.git_dir);
    let mut branches = BTreeMap::new();
    if let Ok(all_refs) = ref_store.list_all() {
        for (name, oid) in all_refs {
            branches.insert(name, oid);
        }
    }
    if let Some(ref_or_branch) = spec.branch_or_ref {
        let full_ref = if ref_or_branch.starts_with("refs/") {
            ref_or_branch.to_string()
        } else {
            format!("refs/heads/{ref_or_branch}")
        };
        branches.insert(full_ref, spec.head_oid);
    }

    let view_snapshot = RepoViewSnapshot {
        head_oid: Some(spec.head_oid),
        branches,
        staged_promotions: Vec::new(),
        timestamp_ms: current_time_ms,
    };

    let _ = op_graph.record_operation(
        view_snapshot,
        spec.actor.to_string(),
        spec.command,
        spec.description,
        current_time_ms,
    );
}

/// Displays recorded operation log or outputs JSON array of historical operations.
pub fn handle_operation(ctx: &CliContext) {
    let op_graph = match OperationGraph::load_or_init(&ctx.git_dir) {
        Ok(graph) => graph,
        Err(load_err) => {
            eprintln!(
                "{} Failed to load operation graph: {}",
                CliTag::ERROR,
                load_err
            );
            return;
        }
    };

    let history_list = op_graph.history(20);
    if ctx.json_mode {
        let json_ops: Vec<serde_json::Value> = history_list
            .iter()
            .map(|op_node| {
                serde_json::json!({
                    "operation_id": op_node.op_id.to_hex(),
                    "actor": op_node.metadata.actor,
                    "command": op_node.metadata.command,
                    "description": op_node.metadata.description,
                    "timestamp_ms": op_node.metadata.timestamp_ms,
                })
            })
            .collect();
        print_json(&json_ops);
    } else {
        println!("=== Taxis Operation History (Most Recent First) ===");
        if history_list.is_empty() {
            println!("  (No recorded operations)");
        } else {
            for op_node in history_list {
                let hex_str = op_node.op_id.to_hex();
                let short_id = if hex_str.len() >= 10 {
                    &hex_str[..10]
                } else {
                    &hex_str
                };
                println!(
                    "  * [{}] {} (actor: {}) - {}",
                    short_id,
                    op_node.metadata.command,
                    op_node.metadata.actor,
                    op_node.metadata.description
                );
            }
        }
    }
}
