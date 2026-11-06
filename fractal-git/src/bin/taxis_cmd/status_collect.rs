//! Module: taxis_cmd::status_collect — Status Comparison and Collection Engine
//! File Path: src/bin/taxis_cmd/status_collect.rs
//! Architecture Role: Compares `HEAD`, index, and worktree to produce the three-way status model.
//! Dependencies & Triggers: Dispatched by `status::handle_status`, `checkout`, and `stash`.
//! Responsibilities: Tree flattening, staged/unstaged classification, rename detection,
//!   and merge-conflict mapping.
//! Exit Semantics & Design Rationale:
//!   - Decoupled from CLI rendering to keep comparison performance and formatting separate.
//!   - Pre-allocated functional collectors eliminate transient heap churn in hot loops.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

use fg_algorithms::{detect_renames, BlobRef};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{compute_object_oid, FileMode, IndexStage, ObjectKind};
use fg_index::{AttributeSet, GitIndex, IgnoreMatcher, IndexEntry};

use super::repo_view::RepoView;
use super::status::{
    StatusEntry, CODE_ADDED, CODE_DELETED, CODE_MODIFIED, CODE_RENAMED, CODE_UNCHANGED,
};
use super::status_untracked::find_untracked;
use super::tree_view::{
    entry_is_racy, flatten_commit_tree, mtime_matches, stat_cache_trusted, worktree_mode, SideBlob,
    TreeEntry,
};

const ABSENT_PATH: &str = "<absent>";
const DIRC_MAGIC: &[u8; 4] = b"DIRC";
const EMPTY_INDEX_CAPACITY: usize = 32;

const STAGE_BASE: u8 = 1;
const STAGE_OURS: u8 = 2;
const STAGE_THEIRS: u8 = 3;

/// Resolves the repository index or produces an empty placeholder.
fn resolve_status_index(view: &RepoView) -> FractalResult<GitIndex> {
    match view.index()? {
        Some(loaded) => Ok(loaded),
        None => GitIndex::parse(empty_index_bytes(), PathBuf::from(ABSENT_PATH)),
    }
}

/// Resolves and flattens the commit tree at HEAD (falling back to effective cell HEAD).
fn resolve_head_tree(view: &RepoView) -> FractalResult<BTreeMap<String, TreeEntry>> {
    match view.effective_head_commit()? {
        Some((_, commit)) => flatten_commit_tree(view, &commit),
        None => Ok(BTreeMap::new()),
    }
}

/// Merges worktree changes into the accumulated status changes map.
fn merge_worktree_changes(
    view: &RepoView,
    index_map: &BTreeMap<String, IndexEntry>,
    matcher: &IgnoreMatcher,
    attributes: &AttributeSet,
    changes: &mut BTreeMap<String, StatusEntry>,
) -> FractalResult<()> {
    for (path, entry) in compare_worktree_to_index(view, index_map, matcher, attributes)? {
        merge_side(changes, path, entry);
    }
    Ok(())
}

/// Merges conflict stage records into the accumulated status changes map.
fn merge_conflict_entries(index: &GitIndex, changes: &mut BTreeMap<String, StatusEntry>) {
    for (path, entry) in conflict_entries(index) {
        changes.insert(path, entry);
    }
}

/// Builds the complete status report for `view`.
pub fn collect_status(view: &RepoView) -> FractalResult<Vec<StatusEntry>> {
    let index = resolve_status_index(view)?;
    let head_tree = resolve_head_tree(view)?;
    let matcher = view.ignore_matcher()?;
    let attributes = view.attributes()?;
    let index_map = stage_zero_map(&index);
    let tracked: BTreeSet<String> = index
        .entries()
        .iter()
        .map(|entry| entry.path.clone())
        .collect();

    let mut changes = compare_index_to_head(view, &index_map, &head_tree)?;
    merge_worktree_changes(view, &index_map, &matcher, &attributes, &mut changes)?;
    merge_conflict_entries(&index, &mut changes);

    let mut ordered: Vec<StatusEntry> = changes.into_values().collect();
    ordered.extend(find_untracked(view, &tracked, &matcher)?.into_values());
    Ok(ordered)
}

/// Merges one worktree-side comparison into the accumulated map.
pub fn merge_side(all: &mut BTreeMap<String, StatusEntry>, path: String, entry: StatusEntry) {
    match all.get_mut(&path) {
        Some(existing) => {
            existing.worktree_code = entry.worktree_code;
        }
        None => {
            all.insert(path, entry);
        }
    }
}

/// Produces the bytes of an index with zero entries.
pub fn empty_index_bytes() -> Vec<u8> {
    let mut bytes = Vec::with_capacity(EMPTY_INDEX_CAPACITY);
    bytes.extend_from_slice(DIRC_MAGIC);
    bytes.extend_from_slice(&2u32.to_be_bytes());
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.extend_from_slice(&[0u8; 20]);
    bytes
}

/// Keeps only stage-0 entries, the ones a worktree comparison can use.
pub fn stage_zero_map(index: &GitIndex) -> BTreeMap<String, IndexEntry> {
    index
        .entries_at_stage(IndexStage::Normal)
        .map(|entry| (entry.path.clone(), entry.clone()))
        .collect()
}

/// Compares the index against the `HEAD` tree, then folds rename pairs into single records.
fn compare_index_to_head(
    view: &RepoView,
    index_map: &BTreeMap<String, IndexEntry>,
    head_tree: &BTreeMap<String, TreeEntry>,
) -> FractalResult<BTreeMap<String, StatusEntry>> {
    let mut entries = classify_staged_from_map(index_map, head_tree);
    detect_staged_renames(view, index_map, head_tree, &mut entries)?;
    Ok(entries)
}

/// Classifies every path as staged-added, staged-modified, or staged-deleted.
#[allow(dead_code)]
pub fn classify_staged(
    index: &GitIndex,
    head_tree: &BTreeMap<String, TreeEntry>,
) -> BTreeMap<String, StatusEntry> {
    let staged = stage_zero_map(index);
    classify_staged_from_map(&staged, head_tree)
}

/// Classifies from a pre-computed stage-0 map without loop transient allocations.
pub fn classify_staged_from_map(
    staged: &BTreeMap<String, IndexEntry>,
    head_tree: &BTreeMap<String, TreeEntry>,
) -> BTreeMap<String, StatusEntry> {
    let mut entries = BTreeMap::new();

    let added_and_modified: Vec<(String, StatusEntry)> = staged
        .iter()
        .filter_map(|(path, entry)| match head_tree.get(path) {
            None => Some((
                path.clone(),
                StatusEntry::new(CODE_ADDED, CODE_UNCHANGED, path),
            )),
            Some(existing)
                if existing.oid != entry.oid || existing.mode.to_u32() != entry.mode.to_u32() =>
            {
                Some((
                    path.clone(),
                    StatusEntry::new(CODE_MODIFIED, CODE_UNCHANGED, path),
                ))
            }
            Some(_) => None,
        })
        .collect();

    let deleted: Vec<(String, StatusEntry)> = head_tree
        .keys()
        .filter(|path| !staged.contains_key(*path))
        .map(|path| {
            (
                path.clone(),
                StatusEntry::new(CODE_DELETED, CODE_UNCHANGED, path),
            )
        })
        .collect();

    entries.extend(added_and_modified);
    entries.extend(deleted);
    entries
}

fn collect_candidate_blobs(
    view: &RepoView,
    paths: &[String],
    lookup: impl Fn(&str) -> Option<TreeEntry>,
) -> FractalResult<Vec<SideBlob>> {
    paths
        .iter()
        .filter_map(|path| {
            let entry = lookup(path)?;
            let payload = match view.payload_for(entry.mode, &entry.oid) {
                Ok(p) => p,
                Err(e) => return Some(Err(e)),
            };
            Some(Ok(SideBlob {
                path: path.clone(),
                entry,
                payload,
            }))
        })
        .collect()
}

/// Replaces staged deletion/addition pairs that are the same file with one `R` record.
fn detect_staged_renames(
    view: &RepoView,
    staged: &BTreeMap<String, IndexEntry>,
    head_tree: &BTreeMap<String, TreeEntry>,
    entries: &mut BTreeMap<String, StatusEntry>,
) -> FractalResult<()> {
    let deleted: Vec<String> = entries
        .values()
        .filter(|e| e.index_code == CODE_DELETED)
        .map(|e| e.path.clone())
        .collect();
    let added: Vec<String> = entries
        .values()
        .filter(|e| e.index_code == CODE_ADDED)
        .map(|e| e.path.clone())
        .collect();
    if deleted.is_empty() || added.is_empty() {
        return Ok(());
    }

    let sources = collect_candidate_blobs(view, &deleted, |p| head_tree.get(p).copied())?;
    let dests = collect_candidate_blobs(view, &added, |p| {
        staged.get(p).map(|f| TreeEntry {
            mode: f.mode,
            oid: f.oid,
        })
    })?;

    let source_refs: Vec<BlobRef<'_>> = sources
        .iter()
        .map(|blob| BlobRef {
            path: &blob.path,
            mode: blob.entry.mode,
            oid: blob.entry.oid,
            payload: &blob.payload,
        })
        .collect();
    let dest_refs: Vec<BlobRef<'_>> = dests
        .iter()
        .map(|blob| BlobRef {
            path: &blob.path,
            mode: blob.entry.mode,
            oid: blob.entry.oid,
            payload: &blob.payload,
        })
        .collect();

    let hits = detect_renames(&source_refs, &dest_refs);
    apply_rename_pairs(&hits, &sources, &dests, entries);
    Ok(())
}

fn apply_rename_pairs(
    hits: &[Option<fg_algorithms::RenameHit>],
    sources: &[SideBlob],
    dests: &[SideBlob],
    entries: &mut BTreeMap<String, StatusEntry>,
) {
    let renames: Vec<(String, String, StatusEntry)> = hits
        .iter()
        .enumerate()
        .filter_map(|(dest_index, hit)| {
            let found = hit.as_ref()?;
            let source = &sources[found.source];
            let dest = &dests[dest_index];
            Some((
                source.path.clone(),
                dest.path.clone(),
                StatusEntry::with_rename(
                    CODE_RENAMED,
                    CODE_UNCHANGED,
                    &dest.path,
                    &source.path,
                    found.score,
                ),
            ))
        })
        .collect();

    for (old_path, new_path, entry) in renames {
        entries.remove(&old_path);
        entries.insert(new_path, entry);
    }
}

fn inspect_worktree_entry(
    view: &RepoView,
    path: &str,
    staged: &IndexEntry,
    matcher: &IgnoreMatcher,
    attributes: &AttributeSet,
    index_timestamp: Option<u64>,
) -> FractalResult<Option<StatusEntry>> {
    if staged.mode == FileMode::Gitlink {
        return Ok(None);
    }
    let absolute = view.work_root().join(path);
    let metadata = match fs::symlink_metadata(&absolute) {
        Ok(found) => found,
        Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => {
            if matcher.is_ignored(path, false) {
                return Ok(None);
            }
            return Ok(Some(StatusEntry::new(CODE_UNCHANGED, CODE_DELETED, path)));
        }
        Err(io_err) => return Err(FractalError::Io(io_err)),
    };

    let mode_changed =
        worktree_mode(&metadata, staged.mode, view.config().trust_executable_bit()) != staged.mode;
    let content_changed =
        worktree_content_changed(view, staged, &metadata, attributes, index_timestamp)?;

    if mode_changed || content_changed {
        Ok(Some(StatusEntry::new(CODE_UNCHANGED, CODE_MODIFIED, path)))
    } else {
        Ok(None)
    }
}

/// Compares the worktree against the index.
fn compare_worktree_to_index(
    view: &RepoView,
    index_map: &BTreeMap<String, IndexEntry>,
    matcher: &IgnoreMatcher,
    attributes: &AttributeSet,
) -> FractalResult<BTreeMap<String, StatusEntry>> {
    let index_timestamp = view.index_file_timestamp();
    let items: Vec<(String, StatusEntry)> = index_map
        .iter()
        .filter_map(|(path, staged)| {
            match inspect_worktree_entry(view, path, staged, matcher, attributes, index_timestamp) {
                Ok(Some(entry)) => Some(Ok((path.clone(), entry))),
                Ok(None) => None,
                Err(err) => Some(Err(err)),
            }
        })
        .collect::<FractalResult<Vec<_>>>()?;

    Ok(items.into_iter().collect())
}

/// Decides whether the worktree file differs from what the index records.
fn worktree_content_changed(
    view: &RepoView,
    staged: &IndexEntry,
    metadata: &fs::Metadata,
    attributes: &AttributeSet,
    index_timestamp: Option<u64>,
) -> FractalResult<bool> {
    if stat_cache_trusted(staged, metadata, index_timestamp) {
        return Ok(false);
    }
    if metadata.len() != u64::from(staged.size) && staged.size != 0 {
        return Ok(true);
    }
    if metadata.len() == u64::from(staged.size)
        && mtime_matches(staged, metadata)
        && !entry_is_racy(staged, index_timestamp)
    {
        return Ok(false);
    }
    Ok(!hash_matches(view, staged, attributes)?)
}

/// Reports whether a worktree file still hashes to the staged id.
fn hash_matches(
    view: &RepoView,
    staged: &IndexEntry,
    attributes: &AttributeSet,
) -> FractalResult<bool> {
    let payload =
        view.worktree_payload(&staged.path, staged.mode, Some(&staged.oid), attributes)?;
    Ok(compute_object_oid(ObjectKind::Blob, &payload) == staged.oid)
}

/// Builds one entry per conflicted path.
fn conflict_entries(index: &GitIndex) -> BTreeMap<String, StatusEntry> {
    let mut by_path: BTreeMap<&str, BTreeSet<u8>> = BTreeMap::new();
    for entry in index.entries() {
        if entry.stage != IndexStage::Normal {
            by_path
                .entry(entry.path.as_str())
                .or_default()
                .insert(entry.stage.to_u8());
        }
    }

    by_path
        .into_iter()
        .map(|(path, stages)| {
            let (index_code, worktree_code) = conflict_code(&stages);
            (
                path.to_string(),
                StatusEntry::new(index_code, worktree_code, path),
            )
        })
        .collect()
}

/// Maps the set of occupied stages onto Git's two-letter conflict code.
pub fn conflict_code(stages: &BTreeSet<u8>) -> (char, char) {
    let has_base = stages.contains(&STAGE_BASE);
    let has_ours = stages.contains(&STAGE_OURS);
    let has_theirs = stages.contains(&STAGE_THEIRS);
    match (has_base, has_ours, has_theirs) {
        (true, false, false) => ('D', 'D'),
        (false, true, true) => ('A', 'A'),
        (true, true, false) => ('U', 'D'),
        (true, false, true) => ('D', 'U'),
        (false, true, false) => ('A', 'U'),
        (false, false, true) => ('U', 'A'),
        _ => ('U', 'U'),
    }
}
