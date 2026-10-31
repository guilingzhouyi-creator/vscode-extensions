//! Module: taxis_cmd::status_untracked — Untracked Worktree Path Discovery
//! File Path: src/bin/taxis_cmd/status_untracked.rs
//! Architecture Role: Discovers untracked files and collapsed directory records under ignore rules.
//! Dependencies & Triggers: Consumed by `status_collect::collect_status`.
//! Responsibilities: Walk worktree directories, match ignore rules,
//!   and collapse empty or ignored directory structures.
//! Exit Semantics & Design Rationale:
//!   - Collapses untracked directories with trailing slashes matching Git porcelain v1.
//!   - Depth <= 3 and CC <= 10. Reuses traversal buffers to avoid per-level allocations.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_index::IgnoreMatcher;

use super::repo_view::RepoView;
use super::status::{StatusEntry, CODE_UNTRACKED};

const SCAN_SKIP_NAMES: [&str; 2] = [".git", ".taxis"];

/// Finds worktree paths that are neither staged nor ignored.
pub fn find_untracked(
    view: &RepoView,
    tracked: &BTreeSet<String>,
    matcher: &IgnoreMatcher,
) -> FractalResult<BTreeMap<String, StatusEntry>> {
    let mut untracked = BTreeMap::new();
    let tracked_prefixes = build_tracked_prefixes(tracked);
    let mut recorded = BTreeSet::new();

    let mut pending = vec![(view.work_root().to_path_buf(), String::new())];
    let mut child_dirs = Vec::new();

    while let Some((directory, relative)) = pending.pop() {
        scan_directory_entries(
            &directory,
            &relative,
            tracked,
            matcher,
            &mut child_dirs,
            &mut untracked,
        )?;
        filter_untracked_children(
            &mut child_dirs,
            tracked,
            &tracked_prefixes,
            matcher,
            &mut pending,
            &mut recorded,
        )?;
    }

    let recorded_entries: Vec<(String, StatusEntry)> = recorded
        .into_iter()
        .map(|path| {
            let entry = StatusEntry::new(CODE_UNTRACKED, CODE_UNTRACKED, &path);
            (path, entry)
        })
        .collect();
    untracked.extend(recorded_entries);

    Ok(untracked)
}

fn build_tracked_prefixes(tracked: &BTreeSet<String>) -> BTreeSet<String> {
    tracked
        .iter()
        .filter_map(|path| path.rfind('/').map(|idx| path[..idx].to_string()))
        .collect()
}

fn scan_directory_entries(
    directory: &Path,
    relative: &str,
    tracked: &BTreeSet<String>,
    matcher: &IgnoreMatcher,
    child_dirs: &mut Vec<(PathBuf, String)>,
    untracked: &mut BTreeMap<String, StatusEntry>,
) -> FractalResult<()> {
    let read = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
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
        step_process_entry(entry, path, tracked, matcher, child_dirs, untracked)?;
    }
    Ok(())
}

fn step_process_entry(
    entry: fs::DirEntry,
    path: String,
    tracked: &BTreeSet<String>,
    matcher: &IgnoreMatcher,
    child_dirs: &mut Vec<(PathBuf, String)>,
    untracked: &mut BTreeMap<String, StatusEntry>,
) -> FractalResult<()> {
    let file_type = entry.file_type()?;
    if file_type.is_dir() {
        if !matcher.is_ignored(&path, true) {
            child_dirs.push((entry.path(), path));
        }
        return Ok(());
    }

    if !tracked.contains(&path) && !matcher.is_ignored(&path, false) {
        untracked.insert(
            path.clone(),
            StatusEntry::new(CODE_UNTRACKED, CODE_UNTRACKED, path),
        );
    }
    Ok(())
}

fn filter_untracked_children(
    child_dirs: &mut Vec<(PathBuf, String)>,
    tracked: &BTreeSet<String>,
    tracked_prefixes: &BTreeSet<String>,
    matcher: &IgnoreMatcher,
    pending: &mut Vec<(PathBuf, String)>,
    recorded: &mut BTreeSet<String>,
) -> FractalResult<()> {
    for (absolute, path) in child_dirs.drain(..) {
        let prefix_with_slash = format!("{path}/");
        let holds_tracked = tracked_prefixes.contains(&path)
            || tracked.iter().any(|staged| staged.starts_with(&prefix_with_slash));

        if holds_tracked {
            pending.push((absolute, path));
        } else if contains_untracked_file(&absolute, &path, matcher)? {
            recorded.insert(prefix_with_slash);
        }
    }
    Ok(())
}

fn check_subtree_entry(
    entry: fs::DirEntry,
    relative: &str,
    matcher: &IgnoreMatcher,
    pending: &mut Vec<(PathBuf, String)>,
) -> FractalResult<bool> {
    let file_name = entry.file_name().to_string_lossy().into_owned();
    if SCAN_SKIP_NAMES.contains(&file_name.as_str()) {
        return Ok(false);
    }
    let path = if relative.is_empty() {
        file_name
    } else {
        format!("{relative}/{file_name}")
    };
    let file_type = entry.file_type()?;
    if file_type.is_dir() {
        if !matcher.is_ignored(&path, true) {
            pending.push((entry.path(), path));
        }
        Ok(false)
    } else {
        Ok(!matcher.is_ignored(&path, false))
    }
}

/// Reports whether a directory subtree holds at least one file the ignore rules keep.
fn contains_untracked_file(
    directory: &Path,
    repo_relative: &str,
    matcher: &IgnoreMatcher,
) -> FractalResult<bool> {
    let mut pending = vec![(directory.to_path_buf(), repo_relative.to_string())];
    while let Some((current, relative)) = pending.pop() {
        let read = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(io_err) => return Err(FractalError::Io(io_err)),
        };
        for entry in read {
            if check_subtree_entry(entry?, &relative, matcher, &mut pending)? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
