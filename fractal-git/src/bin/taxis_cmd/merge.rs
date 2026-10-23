//! Module: taxis_cmd::merge — Native 'merge' Command Dispatcher
//! File Path: src/bin/taxis_cmd/merge.rs
//! Architecture Role: Full native three-way branch merge operator: DAG lowest-common-ancestor
//!   (LCA) resolution, fast-forward detection, merge-ort 3-way tree reconciliation,
//!   2-parent merge commit creation, conflict marker rendering, and DIRC multi-stage indexing.
//! Dependencies & Triggers: Dispatched by `taxis merge`.
//! Responsibilities: Resolve LCA merge base, fast-forward or 3-way reconcile trees, synthesize
//!   clean merge commits or record conflict slots in DIRC index, and persist to OperationGraph.
//! Exit Semantics & Design Rationale:
//!   - Fast-forwards avoid unnecessary merge commits by default, matching Git convention.
//!   - Criss-cross and multi-parent branch points use DagWalker's CCD v2 LCA algorithm.
//!   - Unresolved conflicts write standard conflict markers and DIRC stages 1/2/3 without silent loss.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-ALG-001`: Algorithmic three-way tree equivalence guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::collections::BTreeMap;
use std::fs;

use fg_algorithms::merge::{ConflictEntry, TextThreeWayMerge, ThreeWayMerge, ThreeWayMergeResult};
use fg_algorithms::traverse::DagWalker;
use fg_core::constants::git::{OBJ_BLOB, OBJ_COMMIT, OBJ_TREE};
use fg_core::models::{CorrectedCommitDate, FileMode, GitSignature, IndexStage, Oid};
use fg_core::traits::OdbStore;
use fg_index::{InMemoryIndexTree, IndexEntry};
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
use super::tree_view::{flatten_commit_tree, flatten_tree_for_diff, TreeEntry};

/// Options for `taxis merge`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct MergeOptions {
    target: String,
    no_ff: bool,
    ff_only: bool,
    abort: bool,
    message: Option<String>,
}

/// Dispatches the `merge` command.
pub fn handle_merge(ctx: &CliContext) {
    let opts = parse_merge_options(&ctx.args);
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };

    if opts.abort {
        handle_merge_abort(&view);
        return;
    }

    if opts.target.is_empty() {
        reject(CliTag::ERROR, "merge expects a branch or commit to merge in");
    }

    assert_worktree_cleanliness(&view, false);

    let theirs_commit = match view.resolve(&opts.target) {
        Ok(oid) => oid,
        Err(resolve_err) => reject(
            CliTag::ERROR,
            format!("could not resolve revision '{}': {resolve_err}", opts.target),
        ),
    };

    let ours_commit = match view.head_commit() {
        Ok(Some(oid)) => oid,
        _ => reject(CliTag::ERROR, "HEAD has no commit; cannot merge"),
    };

    let effective_branch = view
        .head_branch()
        .ok()
        .flatten()
        .map(|(branch_name, _)| branch_name);

    if ours_commit == theirs_commit {
        if ctx.json_mode {
            print_json(&serde_json::json!({
                "engine": "taxis",
                "operation": "merge",
                "status": "already_up_to_date"
            }));
        } else {
            println!("Already up to date.");
        }
        return;
    }

    let mut get_node = |oid: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
        let obj = view.object(oid).ok()?;
        let record = parse_commit_record(*oid, &obj.payload).ok()?;
        Some((
            CorrectedCommitDate(record.committer_time.max(0) as u64),
            record.parents,
        ))
    };

    let bases = DagWalker::find_merge_bases_with_ccd(&ours_commit, &theirs_commit, &mut get_node);
    if bases.is_empty() {
        reject(
            CliTag::ERROR,
            format!("fatal: refusing to merge unrelated histories between ours and '{}'", opts.target),
        );
    }

    // Check if theirs is already an ancestor of ours
    if bases.contains(&theirs_commit) {
        if ctx.json_mode {
            print_json(&serde_json::json!({
                "engine": "taxis",
                "operation": "merge",
                "status": "already_up_to_date"
            }));
        } else {
            println!("Already up to date.");
        }
        return;
    }

    // Check Fast-Forward (ours is an ancestor of theirs)
    if bases.contains(&ours_commit) && !opts.no_ff {
        execute_fast_forward(&view, &opts, ours_commit, theirs_commit, effective_branch.as_deref(), ctx);
        return;
    }

    if opts.ff_only {
        reject(
            CliTag::ERROR,
            "fatal: Not possible to fast-forward, aborting (--ff-only specified).",
        );
    }

    // Perform True 3-Way Merge
    execute_three_way_merge(
        &view,
        &opts,
        bases[0],
        ours_commit,
        theirs_commit,
        effective_branch.as_deref(),
        ctx,
    );
}

/// Parses CLI flags into structured merge options.
fn parse_merge_options(args: &[String]) -> MergeOptions {
    let mut target = String::new();
    let mut no_ff = false;
    let mut ff_only = false;
    let mut abort = false;
    let mut message = None;

    let mut cursor = 0;
    while cursor < args.len() {
        let arg = &args[cursor];
        match arg.as_str() {
            "--no-ff" => no_ff = true,
            "--ff-only" => ff_only = true,
            "--abort" => abort = true,
            "-m" if cursor + 1 < args.len() => {
                message = Some(args[cursor + 1].clone());
                cursor += 1;
            }
            other if !other.starts_with('-') && target.is_empty() => {
                target = other.to_string();
            }
            _ => {}
        }
        cursor += 1;
    }

    MergeOptions {
        target,
        no_ff,
        ff_only,
        abort,
        message,
    }
}

/// Aborts a merge in progress, restoring worktree and index to HEAD.
fn handle_merge_abort(view: &RepoView) {
    let merge_head_file = view.git_dir().join("MERGE_HEAD");
    if !merge_head_file.is_file() {
        reject(CliTag::ERROR, "fatal: There is no merge to abort (MERGE_HEAD missing).");
    }

    let _ = fs::remove_file(&merge_head_file);
    let _ = fs::remove_file(view.git_dir().join("MERGE_MSG"));

    if let Ok(Some(head_commit)) = view.head_commit() {
        let current_files = flatten_commit_tree(view, &head_commit).unwrap_or_default();
        let index_entries = materialize_files(view, &current_files);
        update_dirc_index(view.git_dir(), &index_entries);
    }

    println!("Merge aborted.");
}

/// Executes a fast-forward merge by directly pointing HEAD at the target commit.
fn execute_fast_forward(
    view: &RepoView,
    opts: &MergeOptions,
    ours_commit: Oid,
    theirs_commit: Oid,
    branch_name: Option<&str>,
    ctx: &CliContext,
) {
    let (_, theirs_tree) = match view.resolve_tree(&theirs_commit.to_hex()) {
        Ok(resolved) => resolved,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let current_files = view
        .head_commit()
        .ok()
        .flatten()
        .and_then(|oid| flatten_commit_tree(view, &oid).ok())
        .unwrap_or_default();

    let mut new_files = BTreeMap::new();
    if let Err(diff_err) = flatten_tree_for_diff(view, &theirs_tree, "", &mut new_files) {
        reject(CliTag::ERROR, diff_err);
    }

    remove_stale_files(view.work_root(), &current_files, &new_files);
    let index_entries = materialize_files(view, &new_files);
    update_dirc_index(view.git_dir(), &index_entries);
    update_references(view.git_dir(), theirs_commit, branch_name);

    record_merge_operation(view, theirs_commit, &opts.target, branch_name);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "merge",
            "strategy": "fast-forward",
            "from": ours_commit.to_hex(),
            "to": theirs_commit.to_hex(),
            "target": opts.target,
        }));
    } else {
        println!(
            "Updating {}..{}\nFast-forward",
            &ours_commit.to_hex()[..8],
            &theirs_commit.to_hex()[..8]
        );
    }
}

/// Executes a standard 3-way merge using merge-ort reconciliation.
fn execute_three_way_merge(
    view: &RepoView,
    opts: &MergeOptions,
    base_commit: Oid,
    ours_commit: Oid,
    theirs_commit: Oid,
    branch_name: Option<&str>,
    ctx: &CliContext,
) {
    let (_, base_tree_oid) = match view.resolve_tree(&base_commit.to_hex()) {
        Ok(resolved) => resolved,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let (_, ours_tree_oid) = match view.resolve_tree(&ours_commit.to_hex()) {
        Ok(resolved) => resolved,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let (_, theirs_tree_oid) = match view.resolve_tree(&theirs_commit.to_hex()) {
        Ok(resolved) => resolved,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let mut base_files = BTreeMap::new();
    let mut ours_files = BTreeMap::new();
    let mut theirs_files = BTreeMap::new();

    let _ = flatten_tree_for_diff(view, &base_tree_oid, "", &mut base_files);
    let _ = flatten_tree_for_diff(view, &ours_tree_oid, "", &mut ours_files);
    let _ = flatten_tree_for_diff(view, &theirs_tree_oid, "", &mut theirs_files);

    let base_map: BTreeMap<String, Oid> = base_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();
    let ours_map: BTreeMap<String, Oid> = ours_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();
    let theirs_map: BTreeMap<String, Oid> = theirs_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();

    match ThreeWayMerge::merge(&base_map, &ours_map, &theirs_map) {
        ThreeWayMergeResult::FastForward => {
            execute_fast_forward(view, opts, ours_commit, theirs_commit, branch_name, ctx);
        }
        ThreeWayMergeResult::Clean { merged_tree } => {
            let m_ctx = CleanMergeContext {
                view,
                opts,
                ours_files: &ours_files,
                theirs_files: &theirs_files,
                ours_commit,
                theirs_commit,
                branch_name,
                ctx,
            };
            finish_clean_merge(&m_ctx, &merged_tree);
        }
        ThreeWayMergeResult::Conflicted {
            mut merged_tree,
            conflicts,
        } => {
            let mut remaining_conflicts = Vec::new();
            let odb = LooseOdb::new(view.git_dir());

            for conflict in conflicts {
                let mut resolved = false;
                if let (Some(ours_oid), Some(theirs_oid)) = (conflict.ours_oid, conflict.theirs_oid) {
                    let base_payload = conflict
                        .base_oid
                        .and_then(|oid| view.blob_payload(&oid).ok())
                        .unwrap_or_default();
                    let ours_payload = view.blob_payload(&ours_oid).unwrap_or_default();
                    let theirs_payload = view.blob_payload(&theirs_oid).unwrap_or_default();

                    let merge_res = TextThreeWayMerge::merge(
                        &base_payload,
                        &ours_payload,
                        &theirs_payload,
                        "HEAD",
                        &opts.target,
                    );

                    if merge_res.is_clean {
                        if let Ok(new_oid) = odb.write_object(OBJ_BLOB, &merge_res.content) {
                            merged_tree.insert(conflict.path.clone(), new_oid);
                            resolved = true;
                        }
                    }
                }

                if !resolved {
                    remaining_conflicts.push(conflict);
                }
            }

            if remaining_conflicts.is_empty() {
                let m_ctx = CleanMergeContext {
                    view,
                    opts,
                    ours_files: &ours_files,
                    theirs_files: &theirs_files,
                    ours_commit,
                    theirs_commit,
                    branch_name,
                    ctx,
                };
                finish_clean_merge(&m_ctx, &merged_tree);
            } else {
                let c_ctx = ConflictedMergeContext {
                    view,
                    opts,
                    base_files: &base_files,
                    ours_files: &ours_files,
                    theirs_files: &theirs_files,
                    theirs_commit,
                    ctx,
                };
                finish_conflicted_merge(&c_ctx, &merged_tree, &remaining_conflicts);
            }
        }
    }
}

/// Context parameter object for completing a clean merge.
struct CleanMergeContext<'a> {
    view: &'a RepoView,
    opts: &'a MergeOptions,
    ours_files: &'a BTreeMap<String, TreeEntry>,
    theirs_files: &'a BTreeMap<String, TreeEntry>,
    ours_commit: Oid,
    theirs_commit: Oid,
    branch_name: Option<&'a str>,
    ctx: &'a CliContext,
}

/// Completes a clean merge: synthesizes trees and creates 2-parent merge commit.
fn finish_clean_merge(
    m_ctx: &CleanMergeContext<'_>,
    merged_tree: &BTreeMap<String, Oid>,
) {
    let mut in_mem_index = InMemoryIndexTree::new();
    let mut new_files = BTreeMap::new();

    for (path, oid) in merged_tree {
        let mode = m_ctx
            .theirs_files
            .get(path)
            .or_else(|| m_ctx.ours_files.get(path))
            .map(|e| e.mode)
            .unwrap_or(FileMode::RegularFile);

        if let Err(stage_err) = in_mem_index.stage_oid(path, mode, *oid) {
            reject(CliTag::ERROR, format!("stage merged file '{path}': {stage_err}"));
        }
        new_files.insert(path.clone(), TreeEntry { mode, oid: *oid });
    }

    let odb = LooseOdb::new(m_ctx.view.git_dir());
    let merged_root_tree = match in_mem_index.write_tree_with_persister(|tree| {
        let payload = serialize_tree_payload(tree);
        odb.write_object(OBJ_TREE, &payload)?;
        Ok(())
    }) {
        Ok(oid) => oid,
        Err(err) => fail_io("persist merged tree", err),
    };

    let default_msg = format!("Merge branch '{}'", m_ctx.opts.target);
    let commit_msg = m_ctx.opts.message.as_deref().unwrap_or(&default_msg);
    let timestamp_sec = chrono::Utc::now().timestamp();
    let author = GitSignature::new("Taxis Operator", "operator@taxis.internal", timestamp_sec);

    let commit = GitCommit::new(
        merged_root_tree,
        vec![m_ctx.ours_commit, m_ctx.theirs_commit],
        author.clone(),
        author,
        commit_msg,
        None,
    );

    let commit_payload = serialize_commit_payload(&commit);
    let commit_oid = match odb.write_object(OBJ_COMMIT, &commit_payload) {
        Ok(oid) => oid,
        Err(err) => fail_io("persist merge commit", err),
    };

    remove_stale_files(m_ctx.view.work_root(), m_ctx.ours_files, &new_files);
    let index_entries = materialize_files(m_ctx.view, &new_files);
    update_dirc_index(m_ctx.view.git_dir(), &index_entries);
    update_references(m_ctx.view.git_dir(), commit_oid, m_ctx.branch_name);

    record_merge_operation(m_ctx.view, commit_oid, &m_ctx.opts.target, m_ctx.branch_name);

    if m_ctx.ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "merge",
            "status": "clean",
            "merge_commit": commit_oid.to_hex(),
            "target": m_ctx.opts.target,
        }));
    } else {
        println!(
            "Merge made by the 'ort' strategy.\n [{}] {}",
            &commit_oid.to_hex()[..8],
            commit_msg
        );
    }
}

/// Context parameter object for completing a conflicted merge.
struct ConflictedMergeContext<'a> {
    view: &'a RepoView,
    opts: &'a MergeOptions,
    base_files: &'a BTreeMap<String, TreeEntry>,
    ours_files: &'a BTreeMap<String, TreeEntry>,
    theirs_files: &'a BTreeMap<String, TreeEntry>,
    theirs_commit: Oid,
    ctx: &'a CliContext,
}

/// Renders conflict markers and populates DIRC multi-stage index slots.
fn finish_conflicted_merge(
    c_ctx: &ConflictedMergeContext<'_>,
    merged_tree: &BTreeMap<String, Oid>,
    conflicts: &[ConflictEntry],
) {
    let mut index_entries = Vec::new();

    // 1. Stage non-conflicting merged files as normal stage 0
    for (path, oid) in merged_tree {
        let mode = c_ctx
            .theirs_files
            .get(path)
            .or_else(|| c_ctx.ours_files.get(path))
            .map(|e| e.mode)
            .unwrap_or(FileMode::RegularFile);

        index_entries.push(IndexEntry {
            path: path.clone(),
            mode,
            oid: *oid,
            stage: IndexStage::Normal,
            size: 0,
            mtime_seconds: 0,
            mtime_nanos: 0,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        });
    }

    // 2. Stage conflicting files with stage 1, 2, 3 and write conflict markers
    for conflict in conflicts {
        println!("Auto-merging {}", conflict.path);
        println!("CONFLICT (content): Merge conflict in {}", conflict.path);

        let mode = c_ctx
            .ours_files
            .get(&conflict.path)
            .or_else(|| c_ctx.theirs_files.get(&conflict.path))
            .map(|e| e.mode)
            .unwrap_or(FileMode::RegularFile);

        if let Some(base_oid) = conflict.base_oid {
            index_entries.push(IndexEntry {
                path: conflict.path.clone(),
                mode: c_ctx.base_files.get(&conflict.path).map(|e| e.mode).unwrap_or(mode),
                oid: base_oid,
                stage: IndexStage::Base,
                size: 0,
                mtime_seconds: 0,
                mtime_nanos: 0,
                assume_valid: false,
                skip_worktree: false,
                intent_to_add: false,
            });
        }
        if let Some(ours_oid) = conflict.ours_oid {
            index_entries.push(IndexEntry {
                path: conflict.path.clone(),
                mode: c_ctx.ours_files.get(&conflict.path).map(|e| e.mode).unwrap_or(mode),
                oid: ours_oid,
                stage: IndexStage::Ours,
                size: 0,
                mtime_seconds: 0,
                mtime_nanos: 0,
                assume_valid: false,
                skip_worktree: false,
                intent_to_add: false,
            });
        }
        if let Some(theirs_oid) = conflict.theirs_oid {
            index_entries.push(IndexEntry {
                path: conflict.path.clone(),
                mode: c_ctx.theirs_files.get(&conflict.path).map(|e| e.mode).unwrap_or(mode),
                oid: theirs_oid,
                stage: IndexStage::Theirs,
                size: 0,
                mtime_seconds: 0,
                mtime_nanos: 0,
                assume_valid: false,
                skip_worktree: false,
                intent_to_add: false,
            });
        }

        // Render localized conflict marker in working tree
        let base_payload = conflict
            .base_oid
            .and_then(|oid| c_ctx.view.blob_payload(&oid).ok())
            .unwrap_or_default();
        let ours_payload = conflict
            .ours_oid
            .and_then(|oid| c_ctx.view.blob_payload(&oid).ok())
            .unwrap_or_default();
        let theirs_payload = conflict
            .theirs_oid
            .and_then(|oid| c_ctx.view.blob_payload(&oid).ok())
            .unwrap_or_default();

        let marker_bytes = if conflict.ours_oid.is_some() && conflict.theirs_oid.is_some() {
            let merge_res = TextThreeWayMerge::merge(
                &base_payload,
                &ours_payload,
                &theirs_payload,
                "HEAD",
                &c_ctx.opts.target,
            );
            merge_res.content
        } else {
            let ours_str = String::from_utf8_lossy(&ours_payload);
            let theirs_str = String::from_utf8_lossy(&theirs_payload);
            format!(
                "<<<<<<< HEAD\n{}=======\n{}>>>>>>> {}\n",
                ours_str, theirs_str, c_ctx.opts.target
            )
            .into_bytes()
        };

        let target_path = c_ctx.view.work_root().join(&conflict.path);
        if let Some(parent) = target_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(target_path, marker_bytes);
    }

    update_dirc_index(c_ctx.view.git_dir(), &index_entries);
    let _ = fs::write(c_ctx.view.git_dir().join("MERGE_HEAD"), format!("{}\n", c_ctx.theirs_commit.to_hex()));
    let _ = fs::write(
        c_ctx.view.git_dir().join("MERGE_MSG"),
        format!("Merge branch '{}'\n\n# Conflicts:\n#\t{}\n", c_ctx.opts.target, conflicts.iter().map(|c| c.path.as_str()).collect::<Vec<_>>().join("\n#\t")),
    );

    if c_ctx.ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "merge",
            "status": "conflicted",
            "conflict_count": conflicts.len(),
            "conflicts": conflicts.iter().map(|c| &c.path).collect::<Vec<_>>(),
        }));
    } else {
        println!("Automatic merge failed; fix conflicts and then commit the result.");
    }

    std::process::exit(1);
}

/// Records merge operation to the OperationGraph.
fn record_merge_operation(
    view: &RepoView,
    merged_commit: Oid,
    target: &str,
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
        branches.insert(format!("refs/heads/{branch}"), merged_commit);
    }

    let view_snapshot = RepoViewSnapshot {
        head_oid: Some(merged_commit),
        branches,
        staged_promotions: Vec::new(),
        timestamp_ms: current_time_ms,
    };

    let _ = op_graph.record_operation(
        view_snapshot,
        "operator".to_string(),
        "merge",
        format!("merge: {target}"),
        current_time_ms,
    );
}
