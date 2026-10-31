//! Module: taxis_cmd::cherry_pick — Native 'cherry-pick' & Delta Transplant Engine
//! File Path: src/bin/taxis_cmd/cherry_pick.rs
//! Architecture Role: Implements commit delta transplant shared by `cherry-pick` and `revert`:
//!   extracts parent-to-target (or inverse target-to-parent) tree diff, reconciles with current
//!   HEAD via 3-way merge-ort, crafts an atomic child commit, and materializes worktree and index.
//! Dependencies & Triggers: Dispatched by `taxis cherry-pick` / `taxis cp` and delegated to by
//!   `taxis revert`.
//! Responsibilities: Validate worktree cleanliness, 3-way reconcile commit delta onto HEAD,
//!   materialize new commit, update references, and append to OperationGraph.
//! Exit Semantics & Design Rationale:
//!   - Fails fast if worktree is dirty.
//!   - Retains original commit author and message on `cherry-pick`, or synthesizes standard
//!     revert message on `revert`.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-ALG-001`: Algorithmic three-way tree equivalence guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::collections::BTreeMap;

use fg_algorithms::merge::{ThreeWayMerge, ThreeWayMergeResult};
use fg_core::models::{FileMode, GitSignature, Oid};
use fg_index::InMemoryIndexTree;
use fg_object::GitCommit;
use fg_storage::commit_materializer::{persist_commit_object, persist_index_tree};
use fg_storage::LooseOdb;
use fractal_git::constants::cli::CliTag;

use super::checkout::{
    assert_worktree_cleanliness, materialize_files, remove_stale_files, update_dirc_index,
    update_references,
};
use super::commit_walk::{parse_commit_record, CommitRecord};
use super::common::{fail_io, print_json, reject, CliContext};
use super::operation::{record_head_operation, HeadOperationSpec};
use super::repo_view::RepoView;
use super::tree_view::{flatten_commit_tree, TreeEntry};

/// Direction and reporting parameters for a single-commit delta transplant (`cherry-pick` or `revert`).
pub(crate) struct DeltaTransplantSpec {
    pub operation: &'static str,
    pub json_commit_key: &'static str,
    pub invert_delta: bool,
}

/// Flattened base/ours/theirs tree maps for a 3-way commit delta transplant.
struct TransplantTrees {
    base_files: BTreeMap<String, TreeEntry>,
    ours_files: BTreeMap<String, TreeEntry>,
    theirs_files: BTreeMap<String, TreeEntry>,
}

/// Dispatches the `cherry-pick` command.
pub fn handle_cherry_pick(ctx: &CliContext) {
    execute_commit_delta_transplant(
        ctx,
        &DeltaTransplantSpec {
            operation: "cherry-pick",
            json_commit_key: "picked_commit",
            invert_delta: false,
        },
    );
}

/// Executes a commit delta transplant (`cherry-pick` when `invert_delta == false`, `revert` when `true`).
pub(crate) fn execute_commit_delta_transplant(ctx: &CliContext, spec: &DeltaTransplantSpec) {
    let op = spec.operation;
    if ctx.args.is_empty() {
        reject(CliTag::ERROR, format!("{op} expects a commit revision"));
    }

    let target_rev = &ctx.args[0];
    let view = RepoView::open_or_exit(ctx);
    assert_worktree_cleanliness(&view, false);

    let (target_oid, target_record, parent_oid) = resolve_transplant_target(&view, target_rev, op);
    let ours_commit = match view.head_commit() {
        Ok(Some(oid)) => oid,
        _ => reject(CliTag::ERROR, format!("HEAD has no commit; cannot {op}")),
    };
    let effective_branch = view
        .head_branch()
        .ok()
        .flatten()
        .map(|(branch_name, _)| branch_name);

    let (base_commit, theirs_commit) = if spec.invert_delta {
        (target_oid, parent_oid)
    } else {
        (parent_oid, target_oid)
    };

    let trees = TransplantTrees {
        base_files: flatten_commit_tree(&view, &base_commit).unwrap_or_default(),
        ours_files: flatten_commit_tree(&view, &ours_commit).unwrap_or_default(),
        theirs_files: flatten_commit_tree(&view, &theirs_commit).unwrap_or_default(),
    };

    let merged_tree = reconcile_transplant_trees(&trees, &target_record, spec);
    let (new_files, merged_root_tree) =
        stage_and_persist_transplant_tree(&view, &merged_tree, &trees);

    let (new_commit_oid, summary_line) = create_transplant_commit(
        &view,
        (merged_root_tree, ours_commit),
        (&target_record, spec),
    );

    remove_stale_files(view.work_root(), &trees.ours_files, &new_files);
    let index_entries = materialize_files(&view, &new_files);
    update_dirc_index(view.git_dir(), &index_entries);
    update_references(
        view.git_dir(),
        view.work_root(),
        new_commit_oid,
        effective_branch.as_deref(),
    );

    record_head_operation(HeadOperationSpec {
        git_dir: view.git_dir(),
        head_oid: new_commit_oid,
        branch_or_ref: effective_branch.as_deref(),
        actor: "operator",
        command: op,
        description: format!("{op}: {target_rev}"),
    });

    if ctx.json_mode {
        let mut payload = serde_json::Map::new();
        payload.insert("engine".to_string(), serde_json::json!("taxis"));
        payload.insert("operation".to_string(), serde_json::json!(op));
        payload.insert("status".to_string(), serde_json::json!("clean"));
        payload.insert(
            spec.json_commit_key.to_string(),
            serde_json::json!(target_oid.to_hex()),
        );
        payload.insert(
            "new_commit".to_string(),
            serde_json::json!(new_commit_oid.to_hex()),
        );
        print_json(&serde_json::Value::Object(payload));
    } else {
        println!("[{}] {}", &new_commit_oid.to_hex()[..8], summary_line);
    }
}

/// Resolves target commit, its parsed commit record, and its first parent.
fn resolve_transplant_target(
    view: &RepoView,
    target_rev: &str,
    op: &str,
) -> (Oid, CommitRecord, Oid) {
    let target_oid = view.resolve(target_rev).unwrap_or_else(|err| {
        reject(
            CliTag::ERROR,
            format!("cannot resolve revision '{target_rev}': {err}"),
        )
    });
    let target_obj = view
        .object(&target_oid)
        .unwrap_or_else(|err| reject(CliTag::ERROR, err));
    let target_record = parse_commit_record(target_oid, &target_obj.payload)
        .unwrap_or_else(|err| reject(CliTag::ERROR, err));
    let parent_oid = target_record.parents.first().copied().unwrap_or_else(|| {
        reject(
            CliTag::ERROR,
            format!("cannot {op} a root commit without parent"),
        )
    });
    (target_oid, target_record, parent_oid)
}

/// Runs 3-way merge reconciliation for a transplant operation.
fn reconcile_transplant_trees(
    trees: &TransplantTrees,
    target_record: &CommitRecord,
    spec: &DeltaTransplantSpec,
) -> BTreeMap<String, Oid> {
    let base_map: BTreeMap<String, Oid> = trees
        .base_files
        .iter()
        .map(|(p, e)| (p.clone(), e.oid))
        .collect();
    let ours_map: BTreeMap<String, Oid> = trees
        .ours_files
        .iter()
        .map(|(p, e)| (p.clone(), e.oid))
        .collect();
    let theirs_map: BTreeMap<String, Oid> = trees
        .theirs_files
        .iter()
        .map(|(p, e)| (p.clone(), e.oid))
        .collect();

    match ThreeWayMerge::merge(&base_map, &ours_map, &theirs_map) {
        ThreeWayMergeResult::Clean { merged_tree } => merged_tree,
        ThreeWayMergeResult::FastForward => theirs_map,
        ThreeWayMergeResult::Conflicted { conflicts, .. } => {
            let paths: Vec<_> = conflicts.iter().map(|c| &c.path).collect();
            let short = &target_record.oid.to_hex()[..8];
            let detail = if spec.invert_delta {
                format!("error: could not revert {short}...\nConflicts in: {paths:?}")
            } else {
                let first_line = target_record.message.lines().next().unwrap_or("");
                format!("error: could not apply {short}... {first_line}\nConflicts in: {paths:?}")
            };
            reject(CliTag::ERROR, detail);
        }
    }
}

/// Stages merged tree entries into an `InMemoryIndexTree` and persists all tree objects.
fn stage_and_persist_transplant_tree(
    view: &RepoView,
    merged_tree: &BTreeMap<String, Oid>,
    trees: &TransplantTrees,
) -> (BTreeMap<String, TreeEntry>, Oid) {
    let mut in_mem_index = InMemoryIndexTree::new();
    let mut new_files = BTreeMap::new();

    for (path, oid) in merged_tree {
        let mode = trees
            .theirs_files
            .get(path)
            .or_else(|| trees.ours_files.get(path))
            .map(|e| e.mode)
            .unwrap_or(FileMode::RegularFile);
        if let Err(stage_err) = in_mem_index.stage_oid(path, mode, *oid) {
            reject(
                CliTag::ERROR,
                format!("stage merged file '{path}': {stage_err}"),
            );
        }
        new_files.insert(path.clone(), TreeEntry { mode, oid: *oid });
    }

    let odb = LooseOdb::new(view.git_dir());
    let merged_root_tree = persist_index_tree(&in_mem_index, &odb)
        .unwrap_or_else(|err| fail_io("persist merged tree", err));
    (new_files, merged_root_tree)
}

/// Crafts and persists the new commit object for a transplant operation, running git hooks.
fn create_transplant_commit(
    view: &RepoView,
    tree_and_parent: (Oid, Oid),
    target_and_spec: (&CommitRecord, &DeltaTransplantSpec),
) -> (Oid, String) {
    let (merged_root_tree, ours_commit) = tree_and_parent;
    let (target_record, spec) = target_and_spec;
    let committer_sec = chrono::Utc::now().timestamp();
    let committer = GitSignature::new("Taxis Operator", "operator@taxis.internal", committer_sec);
    let first_line = target_record
        .message
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    let (author, raw_message) = if spec.invert_delta {
        let revert_msg = format!(
            "Revert \"{}\"\n\nThis reverts commit {}.\n",
            first_line,
            target_record.oid.to_hex()
        );
        (committer.clone(), revert_msg)
    } else {
        let orig_author = GitSignature::new(
            target_record.author_name.clone(),
            target_record.author_mailbox.clone(),
            target_record.author_time,
        );
        (orig_author, target_record.message.clone())
    };

    let hook_runner = super::git_hooks::discover(view.git_dir(), view.work_root());
    let commit_message =
        super::git_hooks::run_prepare_chain(&hook_runner, view.git_dir(), &raw_message, "message");

    let new_commit = GitCommit::new(
        merged_root_tree,
        vec![ours_commit],
        author,
        committer,
        commit_message,
        None,
    );
    let odb = LooseOdb::new(view.git_dir());
    let new_commit_oid = persist_commit_object(&new_commit, &odb)
        .unwrap_or_else(|err| fail_io("persist transplant commit", err));
    super::git_hooks::run_post_hook(&hook_runner, "post-commit", &[]);
    (new_commit_oid, first_line)
}
