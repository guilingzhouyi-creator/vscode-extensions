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

use fg_algorithms::merge::{
    BlockThreeWayMerge, ConflictEntry, TextThreeWayMerge, ThreeWayMerge, ThreeWayMergeResult,
};
use fg_algorithms::traverse::DagWalker;
use fg_core::constants::git::OBJ_BLOB;
use fg_core::models::{
    ConflictPresentationMode, CorrectedCommitDate, FileMode, GitSignature, IndexStage, Oid,
};
use fg_core::traits::OdbStore;
use fg_index::{InMemoryIndexTree, IndexEntry};
use fg_object::GitCommit;
use fg_storage::commit_materializer::{persist_commit_object, persist_index_tree};
use fg_storage::LooseOdb;
use fg_topology::conflict_tree::{ConflictSlice, ConflictTreeManager};
use fractal_git::constants::cli::CliTag;

use super::checkout::{
    assert_worktree_cleanliness, materialize_files, remove_stale_files, update_dirc_index,
    update_references,
};
use super::commit_walk::parse_commit_record;
use super::common::{fail_io, print_json, reject, CliContext};
use super::config::RepoConfig;
use super::operation::{record_head_operation, HeadOperationSpec};
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
    conflict_mode: Option<ConflictPresentationMode>,
}

/// Dispatches the `merge` command.
pub fn handle_merge(ctx: &CliContext) {
    let opts = parse_merge_options(&ctx.args);
    let view = RepoView::open_or_exit(ctx);

    if opts.abort {
        handle_merge_abort(&view);
        return;
    }

    if opts.target.is_empty() {
        reject(
            CliTag::ERROR,
            "merge expects a branch or commit to merge in",
        );
    }

    assert_worktree_cleanliness(&view, false);

    let theirs_commit = match view.resolve(&opts.target) {
        Ok(oid) => oid,
        Err(resolve_err) => reject(
            CliTag::ERROR,
            format!(
                "could not resolve revision '{}': {resolve_err}",
                opts.target
            ),
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
        let commit_obj = view.object(oid).ok()?;
        let record = parse_commit_record(*oid, &commit_obj.payload).ok()?;
        Some((
            CorrectedCommitDate(record.committer_time.max(0) as u64),
            record.parents,
        ))
    };

    let bases = DagWalker::find_merge_bases_with_ccd(&ours_commit, &theirs_commit, &mut get_node);
    if bases.is_empty() {
        reject(
            CliTag::ERROR,
            format!(
                "fatal: refusing to merge unrelated histories between ours and '{}'",
                opts.target
            ),
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
        execute_fast_forward(
            &view,
            &opts,
            ours_commit,
            theirs_commit,
            effective_branch.as_deref(),
            ctx,
        );
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
    let mut conflict_mode = None;

    let mut cursor = 0;
    while cursor < args.len() {
        let arg = &args[cursor];
        match arg.as_str() {
            "--no-ff" => no_ff = true,
            "--ff-only" => ff_only = true,
            "--abort" => abort = true,
            "--conflict-mode" | "--conflict.mode" if cursor + 1 < args.len() => {
                if let Some(parsed) = ConflictPresentationMode::parse_str(&args[cursor + 1]) {
                    conflict_mode = Some(parsed);
                }
                cursor += 1;
            }
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
        conflict_mode,
    }
}

/// Aborts a merge in progress, restoring worktree and index to HEAD.
fn handle_merge_abort(view: &RepoView) {
    let merge_head_file = view.git_dir().join("MERGE_HEAD");
    if !merge_head_file.is_file() {
        reject(
            CliTag::ERROR,
            "fatal: There is no merge to abort (MERGE_HEAD missing).",
        );
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
    update_references(view.git_dir(), view.work_root(), theirs_commit, branch_name);

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

    // A tree that cannot be read aborts the merge. Continuing with an empty map would compute a
    // three-way merge against no base at all, which turns a corrupt object into silent data loss.
    if let Err(read_err) = flatten_tree_for_diff(view, &base_tree_oid, "", &mut base_files) {
        reject(
            CliTag::ERROR,
            format!(
                "cannot read merge base tree {}: {read_err}",
                base_tree_oid.to_hex()
            ),
        );
    }
    if let Err(read_err) = flatten_tree_for_diff(view, &ours_tree_oid, "", &mut ours_files) {
        reject(
            CliTag::ERROR,
            format!(
                "cannot read our tree {}: {read_err}",
                ours_tree_oid.to_hex()
            ),
        );
    }
    if let Err(read_err) = flatten_tree_for_diff(view, &theirs_tree_oid, "", &mut theirs_files) {
        reject(
            CliTag::ERROR,
            format!(
                "cannot read their tree {}: {read_err}",
                theirs_tree_oid.to_hex()
            ),
        );
    }

    let base_map: BTreeMap<String, Oid> =
        base_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();
    let ours_map: BTreeMap<String, Oid> =
        ours_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();
    let theirs_map: BTreeMap<String, Oid> = theirs_files
        .iter()
        .map(|(p, e)| (p.clone(), e.oid))
        .collect();

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
            let remaining_conflicts =
                resolve_auto_mergable_conflicts(view, &opts.target, (&mut merged_tree, conflicts));
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
                let conflict_mode = opts
                    .conflict_mode
                    .unwrap_or_else(|| RepoConfig::load(view.git_dir()).conflict_mode());
                let c_ctx = ConflictedMergeContext {
                    view,
                    opts,
                    base_files: &base_files,
                    ours_files: &ours_files,
                    theirs_files: &theirs_files,
                    theirs_commit,
                    conflict_mode,
                    ctx,
                };
                finish_conflicted_merge(&c_ctx, &merged_tree, &remaining_conflicts);
            }
        }
    }
}

/// Attempts text 3-way merge and semantic block fallback on tree-level conflicts.
fn resolve_auto_mergable_conflicts(
    view: &RepoView,
    target_label: &str,
    tree_and_conflicts: (&mut BTreeMap<String, Oid>, Vec<ConflictEntry>),
) -> Vec<ConflictEntry> {
    let (merged_tree, conflicts) = tree_and_conflicts;
    let mut remaining_conflicts = Vec::new();
    let odb = LooseOdb::new(view.git_dir());

    for conflict in conflicts {
        if let Some(new_oid) = try_auto_merge_conflict_blob(view, &odb, (&conflict, target_label)) {
            merged_tree.insert(conflict.path.clone(), new_oid);
        } else {
            remaining_conflicts.push(conflict);
        }
    }
    remaining_conflicts
}

/// Attempts text or block-level 3-way merge for a single conflicting file.
fn try_auto_merge_conflict_blob(
    view: &RepoView,
    odb: &LooseOdb,
    conflict_and_label: (&ConflictEntry, &str),
) -> Option<Oid> {
    let (conflict, target_label) = conflict_and_label;
    let (ours_oid, theirs_oid) = (conflict.ours_oid?, conflict.theirs_oid?);
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
        target_label,
    );
    if merge_res.is_clean {
        return odb.write_object(OBJ_BLOB, &merge_res.content).ok();
    }

    let block_res = BlockThreeWayMerge::merge(
        &base_payload,
        &ours_payload,
        &theirs_payload,
        "HEAD",
        target_label,
    );
    if block_res.is_clean {
        return odb.write_object(OBJ_BLOB, &block_res.content).ok();
    }
    None
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
fn finish_clean_merge(m_ctx: &CleanMergeContext<'_>, merged_tree: &BTreeMap<String, Oid>) {
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
            reject(
                CliTag::ERROR,
                format!("stage merged file '{path}': {stage_err}"),
            );
        }
        new_files.insert(path.clone(), TreeEntry { mode, oid: *oid });
    }

    let odb = LooseOdb::new(m_ctx.view.git_dir());
    let merged_root_tree = persist_index_tree(&in_mem_index, &odb)
        .unwrap_or_else(|err| fail_io("persist merged tree", err));

    let default_msg = format!("Merge branch '{}'", m_ctx.opts.target);
    let commit_msg = m_ctx.opts.message.as_deref().unwrap_or(&default_msg);
    let hook_runner = super::git_hooks::discover(m_ctx.view.git_dir(), m_ctx.view.work_root());
    let final_msg =
        super::git_hooks::run_merge_chain(&hook_runner, m_ctx.view.git_dir(), commit_msg);
    let timestamp_sec = chrono::Utc::now().timestamp();
    let author = GitSignature::new("Taxis Operator", "operator@taxis.internal", timestamp_sec);

    let commit = GitCommit::new(
        merged_root_tree,
        vec![m_ctx.ours_commit, m_ctx.theirs_commit],
        author.clone(),
        author,
        &final_msg,
        None,
    );

    let commit_oid = persist_commit_object(&commit, &odb)
        .unwrap_or_else(|err| fail_io("persist merge commit", err));

    remove_stale_files(m_ctx.view.work_root(), m_ctx.ours_files, &new_files);
    let index_entries = materialize_files(m_ctx.view, &new_files);
    update_dirc_index(m_ctx.view.git_dir(), &index_entries);
    update_references(
        m_ctx.view.git_dir(),
        m_ctx.view.work_root(),
        commit_oid,
        m_ctx.branch_name,
    );
    super::git_hooks::run_post_hook(&hook_runner, "post-merge", &["0".to_string()]);

    record_merge_operation(
        m_ctx.view,
        commit_oid,
        &m_ctx.opts.target,
        m_ctx.branch_name,
    );

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
    conflict_mode: ConflictPresentationMode,
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

        push_conflict_stage_entries(c_ctx, conflict, &mut index_entries);

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

        let marker_bytes = render_conflict_file_payload(
            c_ctx.conflict_mode,
            (&base_payload, &ours_payload, &theirs_payload),
            (
                &c_ctx.opts.target,
                conflict.ours_oid.is_some(),
                conflict.theirs_oid.is_some(),
            ),
        );

        let target_path = c_ctx.view.work_root().join(&conflict.path);
        if let Some(parent) = target_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(target_path, marker_bytes);
    }

    let agent_slices = build_agent_conflict_slices(conflicts, c_ctx);

    update_dirc_index(c_ctx.view.git_dir(), &index_entries);
    let _ = fs::write(
        c_ctx.view.git_dir().join("MERGE_HEAD"),
        format!("{}\n", c_ctx.theirs_commit.to_hex()),
    );
    let _ = fs::write(
        c_ctx.view.git_dir().join("MERGE_MSG"),
        format!(
            "Merge branch '{}'\n\n# Conflicts:\n#\t{}\n",
            c_ctx.opts.target,
            conflicts
                .iter()
                .map(|c| c.path.as_str())
                .collect::<Vec<_>>()
                .join("\n#\t")
        ),
    );

    if c_ctx.ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "merge",
            "status": "conflicted",
            "conflict_mode": c_ctx.conflict_mode.as_str(),
            "conflict_count": conflicts.len(),
            "conflicts": conflicts.iter().map(|c| &c.path).collect::<Vec<_>>(),
            "conflict_slices": agent_slices,
        }));
    } else if c_ctx.conflict_mode == ConflictPresentationMode::AgentAlgebraic {
        println!("Automatic merge failed; recorded unmerged conflict slices while keeping files clean.\nMode: agent-algebraic (files left compilable). Use 'taxis diff' or 'taxis status' to inspect.");
    } else {
        println!("Automatic merge failed; fix conflicts and then commit the result.");
    }

    std::process::exit(1);
}

/// Appends stage 1/2/3 `IndexEntry` slots for one conflicting file.
fn push_conflict_stage_entries(
    c_ctx: &ConflictedMergeContext<'_>,
    conflict: &ConflictEntry,
    index_entries: &mut Vec<IndexEntry>,
) {
    let default_mode = c_ctx
        .ours_files
        .get(&conflict.path)
        .or_else(|| c_ctx.theirs_files.get(&conflict.path))
        .map(|e| e.mode)
        .unwrap_or(FileMode::RegularFile);

    let stages = [
        (conflict.base_oid, c_ctx.base_files, IndexStage::Base),
        (conflict.ours_oid, c_ctx.ours_files, IndexStage::Ours),
        (conflict.theirs_oid, c_ctx.theirs_files, IndexStage::Theirs),
    ];
    for (oid_opt, files_map, stage) in stages {
        if let Some(oid) = oid_opt {
            let mode = files_map
                .get(&conflict.path)
                .map(|e| e.mode)
                .unwrap_or(default_mode);
            index_entries.push(IndexEntry {
                path: conflict.path.clone(),
                mode,
                oid,
                stage,
                size: 0,
                mtime_seconds: 0,
                mtime_nanos: 0,
                assume_valid: false,
                skip_worktree: false,
                intent_to_add: false,
            });
        }
    }
}

/// Renders file content according to active conflict mode.
fn render_conflict_file_payload(
    mode: ConflictPresentationMode,
    payloads: (&[u8], &[u8], &[u8]),
    target_and_presence: (&str, bool, bool),
) -> Vec<u8> {
    let (base, ours, theirs) = payloads;
    let (target_label, has_ours, has_theirs) = target_and_presence;
    match mode {
        ConflictPresentationMode::AgentAlgebraic => {
            if has_ours {
                ours.to_vec()
            } else if has_theirs {
                theirs.to_vec()
            } else {
                Vec::new()
            }
        }
        ConflictPresentationMode::GitCompat => {
            if has_ours && has_theirs {
                TextThreeWayMerge::merge(base, ours, theirs, "HEAD", target_label).content
            } else if has_ours {
                ours.to_vec()
            } else if has_theirs {
                theirs.to_vec()
            } else {
                Vec::new()
            }
        }
        ConflictPresentationMode::Diff3 => {
            if has_ours && has_theirs {
                ConflictTreeManager::render_diff3(base, ours, theirs, "HEAD", "base", target_label)
            } else if has_ours {
                ours.to_vec()
            } else if has_theirs {
                theirs.to_vec()
            } else {
                Vec::new()
            }
        }
    }
}

/// Builds structured agent conflict slice reports for all unmerged paths.
fn build_agent_conflict_slices(
    conflicts: &[ConflictEntry],
    c_ctx: &ConflictedMergeContext<'_>,
) -> Vec<fg_topology::conflict_tree::AgentConflictSliceReport> {
    let mut slices = Vec::with_capacity(conflicts.len());
    for c in conflicts {
        let ours_len = c
            .ours_oid
            .and_then(|oid| c_ctx.view.blob_payload(&oid).ok())
            .map(|b| b.len())
            .unwrap_or(0);
        let theirs_len = c
            .theirs_oid
            .and_then(|oid| c_ctx.view.blob_payload(&oid).ok())
            .map(|b| b.len())
            .unwrap_or(0);
        let mode = c_ctx
            .ours_files
            .get(&c.path)
            .or_else(|| c_ctx.theirs_files.get(&c.path))
            .map(|e| e.mode)
            .unwrap_or(FileMode::RegularFile);
        slices.push(
            ConflictSlice::new(c.path.clone(), mode, c.base_oid, c.ours_oid, c.theirs_oid)
                .to_agent_report(ours_len, theirs_len),
        );
    }
    slices
}

/// Records merge operation to the OperationGraph.
fn record_merge_operation(
    view: &RepoView,
    merged_commit: Oid,
    target: &str,
    branch_name: Option<&str>,
) {
    record_head_operation(HeadOperationSpec {
        git_dir: view.git_dir(),
        head_oid: merged_commit,
        branch_or_ref: branch_name,
        actor: "operator",
        command: "merge",
        description: format!("merge: {target}"),
    });
}
