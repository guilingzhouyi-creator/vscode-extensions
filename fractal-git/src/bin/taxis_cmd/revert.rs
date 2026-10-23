//! Module: taxis_cmd::revert — Native 'revert' Command Dispatcher
//! File Path: src/bin/taxis_cmd/revert.rs
//! Architecture Role: Implements revert inverse delta: inverts target-to-parent tree diff,
//!   reconciles with current HEAD via 3-way merge, crafts atomic revert commit, and
//!   materializes worktree and index.
//! Dependencies & Triggers: Dispatched by `taxis revert`.
//! Responsibilities: Validate worktree cleanliness, 3-way reconcile inverse delta onto HEAD,
//!   create revert commit, update references, and append to OperationGraph.
//! Exit Semantics & Design Rationale:
//!   - Produces standard 'Revert "<summary>"' commit messages, matching Git convention.
//!   - Atomic reference update guarantees zero half-reverted states.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-ALG-001`: Algorithmic three-way tree equivalence guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::collections::BTreeMap;

use fg_algorithms::merge::{ThreeWayMerge, ThreeWayMergeResult};
use fg_core::constants::git::{OBJ_COMMIT, OBJ_TREE};
use fg_core::models::{FileMode, GitSignature, Oid};
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
use super::commit_walk::parse_commit_record;
use super::common::{fail_io, print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::tree_view::{flatten_tree_for_diff, TreeEntry};

/// Dispatches the `revert` command.
pub fn handle_revert(ctx: &CliContext) {
    if ctx.args.is_empty() {
        reject(CliTag::ERROR, "revert expects a commit revision to revert");
    }

    let target_rev = &ctx.args[0];
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };

    assert_worktree_cleanliness(&view, false);

    let target_oid = match view.resolve(target_rev) {
        Ok(oid) => oid,
        Err(err) => reject(CliTag::ERROR, format!("cannot resolve revision '{target_rev}': {err}")),
    };

    let target_obj = match view.object(&target_oid) {
        Ok(obj) => obj,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let target_record = match parse_commit_record(target_oid, &target_obj.payload) {
        Ok(rec) => rec,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let parent_oid = match target_record.parents.first() {
        Some(p) => *p,
        None => reject(CliTag::ERROR, "cannot revert a root commit without parent"),
    };

    let ours_commit = match view.head_commit() {
        Ok(Some(oid)) => oid,
        _ => reject(CliTag::ERROR, "HEAD has no commit; cannot revert"),
    };

    let effective_branch = view
        .head_branch()
        .ok()
        .flatten()
        .map(|(branch_name, _)| branch_name);

    // Invert roles: base is target, theirs is parent
    let (_, base_tree_oid) = match view.resolve_tree(&target_oid.to_hex()) {
        Ok(res) => res,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let (_, theirs_tree_oid) = match view.resolve_tree(&parent_oid.to_hex()) {
        Ok(res) => res,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let (_, ours_tree_oid) = match view.resolve_tree(&ours_commit.to_hex()) {
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
            reject(
                CliTag::ERROR,
                format!(
                    "error: could not revert {}...\nConflicts in: {:?}",
                    &target_oid.to_hex()[..8],
                    conflicts.iter().map(|c| &c.path).collect::<Vec<_>>()
                ),
            );
        }
    };

    let mut in_mem_index = InMemoryIndexTree::new();
    let mut new_files = BTreeMap::new();

    for (path, oid) in &merged_tree {
        let mode = theirs_files
            .get(path)
            .or_else(|| ours_files.get(path))
            .map(|e| e.mode)
            .unwrap_or(FileMode::RegularFile);

        if let Err(stage_err) = in_mem_index.stage_oid(path, mode, *oid) {
            reject(CliTag::ERROR, format!("stage merged file '{path}': {stage_err}"));
        }
        new_files.insert(path.clone(), TreeEntry { mode, oid: *oid });
    }

    let odb = LooseOdb::new(view.git_dir());
    let merged_root_tree = match in_mem_index.write_tree_with_persister(|tree| {
        let payload = serialize_tree_payload(tree);
        odb.write_object(OBJ_TREE, &payload)?;
        Ok(())
    }) {
        Ok(oid) => oid,
        Err(err) => fail_io("persist merged tree", err),
    };

    let committer_sec = chrono::Utc::now().timestamp();
    let author = GitSignature::new("Taxis Operator", "operator@taxis.internal", committer_sec);

    let first_line = target_record.message.lines().next().unwrap_or("").trim();
    let revert_msg = format!("Revert \"{}\"\n\nThis reverts commit {}.\n", first_line, target_oid.to_hex());

    let new_commit = GitCommit::new(
        merged_root_tree,
        vec![ours_commit],
        author.clone(),
        author,
        revert_msg.clone(),
        None,
    );

    let commit_payload = serialize_commit_payload(&new_commit);
    let new_commit_oid = match odb.write_object(OBJ_COMMIT, &commit_payload) {
        Ok(oid) => oid,
        Err(err) => fail_io("persist revert commit", err),
    };

    remove_stale_files(view.work_root(), &ours_files, &new_files);
    let index_entries = materialize_files(&view, &new_files);
    update_dirc_index(view.git_dir(), &index_entries);
    update_references(view.git_dir(), new_commit_oid, effective_branch.as_deref());

    record_revert_op(&view, new_commit_oid, target_rev, effective_branch.as_deref());

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "revert",
            "status": "clean",
            "reverted_commit": target_oid.to_hex(),
            "new_commit": new_commit_oid.to_hex(),
        }));
    } else {
        println!("[{}] {}", &new_commit_oid.to_hex()[..8], first_line);
    }
}

/// Records revert operation into OperationGraph.
fn record_revert_op(
    view: &RepoView,
    new_commit: Oid,
    target_rev: &str,
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
        branches.insert(format!("refs/heads/{branch}"), new_commit);
    }

    let view_snapshot = RepoViewSnapshot {
        head_oid: Some(new_commit),
        branches,
        staged_promotions: Vec::new(),
        timestamp_ms: current_time_ms,
    };

    let _ = op_graph.record_operation(
        view_snapshot,
        "operator".to_string(),
        "revert",
        format!("revert: {target_rev}"),
        current_time_ms,
    );
}
