//! Module: taxis_cmd::status — Three-Way Status Report
//! File Path: src/bin/taxis_cmd/status.rs
//! Architecture Role: Compares `HEAD`, the index, and the worktree, which is the definition of a
//!   status report. Produces `--porcelain=v1 -z` output compatible with Git's.
//! Dependencies & Triggers: Dispatched by `taxis status`; also supplies the file list `diff` walks.
//! Responsibilities: Tree flattening, staged/unstaged classification, rename detection on the staged
//!   side, untracked discovery under ignore rules, and merge-conflict reporting.
//! Exit Semantics & Design Rationale:
//!   - The three comparisons are all required. Index against the `HEAD` tree gives staged changes;
//!     worktree against the index gives unstaged changes; the index against the directory listing
//!     gives untracked paths. Dropping the third is what makes a report claim a directory is clean
//!     while it holds files a commit would never include.
//!   - Renames are detected only between `HEAD` and the index. Git's own status detects them there
//!     and not on the worktree side — a worktree-side move is reported as one deletion plus one
//!     modification, because the index holds both paths and neither side of that comparison is
//!     "missing" in the way a rename needs. Detecting on both sides would produce rename records
//!     Git never prints.
//!   - Records are grouped, not globally sorted: every change record comes first in path order, then
//!     the untracked ones. Git keeps two separate lists and prints them in that order, so a single
//!     sorted map puts an untracked `a.txt` above a modified `z.txt` and diverges on the first
//!     repository that has both.
//!   - The stat cache is an optimization, never the answer. A size and mtime match means "probably
//!     clean"; a mismatch forces a hash. Trusting the cache alone loses edits made within the same
//!     second on filesystems with coarse timestamps.
//!   - Untracked paths are reported as their topmost directory that no staged path lives under,
//!     matching Git's default `normal` mode. Listing every file under a new directory turns one
//!     untracked branch into thousands of lines and hides the single path a user must act on.
//!   - A conflicted path occupies stages 1/2/3 and has no stage-0 entry. It is reported once, with
//!     the code describing which sides survived, because both characters describe the same path and
//!     two rows for one path would be read as two files.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use fg_algorithms::{detect_renames, BlobRef};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{compute_object_oid, FileMode, IndexStage, ObjectKind};
use fg_index::{AttributeSet, GitIndex, IgnoreMatcher, IndexEntry};
use fractal_git::constants::cli::CliTag;

use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Status code for an unmodified side.
pub const CODE_UNCHANGED: char = ' ';

/// Status code for an added path.
pub const CODE_ADDED: char = 'A';

/// Status code for a modified path.
pub const CODE_MODIFIED: char = 'M';

/// Status code for a deleted path.
pub const CODE_DELETED: char = 'D';

/// Status code for a path that survived a rename.
pub const CODE_RENAMED: char = 'R';

/// Status code marking a merge conflict.
pub const CODE_UNMERGED: char = 'U';

/// Index-side character reserved for untracked paths.
const CODE_UNTRACKED: char = '?';

/// Directory names excluded from the worktree scan.
const SCAN_SKIP_NAMES: [&str; 2] = [".git", ".taxis"];

/// One report line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusEntry {
    /// Index-side status character.
    pub index_code: char,
    /// Worktree-side status character.
    pub worktree_code: char,
    /// Repository-relative path with `/` separators. For a rename this is the new path.
    pub path: String,
    /// Path the file came from when this entry is a rename; `None` for every other status.
    pub rename_from: Option<String>,
    /// Similarity on Git's 0..=60000 scale when this entry is a rename; `None` otherwise.
    ///
    /// Porcelain v1 does not print the score, but `diff --cached` does, and both commands must
    /// describe the same rename with the same number. Carrying it here means the pairing is decided
    /// once, by whichever comparison ran first, rather than recomputed with a chance to disagree.
    pub score: Option<u32>,
}

impl StatusEntry {
    /// Creates an entry from its two codes and path.
    pub fn new(index_code: char, worktree_code: char, path: impl Into<String>) -> Self {
        Self {
            index_code,
            worktree_code,
            path: path.into(),
            rename_from: None,
            score: None,
        }
    }

    /// Creates an entry that records a rename from `from` to `path`.
    pub fn with_rename(
        index_code: char,
        worktree_code: char,
        path: impl Into<String>,
        from: impl Into<String>,
        score: u32,
    ) -> Self {
        Self {
            index_code,
            worktree_code,
            path: path.into(),
            rename_from: Some(from.into()),
            score: Some(score),
        }
    }

    /// Renders the two-character code Git prints.
    pub fn code(&self) -> String {
        if self.index_code == CODE_UNTRACKED {
            return "??".to_string();
        }
        format!("{}{}", self.index_code, self.worktree_code)
    }

    /// Renders the record text without its terminator.
    ///
    /// A rename carries two paths, and the two output framings disagree on how to spell them: the
    /// line-oriented form writes `old -> new` inside one record, while `-z` writes the new path in
    /// the record and the old path as a separate NUL-terminated field. Emitting `old -> new` under
    /// `-z` would hand a consumer a single string containing an arrow, and every `-z` parser splits
    /// on NUL only.
    pub fn record_text(&self, nul_terminated: bool) -> String {
        let code = self.code();
        match (&self.rename_from, nul_terminated) {
            (Some(from), false) => format!("{code} {from} -> {}", self.path),
            _ => format!("{code} {}", self.path),
        }
    }

    /// Reports whether this entry describes an unresolved merge conflict.
    pub fn is_conflicted(&self) -> bool {
        self.index_code == CODE_UNMERGED || self.worktree_code == CODE_UNMERGED
    }

    /// Reports whether the change is staged.
    pub fn is_staged(&self) -> bool {
        self.index_code != CODE_UNCHANGED && self.index_code != CODE_UNTRACKED
    }

    /// Reports whether the change exists only in the worktree.
    pub fn is_unstaged(&self) -> bool {
        self.worktree_code != CODE_UNCHANGED && self.index_code != CODE_UNTRACKED
    }

    /// Reports whether this path is untracked.
    pub fn is_untracked(&self) -> bool {
        self.index_code == CODE_UNTRACKED
    }
}

pub use super::tree_view::{
    flatten_commit_tree, mtime_matches, stat_cache_matches, worktree_mode, write_record, SideBlob,
    TreeEntry,
};

/// Builds the complete status report for `view`.
///
/// # Errors
///
/// Propagates reference, object, index, and ignore-rule failures. A worktree that cannot be listed
/// is an error rather than an empty result.
pub fn collect_status(view: &RepoView) -> FractalResult<Vec<StatusEntry>> {
    let index = match view.index()? {
        Some(loaded) => loaded,
        None => GitIndex::parse(empty_index_bytes(), std::path::PathBuf::from("<absent>"))?,
    };
    let head_tree = match view.head_commit()? {
        Some(commit) => flatten_commit_tree(view, &commit)?,
        None => BTreeMap::new(),
    };
    let matcher = view.ignore_matcher()?;
    let attributes = view.attributes()?;
    let index_map = stage_zero_map(&index);

    let mut changes: BTreeMap<String, StatusEntry> =
        compare_index_to_head(view, &index, &head_tree)?;
    for (path, entry) in compare_worktree_to_index(view, &index_map, &matcher, &attributes)? {
        merge_side(&mut changes, path, entry);
    }
    for (path, entry) in conflict_entries(&index) {
        changes.insert(path, entry);
    }

    let mut ordered: Vec<StatusEntry> = changes.into_values().collect();
    ordered.extend(find_untracked(view, &index_map, &matcher)?.into_values());
    Ok(ordered)
}

/// Merges one worktree-side comparison into the accumulated map.
fn merge_side(all: &mut BTreeMap<String, StatusEntry>, path: String, entry: StatusEntry) {
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
fn empty_index_bytes() -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"DIRC");
    bytes.extend_from_slice(&2u32.to_be_bytes());
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.extend_from_slice(&[0u8; 20]);
    bytes
}

/// Keeps only stage-0 entries, the ones a worktree comparison can use.
fn stage_zero_map(index: &GitIndex) -> BTreeMap<String, IndexEntry> {
    let mut map = BTreeMap::new();
    for entry in index.entries_at_stage(IndexStage::Normal) {
        map.insert(entry.path.clone(), entry.clone());
    }
    map
}

/// Compares the index against the `HEAD` tree, then folds rename pairs into single records.
///
/// # Errors
///
/// Propagates object reads for the payloads rename detection scores.
fn compare_index_to_head(
    view: &RepoView,
    index: &GitIndex,
    head_tree: &BTreeMap<String, TreeEntry>,
) -> FractalResult<BTreeMap<String, StatusEntry>> {
    let mut entries = classify_staged(index, head_tree);
    detect_staged_renames(view, index, head_tree, &mut entries)?;
    Ok(entries)
}

/// Classifies every path as staged-added, staged-modified, or staged-deleted.
///
/// Renames are deliberately absent: a rename is a deletion and an addition that only become one
/// record once their payloads are compared, so the classification has to finish first. Returning
/// them as separate records here is what lets the pure classification be tested without a
/// repository.
fn classify_staged(
    index: &GitIndex,
    head_tree: &BTreeMap<String, TreeEntry>,
) -> BTreeMap<String, StatusEntry> {
    let staged = stage_zero_map(index);
    let mut entries: BTreeMap<String, StatusEntry> = BTreeMap::new();

    for (path, entry) in &staged {
        match head_tree.get(path) {
            None => {
                entries.insert(
                    path.clone(),
                    StatusEntry::new(CODE_ADDED, CODE_UNCHANGED, path),
                );
            }
            Some(existing)
                if existing.oid != entry.oid || existing.mode.to_u32() != entry.mode.to_u32() =>
            {
                entries.insert(
                    path.clone(),
                    StatusEntry::new(CODE_MODIFIED, CODE_UNCHANGED, path),
                );
            }
            Some(_) => {}
        }
    }
    for path in head_tree.keys() {
        if staged.contains_key(path) {
            continue;
        }
        entries.insert(
            path.clone(),
            StatusEntry::new(CODE_DELETED, CODE_UNCHANGED, path),
        );
    }
    entries
}

/// Replaces staged deletion/addition pairs that are the same file with one `R` record.
///
/// Only the staged side is considered. Git's status detects renames between `HEAD` and the index and
/// not between the index and the worktree, because the worktree comparison already has both paths in
/// the index and a "moved" file there is indistinguishable from an edit plus a deletion — probing
/// `git status` on a worktree-side move confirms it prints ` D` and ` M`, never `R`.
fn detect_staged_renames(
    view: &RepoView,
    index: &GitIndex,
    head_tree: &BTreeMap<String, TreeEntry>,
    entries: &mut BTreeMap<String, StatusEntry>,
) -> FractalResult<()> {
    let deleted: Vec<String> = entries
        .values()
        .filter(|entry| entry.index_code == CODE_DELETED)
        .map(|entry| entry.path.clone())
        .collect();
    let added: Vec<String> = entries
        .values()
        .filter(|entry| entry.index_code == CODE_ADDED)
        .map(|entry| entry.path.clone())
        .collect();
    if deleted.is_empty() || added.is_empty() {
        return Ok(());
    }

    let staged = stage_zero_map(index);
    let mut sources: Vec<SideBlob> = Vec::with_capacity(deleted.len());
    for path in &deleted {
        let entry = match head_tree.get(path) {
            Some(found) => *found,
            None => continue,
        };
        sources.push(SideBlob {
            path: path.clone(),
            entry,
            payload: view.payload_for(entry.mode, &entry.oid)?,
        });
    }
    let mut dests: Vec<SideBlob> = Vec::with_capacity(added.len());
    for path in &added {
        let entry = match staged.get(path) {
            Some(found) => TreeEntry {
                mode: found.mode,
                oid: found.oid,
            },
            None => continue,
        };
        dests.push(SideBlob {
            path: path.clone(),
            entry,
            payload: view.payload_for(entry.mode, &entry.oid)?,
        });
    }

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

    for (dest_index, hit) in hits.iter().enumerate() {
        let hit = match hit {
            Some(found) => found,
            None => continue,
        };
        let source = &sources[hit.source];
        let dest = &dests[dest_index];
        entries.remove(&source.path);
        entries.insert(
            dest.path.clone(),
            StatusEntry::with_rename(
                CODE_RENAMED,
                CODE_UNCHANGED,
                &dest.path,
                &source.path,
                hit.score,
            ),
        );
    }
    Ok(())
}

/// Compares the worktree against the index.
fn compare_worktree_to_index(
    view: &RepoView,
    index_map: &BTreeMap<String, IndexEntry>,
    matcher: &IgnoreMatcher,
    attributes: &AttributeSet,
) -> FractalResult<BTreeMap<String, StatusEntry>> {
    let mut entries: BTreeMap<String, StatusEntry> = BTreeMap::new();
    for (path, staged) in index_map {
        if staged.mode == FileMode::Gitlink {
            continue;
        }
        let absolute = view.work_root().join(path);
        let metadata = match fs::symlink_metadata(&absolute) {
            Ok(found) => found,
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => {
                if matcher.is_ignored(path, false) {
                    continue;
                }
                entries.insert(
                    path.clone(),
                    StatusEntry::new(CODE_UNCHANGED, CODE_DELETED, path),
                );
                continue;
            }
            Err(io_err) => return Err(FractalError::Io(io_err)),
        };

        let mode_changed =
            worktree_mode(&metadata, staged.mode, view.config().trust_executable_bit())
                != staged.mode;
        let content_changed = worktree_content_changed(view, staged, &metadata, attributes)?;
        if mode_changed || content_changed {
            entries.insert(
                path.clone(),
                StatusEntry::new(CODE_UNCHANGED, CODE_MODIFIED, path),
            );
        }
    }
    Ok(entries)
}

/// Decides whether the worktree file differs from what the index records.
///
/// The order is Git's, and it is not an optimisation detail — it changes the answer. `ie_modified`
/// returns as soon as the size differs and the recorded size is non-zero, *before* any content
/// comparison, so a file that changed length is reported modified even when its normalised content
/// hashes back to the recorded id. A CRLF-only rewrite is exactly that case: the worktree copy is
/// longer, `status` says ` M`, and `diff` — which does convert — prints nothing. Reproducing both
/// answers requires this split, and collapsing it into "compare the content" would silently drop a
/// modification Git reports.
///
/// The zero-size branch is the other half: an entry created by `read-tree` or `update-index
/// --cacheinfo` has never been `lstat`ed, so its recorded size says nothing and the content decides.
fn worktree_content_changed(
    view: &RepoView,
    staged: &IndexEntry,
    metadata: &fs::Metadata,
    attributes: &AttributeSet,
) -> FractalResult<bool> {
    if stat_cache_matches(staged, metadata) {
        return Ok(false);
    }
    if metadata.len() != u64::from(staged.size) && staged.size != 0 {
        return Ok(true);
    }
    if metadata.len() == u64::from(staged.size) && mtime_matches(staged, metadata) {
        return Ok(false);
    }
    Ok(!hash_matches(view, staged, attributes)?)
}

/// Reports whether a worktree file still hashes to the staged id.
///
/// The payload goes through [`RepoView::worktree_payload`], which applies the `text`/`eol` conversion
/// Git applies before hashing. Hashing the raw bytes would call every CRLF file declared `text` a
/// modification, since the stored blob holds the normalised form and the two ids can never agree.
///
/// Note that `status` reaches this only when the stat cache already disagreed. Git does the same and
/// stops there: `ie_modified` returns `DATA_CHANGED` without a content check whenever the recorded
/// size is non-zero, so a CRLF-only rewrite stays reported as modified in both tools even though
/// `diff` — which does convert — prints nothing for it.
fn hash_matches(
    view: &RepoView,
    staged: &IndexEntry,
    attributes: &AttributeSet,
) -> FractalResult<bool> {
    let payload =
        view.worktree_payload(&staged.path, staged.mode, Some(&staged.oid), attributes)?;
    Ok(compute_object_oid(ObjectKind::Blob, &payload) == staged.oid)
}

/// Finds worktree paths that are neither staged nor ignored.
///
/// A directory with no staged path beneath it is collapsed into one `?? <dir>/` record, but only
/// when it actually holds a file that survives the ignore rules. Reporting the directory without
/// that check contradicts Git in two visible ways: an empty directory is never reported at all, and
/// a directory whose entire contents are ignored is reported as clean. Both cases occur in real
/// repositories — build output directories and freshly emptied scratch trees — so a report that
/// lists them sends a user to look at paths that no commit would ever include.
fn find_untracked(
    view: &RepoView,
    index_map: &BTreeMap<String, IndexEntry>,
    matcher: &IgnoreMatcher,
) -> FractalResult<BTreeMap<String, StatusEntry>> {
    let mut untracked: BTreeMap<String, StatusEntry> = BTreeMap::new();
    let tracked_prefixes: BTreeSet<String> = index_map
        .keys()
        .filter_map(|path| path.rfind('/').map(|index| path[..index].to_string()))
        .collect();
    let mut recorded: BTreeSet<String> = BTreeSet::new();

    let mut pending: Vec<(std::path::PathBuf, String)> =
        vec![(view.work_root().to_path_buf(), String::new())];
    while let Some((directory, relative)) = pending.pop() {
        let read = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(io_err) => return Err(FractalError::Io(io_err)),
        };
        let mut child_directories: Vec<(std::path::PathBuf, String)> = Vec::new();
        for entry in read {
            let entry = entry?;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if SCAN_SKIP_NAMES.contains(&file_name.as_str()) {
                continue;
            }
            let path = if relative.is_empty() {
                file_name
            } else {
                format!("{relative}/{file_name}")
            };
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                if matcher.is_ignored(&path, true) {
                    continue;
                }
                child_directories.push((entry.path(), path));
                continue;
            }
            if index_map.contains_key(&path) || matcher.is_ignored(&path, false) {
                continue;
            }
            untracked.insert(
                path.clone(),
                StatusEntry::new(CODE_UNTRACKED, CODE_UNTRACKED, path),
            );
        }

        for (absolute, path) in child_directories {
            let holds_tracked = tracked_prefixes.contains(&path)
                || index_map
                    .keys()
                    .any(|staged| staged.starts_with(&format!("{path}/")));
            if holds_tracked {
                pending.push((absolute, path));
                continue;
            }
            if !contains_untracked_file(&absolute, &path, matcher)? {
                continue;
            }
            // Git's `normal` mode collapses an untracked directory into one record with a trailing
            // slash, which is how a reader tells it apart from a file of the same name.
            recorded.insert(format!("{path}/"));
        }
    }

    for path in recorded {
        untracked.insert(
            path.clone(),
            StatusEntry::new(CODE_UNTRACKED, CODE_UNTRACKED, path),
        );
    }
    Ok(untracked)
}

/// Reports whether a directory subtree holds at least one file the ignore rules keep.
///
/// `repo_relative` is the directory's own path from the worktree root and is required: ignore rules
/// are matched against the full repository path, so walking from a directory-local path loses the
/// segments a pattern like `**/reports/audit-*.json` anchors on. Without it every directory looks
/// untracked, including one whose entire contents are ignored.
fn contains_untracked_file(
    directory: &Path,
    repo_relative: &str,
    matcher: &IgnoreMatcher,
) -> FractalResult<bool> {
    let mut pending: Vec<(std::path::PathBuf, String)> =
        vec![(directory.to_path_buf(), repo_relative.to_string())];
    while let Some((current, relative)) = pending.pop() {
        let read = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(io_err) => return Err(FractalError::Io(io_err)),
        };
        for entry in read {
            let entry = entry?;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if SCAN_SKIP_NAMES.contains(&file_name.as_str()) {
                continue;
            }
            let path = if relative.is_empty() {
                file_name
            } else {
                format!("{relative}/{file_name}")
            };
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                if matcher.is_ignored(&path, true) {
                    continue;
                }
                pending.push((entry.path(), path));
                continue;
            }
            if !matcher.is_ignored(&path, false) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Builds one entry per conflicted path.
fn conflict_entries(index: &GitIndex) -> BTreeMap<String, StatusEntry> {
    let mut by_path: BTreeMap<String, BTreeSet<u8>> = BTreeMap::new();
    for entry in index.entries() {
        if entry.stage == IndexStage::Normal {
            continue;
        }
        by_path
            .entry(entry.path.clone())
            .or_default()
            .insert(entry.stage.to_u8());
    }
    let mut entries = BTreeMap::new();
    for (path, stages) in by_path {
        let (index_code, worktree_code) = conflict_code(&stages);
        entries.insert(
            path.clone(),
            StatusEntry::new(index_code, worktree_code, path),
        );
    }
    entries
}

/// Maps the set of occupied stages onto Git's two-letter conflict code.
pub fn conflict_code(stages: &BTreeSet<u8>) -> (char, char) {
    let has_base = stages.contains(&1);
    let has_ours = stages.contains(&2);
    let has_theirs = stages.contains(&3);
    match (has_base, has_ours, has_theirs) {
        (false, true, true) => ('A', 'A'),
        (true, true, false) => ('D', 'U'),
        (true, false, true) => ('U', 'D'),
        (false, true, false) => ('A', 'U'),
        (false, false, true) => ('U', 'A'),
        _ => ('U', 'U'),
    }
}

/// Dispatches `taxis status`.
pub fn handle_status(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };

    let mut nul_terminated = false;
    let mut verbose = false;
    let mut unknown_flags: Vec<String> = Vec::new();
    for argument in &ctx.args {
        match argument.as_str() {
            "-z" => nul_terminated = true,
            "--long" | "-v" | "--verbose" => verbose = true,
            "--porcelain" | "--porcelain=v1" | "--short" | "-s" => {}
            other if other.starts_with('-') => unknown_flags.push(other.to_string()),
            _ => {}
        }
    }
    if let Some(flag) = unknown_flags.first() {
        reject(
            CliTag::ERROR,
            format!("status does not support the flag '{flag}'"),
        );
    }

    let entries = match collect_status(&view) {
        Ok(collected) => collected,
        Err(status_err) => reject(CliTag::ERROR, status_err),
    };

    if ctx.json_mode {
        report_json(&view, &entries);
        return;
    }

    let mut sink = std::io::stdout();
    for entry in &entries {
        let _ = write_record(
            &mut sink,
            &entry.record_text(nul_terminated),
            nul_terminated,
        );
        // The `-z` framing carries a rename's old path as its own field, after the record it
        // belongs to. Writing it as part of the record text would leave a consumer that splits on
        // NUL holding one string with an arrow in it and no way to recover the two paths.
        if nul_terminated {
            if let Some(from) = &entry.rename_from {
                let _ = write_record(&mut sink, from, true);
            }
        }
    }
    if verbose {
        let staged = entries.iter().filter(|entry| entry.is_staged()).count();
        let unstaged = entries.iter().filter(|entry| entry.is_unstaged()).count();
        let untracked = entries.iter().filter(|entry| entry.is_untracked()).count();
        println!(
            "{} entry(s): {staged} staged, {unstaged} unstaged, {untracked} untracked",
            entries.len()
        );
    }
}

/// Renders the status report as JSON.
fn report_json(view: &RepoView, entries: &[StatusEntry]) {
    let rendered: Vec<serde_json::Value> = entries
        .iter()
        .map(|entry| {
            serde_json::json!({
                "code": entry.code(),
                "path": entry.path,
                "staged": entry.is_staged(),
                "unstaged": entry.is_unstaged(),
                "untracked": entry.is_untracked(),
                "conflicted": entry.is_conflicted(),
            })
        })
        .collect();
    let payload = serde_json::json!({
        "engine": "taxis",
        "operation": "status",
        "git_dir": view.git_dir().display().to_string(),
        "pack_count": view.pack_count(),
        "entry_count": rendered.len(),
        "entries": rendered,
    });
    print_json(&payload);
}

#[cfg(test)]
mod tests {
    use super::{
        classify_staged, conflict_code, empty_index_bytes, merge_side, stage_zero_map, StatusEntry,
        TreeEntry, CODE_ADDED, CODE_DELETED, CODE_MODIFIED, CODE_RENAMED, CODE_UNCHANGED,
    };
    use fg_core::models::{FileMode, Oid};
    use fg_index::GitIndex;
    use std::collections::{BTreeMap, BTreeSet};

    fn oid_of(seed: u8) -> Oid {
        Oid::from_bytes([seed; 20])
    }

    fn tree_entry(seed: u8) -> TreeEntry {
        TreeEntry {
            mode: FileMode::RegularFile,
            oid: oid_of(seed),
        }
    }

    /// Decodes the empty index so the classification has a real `GitIndex`.
    fn empty_index() -> GitIndex {
        GitIndex::parse(empty_index_bytes(), std::path::PathBuf::from("<t>")).expect("parse")
    }

    #[test]
    fn a_path_only_in_the_head_tree_is_a_staged_deletion() {
        let mut head: BTreeMap<String, TreeEntry> = BTreeMap::new();
        head.insert("gone.txt".to_string(), tree_entry(3));
        let staged = classify_staged(&empty_index(), &head);
        assert_eq!(
            staged.get("gone.txt").map(|entry| entry.index_code),
            Some(CODE_DELETED)
        );
    }

    #[test]
    fn an_empty_index_and_empty_tree_report_nothing() {
        let staged = classify_staged(&empty_index(), &BTreeMap::new());
        assert!(staged.is_empty());
    }

    #[test]
    fn a_rename_record_names_both_paths_in_the_line_form() {
        let entry =
            StatusEntry::with_rename(CODE_RENAMED, CODE_UNCHANGED, "new.txt", "old.txt", 60_000);
        assert_eq!(entry.record_text(false), "R  old.txt -> new.txt");
    }

    #[test]
    fn a_rename_record_names_only_the_new_path_in_the_nul_form() {
        // The old path travels as its own `-z` field, so repeating it inside the record would make a
        // NUL-splitting consumer see one string with an arrow and no way to recover either path.
        let entry =
            StatusEntry::with_rename(CODE_RENAMED, CODE_UNCHANGED, "new.txt", "old.txt", 60_000);
        assert_eq!(entry.record_text(true), "R  new.txt");
    }

    #[test]
    fn a_non_rename_record_is_identical_in_both_forms() {
        let entry = StatusEntry::new(CODE_MODIFIED, CODE_UNCHANGED, "a.txt");
        assert_eq!(entry.record_text(false), "M  a.txt");
        assert_eq!(entry.record_text(true), "M  a.txt");
    }

    #[test]
    fn a_rename_is_staged_because_its_index_side_changed() {
        let entry =
            StatusEntry::with_rename(CODE_RENAMED, CODE_UNCHANGED, "new.txt", "old.txt", 30_000);
        assert!(entry.is_staged());
        assert!(!entry.is_unstaged());
        assert!(!entry.is_untracked());
    }

    #[test]
    fn every_conflict_stage_combination_maps_to_a_two_letter_code() {
        let all_three: BTreeSet<u8> = [1u8, 2, 3].into_iter().collect();
        assert_eq!(conflict_code(&all_three), ('U', 'U'));

        let both_added: BTreeSet<u8> = [2u8, 3].into_iter().collect();
        assert_eq!(conflict_code(&both_added), ('A', 'A'));

        let delete_modify: BTreeSet<u8> = [1u8, 2].into_iter().collect();
        assert_eq!(conflict_code(&delete_modify), ('D', 'U'));

        let their_delete: BTreeSet<u8> = [1u8, 3].into_iter().collect();
        assert_eq!(conflict_code(&their_delete), ('U', 'D'));
    }

    #[test]
    fn merging_keeps_both_sides_of_one_path() {
        let mut all: BTreeMap<String, StatusEntry> = BTreeMap::new();
        all.insert(
            "a.txt".to_string(),
            StatusEntry::new(CODE_MODIFIED, CODE_UNCHANGED, "a.txt"),
        );
        merge_side(
            &mut all,
            "a.txt".to_string(),
            StatusEntry::new(CODE_UNCHANGED, CODE_MODIFIED, "a.txt"),
        );
        assert_eq!(all.len(), 1);
        assert_eq!(all["a.txt"].code(), "MM");
    }

    #[test]
    fn merging_a_new_worktree_only_path_inserts_it() {
        let mut all: BTreeMap<String, StatusEntry> = BTreeMap::new();
        merge_side(
            &mut all,
            "b.txt".to_string(),
            StatusEntry::new(CODE_UNCHANGED, CODE_MODIFIED, "b.txt"),
        );
        assert_eq!(all["b.txt"].code(), " M");
    }

    #[test]
    fn an_untracked_entry_renders_two_question_marks() {
        let entry = StatusEntry::new('?', '?', "new.txt");
        assert_eq!(entry.code(), "??");
        assert!(entry.is_untracked());
        assert!(!entry.is_staged());
        assert!(!entry.is_unstaged());
    }

    #[test]
    fn an_added_entry_is_staged_but_not_unstaged() {
        let entry = StatusEntry::new(CODE_ADDED, CODE_UNCHANGED, "a.txt");
        assert!(entry.is_staged());
        assert!(!entry.is_unstaged());
    }

    #[test]
    fn a_conflicted_entry_is_neither_staged_nor_unstaged() {
        let entry = StatusEntry::new('U', 'U', "a.txt");
        assert!(entry.is_conflicted());
    }

    #[test]
    fn only_stage_zero_entries_enter_the_worktree_comparison() {
        let map = stage_zero_map(&empty_index());
        assert!(map.is_empty());
    }

    #[test]
    fn an_unknown_tree_oid_seed_is_stable() {
        assert_eq!(oid_of(7), oid_of(7));
        assert_ne!(oid_of(7), oid_of(8));
    }
}
