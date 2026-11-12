//! Module: taxis_cmd::cherry_pick_state — Conflicted Transplant State and Abort Restoration
//! File Path: src/bin/taxis_cmd/cherry_pick_state.rs
//! Architecture Role: Owns the on-disk state of an unfinished `cherry-pick`/`revert`: conflict
//!   markers, stage 1/2/3 index slots, `ORIG_HEAD`, `CHERRY_PICK_HEAD`/`REVERT_HEAD`, `MERGE_MSG`,
//!   and the `--abort` path that restores the pre-operation worktree and index.
//! Dependencies & Triggers: Called by `taxis_cmd::cherry_pick` when the three-way reconcile leaves
//!   unresolved paths, and when `--abort` is passed to `cherry-pick` or `revert`.
//! Responsibilities: Text auto-merge of conflicting blobs, conflict presentation per configured
//!   mode, multi-stage index persistence, and full worktree/index restoration from `ORIG_HEAD`.
//! Exit Semantics & Design Rationale:
//!   - An unresolved transplant exits 1 after writing every state file, so `--abort` and
//!     `status` can always reconstruct what happened.
//!   - `--abort` restores tracked files and the index from `ORIG_HEAD` and removes files the pick
//!     introduced; deleting only the marker file would leave a half-applied worktree behind.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-ALG-001`: Algorithmic three-way tree equivalence guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::collections::BTreeMap;
use std::fs;

use fg_algorithms::merge::{ConflictEntry, TextThreeWayMerge};
use fg_core::constants::git::OBJ_BLOB;
use fg_core::models::{ConflictPresentationMode, FileMode, IndexStage, Oid};
use fg_core::traits::OdbStore;
use fg_index::{GitIndex, IndexEntry};
use fg_storage::LooseOdb;
use fg_topology::conflict_tree::ConflictTreeManager;
use fractal_git::constants::cli::CliTag;
use fractal_git::DiskRefStore;

use super::checkout::{
    materialize_files, preflight_worktree_paths, remove_stale_files, update_dirc_index,
};
use super::cherry_pick::{DeltaTransplantSpec, TransplantTrees};
use super::commit_walk::CommitRecord;
use super::common::{fail_io, print_json, reject, CliContext};
use super::config::RepoConfig;
use super::repo_view::RepoView;
use super::tree_view::{flatten_commit_tree, TreeEntry};

/// Aborts an in-progress cherry-pick or revert, restoring worktree and index to `ORIG_HEAD`.
pub(crate) fn handle_transplant_abort(ctx: &CliContext, spec: &DeltaTransplantSpec) {
    let view = RepoView::open_or_exit(ctx);
    let head_marker_name = if spec.invert_delta {
        "REVERT_HEAD"
    } else {
        "CHERRY_PICK_HEAD"
    };
    let head_marker_path = view.git_dir().join(head_marker_name);
    if !head_marker_path.is_file() {
        eprintln!("{} fatal: no {} in progress", CliTag::ERROR, spec.operation);
        std::process::exit(1);
    }

    let pending_oid = fs::read_to_string(&head_marker_path)
        .ok()
        .and_then(|text| Oid::from_hex(text.trim()).ok());
    let orig_oid = read_abort_restore_oid(&view);
    let orig_files = orig_oid
        .and_then(|oid| flatten_commit_tree(&view, &oid).ok())
        .unwrap_or_default();

    let mut stale_candidates = BTreeMap::new();
    if let Ok(current_index) = GitIndex::load(view.git_dir().join("index")) {
        for entry in current_index.entries() {
            stale_candidates
                .entry(entry.path.clone())
                .or_insert(TreeEntry {
                    mode: entry.mode,
                    oid: entry.oid,
                });
        }
    }
    if let Some(p_oid) = pending_oid {
        if let Ok(pending_files) = flatten_commit_tree(&view, &p_oid) {
            for (path, te) in pending_files {
                stale_candidates.entry(path).or_insert(te);
            }
        }
    }

    if let Err(detail) =
        preflight_worktree_paths(view.work_root(), orig_files.keys().map(String::as_str))
    {
        reject(CliTag::ERROR, detail);
    }
    remove_stale_files(view.work_root(), &stale_candidates, &orig_files);
    let restored_entries = materialize_files(&view, &orig_files);
    update_dirc_index(view.git_dir(), &restored_entries);

    let _ = fs::remove_file(&head_marker_path);
    let _ = fs::remove_file(view.git_dir().join("MERGE_MSG"));

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": spec.operation,
            "status": "aborted",
            "restored_oid": orig_oid.map(|o| o.to_hex()),
        }));
    }
}

/// Reads `ORIG_HEAD` (falling back to effective `HEAD`) as the commit state to restore on `--abort`.
fn read_abort_restore_oid(view: &RepoView) -> Option<Oid> {
    if let Ok(raw) = fs::read_to_string(view.git_dir().join("ORIG_HEAD")) {
        if let Ok(oid) = Oid::from_hex(raw.trim()) {
            return Some(oid);
        }
    }
    view.effective_head_commit()
        .ok()
        .flatten()
        .map(|(_, oid)| oid)
}

/// Formats the target commit label shown on `>>>>>>>` conflict markers.
pub(crate) fn format_conflict_target_label(target_record: &CommitRecord) -> String {
    let short = &target_record.oid.to_hex()[..7];
    let subject = target_record.message.lines().next().unwrap_or("").trim();
    if subject.is_empty() {
        short.to_string()
    } else {
        format!("{short} ({subject})")
    }
}

/// Attempts clean text 3-way auto-merge on a single conflicted entry, persisting a merged blob if clean.
pub(crate) fn try_text_auto_merge_conflict(
    view: &RepoView,
    odb: &LooseOdb,
    conflict: &ConflictEntry,
    target_label: &str,
) -> Option<Oid> {
    let (Some(ours_oid), Some(theirs_oid)) = (conflict.ours_oid, conflict.theirs_oid) else {
        return None;
    };
    let base_bytes = conflict
        .base_oid
        .and_then(|oid| view.blob_payload(&oid).ok())
        .unwrap_or_default();
    let ours_bytes = view.blob_payload(&ours_oid).ok()?;
    let theirs_bytes = view.blob_payload(&theirs_oid).ok()?;
    let text_res = TextThreeWayMerge::merge(
        &base_bytes,
        &ours_bytes,
        &theirs_bytes,
        "HEAD",
        target_label,
    );
    if !text_res.is_clean {
        return None;
    }
    odb.write_object(OBJ_BLOB, &text_res.content).ok()
}

/// Materializes clean merged files, writes conflict markers, populates multi-stage DIRC index, and exits 1.
pub(crate) fn persist_conflicted_transplant_state(
    view: &RepoView,
    trees: &TransplantTrees,
    ours_commit: Oid,
    target_record: &CommitRecord,
    spec: &DeltaTransplantSpec,
    conflict_bundle: (&BTreeMap<String, Oid>, &[ConflictEntry], &str),
    ctx: &CliContext,
) -> ! {
    let (merged_tree, conflicts, target_label) = conflict_bundle;
    if let Err(err) = DiskRefStore::new(view.git_dir()).write_orig_head(&ours_commit) {
        fail_io("write ORIG_HEAD", err);
    }
    let head_marker = if spec.invert_delta {
        "REVERT_HEAD"
    } else {
        "CHERRY_PICK_HEAD"
    };
    if let Err(err) = fs::write(
        view.git_dir().join(head_marker),
        format!("{}\n", target_record.oid.to_hex()),
    ) {
        fail_io(format!("write {head_marker}"), err);
    }

    let conflict_paths: Vec<&str> = conflicts.iter().map(|c| c.path.as_str()).collect();
    let merge_msg = format!(
        "{}\n\n# Conflicts:\n#\t{}\n",
        target_record.message.trim_end(),
        conflict_paths.join("\n#\t")
    );
    let _ = fs::write(view.git_dir().join("MERGE_MSG"), merge_msg);

    let mut clean_files = BTreeMap::new();
    for (path, oid) in merged_tree {
        let mode = trees
            .theirs_files
            .get(path)
            .or_else(|| trees.ours_files.get(path))
            .map(|e| e.mode)
            .unwrap_or(FileMode::RegularFile);
        clean_files.insert(path.clone(), TreeEntry { mode, oid: *oid });
    }
    let mut keep_on_disk = clean_files.clone();
    for c in conflicts {
        let mode = trees
            .ours_files
            .get(&c.path)
            .or_else(|| trees.theirs_files.get(&c.path))
            .map(|e| e.mode)
            .unwrap_or(FileMode::RegularFile);
        keep_on_disk.entry(c.path.clone()).or_insert(TreeEntry {
            mode,
            oid: c.ours_oid.or(c.theirs_oid).unwrap_or(Oid::ZERO),
        });
    }
    remove_stale_files(view.work_root(), &trees.ours_files, &keep_on_disk);
    let mut index_entries = materialize_files(view, &clean_files);

    let mode = RepoConfig::load(view.git_dir()).conflict_mode();
    for conflict in conflicts {
        write_conflicted_transplant_entry(
            view,
            trees,
            conflict,
            (mode, target_label),
            &mut index_entries,
        );
    }
    update_dirc_index(view.git_dir(), &index_entries);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": spec.operation,
            "status": "conflicted",
            "conflicts": conflict_paths,
        }));
    } else {
        let short = &target_record.oid.to_hex()[..7];
        let first_line = target_record.message.lines().next().unwrap_or("");
        eprintln!(
            "error: could not apply {short}... {first_line}\nhint: after resolving the conflicts, mark the corrected paths\nhint: with 'taxis add <paths>' and commit the result with 'taxis commit'\nhint: or abort with 'taxis {} --abort'",
            spec.operation
        );
    }
    std::process::exit(1);
}

/// Writes conflict stage 1/2/3 index slots and conflict markers to disk for one path.
fn write_conflicted_transplant_entry(
    view: &RepoView,
    trees: &TransplantTrees,
    conflict: &ConflictEntry,
    presentation: (ConflictPresentationMode, &str),
    index_entries: &mut Vec<IndexEntry>,
) {
    let (mode, target_label) = presentation;
    println!("CONFLICT (content): Merge conflict in {}", conflict.path);
    let default_mode = trees
        .ours_files
        .get(&conflict.path)
        .or_else(|| trees.theirs_files.get(&conflict.path))
        .map(|e| e.mode)
        .unwrap_or(FileMode::RegularFile);
    for (oid_opt, files_map, stage) in [
        (conflict.base_oid, &trees.base_files, IndexStage::Base),
        (conflict.ours_oid, &trees.ours_files, IndexStage::Ours),
        (conflict.theirs_oid, &trees.theirs_files, IndexStage::Theirs),
    ] {
        if let Some(oid) = oid_opt {
            let entry_mode = files_map
                .get(&conflict.path)
                .map(|e| e.mode)
                .unwrap_or(default_mode);
            index_entries.push(IndexEntry {
                path: conflict.path.clone(),
                mode: entry_mode,
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

    let base_payload = conflict
        .base_oid
        .and_then(|oid| view.blob_payload(&oid).ok())
        .unwrap_or_default();
    let ours_payload = conflict
        .ours_oid
        .and_then(|oid| view.blob_payload(&oid).ok())
        .unwrap_or_default();
    let theirs_payload = conflict
        .theirs_oid
        .and_then(|oid| view.blob_payload(&oid).ok())
        .unwrap_or_default();
    let marker_bytes = match mode {
        ConflictPresentationMode::AgentAlgebraic => {
            if conflict.ours_oid.is_some() {
                ours_payload
            } else {
                theirs_payload
            }
        }
        ConflictPresentationMode::GitCompat => {
            if conflict.ours_oid.is_some() && conflict.theirs_oid.is_some() {
                TextThreeWayMerge::merge(
                    &base_payload,
                    &ours_payload,
                    &theirs_payload,
                    "HEAD",
                    target_label,
                )
                .content
            } else if conflict.ours_oid.is_some() {
                ours_payload
            } else {
                theirs_payload
            }
        }
        ConflictPresentationMode::Diff3 => {
            if conflict.ours_oid.is_some() && conflict.theirs_oid.is_some() {
                ConflictTreeManager::render_diff3(
                    &base_payload,
                    &ours_payload,
                    &theirs_payload,
                    "HEAD",
                    "base",
                    target_label,
                )
            } else if conflict.ours_oid.is_some() {
                ours_payload
            } else {
                theirs_payload
            }
        }
    };
    let target_path = match super::checkout::plan_worktree_path(view.work_root(), &conflict.path) {
        Ok(full) => full,
        Err(detail) => reject(CliTag::ERROR, detail),
    };
    if let Some(parent) = target_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(target_path, marker_bytes);
}
