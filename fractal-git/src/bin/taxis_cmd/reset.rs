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
use fractal_git::DiskRefStore;

use super::checkout::{
    build_native_index_section, load_index_entries, materialize_files, plan_worktree_path,
    preflight_worktree_paths, remove_stale_files, update_dirc_index, update_references,
};
use super::common::{fail_fatal, print_json, reject, CliContext};
use super::operation::{record_head_operation, HeadOperationSpec};
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
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };

    let (commit_spec, path_specs) = split_reset_pathspecs(&view, &ctx.args);
    if !path_specs.is_empty() {
        handle_path_reset(&view, commit_spec.as_deref().unwrap_or("HEAD"), &path_specs);
        return;
    }

    let opts = parse_reset_options(&ctx.args);
    let (target_commit, tree_oid) = match view.resolve_tree(&opts.target) {
        Ok(resolved) => resolved,
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };

    let (target_files, current_files) = prepare_reset_trees(&view, opts.mode, &tree_oid);
    let effective_branch = view
        .head_branch()
        .ok()
        .flatten()
        .map(|(branch_name, _)| branch_name);

    assert_reset_trunk_allowed(
        &view,
        effective_branch.as_deref(),
        (target_commit, opts.force),
    );

    // Git records the position it is leaving in ORIG_HEAD before it moves HEAD.
    let previous_head = view
        .effective_head_commit()
        .ok()
        .flatten()
        .map(|(_, oid)| oid);
    if let Some(previous) = previous_head.as_ref() {
        if let Err(err) = DiskRefStore::new(view.git_dir()).write_orig_head(previous) {
            fail_fatal(format!("write ORIG_HEAD: {err}"));
        }
    }

    // Record snapshot to OperationGraph BEFORE state mutation for 100% reliable undo
    record_reset_operation(
        &view,
        previous_head,
        target_commit,
        &opts,
        effective_branch.as_deref(),
    );

    apply_reset_mode(
        &view,
        (opts.mode, target_commit, effective_branch.as_deref()),
        (&current_files, &target_files),
    );

    // The branch update logs the branch it rewrote; Git keeps the matching entry on HEAD too.
    if let Some(previous) = previous_head.as_ref() {
        let message = format!("reset: moving to {}", opts.target);
        DiskRefStore::new(view.git_dir()).record_head_move(previous, &target_commit, &message);
    }

    print_reset_feedback(ctx, &opts, target_commit, effective_branch.as_deref());
}

/// Splits `reset` arguments into an optional commit spec and pathspecs when unstaging paths.
fn split_reset_pathspecs(view: &RepoView, args: &[String]) -> (Option<String>, Vec<String>) {
    let mut commit_spec: Option<String> = None;
    let mut path_specs: Vec<String> = Vec::new();
    let mut after_dash_dash = false;

    for arg in args {
        if arg == "--" {
            after_dash_dash = true;
            continue;
        }
        if after_dash_dash {
            path_specs.push(arg.clone());
            continue;
        }
        if arg.starts_with("--") {
            continue;
        }
        if commit_spec.is_none()
            && (arg == "HEAD" || view.resolve(arg).is_ok())
            && !view.work_root().join(arg).is_file()
        {
            commit_spec = Some(arg.clone());
        } else {
            path_specs.push(arg.clone());
        }
    }
    (commit_spec, path_specs)
}

/// Flattens and validates trees for non-soft resets before any state change.
fn prepare_reset_trees(
    view: &RepoView,
    mode: ResetMode,
    tree_oid: &Oid,
) -> (BTreeMap<String, TreeEntry>, BTreeMap<String, TreeEntry>) {
    let mut target_files = BTreeMap::new();
    let mut current_files = BTreeMap::new();
    if mode == ResetMode::Soft {
        return (target_files, current_files);
    }
    if let Err(diff_err) = flatten_tree_for_diff(view, tree_oid, "", &mut target_files) {
        reject(CliTag::ERROR, diff_err);
    }
    if mode == ResetMode::Hard {
        current_files = view
            .effective_head_commit()
            .ok()
            .flatten()
            .and_then(|(_, head_oid)| flatten_commit_tree(view, &head_oid).ok())
            .unwrap_or_default();
    }
    preflight_reset_paths(view, &target_files, &current_files);
    (target_files, current_files)
}

/// Protects trunk branches from non-forced history rewrites in Taxis-governed repositories.
fn assert_reset_trunk_allowed(
    view: &RepoView,
    effective_branch: Option<&str>,
    target_and_force: (Oid, bool),
) {
    if !fg_native::container_path(view.git_dir()).is_file() {
        return;
    }
    let Some(br) = effective_branch else {
        return;
    };
    let is_trunk =
        br == "main" || br == "trunk" || br == "refs/heads/main" || br == "refs/heads/trunk";
    if !is_trunk {
        return;
    }
    let (target_commit, force) = target_and_force;
    let Some(current_head) = view.head_commit().ok().flatten() else {
        return;
    };
    if current_head != target_commit && !force {
        reject(
            CliTag::AUTHORITY_BREACH,
            format!(
                "Resetting protected trunk branch '{br}' backwards to {target_commit} is forbidden. \
                 Trunk history is append-only; use 'taxis revert' instead."
            ),
        );
    }
}

/// Executes reference, index, and worktree mutations for the selected reset mode.
fn apply_reset_mode(
    view: &RepoView,
    spec: (ResetMode, Oid, Option<&str>),
    trees: (&BTreeMap<String, TreeEntry>, &BTreeMap<String, TreeEntry>),
) {
    let (mode, target_commit, effective_branch) = spec;
    let (current_files, target_files) = trees;
    match mode {
        ResetMode::Soft => {
            update_references(
                view.git_dir(),
                view.work_root(),
                target_commit,
                effective_branch,
            );
        }
        ResetMode::Mixed => {
            update_references(
                view.git_dir(),
                view.work_root(),
                target_commit,
                effective_branch,
            );
            rebuild_mixed_dirc_index(view, target_files);
        }
        ResetMode::Hard => {
            remove_stale_files(view.work_root(), current_files, target_files);
            remove_index_only_files(view, target_files);
            let index_entries = materialize_files(view, target_files);
            update_dirc_index(view.git_dir(), &index_entries);
            update_references(
                view.git_dir(),
                view.work_root(),
                target_commit,
                effective_branch,
            );
        }
    }
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

/// Rejects a target tree or staged index that would resolve outside the worktree.
///
/// Both sides are untrusted input: a tree imported from a remote can name `..` or a device node,
/// and a corrupted index can too. Checking both here means the reset fails while the worktree and
/// the index still agree, instead of after one of them has been rewritten.
fn preflight_reset_paths(
    view: &RepoView,
    target_files: &BTreeMap<String, TreeEntry>,
    current_files: &BTreeMap<String, TreeEntry>,
) {
    let paths = target_files
        .keys()
        .chain(current_files.keys())
        .map(String::as_str);
    if let Err(detail) = preflight_worktree_paths(view.work_root(), paths) {
        reject(CliTag::ERROR, detail);
    }
    let Ok(Some(index)) = view.index() else {
        return;
    };
    for entry in index.entries() {
        if let Err(detail) = plan_worktree_path(view.work_root(), &entry.path) {
            reject(CliTag::ERROR, detail);
        }
    }
}

/// Deletes files that only the index tracks, as `git reset --hard` does for staged additions.
///
/// A path staged but absent from both HEAD and the target commit has no history to rebuild it
/// from, so leaving it behind would keep a file the reset claims to have discarded.
fn remove_index_only_files(view: &RepoView, target_files: &BTreeMap<String, TreeEntry>) {
    let Ok(Some(index)) = view.index() else {
        return;
    };
    for entry in index.entries() {
        if entry.stage != IndexStage::Normal || target_files.contains_key(&entry.path) {
            continue;
        }
        let full_path = match plan_worktree_path(view.work_root(), &entry.path) {
            Ok(full_path) => full_path,
            Err(detail) => reject(CliTag::ERROR, detail),
        };
        if full_path.is_file() || full_path.is_symlink() {
            let _ = fs::remove_file(&full_path);
        }
        let mut cursor = full_path.parent();
        while let Some(parent) = cursor {
            if parent == view.work_root() || !parent.starts_with(view.work_root()) {
                break;
            }
            if fs::remove_dir(parent).is_err() {
                break;
            }
            cursor = parent.parent();
        }
    }
}

/// Rebuilds DIRC index entries for mixed reset without touching working files.
fn rebuild_mixed_dirc_index(view: &RepoView, target_files: &BTreeMap<String, TreeEntry>) {
    let mut index_entries = Vec::with_capacity(target_files.len());

    for (path, tree_entry) in target_files {
        if let Err(detail) = plan_worktree_path(view.work_root(), path) {
            reject(CliTag::ERROR, detail);
        }

        index_entries.push(IndexEntry {
            path: path.clone(),
            mode: tree_entry.mode,
            oid: tree_entry.oid,
            stage: IndexStage::Normal,
            size: 0,
            mtime_seconds: 0,
            mtime_nanos: 0,
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
    previous_head: Option<Oid>,
    target_commit: Oid,
    opts: &ResetOptions,
    branch_name: Option<&str>,
) {
    if let Some(prev_oid) = previous_head {
        if prev_oid != target_commit {
            let needs_baseline = fractal_git::OperationGraph::load_or_init(view.git_dir())
                .map(|g| g.current_head.is_none())
                .unwrap_or(false);
            if needs_baseline {
                record_head_operation(HeadOperationSpec {
                    git_dir: view.git_dir(),
                    head_oid: prev_oid,
                    branch_or_ref: branch_name,
                    actor: "operator",
                    command: "commit",
                    description: format!("baseline before reset: {}", prev_oid.to_hex()),
                });
            }
        }
    }
    record_head_operation(HeadOperationSpec {
        git_dir: view.git_dir(),
        head_oid: target_commit,
        branch_or_ref: branch_name,
        actor: "operator",
        command: "reset",
        description: format!("reset ({:?}): {}", opts.mode, opts.target),
    });
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

/// Unstages paths from the index to match the specified commit (or HEAD).
fn handle_path_reset(view: &RepoView, commit_rev: &str, paths: &[String]) {
    let head_oid_opt = view.resolve(commit_rev).ok();
    let head_files: BTreeMap<String, TreeEntry> = head_oid_opt
        .and_then(|oid| flatten_commit_tree(view, &oid).ok())
        .unwrap_or_default();

    let mut index_entries = load_index_entries(view.git_dir());
    let mut unstaged_files = Vec::new();

    for path in paths {
        if let Some(tree_entry) = head_files.get(path) {
            if let Err(err) = plan_worktree_path(view.work_root(), path) {
                reject(CliTag::ERROR, err);
            }
            index_entries.insert(
                path.clone(),
                IndexEntry {
                    path: path.clone(),
                    mode: tree_entry.mode,
                    oid: tree_entry.oid,
                    stage: IndexStage::Normal,
                    size: 0,
                    mtime_seconds: 0,
                    mtime_nanos: 0,
                    assume_valid: false,
                    skip_worktree: false,
                    intent_to_add: false,
                },
            );
            unstaged_files.push(path.clone());
        } else if index_entries.remove(path).is_some() {
            unstaged_files.push(path.clone());
        }
    }

    let final_entries: Vec<IndexEntry> = index_entries.into_values().collect();
    update_dirc_index(view.git_dir(), &final_entries);

    let container_path = fg_native::container_path(view.git_dir());
    if container_path.is_file() {
        if let Ok(mut doc) = fg_native::RepoDocument::load(&container_path) {
            doc.indx = build_native_index_section(&final_entries);
            let _ = doc.save_atomic(&container_path);
        }
    }

    if !unstaged_files.is_empty() {
        println!("Unstaged changes after reset:");
        for f in unstaged_files {
            println!("M\t{f}");
        }
    }
}
