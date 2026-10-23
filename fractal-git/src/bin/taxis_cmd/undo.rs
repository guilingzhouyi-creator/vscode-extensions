//! Module: taxis_cmd::undo — Operation Graph Time-Travel Undo
//! File Path: src/bin/taxis_cmd/undo.rs
//! Architecture Role: Restores repository reference topology and worktree state to the
//!   predecessor snapshot recorded in the OperationGraph (Jujutsu-style undo).
//! Dependencies & Triggers: Dispatched by `taxis undo`.
//! Responsibilities: Operation graph traversal, atomic reference restoration, and worktree/index
//!   synchronization.
//! Exit Semantics & Design Rationale:
//!   - Atomically rolls back references and materializes the predecessor commit tree.
//!   - Safe idempotent operation; exits 0 when already at root operation.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, OperationGraph, RefStore};

use super::checkout::{materialize_files, remove_stale_files, update_dirc_index};
use super::common::{print_json, CliContext};
use super::repo_view::RepoView;
use super::tree_view::flatten_commit_tree;

/// Dispatches time-travel undo operation, restoring branch heads and worktree to previous snapshot.
pub fn handle_undo(ctx: &CliContext) {
    let mut op_graph = match OperationGraph::load_or_init(&ctx.git_dir) {
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

    match op_graph.undo() {
        Ok(Some(restored_op)) => {
            let ref_store = DiskRefStore::new(&ctx.git_dir);
            for (ref_name, ref_oid) in &restored_op.view.branches {
                let _ = ref_store.update_ref(ref_name, ref_oid, None);
            }

            // Synchronize worktree and index if head commit is present
            if let Some(head_oid) = restored_op.view.head_oid {
                if let Ok(view) = RepoView::open(ctx) {
                    let current_files = view
                        .head_commit()
                        .ok()
                        .flatten()
                        .and_then(|oid| flatten_commit_tree(&view, &oid).ok())
                        .unwrap_or_default();

                    let target_files = flatten_commit_tree(&view, &head_oid).unwrap_or_default();
                    remove_stale_files(view.work_root(), &current_files, &target_files);
                    let index_entries = materialize_files(&view, &target_files);
                    update_dirc_index(view.git_dir(), &index_entries);
                }
            }

            if ctx.json_mode {
                let json_val = serde_json::json!({
                    "status": "undone",
                    "restored_operation_id": restored_op.op_id.to_hex(),
                    "command": restored_op.metadata.command,
                    "description": restored_op.metadata.description,
                });
                print_json(&json_val);
            } else {
                let hex_str = restored_op.op_id.to_hex();
                let short_id = if hex_str.len() >= 10 {
                    &hex_str[..10]
                } else {
                    &hex_str
                };
                println!(
                    "{} Restored repository view to operation {} (command: '{}')",
                    CliTag::UNDO_OK,
                    short_id,
                    restored_op.metadata.command
                );
            }
        }
        Ok(None) => {
            if ctx.json_mode {
                println!(r#"{{"status": "noop", "message": "At root operation"}}"#);
            } else {
                println!("{} No previous operation to undo.", CliTag::INFO);
            }
        }
        Err(undo_err) => {
            eprintln!("{} Undo failed: {}", CliTag::FAIL, undo_err);
        }
    }
}
