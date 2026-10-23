//! Module: taxis_cmd::rebase_cmd — Native 'rebase' Command Dispatcher
//! File Path: src/bin/taxis_cmd/rebase_cmd.rs
//! Architecture Role: Implements linear commit replay onto upstream base: DAG ancestor
//!   filtering, sequential 3-way merge-ort tree application, new commit synthesis,
//!   and atomic branch tip advancement.
//! Dependencies & Triggers: Dispatched by `taxis rebase` / `taxis rb`.
//! Responsibilities: Validate worktree cleanliness, determine rebase commit slice,
//!   iteratively replay commits with original author provenance, update branch ref,
//!   and append to OperationGraph.
//! Exit Semantics & Design Rationale:
//!   - If already up to date, exits immediately without touching working tree.
//!   - Fast-forwards when the current branch is an ancestor of upstream.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-ALG-001`: Algorithmic three-way tree equivalence guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::collections::BTreeMap;
use std::fs;

use fg_algorithms::merge::{ThreeWayMerge, ThreeWayMergeResult};
use fg_algorithms::traverse::DagWalker;
use fg_core::constants::git::{OBJ_COMMIT, OBJ_TREE};
use fg_core::models::{CorrectedCommitDate, FileMode, GitSignature, Oid};
use fg_core::traits::OdbStore;
use fg_index::InMemoryIndexTree;
use fg_object::GitCommit;
use fg_storage::commit_materializer::{serialize_commit_payload, serialize_tree_payload};
use fg_storage::LooseOdb;
use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, OperationGraph, RepoViewSnapshot};

use super::checkout::{
    assert_worktree_cleanliness, materialize_files, remove_stale_files, update_dirc_index,
    update_references,
};
use super::commit_walk::{parse_commit_record, walk_commits};
use super::common::{fail_io, print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::status_cmd::{flatten_commit_tree, flatten_tree_for_diff};

/// Dispatches the `rebase` command.
pub fn handle_rebase(ctx: &CliContext) {
    if ctx.args.iter().any(|a| a == "--abort") {
        handle_rebase_abort(ctx);
        return;
    }

    if ctx.args.is_empty() {
        reject(CliTag::ERROR, "rebase expects an upstream branch or commit");
    }

    let upstream_arg = &ctx.args[0];
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };

    assert_worktree_cleanliness(&view, false);

    let upstream_commit = match view.resolve(upstream_arg) {
        Ok(oid) => oid,
        Err(err) => reject(CliTag::ERROR, format!("cannot resolve upstream '{upstream_arg}': {err}")),
    };

    let ours_commit = match view.head_commit() {
        Ok(Some(oid)) => oid,
        _ => reject(CliTag::ERROR, "HEAD has no commit; cannot rebase"),
    };

    let effective_branch = view
        .head_branch()
        .ok()
        .flatten()
        .map(|(branch_name, _)| branch_name);

    let mut get_node = |oid: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
        let obj = view.object(oid).ok()?;
        let record = parse_commit_record(*oid, &obj.payload).ok()?;
        Some((
            CorrectedCommitDate(record.committer_time.max(0) as u64),
            record.parents,
        ))
    };

    let bases = DagWalker::find_merge_bases_with_ccd(&ours_commit, &upstream_commit, &mut get_node);
    if bases.is_empty() {
        reject(CliTag::ERROR, "fatal: refusing to rebase unrelated histories");
    }

    let merge_base = bases[0];

    // Case 1: Already up-to-date
    if merge_base == upstream_commit {
        if ctx.json_mode {
            print_json(&serde_json::json!({
                "engine": "taxis",
                "operation": "rebase",
                "status": "already_up_to_date"
            }));
        } else {
            println!("Current branch is up to date.");
        }
        return;
    }

    // Case 2: Fast-forward (ours is an ancestor of upstream)
    if merge_base == ours_commit {
        let (_, upstream_tree) = match view.resolve_tree(&upstream_commit.to_hex()) {
            Ok(res) => res,
            Err(err) => reject(CliTag::ERROR, err),
        };

        let current_files = flatten_commit_tree(&view, &ours_commit).unwrap_or_default();
        let mut new_files = BTreeMap::new();
        let _ = flatten_tree_for_diff(&view, &upstream_tree, "", &mut new_files);

        remove_stale_files(view.work_root(), &current_files, &new_files);
        let index_entries = materialize_files(&view, &new_files);
        update_dirc_index(view.git_dir(), &index_entries);
        update_references(view.git_dir(), upstream_commit, effective_branch.as_deref());

        record_rebase_op(&view, upstream_commit, upstream_arg, effective_branch.as_deref());

        if ctx.json_mode {
            print_json(&serde_json::json!({
                "engine": "taxis",
                "operation": "rebase",
                "status": "fast-forward",
                "new_head": upstream_commit.to_hex(),
            }));
        } else {
            println!("Fast-forwarded branch to {}", &upstream_commit.to_hex()[..8]);
        }
        return;
    }

    // Case 3: True Rebase - collect commits between merge_base and ours
    let all_walked = match walk_commits(&view, &[ours_commit]) {
        Ok(list) => list,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let mut commits_to_replay = Vec::new();
    for rec in all_walked {
        if rec.oid == merge_base {
            break;
        }
        commits_to_replay.push(rec);
    }
    commits_to_replay.reverse();

    if commits_to_replay.is_empty() {
        println!("No commits to replay. Current branch is up to date.");
        return;
    }

    let odb = LooseOdb::new(view.git_dir());
    let mut current_tip = upstream_commit;

    for rec in &commits_to_replay {
        let parent_oid = match rec.parents.first() {
            Some(p) => *p,
            None => merge_base,
        };

        let (_, base_tree_oid) = match view.resolve_tree(&parent_oid.to_hex()) {
            Ok(res) => res,
            Err(err) => reject(CliTag::ERROR, err),
        };
        let (_, theirs_tree_oid) = match view.resolve_tree(&rec.oid.to_hex()) {
            Ok(res) => res,
            Err(err) => reject(CliTag::ERROR, err),
        };
        let (_, ours_tree_oid) = match view.resolve_tree(&current_tip.to_hex()) {
            Ok(res) => res,
            Err(err) => reject(CliTag::ERROR, err),
        };

        let mut base_files = BTreeMap::new();
        let mut theirs_files = BTreeMap::new();
        let mut ours_files = BTreeMap::new();

        let _ = flatten_tree_for_diff(&view, &base_tree_oid, "", &mut base_files);
        let _ = flatten_tree_for_diff(&view, &theirs_tree_oid, "", &mut theirs_files);
        let _ = flatten_tree_for_diff(&view, &ours_tree_oid, "", &mut ours_files);

        let base_map: BTreeMap<String, Oid> = base_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();
        let theirs_map: BTreeMap<String, Oid> = theirs_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();
        let ours_map: BTreeMap<String, Oid> = ours_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();

        let merged_tree = match ThreeWayMerge::merge(&base_map, &ours_map, &theirs_map) {
            ThreeWayMergeResult::Clean { merged_tree } => merged_tree,
            ThreeWayMergeResult::FastForward => theirs_map.clone(),
            ThreeWayMergeResult::Conflicted { conflicts, .. } => {
                let _ = fs::write(view.git_dir().join("REBASE_HEAD"), format!("{}\n", rec.oid.to_hex()));
                reject(
                    CliTag::ERROR,
                    format!(
                        "error: could not apply {}... {}\nConflict in: {:?}",
                        &rec.oid.to_hex()[..8],
                        rec.message.lines().next().unwrap_or(""),
                        conflicts.iter().map(|c| &c.path).collect::<Vec<_>>()
                    ),
                );
            }
        };

        let mut in_mem_index = InMemoryIndexTree::new();
        for (path, oid) in &merged_tree {
            let mode = theirs_files
                .get(path)
                .or_else(|| ours_files.get(path))
                .map(|e| e.mode)
                .unwrap_or(FileMode::RegularFile);
            let _ = in_mem_index.stage_oid(path, mode, *oid);
        }

        let new_tree_oid = match in_mem_index.write_tree_with_persister(|tree| {
            let payload = serialize_tree_payload(tree);
            odb.write_object(OBJ_TREE, &payload)?;
            Ok(())
        }) {
            Ok(oid) => oid,
            Err(err) => fail_io("persist rebased tree", err),
        };

        let author = GitSignature::new(
            rec.author_name.clone(),
            rec.author_mailbox.clone(),
            rec.author_time,
        );
        let committer_sec = chrono::Utc::now().timestamp();
        let committer = GitSignature::new("Taxis Operator", "operator@taxis.internal", committer_sec);

        let rebased_commit = GitCommit::new(
            new_tree_oid,
            vec![current_tip],
            author,
            committer,
            rec.message.clone(),
            None,
        );

        let commit_payload = serialize_commit_payload(&rebased_commit);
        current_tip = match odb.write_object(OBJ_COMMIT, &commit_payload) {
            Ok(oid) => oid,
            Err(err) => fail_io("persist rebased commit", err),
        };
    }

    // Update worktree & references to the final replayed commit tip
    let (_, final_tree) = match view.resolve_tree(&current_tip.to_hex()) {
        Ok(res) => res,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let original_files = flatten_commit_tree(&view, &ours_commit).unwrap_or_default();
    let mut final_files = BTreeMap::new();
    let _ = flatten_tree_for_diff(&view, &final_tree, "", &mut final_files);

    remove_stale_files(view.work_root(), &original_files, &final_files);
    let index_entries = materialize_files(&view, &final_files);
    update_dirc_index(view.git_dir(), &index_entries);
    update_references(view.git_dir(), current_tip, effective_branch.as_deref());

    record_rebase_op(&view, current_tip, upstream_arg, effective_branch.as_deref());

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "rebase",
            "status": "success",
            "replayed_count": commits_to_replay.len(),
            "new_head": current_tip.to_hex(),
            "branch": effective_branch,
        }));
    } else {
        println!(
            "Successfully rebased and updated refs/heads/{}.",
            effective_branch.as_deref().unwrap_or("HEAD")
        );
    }
}

/// Aborts a rebase in progress.
fn handle_rebase_abort(ctx: &CliContext) {
    let rebase_head = ctx.git_dir.join("REBASE_HEAD");
    if !rebase_head.is_file() {
        reject(CliTag::ERROR, "fatal: No rebase in progress to abort");
    }
    let _ = fs::remove_file(rebase_head);
    println!("Rebase aborted.");
}

/// Records rebase operation into OperationGraph.
fn record_rebase_op(
    view: &RepoView,
    new_head: Oid,
    upstream: &str,
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
        branches.insert(format!("refs/heads/{branch}"), new_head);
    }

    let view_snapshot = RepoViewSnapshot {
        head_oid: Some(new_head),
        branches,
        staged_promotions: Vec::new(),
        timestamp_ms: current_time_ms,
    };

    let _ = op_graph.record_operation(
        view_snapshot,
        "operator".to_string(),
        "rebase",
        format!("rebase onto {upstream}"),
        current_time_ms,
    );
}
