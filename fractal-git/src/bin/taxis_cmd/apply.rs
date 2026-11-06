//! Module: taxis_cmd::apply — Unified Diff Patch Application
//! File Path: src/bin/taxis_cmd/apply.rs
//! Architecture Role: Implements `git apply`, applying unified diffs to worktree and/or index.
//! Dependencies & Triggers: Dispatched by `taxis apply`, called by `taxis am`.
//! Responsibilities: Parse unified diff patches and hunks, perform context matching,
//!   execute dry-run `--check`, render `--stat`, and mutate worktree and staged index.
//! Exit Semantics & Design Rationale:
//!   - Exits 0 on successful application or `--check` pass.
//!   - Exits 1 with diagnostic on patch mismatch or hunk conflict.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-ALG-001`: Unified patch generation and application

use std::fs;
use std::io::{self, Read};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileMode, IndexStage};
use fg_index::{write_dirc_v2, IndexEntry};
use fg_storage::LooseOdb;
use fractal_git::OdbStore;

use super::common::{fail_fatal, fail_usage, CliContext};
use super::repo_view::RepoView;

/// Options for `taxis apply`.
#[derive(Debug, Clone)]
pub struct ApplyOptions {
    pub stat_only: bool,
    pub numstat: bool,
    pub check_only: bool,
    pub cached: bool,
    pub index: bool,
    pub reverse: bool,
    pub strip_leading: usize,
    pub files: Vec<String>,
}

pub use super::patch_parser::{parse_unified_diff, DiffHunk, FilePatch, HunkLine};

/// Dispatches `taxis apply`.
pub fn handle_apply(ctx: &CliContext) {
    let opts = parse_apply_args(&ctx.args);
    let view = RepoView::open_or_exit(ctx);

    let patch_bytes = match load_patch_payload(&opts.files) {
        Ok(b) => b,
        Err(err) => fail_fatal(err),
    };

    let patches = match parse_unified_diff(&patch_bytes, opts.strip_leading, opts.reverse) {
        Ok(p) => p,
        Err(err) => fail_fatal(err),
    };

    if opts.stat_only || opts.numstat {
        render_apply_stats(&patches, opts.numstat);
        return;
    }

    if let Err(err) = execute_apply(&view, &patches, &opts) {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

/// Parses CLI flags for `apply`.
fn parse_apply_args(args: &[String]) -> ApplyOptions {
    let mut opts = ApplyOptions {
        stat_only: false,
        numstat: false,
        check_only: false,
        cached: false,
        index: false,
        reverse: false,
        strip_leading: 1,
        files: Vec::new(),
    };

    let mut cursor = 0;
    while cursor < args.len() {
        let arg = &args[cursor];
        match arg.as_str() {
            "--stat" => opts.stat_only = true,
            "--numstat" => opts.numstat = true,
            "--check" => opts.check_only = true,
            "--cached" => opts.cached = true,
            "--index" => opts.index = true,
            "-R" | "--reverse" => opts.reverse = true,
            other if other.starts_with("-p") => {
                let num_str = other.strip_prefix("-p").unwrap_or("1");
                opts.strip_leading = num_str.parse().unwrap_or(1);
            }
            other if other.starts_with('-') && other != "-" => {
                fail_usage(format!("apply: unsupported option '{other}'"));
            }
            file => {
                opts.files.push(file.to_string());
            }
        }
        cursor += 1;
    }

    opts
}

/// Reads patch bytes from stdin or specified files.
fn load_patch_payload(files: &[String]) -> FractalResult<Vec<u8>> {
    if files.is_empty() || (files.len() == 1 && files[0] == "-") {
        let mut buf = Vec::new();
        io::stdin()
            .read_to_end(&mut buf)
            .map_err(|e| FractalError::ObjectCodec(format!("reading stdin patch failed: {e}")))?;
        return Ok(buf);
    }

    let mut combined = Vec::new();
    for path_str in files {
        let bytes = fs::read(path_str).map_err(|e| {
            FractalError::ObjectCodec(format!("could not read patch file '{path_str}': {e}"))
        })?;
        combined.extend_from_slice(&bytes);
        if !combined.ends_with(b"\n") {
            combined.push(b'\n');
        }
    }
    Ok(combined)
}

/// Executes patch application in dry-run or write mode.
pub fn execute_apply(
    view: &RepoView,
    patches: &[FilePatch],
    opts: &ApplyOptions,
) -> Result<(), String> {
    let odb = LooseOdb::new(view.git_dir());
    let mut staged_entries = match view.index() {
        Ok(Some(idx)) => idx.entries().to_vec(),
        _ => Vec::new(),
    };

    for patch in patches {
        apply_single_file_patch(view, patch, (opts, &odb, &mut staged_entries))?;
    }

    if (opts.cached || opts.index) && !opts.check_only {
        staged_entries.sort_by(|a, b| a.path.cmp(&b.path));
        let index_file = view.git_dir().join("index");
        write_dirc_v2(&index_file, &staged_entries)
            .map_err(|e| format!("failed updating index file: {e}"))?;
    }

    Ok(())
}

/// Applies one file patch to the worktree and/or staged index.
fn apply_single_file_patch(
    view: &RepoView,
    patch: &FilePatch,
    state: (&ApplyOptions, &LooseOdb, &mut Vec<IndexEntry>),
) -> Result<(), String> {
    let (opts, odb, staged_entries) = state;
    let target_path = patch
        .new_path
        .as_deref()
        .or(patch.old_path.as_deref())
        .ok_or_else(|| "patch specifies neither old nor new path".to_string())?;
    let disk_path = view.work_root().join(target_path);

    if patch.is_deleted {
        if !opts.cached && disk_path.exists() && !opts.check_only {
            let _ = fs::remove_file(&disk_path);
        }
        if (opts.cached || opts.index) && !opts.check_only {
            staged_entries.retain(|e| e.path != target_path);
        }
        return Ok(());
    }

    let existing_content =
        read_apply_target_content(view, (target_path, &disk_path), (opts, staged_entries))?;
    let new_content = apply_hunks_to_content(&existing_content, &patch.hunks, target_path)?;
    if opts.check_only {
        return Ok(());
    }

    if !opts.cached {
        if let Some(parent) = disk_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(&disk_path, new_content.as_bytes())
            .map_err(|e| format!("could not write to '{target_path}': {e}"))?;
    }

    if opts.cached || opts.index {
        let blob_oid = odb
            .write_object("blob", new_content.as_bytes())
            .map_err(|e| format!("ODB write failed: {e}"))?;
        staged_entries.retain(|e| e.path != target_path);
        staged_entries.push(IndexEntry {
            path: target_path.to_string(),
            mode: FileMode::RegularFile,
            oid: blob_oid,
            stage: IndexStage::Normal,
            size: new_content.len() as u32,
            mtime_seconds: 0,
            mtime_nanos: 0,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        });
    }
    Ok(())
}

/// Reads existing file content from either the staged index (`--cached`) or the working tree.
fn read_apply_target_content(
    view: &RepoView,
    target: (&str, &std::path::Path),
    state: (&ApplyOptions, &[IndexEntry]),
) -> Result<String, String> {
    let (target_path, disk_path) = target;
    let (opts, staged_entries) = state;
    if opts.cached {
        return Ok(staged_entries
            .iter()
            .find(|e| e.path == target_path)
            .and_then(|e| view.object(&e.oid).ok())
            .map(|o| String::from_utf8_lossy(&o.payload).into_owned())
            .unwrap_or_default());
    }
    if disk_path.exists() {
        fs::read_to_string(disk_path).map_err(|e| format!("cannot read '{target_path}': {e}"))
    } else {
        Ok(String::new())
    }
}

/// Applies parsed hunks to a string text.
pub fn apply_hunks_to_content(
    original: &str,
    hunks: &[DiffHunk],
    path_for_err: &str,
) -> Result<String, String> {
    if hunks.is_empty() {
        return Ok(original.to_string());
    }

    let orig_lines: Vec<&str> = if original.is_empty() {
        Vec::new()
    } else {
        original.lines().collect()
    };

    let mut result_lines = orig_lines.clone();
    let mut line_offset: isize = 0;
    let mut hunk_deletions = Vec::new();
    let mut hunk_additions = Vec::new();
    let mut hunk_contexts = Vec::new();

    for hunk in hunks {
        let expected_idx = (hunk.old_start as isize - 1 + line_offset).max(0) as usize;

        hunk_deletions.clear();
        hunk_additions.clear();
        hunk_contexts.clear();

        for line in &hunk.lines {
            match line {
                HunkLine::Context(c) => {
                    hunk_contexts.push(c.as_str());
                    hunk_additions.push(c.as_str());
                    hunk_deletions.push(c.as_str());
                }
                HunkLine::Deletion(d) => hunk_deletions.push(d.as_str()),
                HunkLine::Addition(a) => hunk_additions.push(a.as_str()),
            }
        }

        let del_len = hunk_deletions.len();
        let add_len = hunk_additions.len();

        let mut matched_idx = None;
        if expected_idx + del_len <= result_lines.len() {
            let slice = &result_lines[expected_idx..expected_idx + del_len];
            if slice == hunk_deletions.as_slice() {
                matched_idx = Some(expected_idx);
            }
        }

        if matched_idx.is_none() {
            if let Some(max_candidate) = result_lines.len().checked_sub(del_len) {
                for candidate in 0..=max_candidate {
                    if &result_lines[candidate..candidate + del_len] == hunk_deletions.as_slice() {
                        matched_idx = Some(candidate);
                        break;
                    }
                }
            }
        }

        let match_pos = matched_idx.ok_or_else(|| {
            format!(
                "error: patch failed: {path_for_err}:{}\nerror: {path_for_err}: patch does not apply",
                hunk.old_start
            )
        })?;

        result_lines.splice(
            match_pos..match_pos + del_len,
            hunk_additions.iter().copied(),
        );

        line_offset += (add_len as isize) - (del_len as isize);
    }

    let mut final_text = result_lines.join("\n");
    if original.ends_with('\n') || (original.is_empty() && !final_text.is_empty()) {
        final_text.push('\n');
    }
    Ok(final_text)
}

/// Renders diff statistics for `apply --stat` and `apply --numstat`.
fn render_apply_stats(patches: &[FilePatch], numstat: bool) {
    for patch in patches {
        let path = patch
            .new_path
            .as_deref()
            .or(patch.old_path.as_deref())
            .unwrap_or("unknown");

        let mut adds = 0;
        let mut dels = 0;
        for hunk in &patch.hunks {
            for line in &hunk.lines {
                match line {
                    HunkLine::Addition(_) => adds += 1,
                    HunkLine::Deletion(_) => dels += 1,
                    HunkLine::Context(_) => {}
                }
            }
        }

        if numstat {
            println!("{adds}\t{dels}\t{path}");
        } else {
            let total = adds + dels;
            let pluses = "+".repeat(adds.min(50));
            let minuses = "-".repeat(dels.min(50));
            println!(" {path:<30} | {total:>4} {pluses}{minuses}");
        }
    }
}
