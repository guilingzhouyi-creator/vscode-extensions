//! Module: taxis_cmd::ls_files — Detailed Index and Working Tree File Enumeration
//! File Path: src/bin/taxis_cmd/ls_files.rs
//! Architecture Role: Implements standard Git `ls-files` with full flag selection:
//!   cached, modified, deleted, untracked (others), unmerged, and ignored filters.
//! Dependencies & Triggers: Dispatched by `taxis ls-files`.
//! Responsibilities: High-performance filesystem walk, index comparison, ignore rule filtering,
//!   and stage-formatted or plain path rendering.
//! Exit Semantics & Design Rationale:
//!   - Defaults to `-c` (cached) if no selection flag is specified.
//!   - Multiple selection flags (`-c`, `-d`, `-m`, `-o`, `-u`) are additive, exactly matching Git.
//!   - Supports `-s` / `--stage` for DIRC slot inspection and `-z` for NUL termination.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Subcommand gate and CLI surface guard

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use fg_core::models::{compute_object_oid, IndexStage, ObjectKind};
use fg_index::{IgnoreMatcher, IndexEntry};
use fractal_git::constants::cli::CliTag;

use super::common::{fail_fatal, print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::tree_view::write_record;

/// Options parsed from command-line arguments for `ls-files`.
#[derive(Debug, Default, Clone)]
struct LsFilesOptions {
    show_cached: bool,
    show_deleted: bool,
    show_modified: bool,
    show_others: bool,
    show_unmerged: bool,
    show_ignored: bool,
    show_stage: bool,
    exclude_standard: bool,
    nul_terminated: bool,
    path_filters: Vec<String>,
}

impl LsFilesOptions {
    fn parse(args: &[String]) -> Result<Self, String> {
        let mut opts = Self::default();
        let mut explicit_selection = false;

        for arg in args {
            match arg.as_str() {
                "-s" | "--stage" => {
                    opts.show_stage = true;
                    opts.show_cached = true;
                    explicit_selection = true;
                }
                "-z" => opts.nul_terminated = true,
                "-c" | "--cached" => {
                    opts.show_cached = true;
                    explicit_selection = true;
                }
                "-d" | "--deleted" => {
                    opts.show_deleted = true;
                    explicit_selection = true;
                }
                "-m" | "--modified" => {
                    opts.show_modified = true;
                    explicit_selection = true;
                }
                "-o" | "--others" => {
                    opts.show_others = true;
                    explicit_selection = true;
                }
                "-u" | "--unmerged" => {
                    opts.show_unmerged = true;
                    explicit_selection = true;
                }
                "-i" | "--ignored" => opts.show_ignored = true,
                "--exclude-standard" => opts.exclude_standard = true,
                other if other.starts_with('-') => {
                    return Err(format!("ls-files does not support the flag '{other}'"));
                }
                other => {
                    opts.path_filters.push(other.trim_end_matches('/').to_string());
                }
            }
        }

        if !explicit_selection {
            opts.show_cached = true;
        }

        Ok(opts)
    }
}

/// One rendered line entry produced by `ls-files`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct OutputEntry {
    path: String,
    stage_info: Option<(u32, String, u8)>,
}

impl OutputEntry {
    fn from_index(entry: &IndexEntry) -> Self {
        Self {
            path: entry.path.clone(),
            stage_info: Some((entry.mode.to_u32(), entry.oid.to_hex(), entry.stage.to_u8())),
        }
    }

    fn from_path(path: String) -> Self {
        Self { path, stage_info: None }
    }
}

/// Dispatches the `taxis ls-files` command.
pub fn handle_ls_files(ctx: &CliContext) {
    let opts = match LsFilesOptions::parse(&ctx.args) {
        Ok(parsed) => parsed,
        Err(err) => reject(CliTag::ERROR, err),
    };

    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };

    let index = match view.index() {
        Ok(loaded) => loaded,
        Err(load_err) => reject(CliTag::ERROR, load_err),
    };

    let staged_entries: &[IndexEntry] = match &index {
        Some(loaded) => loaded.entries(),
        None => &[],
    };

    let mut results: Vec<OutputEntry> = Vec::new();

    // 1. Unmerged entries (-u)
    if opts.show_unmerged {
        for entry in staged_entries {
            if entry.stage != IndexStage::Normal && matches_filters(&entry.path, &opts.path_filters) {
                results.push(OutputEntry::from_index(entry));
            }
        }
    }

    // 2. Cached entries (-c)
    if opts.show_cached {
        for entry in staged_entries {
            if matches_filters(&entry.path, &opts.path_filters) {
                results.push(OutputEntry::from_index(entry));
            }
        }
    }

    // 3. Deleted entries (-d)
    if opts.show_deleted {
        for entry in staged_entries {
            if entry.stage == IndexStage::Normal
                && matches_filters(&entry.path, &opts.path_filters)
                && !view.work_root().join(&entry.path).exists()
            {
                results.push(OutputEntry::from_path(entry.path.clone()));
            }
        }
    }

    // 4. Modified entries (-m)
    if opts.show_modified {
        for entry in staged_entries {
            if entry.stage == IndexStage::Normal
                && matches_filters(&entry.path, &opts.path_filters)
                && is_file_modified(view.work_root(), entry)
            {
                results.push(OutputEntry::from_path(entry.path.clone()));
            }
        }
    }

    // 5. Other untracked entries (-o)
    if opts.show_others {
        let tracked_paths: BTreeSet<&str> = staged_entries.iter().map(|e| e.path.as_str()).collect();
        let matcher = if opts.exclude_standard || opts.show_ignored {
            view.ignore_matcher().ok()
        } else {
            None
        };

        collect_others(
            view.work_root(),
            view.work_root(),
            &tracked_paths,
            matcher.as_ref(),
            opts.show_ignored,
            &opts.path_filters,
            &mut results,
        );
    }

    // Sort entries stably: path first, then stage if present
    results.sort_by(|a, b| {
        let path_cmp = a.path.cmp(&b.path);
        if path_cmp != std::cmp::Ordering::Equal {
            return path_cmp;
        }
        let a_stage = a.stage_info.as_ref().map(|(_, _, s)| *s).unwrap_or(0);
        let b_stage = b.stage_info.as_ref().map(|(_, _, s)| *s).unwrap_or(0);
        a_stage.cmp(&b_stage)
    });

    if ctx.json_mode {
        let rendered: Vec<serde_json::Value> = results
            .iter()
            .map(|entry| {
                if let Some((mode, oid, stage)) = &entry.stage_info {
                    serde_json::json!({
                        "path": entry.path,
                        "mode": format!("{:06o}", mode),
                        "oid": oid,
                        "stage": stage,
                    })
                } else {
                    serde_json::json!({ "path": entry.path })
                }
            })
            .collect();
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "ls-files",
            "count": rendered.len(),
            "entries": rendered,
        }));
        return;
    }

    let mut sink = std::io::stdout();
    for entry in results {
        let line = match &entry.stage_info {
            Some((mode, oid, stage)) if opts.show_stage || opts.show_unmerged => {
                format!("{:06o} {} {}\t{}", mode, oid, stage, entry.path)
            }
            _ => entry.path,
        };
        let _ = write_record(&mut sink, &line, opts.nul_terminated);
    }
}

/// Checks if an entry's relative path matches explicit positional path filters.
fn matches_filters(path: &str, filters: &[String]) -> bool {
    filters.is_empty()
        || filters
            .iter()
            .any(|filter| path == filter || path.starts_with(&format!("{filter}/")))
}

/// Checks whether an indexed file is modified in the physical worktree.
fn is_file_modified(work_root: &Path, entry: &IndexEntry) -> bool {
    let abs_path = work_root.join(&entry.path);
    let Ok(meta) = fs::symlink_metadata(&abs_path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    // Fast path: file size mismatch implies modification
    if meta.len() != entry.size as u64 {
        return true;
    }
    // Content hash comparison
    let Ok(bytes) = fs::read(&abs_path) else {
        return false;
    };
    let current_oid = compute_object_oid(ObjectKind::Blob, &bytes);
    current_oid != entry.oid
}

/// Recursively scans worktree for untracked and/or ignored files.
fn collect_others(
    work_root: &Path,
    current_dir: &Path,
    tracked: &BTreeSet<&str>,
    matcher: Option<&IgnoreMatcher>,
    show_ignored_only: bool,
    filters: &[String],
    results: &mut Vec<OutputEntry>,
) {
    let Ok(dir_entries) = fs::read_dir(current_dir) else {
        return;
    };

    let mut subdirs = Vec::new();

    for dir_entry in dir_entries.flatten() {
        let file_name = dir_entry.file_name();
        let name_str = file_name.to_string_lossy();
        if name_str == ".git" || name_str == ".taxis" {
            continue;
        }

        let child_path = dir_entry.path();
        let Ok(rel_path) = child_path.strip_prefix(work_root) else {
            continue;
        };
        let rel_str = rel_path.to_string_lossy().replace('\\', "/");

        let Ok(file_type) = dir_entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            let is_dir_ignored = matcher.is_some_and(|m| m.is_ignored(&rel_str, true));
            if !show_ignored_only && is_dir_ignored {
                // Whole directory ignored and not looking for ignored: skip descending
                continue;
            }
            subdirs.push(child_path);
        } else if file_type.is_file() || file_type.is_symlink() {
            if tracked.contains(rel_str.as_str()) {
                continue;
            }
            let is_file_ignored = matcher.is_some_and(|m| m.is_ignored(&rel_str, false));
            let keep = if show_ignored_only {
                is_file_ignored
            } else if matcher.is_some() {
                !is_file_ignored
            } else {
                true
            };

            if keep && matches_filters(&rel_str, filters) {
                results.push(OutputEntry::from_path(rel_str));
            }
        }
    }

    for subdir in subdirs {
        collect_others(
            work_root,
            &subdir,
            tracked,
            matcher,
            show_ignored_only,
            filters,
            results,
        );
    }
}
