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
use fractal_git::DiskRefStore;

use super::checkout::{materialize_files, remove_stale_files, update_dirc_index};
use super::commit_walk::parse_commit_record;
use super::common::{fail_io, fail_usage, print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::stash_merge::{
    apply_clean_stash_to_worktree, merge_stash_trees, preflight_worktree_paths,
    reject_if_local_changes_collide, write_conflicted_stash_state, StashConflictTrees,
};
use super::stash_stack::{
    handle_stash_clear, handle_stash_drop, handle_stash_list, parse_stash_slot_arg,
    read_stash_stack, remove_stash_slot, sync_native_stash_ref,
};
use super::status::collect_status;
use super::tree_view::{flatten_commit_tree, flatten_tree_for_diff};

/// Dispatches the `stash` command.
pub fn handle_stash(ctx: &CliContext) {
    let subcmd = ctx.args.first().map(|s| s.as_str()).unwrap_or("push");
    let view = RepoView::open_or_exit(ctx);

    match subcmd {
        "push" | "save" => handle_stash_push(&view, ctx, &ctx.args[1..]),
        "pop" => handle_stash_pop(&view, true, ctx, &ctx.args[1..]),
        "apply" => handle_stash_pop(&view, false, ctx, &ctx.args[1..]),
        "list" => handle_stash_list(&view, ctx),
        "drop" => handle_stash_drop(&view, ctx, &ctx.args[1..]),
        "clear" => handle_stash_clear(&view, ctx),
        _ => handle_stash_push(&view, ctx, &ctx.args),
    }
}

/// Parses optional `-m`/`--message`, `-u`/`--include-untracked`, and `-k`/`--keep-index` flags.
fn parse_stash_push_flags(args: &[String]) -> (Option<String>, bool, bool) {
    let mut custom_message: Option<&str> = None;
    let mut include_untracked = false;
    let mut keep_index = false;
    let mut cursor = 0;

    while cursor < args.len() {
        let arg = args[cursor].as_str();
        match arg {
            "-u" | "--include-untracked" => include_untracked = true,
            "-k" | "--keep-index" => keep_index = true,
            "-m" | "--message" => {
                if cursor + 1 < args.len() {
                    custom_message = Some(args[cursor + 1].as_str());
                    cursor += 1;
                } else {
                    fail_usage("option `-m` requires a stash message");
                }
            }
            _ if arg.starts_with("--message=") => {
                custom_message = Some(&arg["--message=".len()..]);
            }
            _ if !arg.starts_with('-') && custom_message.is_none() => {
                custom_message = Some(arg);
            }
            _ if arg.starts_with('-') => {
                fail_usage(format!("unknown option `{arg}` for `stash push`"));
            }
            _ => {}
        }
        cursor += 1;
    }

    (
        custom_message.map(str::to_string),
        include_untracked,
        keep_index,
    )
}

/// Shelves uncommitted working tree and index modifications onto the `refs/stash` stack.
fn handle_stash_push(view: &RepoView, ctx: &CliContext, args: &[String]) {
    let (custom_message, include_untracked, _keep_index) = parse_stash_push_flags(args);
    let status_entries = match collect_status(view) {
        Ok(s) => s,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let dirty: Vec<_> = status_entries
        .iter()
        .filter(|e| e.is_staged() || e.is_unstaged() || (include_untracked && e.is_untracked()))
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

    let head_oid = match view.effective_head_commit() {
        Ok(Some((_, oid))) => oid,
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
    let mut in_mem_index = InMemoryIndexTree::new();
    let current_head_files = flatten_commit_tree(view, &head_oid).unwrap_or_default();

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
    let short_head = &head_oid.to_hex()[..7];
    let stash_msg = match custom_message {
        Some(ref user_msg) if user_msg.starts_with("WIP on ") => user_msg.clone(),
        Some(ref user_msg) => format!("WIP on {branch_name}: {short_head} {user_msg}"),
        None => format!("WIP on {branch_name}: {short_head} {head_summary}"),
    };

    // A stash subject is synthesized by the tool in Git's own `WIP on` format, so it is checked
    // only for an unfinished thought. Applying the authoring vocabulary contract here would reject
    // every stash because Git itself spells the subject with "WIP".
    let stash_floor = fg_gate::PolicyFloor::resolve(view.git_dir());
    let stash_policy = fg_gate::policy_floor::preset_for_tier(stash_floor.tier);
    if let Err(guard_error) = fg_gate::commit_guard::rewrite::verify_rewrite_message(
        &stash_policy,
        &stash_floor,
        &stash_msg,
        fg_gate::commit_guard::rewrite::MessageOrigin::Synthesized,
        None,
    ) {
        reject(
            CliTag::COMMIT_GOVERNANCE_FAIL,
            format!("Stash subject rejected: {guard_error}"),
        );
    }

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
    fg_core::diag_info!(
        "stash",
        "created {} on {} subject={:?}",
        stash_commit_oid.to_hex(),
        head_oid.to_hex(),
        stash_msg
    );

    // Update refs/stash and append to logs/refs/stash stack.
    let ref_store = DiskRefStore::new(view.git_dir());
    if let Err(err) =
        ref_store.update_ref_with_message("refs/stash", &stash_commit_oid, None, &stash_msg)
    {
        fail_io("update refs/stash", err);
    }
    sync_native_stash_ref(view.git_dir(), Some(stash_commit_oid));
    fg_core::diag_debug!(
        "stash",
        "advanced refs/stash to {}",
        stash_commit_oid.to_hex()
    );

    // Hard reset worktree to HEAD, deleting any newly staged/added files included in the stash.
    let mut target_files = BTreeMap::new();
    let _ = flatten_tree_for_diff(view, &head_rec.tree, "", &mut target_files);
    let mut stashed_worktree = BTreeMap::new();
    let _ = flatten_tree_for_diff(view, &stash_tree_oid, "", &mut stashed_worktree);

    remove_stale_files(view.work_root(), &stashed_worktree, &target_files);
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

/// Restores stashed modifications back to the worktree via 3-way merge and optionally drops the slot.
fn handle_stash_pop(view: &RepoView, drop_after: bool, ctx: &CliContext, args: &[String]) {
    let slot_index = parse_stash_slot_arg(args);
    let stack = read_stash_stack(view);
    let Some(slot) = stack.get(slot_index) else {
        if stack.is_empty() {
            reject(CliTag::ERROR, "error: No stash entries found.");
        }
        reject(
            CliTag::ERROR,
            format!("error: log for 'stash' only has {} entries", stack.len()),
        );
    };
    let stash_oid = slot.oid;

    let (_, stash_tree) = match view.resolve_tree(&stash_oid.to_hex()) {
        Ok(res) => res,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let stash_obj = match view.object(&stash_oid) {
        Ok(obj) => obj,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let stash_rec = match parse_commit_record(stash_oid, &stash_obj.payload) {
        Ok(rec) => rec,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let head_oid = match view.effective_head_commit() {
        Ok(Some((_, oid))) => oid,
        _ => reject(CliTag::ERROR, "cannot apply stash on unborn HEAD"),
    };
    let base_oid = stash_rec.parents.first().copied().unwrap_or(head_oid);

    let base_files = flatten_commit_tree(view, &base_oid).unwrap_or_default();
    let head_files = flatten_commit_tree(view, &head_oid).unwrap_or_default();
    let mut theirs_files = BTreeMap::new();
    let _ = flatten_tree_for_diff(view, &stash_tree, "", &mut theirs_files);

    reject_if_local_changes_collide(view, &base_files, &theirs_files);

    let (merged_files, conflicts) =
        merge_stash_trees(view, &base_files, &head_files, &theirs_files);
    if !conflicts.is_empty() {
        write_conflicted_stash_state(
            view,
            StashConflictTrees {
                base: &base_files,
                head: &head_files,
                theirs: &theirs_files,
            },
            &merged_files,
            &conflicts,
            ctx,
        );
    }

    if let Err(detail) =
        preflight_worktree_paths(view.work_root(), merged_files.keys().map(String::as_str))
    {
        reject(CliTag::ERROR, detail);
    }

    apply_clean_stash_to_worktree(view, &head_files, &merged_files);

    if drop_after {
        remove_stash_slot(view.git_dir(), stack, slot_index);
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "stash",
            "status": if drop_after { "popped" } else { "applied" },
            "stash_index": slot_index,
            "stash_oid": stash_oid.to_hex(),
        }));
    } else {
        println!(
            "Applied stash@{{{slot_index}}} ({})",
            &stash_oid.to_hex()[..7]
        );
        if drop_after {
            println!("Dropped stash@{{{slot_index}}} ({})", stash_oid.to_hex());
        }
    }
}
