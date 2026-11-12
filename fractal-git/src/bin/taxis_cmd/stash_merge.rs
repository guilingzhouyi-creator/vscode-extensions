//! Module: taxis_cmd::stash_merge — Three-Way Stash Reconciliation & Conflict Management
//! File Path: src/bin/taxis_cmd/stash_merge.rs
//! Architecture Role: Reconciles stashed modifications with the current working tree and index,
//!   detecting local collisions, performing 3-way tree & text merges, and writing conflict state.
//! Dependencies & Triggers: Called by `taxis stash pop` and `taxis stash apply`.
//! Responsibilities: Collision guard, three-way merge, clean apply to worktree/index, conflict presentation.
//! Exit Semantics & Design Rationale:
//!   - Collisions with local changes reject cleanly before mutating worktree.
//!   - Conflicts leave stash entry intact and write stage 1/2/3 index entries.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-ALG-001`: Algorithmic three-way tree equivalence guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::collections::BTreeMap;
use std::fs;

use fg_algorithms::merge::{ConflictEntry, TextThreeWayMerge, ThreeWayMerge, ThreeWayMergeResult};
use fg_core::constants::git::OBJ_BLOB;
use fg_core::models::{ConflictPresentationMode, FileMode, IndexStage, Oid};
use fg_core::traits::OdbStore;
use fg_index::IndexEntry;
use fg_storage::LooseOdb;
use fg_topology::conflict_tree::ConflictTreeManager;
use fractal_git::constants::cli::CliTag;

pub(crate) use super::checkout::preflight_worktree_paths;
use super::checkout::{
    load_index_entries, materialize_files, plan_worktree_path, remove_stale_files,
    update_dirc_index,
};
use super::common::{print_json, reject, CliContext};
use super::config::RepoConfig;
use super::repo_view::RepoView;
use super::status::collect_status;
use super::tree_view::TreeEntry;

/// Checks whether dirty or untracked worktree files would be overwritten by applying the stash.
pub(crate) fn reject_if_local_changes_collide(
    view: &RepoView,
    base_files: &BTreeMap<String, TreeEntry>,
    theirs_files: &BTreeMap<String, TreeEntry>,
) {
    let Ok(status) = collect_status(view) else {
        return;
    };
    let mut colliding = Vec::new();
    for entry in &status {
        let base_entry = base_files.get(&entry.path);
        let their_entry = theirs_files.get(&entry.path);
        let changed_in_stash = match (base_entry, their_entry) {
            (Some(b), Some(t)) => b.oid != t.oid || b.mode != t.mode,
            (None, Some(_)) | (Some(_), None) => true,
            (None, None) => false,
        };
        if changed_in_stash
            && (entry.is_staged()
                || entry.is_unstaged()
                || (entry.is_untracked() && their_entry.is_some()))
        {
            colliding.push(entry.path.clone());
        }
    }
    if !colliding.is_empty() {
        let joined = colliding.join("\n\t");
        reject(
            CliTag::ERROR,
            format!(
                "error: Your local changes to the following files would be overwritten by merge:\n\t{joined}\nPlease commit your changes or stash them before you merge."
            ),
        );
    }
}

/// Reconciles `base -> theirs` (stash) onto `head` (`ours`) using 3-way object and text merge.
pub(crate) fn merge_stash_trees(
    view: &RepoView,
    base_files: &BTreeMap<String, TreeEntry>,
    head_files: &BTreeMap<String, TreeEntry>,
    theirs_files: &BTreeMap<String, TreeEntry>,
) -> (BTreeMap<String, TreeEntry>, Vec<ConflictEntry>) {
    let base_map: BTreeMap<String, Oid> =
        base_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();
    let head_map: BTreeMap<String, Oid> =
        head_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();
    let theirs_map: BTreeMap<String, Oid> = theirs_files
        .iter()
        .map(|(p, e)| (p.clone(), e.oid))
        .collect();

    let (mut merged_oids, raw_conflicts) =
        match ThreeWayMerge::merge(&base_map, &head_map, &theirs_map) {
            ThreeWayMergeResult::Clean { merged_tree } => (merged_tree, Vec::new()),
            ThreeWayMergeResult::FastForward => (theirs_map, Vec::new()),
            ThreeWayMergeResult::Conflicted {
                merged_tree,
                conflicts,
            } => (merged_tree, conflicts),
        };

    let odb = LooseOdb::new(view.git_dir());
    let mut remaining = Vec::new();
    for conflict in raw_conflicts {
        if let Some(resolved_oid) = try_auto_merge_stash_conflict(view, &odb, &conflict) {
            merged_oids.insert(conflict.path.clone(), resolved_oid);
        } else {
            remaining.push(conflict);
        }
    }

    let mut merged_files = BTreeMap::new();
    for (path, oid) in merged_oids {
        let mode = theirs_files
            .get(&path)
            .or_else(|| head_files.get(&path))
            .map(|e| e.mode)
            .unwrap_or(FileMode::RegularFile);
        merged_files.insert(path, TreeEntry { mode, oid });
    }
    (merged_files, remaining)
}

/// Attempts a clean text 3-way merge for one stash conflict entry.
fn try_auto_merge_stash_conflict(
    view: &RepoView,
    odb: &LooseOdb,
    conflict: &ConflictEntry,
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
        "Updated upstream",
        "Stashed changes",
    );
    if !text_res.is_clean {
        return None;
    }
    odb.write_object(OBJ_BLOB, &text_res.content).ok()
}

/// Tree snapshot tuple passed while writing conflicted stash apply/pop state.
pub(crate) struct StashConflictTrees<'a> {
    pub(crate) base: &'a BTreeMap<String, TreeEntry>,
    pub(crate) head: &'a BTreeMap<String, TreeEntry>,
    pub(crate) theirs: &'a BTreeMap<String, TreeEntry>,
}

/// Applies clean merged stash changes onto worktree while preserving unrelated local edits and index HEAD baselines.
pub(crate) fn apply_clean_stash_to_worktree(
    view: &RepoView,
    head_files: &BTreeMap<String, TreeEntry>,
    merged_files: &BTreeMap<String, TreeEntry>,
) {
    let deleted_by_stash: BTreeMap<String, TreeEntry> = head_files
        .iter()
        .filter(|(p, _)| !merged_files.contains_key(*p))
        .map(|(p, e)| (p.clone(), *e))
        .collect();
    if !deleted_by_stash.is_empty() {
        remove_stale_files(view.work_root(), &deleted_by_stash, &BTreeMap::new());
    }

    let existing_index = load_index_entries(view.git_dir());
    let mut next_index: BTreeMap<String, IndexEntry> = BTreeMap::new();
    let changed_only: BTreeMap<String, TreeEntry> = merged_files
        .iter()
        .filter(|(p, te)| {
            head_files
                .get(*p)
                .is_none_or(|h| h.oid != te.oid || h.mode != te.mode)
        })
        .map(|(p, te)| (p.clone(), *te))
        .collect();

    let materialized_changed = materialize_files(view, &changed_only);
    for entry in materialized_changed {
        if !head_files.contains_key(&entry.path) {
            next_index.insert(entry.path.clone(), entry);
        }
    }

    for (path, head_entry) in head_files {
        if let Some(existing) = existing_index.get(path) {
            next_index.insert(path.clone(), existing.clone());
        } else if merged_files.contains_key(path) {
            next_index.insert(
                path.clone(),
                IndexEntry {
                    path: path.clone(),
                    mode: head_entry.mode,
                    oid: head_entry.oid,
                    stage: IndexStage::Normal,
                    size: 0,
                    mtime_seconds: 0,
                    mtime_nanos: 0,
                    assume_valid: false,
                    skip_worktree: false,
                    intent_to_add: false,
                },
            );
        }
    }

    let final_entries: Vec<IndexEntry> = next_index.into_values().collect();
    update_dirc_index(view.git_dir(), &final_entries);
}

/// Writes conflict markers and multi-stage index entries when `stash pop`/`apply` conflicts, leaving the stash entry intact.
pub(crate) fn write_conflicted_stash_state(
    view: &RepoView,
    trees: StashConflictTrees<'_>,
    merged_files: &BTreeMap<String, TreeEntry>,
    conflicts: &[ConflictEntry],
    ctx: &CliContext,
) -> ! {
    let mut index_entries = Vec::new();
    let changed_only: BTreeMap<String, TreeEntry> = merged_files
        .iter()
        .filter(|(p, te)| {
            trees
                .head
                .get(*p)
                .is_none_or(|h| h.oid != te.oid || h.mode != te.mode)
        })
        .map(|(p, te)| (p.clone(), *te))
        .collect();
    let materialized_clean = materialize_files(view, &changed_only);
    let existing_index = load_index_entries(view.git_dir());
    let mut clean_map: BTreeMap<String, IndexEntry> = existing_index;
    for entry in materialized_clean {
        clean_map.insert(entry.path.clone(), entry);
    }
    for c in conflicts {
        clean_map.remove(&c.path);
    }
    index_entries.extend(clean_map.into_values());

    let mode = RepoConfig::load(view.git_dir()).conflict_mode();
    for conflict in conflicts {
        println!("CONFLICT (content): Merge conflict in {}", conflict.path);
        push_stash_conflict_slots(view, &trees, conflict, mode, &mut index_entries);
    }
    update_dirc_index(view.git_dir(), &index_entries);

    if ctx.json_mode {
        let paths: Vec<&str> = conflicts.iter().map(|c| c.path.as_str()).collect();
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "stash",
            "status": "conflicted",
            "stash_dropped": false,
            "conflicts": paths,
        }));
    } else {
        eprintln!("The stash entry is kept in case you need it again.");
    }
    std::process::exit(1);
}

/// Appends stage 1/2/3 slots and writes conflict marker bytes for one stash conflict.
fn push_stash_conflict_slots(
    view: &RepoView,
    trees: &StashConflictTrees<'_>,
    conflict: &ConflictEntry,
    mode: ConflictPresentationMode,
    index_entries: &mut Vec<IndexEntry>,
) {
    let default_mode = trees
        .head
        .get(&conflict.path)
        .or_else(|| trees.theirs.get(&conflict.path))
        .map(|e| e.mode)
        .unwrap_or(FileMode::RegularFile);
    for (oid_opt, files_map, stage) in [
        (conflict.base_oid, trees.base, IndexStage::Base),
        (conflict.ours_oid, trees.head, IndexStage::Ours),
        (conflict.theirs_oid, trees.theirs, IndexStage::Theirs),
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

    let base_bytes = conflict
        .base_oid
        .and_then(|oid| view.blob_payload(&oid).ok())
        .unwrap_or_default();
    let ours_bytes = conflict
        .ours_oid
        .and_then(|oid| view.blob_payload(&oid).ok())
        .unwrap_or_default();
    let theirs_bytes = conflict
        .theirs_oid
        .and_then(|oid| view.blob_payload(&oid).ok())
        .unwrap_or_default();
    let rendered = match mode {
        ConflictPresentationMode::AgentAlgebraic => {
            if conflict.ours_oid.is_some() {
                ours_bytes
            } else {
                theirs_bytes
            }
        }
        ConflictPresentationMode::GitCompat => {
            if conflict.ours_oid.is_some() && conflict.theirs_oid.is_some() {
                TextThreeWayMerge::merge(
                    &base_bytes,
                    &ours_bytes,
                    &theirs_bytes,
                    "Updated upstream",
                    "Stashed changes",
                )
                .content
            } else if conflict.ours_oid.is_some() {
                ours_bytes
            } else {
                theirs_bytes
            }
        }
        ConflictPresentationMode::Diff3 => {
            if conflict.ours_oid.is_some() && conflict.theirs_oid.is_some() {
                ConflictTreeManager::render_diff3(
                    &base_bytes,
                    &ours_bytes,
                    &theirs_bytes,
                    "Updated upstream",
                    "base",
                    "Stashed changes",
                )
            } else if conflict.ours_oid.is_some() {
                ours_bytes
            } else {
                theirs_bytes
            }
        }
    };
    let target_path = match plan_worktree_path(view.work_root(), &conflict.path) {
        Ok(fp) => fp,
        Err(detail) => reject(CliTag::ERROR, detail),
    };
    if let Some(parent) = target_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(target_path, rendered);
}
