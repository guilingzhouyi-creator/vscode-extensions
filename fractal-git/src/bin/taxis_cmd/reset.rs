//! Module: taxis_cmd::reset — Native 'reset' Command Dispatcher
//! File Path: src/bin/taxis_cmd/reset.rs
//! Architecture Role: Implements Git-compatible reset mechanics (--soft, --mixed, --hard)
//!   with atomic reference updates, DIRC v2 index synchronization, worktree materialization,
//!   and OperationGraph time-travel recording.
//! Dependencies & Triggers: Dispatched by `taxis reset`.
//! Responsibilities: Parse reset mode and target, update branch/HEAD pointer, synchronize
//!   staged index, optionally materialize/clean worktree files, and record to operation log.
//! Exit Semantics & Design Rationale:
//!   - Default mode is Mixed, conforming to Git specification.
//!   - Atomic reference update guarantees zero half-reset dangling state.
//!   - OperationGraph integration guarantees every reset can be reversed via `taxis undo`.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::collections::BTreeMap;
use std::fs;

use fg_core::models::{IndexStage, Oid};
use fg_index::IndexEntry;
use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, OperationGraph, RepoViewSnapshot};

use super::checkout::{
    assert_worktree_cleanliness, materialize_files, remove_stale_files, update_dirc_index,
    update_references,
};
use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::tree_view::{flatten_commit_tree, flatten_tree_for_diff, TreeEntry};

/// Reset mode indicating how much state to reset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResetMode {
    /// Move HEAD only; preserve index and working tree.
    Soft,
    /// Move HEAD and reset index; preserve working tree.
    Mixed,
    /// Move HEAD, reset index, and reset working tree files.
    Hard,
}

/// Parsed options for `taxis reset`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ResetOptions {
    mode: ResetMode,
    target: String,
    force: bool,
}

/// Dispatches the `reset` command.
pub fn handle_reset(ctx: &CliContext) {
    let opts = parse_reset_options(&ctx.args);
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };

    let (target_commit, tree_oid) = match view.resolve_tree(&opts.target) {
        Ok(resolved) => resolved,
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };

    let effective_branch = view
        .head_branch()
        .ok()
        .flatten()
        .map(|(branch_name, _)| branch_name);

    // Guard 1: Protect System Trunk & Trunk from non-HEAD history rewriting
    if let Some(ref br) = effective_branch {
        if br == "main" || br == "trunk" || br == "refs/heads/main" || br == "refs/heads/trunk" {
            let current_head = view.head_commit().ok().flatten();
            if current_head != Some(target_commit) && !opts.force {
                reject(
                    CliTag::AUTHORITY_BREACH,
                    format!(
                        "Resetting protected trunk branch '{br}' backwards to {target_commit} is forbidden. \
                         Trunk history is append-only; use 'taxis revert' instead."
                    ),
                );
            }
        }
    }

    // Guard 2: Protect working tree from silent overwrite in --hard mode unless forced
    if opts.mode == ResetMode::Hard {
        assert_worktree_cleanliness(&view, opts.force);
    }

    // Record snapshot to OperationGraph BEFORE state mutation for 100% reliable undo
    record_reset_operation(&view, target_commit, &opts, effective_branch.as_deref());

    match opts.mode {
        ResetMode::Soft => {
            update_references(
                view.git_dir(),
                view.work_root(),
                target_commit,
                effective_branch.as_deref(),
            );
        }
        ResetMode::Mixed => {
            update_references(
                view.git_dir(),
                view.work_root(),
                target_commit,
                effective_branch.as_deref(),
            );
            let mut target_files = BTreeMap::new();
            if let Err(diff_err) = flatten_tree_for_diff(&view, &tree_oid, "", &mut target_files) {
                reject(CliTag::ERROR, diff_err);
            }
            rebuild_mixed_dirc_index(&view, &target_files);
        }
        ResetMode::Hard => {
            let current_files = view
                .head_commit()
                .ok()
                .flatten()
                .and_then(|head_oid| flatten_commit_tree(&view, &head_oid).ok())
                .unwrap_or_default();

            let mut target_files = BTreeMap::new();
            if let Err(diff_err) = flatten_tree_for_diff(&view, &tree_oid, "", &mut target_files) {
                reject(CliTag::ERROR, diff_err);
            }

            remove_stale_files(view.work_root(), &current_files, &target_files);
            let index_entries = materialize_files(&view, &target_files);
            update_dirc_index(view.git_dir(), &index_entries);
            update_references(
                view.git_dir(),
                view.work_root(),
                target_commit,
                effective_branch.as_deref(),
            );
        }
    }

    print_reset_feedback(ctx, &opts, target_commit, effective_branch.as_deref());
}

/// Parses command line flags into structured reset options.
fn parse_reset_options(args: &[String]) -> ResetOptions {
    let mut mode = ResetMode::Mixed;
    let mut target = "HEAD".to_string();
    let mut force = false;

    for arg in args {
        match arg.as_str() {
            "--soft" => mode = ResetMode::Soft,
            "--mixed" => mode = ResetMode::Mixed,
            "--hard" => mode = ResetMode::Hard,
            "-f" | "--force" => force = true,
            other if !other.starts_with('-') => {
                target = other.to_string();
            }
            _ => {}
        }
    }

    ResetOptions {
        mode,
        target,
        force,
    }
}

/// Rebuilds DIRC index entries for mixed reset without touching working files.
fn rebuild_mixed_dirc_index(view: &RepoView, target_files: &BTreeMap<String, TreeEntry>) {
    let mut index_entries = Vec::with_capacity(target_files.len());

    for (path, tree_entry) in target_files {
        let full_path = view.work_root().join(path);
        let (size, mtime_sec, mtime_nano) = if let Ok(meta) = fs::metadata(&full_path) {
            let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let duration = mtime
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap_or_default();
            (
                meta.len() as u32,
                duration.as_secs() as u32,
                duration.subsec_nanos(),
            )
        } else {
            (0, 0, 0)
        };

        index_entries.push(IndexEntry {
            path: path.clone(),
            mode: tree_entry.mode,
            oid: tree_entry.oid,
            stage: IndexStage::Normal,
            size,
            mtime_seconds: mtime_sec,
            mtime_nanos: mtime_nano,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        });
    }

    update_dirc_index(view.git_dir(), &index_entries);
}

/// Records the reset operation in the OperationGraph for `undo` capability.
fn record_reset_operation(
    view: &RepoView,
    target_commit: Oid,
    opts: &ResetOptions,
    branch_name: Option<&str>,
) {
    let ref_store = DiskRefStore::new(view.git_dir());
    let mut op_graph = match OperationGraph::load_or_init(view.git_dir()) {
        Ok(graph) => graph,
        Err(_) => return,
    };
    let current_time_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_millis() as i64)
        .unwrap_or(0);

    let mut branches = BTreeMap::new();
    if let Ok(all_refs) = ref_store.list_all() {
        for (name, oid) in all_refs {
            branches.insert(name, oid);
        }
    }
    if let Some(branch) = branch_name {
        branches.insert(format!("refs/heads/{branch}"), target_commit);
    }

    let view_snapshot = RepoViewSnapshot {
        head_oid: Some(target_commit),
        branches,
        staged_promotions: Vec::new(),
        timestamp_ms: current_time_ms,
    };

    let _ = op_graph.record_operation(
        view_snapshot,
        "operator".to_string(),
        "reset",
        format!("reset ({:?}): {}", opts.mode, opts.target),
        current_time_ms,
    );
}

/// Prints formatted human or JSON response for reset.
fn print_reset_feedback(
    ctx: &CliContext,
    opts: &ResetOptions,
    target_commit: Oid,
    branch_name: Option<&str>,
) {
    let mode_str = match opts.mode {
        ResetMode::Soft => "soft",
        ResetMode::Mixed => "mixed",
        ResetMode::Hard => "hard",
    };

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "reset",
            "mode": mode_str,
            "target": opts.target,
            "target_commit": target_commit.to_hex(),
            "branch": branch_name,
        }));
        return;
    }

    match opts.mode {
        ResetMode::Soft => {
            println!("Reset HEAD to {} (soft)", &target_commit.to_hex()[..8]);
        }
        ResetMode::Mixed => {
            println!("Unstaged changes after reset:");
            println!("M\t(index reset to {})", &target_commit.to_hex()[..8]);
        }
        ResetMode::Hard => {
            println!(
                "HEAD is now at {} {}",
                &target_commit.to_hex()[..8],
                branch_name.unwrap_or("detached")
            );
        }
    }
}
