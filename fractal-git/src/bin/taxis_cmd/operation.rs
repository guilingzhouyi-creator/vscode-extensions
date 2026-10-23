//! Module: taxis_cmd::operation — Operation Log Inspection
//! File Path: src/bin/taxis_cmd/operation.rs
//! Architecture Role: Displays recorded Operation Log DAG history or outputs JSON array of
//!   historical repository mutations.
//! Dependencies & Triggers: Dispatched by `taxis operation` / `taxis op`.
//! Responsibilities: Formats and outputs the repository's chronological operation ledger.
//! Exit Semantics & Design Rationale: Exits 0 on query; displays informative message if empty.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use fractal_git::constants::cli::CliTag;
use fractal_git::OperationGraph;

use super::common::{print_json, CliContext};

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
