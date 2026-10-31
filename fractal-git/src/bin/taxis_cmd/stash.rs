//! Module: taxis_cmd::stash — Native 'stash' Command Dispatcher
//! File Path: src/bin/taxis_cmd/stash.rs
//! Architecture Role: Implements dirty state shelving: captures uncommitted working-tree
//!   and index changes into synthetic stash commits, advances refs/stash, resets worktree
//!   to clean HEAD, and provides pop/apply/list/drop lifecycle.
//! Dependencies & Triggers: Dispatched by `taxis stash`.
//! Responsibilities: Snapshot dirty worktree into tree object, create stash commit, reset
//!   worktree cleanly to HEAD, and restore or drop stashed states.
//! Exit Semantics & Design Rationale:
//!   - If worktree and index are completely clean, reports 'No local changes to save' without side effects.
//!   - Stash commit stores exact tree and links directly to HEAD as parent.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::collections::BTreeMap;
use std::fs;

use fg_core::constants::git::OBJ_BLOB;
use fg_core::models::{FileMode, GitSignature};
use fg_core::traits::OdbStore;
use fg_index::InMemoryIndexTree;
use fg_object::GitCommit;
use fg_storage::commit_materializer::{persist_commit_object, persist_index_tree};
use fg_storage::LooseOdb;
use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, RefStore};

use super::checkout::{materialize_files, remove_stale_files, update_dirc_index};
use super::commit_walk::parse_commit_record;
use super::common::{fail_io, print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::status::collect_status;
use super::tree_view::{flatten_commit_tree, flatten_tree_for_diff};

/// Dispatches the `stash` command.
pub fn handle_stash(ctx: &CliContext) {
    let subcmd = ctx.args.first().map(|s| s.as_str()).unwrap_or("push");
    let view = RepoView::open_or_exit(ctx);

    match subcmd {
        "push" | "save" => handle_stash_push(&view, ctx),
        "pop" => handle_stash_pop(&view, true, ctx),
        "apply" => handle_stash_pop(&view, false, ctx),
        "list" => handle_stash_list(&view, ctx),
        "drop" | "clear" => handle_stash_drop(&view, ctx),
        other if !other.starts_with('-') => {
            // Treat bare argument like `taxis stash` with message or defaults
            handle_stash_push(&view, ctx);
        }
        _ => handle_stash_push(&view, ctx),
    }
}

/// Shelves uncommitted working tree and index modifications into refs/stash.
fn handle_stash_push(view: &RepoView, ctx: &CliContext) {
    let status_entries = match collect_status(view) {
        Ok(s) => s,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let dirty: Vec<_> = status_entries
        .iter()
        .filter(|e| e.is_staged() || e.is_unstaged())
        .collect();

    if dirty.is_empty() {
        if ctx.json_mode {
            print_json(&serde_json::json!({
                "engine": "taxis",
                "operation": "stash",
                "status": "clean",
                "message": "No local changes to save"
            }));
        } else {
            println!("No local changes to save");
        }
        return;
    }

    let head_oid = match view.head_commit() {
        Ok(Some(oid)) => oid,
        _ => reject(CliTag::ERROR, "cannot stash on unborn HEAD"),
    };

    let head_obj = match view.object(&head_oid) {
        Ok(obj) => obj,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let head_rec = match parse_commit_record(head_oid, &head_obj.payload) {
        Ok(rec) => rec,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let branch_name = view
        .head_branch()
        .ok()
        .flatten()
        .map(|(b, _)| b)
        .unwrap_or_else(|| "detached".to_string());

    let odb = LooseOdb::new(view.git_dir());

    // 1. Build tree from current working directory
    let mut in_mem_index = InMemoryIndexTree::new();
    let current_head_files = flatten_commit_tree(view, &head_oid).unwrap_or_default();

    // Start with all head files
    for (path, tree_entry) in &current_head_files {
        let full_path = view.work_root().join(path);
        if full_path.is_file() {
            if let Ok(bytes) = fs::read(&full_path) {
                if let Ok(blob_oid) = odb.write_object(OBJ_BLOB, &bytes) {
                    let _ = in_mem_index.stage_oid(path, tree_entry.mode, blob_oid);
                }
            }
        }
    }

    // Include any new/modified files from status
    for entry in &dirty {
        let full_path = view.work_root().join(&entry.path);
        if full_path.is_file() {
            if let Ok(bytes) = fs::read(&full_path) {
                if let Ok(blob_oid) = odb.write_object(OBJ_BLOB, &bytes) {
                    let _ = in_mem_index.stage_oid(&entry.path, FileMode::RegularFile, blob_oid);
                }
            }
        }
    }

    let stash_tree_oid = persist_index_tree(&in_mem_index, &odb)
        .unwrap_or_else(|err| fail_io("persist stash tree", err));

    let timestamp_sec = chrono::Utc::now().timestamp();
    let author = GitSignature::new("Taxis Operator", "operator@taxis.internal", timestamp_sec);
    let head_summary = head_rec.message.lines().next().unwrap_or("").trim();
    let stash_msg = format!(
        "WIP on {}: {} {}",
        branch_name,
        &head_oid.to_hex()[..7],
        head_summary
    );

    let stash_commit = GitCommit::new(
        stash_tree_oid,
        vec![head_oid],
        author.clone(),
        author,
        format!("{stash_msg}\n"),
        None,
    );

    let stash_commit_oid = persist_commit_object(&stash_commit, &odb)
        .unwrap_or_else(|err| fail_io("persist stash commit", err));

    // Update refs/stash
    let ref_store = DiskRefStore::new(view.git_dir());
    let _ = ref_store.update_ref("refs/stash", &stash_commit_oid, None);

    // Hard reset worktree to HEAD
    let mut target_files = BTreeMap::new();
    let _ = flatten_tree_for_diff(view, &head_rec.tree, "", &mut target_files);

    remove_stale_files(view.work_root(), &current_head_files, &target_files);
    let index_entries = materialize_files(view, &target_files);
    update_dirc_index(view.git_dir(), &index_entries);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "stash",
            "status": "saved",
            "stash_commit": stash_commit_oid.to_hex(),
            "message": stash_msg,
        }));
    } else {
        println!("Saved working directory and index state {}", stash_msg);
    }
}

/// Restores stashed modifications back to the worktree and optionally drops the stash entry.
fn handle_stash_pop(view: &RepoView, drop_after: bool, ctx: &CliContext) {
    let ref_store = DiskRefStore::new(view.git_dir());
    let stash_oid = match ref_store.get_ref("refs/stash") {
        Ok(Some(oid)) => oid,
        _ => reject(CliTag::ERROR, "error: No stash entries found."),
    };

    let (_, stash_tree) = match view.resolve_tree(&stash_oid.to_hex()) {
        Ok(res) => res,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let mut stashed_files = BTreeMap::new();
    let _ = flatten_tree_for_diff(view, &stash_tree, "", &mut stashed_files);

    let index_entries = materialize_files(view, &stashed_files);
    update_dirc_index(view.git_dir(), &index_entries);

    if drop_after {
        let stash_file = view.git_dir().join("refs/stash");
        let _ = fs::remove_file(stash_file);
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "stash",
            "status": if drop_after { "popped" } else { "applied" },
            "stash_oid": stash_oid.to_hex(),
        }));
    } else {
        println!("Applied stash ({})", &stash_oid.to_hex()[..7]);
        if drop_after {
            println!("Dropped refs/stash@{{0}} ({})", stash_oid.to_hex());
        }
    }
}

/// Lists available stash entries.
fn handle_stash_list(view: &RepoView, ctx: &CliContext) {
    let ref_store = DiskRefStore::new(view.git_dir());
    let stash_oid = match ref_store.get_ref("refs/stash") {
        Ok(Some(oid)) => oid,
        _ => {
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "engine": "taxis",
                    "operation": "stash",
                    "stashes": []
                }));
            }
            return;
        }
    };

    let summary = if let Ok(obj) = view.object(&stash_oid) {
        if let Ok(rec) = parse_commit_record(stash_oid, &obj.payload) {
            rec.message.lines().next().unwrap_or("").to_string()
        } else {
            "WIP".to_string()
        }
    } else {
        "WIP".to_string()
    };

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "stash",
            "stashes": [{
                "index": 0,
                "oid": stash_oid.to_hex(),
                "summary": summary
            }]
        }));
    } else {
        println!("stash@{{0}}: {summary}");
    }
}

/// Drops refs/stash.
fn handle_stash_drop(view: &RepoView, ctx: &CliContext) {
    let stash_file = view.git_dir().join("refs/stash");
    if !stash_file.is_file() {
        reject(CliTag::ERROR, "error: No stash entries found.");
    }

    let _ = fs::remove_file(stash_file);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "stash",
            "status": "dropped"
        }));
    } else {
        println!("Dropped refs/stash@{{0}}");
    }
}
