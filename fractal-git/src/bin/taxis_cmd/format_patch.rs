//! Module: taxis_cmd::format_patch — Format Patch Generation
//! File Path: src/bin/taxis_cmd/format_patch.rs
//! Architecture Role: Implements `git format-patch`, exporting commits as email-formatted
//!   mbox patches for local patch sharing, audit trails, and `taxis am` consumption.
//! Dependencies & Triggers: Dispatched by `taxis format-patch`.
//! Responsibilities: Resolve commit ranges chronologically, generate unified diffs and stat
//!   summaries, format RFC 2822 email headers, and write `.patch` files or stdout stream.
//! Exit Semantics & Design Rationale:
//!   - Produces Git-compliant mbox format `From <oid> Mon Sep 17 00:00:00 2001`.
//!   - Exits 0 on success, 1 on invalid ranges or I/O failure.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-ALG-001`: Unified patch generation

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use chrono::{FixedOffset, TimeZone, Utc};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;

use super::commit_walk::{parse_commit_record, walk_commits, CommitRecord};
use super::common::{fail_fatal, fail_usage, CliContext};
use super::diff::{collect_comparisons, DiffRequest, DiffScope, EMPTY_TREE_MARKER};
use super::diff_render::render_text_to_writer;
use super::repo_view::RepoView;

/// Options parsed from command line for `taxis format-patch`.
struct FormatPatchOptions {
    output_dir: PathBuf,
    to_stdout: bool,
    numbered: bool,
    start_number: usize,
    suffix: String,
    range_specs: Vec<String>,
    count_limit: Option<usize>,
}

/// Dispatches `taxis format-patch`.
pub fn handle_format_patch(ctx: &CliContext) {
    let opts = parse_format_patch_args(&ctx.args);
    let view = RepoView::open_or_exit(ctx);

    let commits = match resolve_commits_to_format(&view, &opts) {
        Ok(c) => c,
        Err(err) => fail_fatal(err),
    };

    if commits.is_empty() {
        return;
    }

    if !opts.to_stdout && !opts.output_dir.exists() {
        if let Err(err) = fs::create_dir_all(&opts.output_dir) {
            fail_fatal(format!(
                "could not create output directory '{}': {err}",
                opts.output_dir.display()
            ));
        }
    }

    let total = commits.len();
    for (index, record) in commits.iter().enumerate() {
        let patch_number = opts.start_number + index;
        let formatted = match format_single_patch(&view, record, patch_number, total, opts.numbered)
        {
            Ok(bytes) => bytes,
            Err(err) => fail_fatal(err),
        };

        if opts.to_stdout {
            let _ = std::io::stdout().write_all(&formatted);
        } else {
            let filename = generate_patch_filename(patch_number, record.subject(), &opts.suffix);
            let file_path = opts.output_dir.join(&filename);
            if let Err(err) = fs::write(&file_path, &formatted) {
                fail_fatal(format!(
                    "failed writing patch file '{}': {err}",
                    file_path.display()
                ));
            }
            println!("{}", file_path.display());
        }
    }
}

/// Parses CLI flags and positional arguments.
fn parse_format_patch_args(args: &[String]) -> FormatPatchOptions {
    let mut output_dir = PathBuf::from(".");
    let mut to_stdout = false;
    let mut numbered = false;
    let mut start_number = 1usize;
    let mut suffix = ".patch".to_string();
    let mut range_specs = Vec::new();
    let mut count_limit = None;

    let mut cursor = 0;
    while cursor < args.len() {
        let arg = &args[cursor];
        match arg.as_str() {
            "-o" | "--output-directory" => {
                cursor += 1;
                let Some(dir) = args.get(cursor) else {
                    fail_usage("format-patch: missing directory after -o");
                };
                output_dir = PathBuf::from(dir);
            }
            "--stdout" => to_stdout = true,
            "-n" | "--numbered" => numbered = true,
            "-N" | "--no-numbered" => numbered = false,
            other if other.starts_with("--start-number=") => {
                let text = other.strip_prefix("--start-number=").unwrap_or("1");
                start_number = text.parse().unwrap_or(1);
            }
            other if other.starts_with("--suffix=") => {
                suffix = other.strip_prefix("--suffix=").unwrap_or(".patch").to_string();
            }
            other if other.starts_with('-') && other.len() > 1 && other[1..].chars().all(|c| c.is_ascii_digit()) => {
                let count: usize = other[1..].parse().unwrap_or(1);
                count_limit = Some(count);
            }
            other if other.starts_with('-') => {
                fail_usage(format!("format-patch: unknown option '{other}'"));
            }
            positional => {
                range_specs.push(positional.to_string());
            }
        }
        cursor += 1;
    }

    FormatPatchOptions {
        output_dir,
        to_stdout,
        numbered,
        start_number,
        suffix,
        range_specs,
        count_limit,
    }
}

/// Resolves commit records in oldest-to-newest chronological order.
fn resolve_commits_to_format(
    view: &RepoView,
    opts: &FormatPatchOptions,
) -> FractalResult<Vec<CommitRecord>> {
    let head = match view.head_commit()? {
        Some(oid) => oid,
        None => {
            if let Ok(oid) = view.resolve("refs/fractal/cell/cell-default/main") {
                oid
            } else {
                let starts = super::log::collect_all_starts(view)?;
                starts.first().copied().ok_or_else(|| {
                    FractalError::ObjectCodec("cannot format-patch on an unborn HEAD".to_string())
                })?
            }
        }
    };

    let (start_oid, exclude_oid) = if let Some(first_spec) = opts.range_specs.first() {
        if let Some((left, right)) = first_spec.split_once("..") {
            let left_oid = if left.is_empty() {
                head
            } else {
                view.resolve(left)?
            };
            let right_oid = if right.is_empty() {
                head
            } else {
                view.resolve(right)?
            };
            (right_oid, Some(left_oid))
        } else {
            let base_oid = view.resolve(first_spec)?;
            (head, Some(base_oid))
        }
    } else if let Some(limit) = opts.count_limit {
        let mut cur = head;
        let mut parents = Vec::new();
        for _ in 0..limit {
            let commit_obj = view.object(&cur)?;
            let rec = parse_commit_record(cur, &commit_obj.payload)?;
            if rec.parents.is_empty() {
                break;
            }
            cur = rec.parents[0];
            parents.push(cur);
        }
        (head, parents.last().copied())
    } else {
        return Err(FractalError::ObjectCodec(
            "format-patch requires a revision range or commit count".to_string(),
        ));
    };

    let walked = walk_commits(view, &[start_oid])?;
    let excluded_set: std::collections::HashSet<Oid> = if let Some(ex) = exclude_oid {
        walk_commits(view, &[ex])?
            .into_iter()
            .map(|r| r.oid)
            .collect()
    } else {
        std::collections::HashSet::new()
    };

    let mut filtered: Vec<CommitRecord> = walked
        .into_iter()
        .filter(|rec| !excluded_set.contains(&rec.oid))
        .collect();

    // Reorder oldest first
    filtered.reverse();

    if let Some(limit) = opts.count_limit {
        if filtered.len() > limit {
            let start = filtered.len() - limit;
            filtered = filtered[start..].to_vec();
        }
    }

    Ok(filtered)
}

/// Formats a single commit into mbox-compatible email bytes.
fn format_single_patch(
    view: &RepoView,
    record: &CommitRecord,
    patch_number: usize,
    total: usize,
    force_numbered: bool,
) -> FractalResult<Vec<u8>> {
    let mut out = Vec::new();

    // From line
    let _ = writeln!(out, "From {} Mon Sep 17 00:00:00 2001", record.oid.to_hex());
    let _ = writeln!(out, "From: {} <{}>", record.author_name, record.author_mailbox);
    let date_str = format_rfc2822(record.author_time, record.author_offset_minutes);
    let _ = writeln!(out, "Date: {date_str}");

    let prefix = if total > 1 || force_numbered {
        format!("[PATCH {patch_number}/{total}]")
    } else {
        "[PATCH]".to_string()
    };
    let _ = writeln!(out, "Subject: {prefix} {}", record.subject());
    let _ = writeln!(out);

    let body_lines: Vec<&str> = record.message.lines().skip(1).collect();
    let body_trimmed = body_lines.join("\n").trim().to_string();
    if !body_trimmed.is_empty() {
        let _ = writeln!(out, "{body_trimmed}");
    }
    let _ = writeln!(out, "---");

    // Diff against first parent or empty tree
    let parent_rev = record.parents.first().map(|p| p.to_hex()).unwrap_or_else(|| EMPTY_TREE_MARKER.to_string());
    let diff_req = DiffRequest {
        scope: DiffScope::Revisions,
        context: 3,
        revisions: vec![parent_rev, record.oid.to_hex()],
        nul_terminated: false,
        name_only: false,
        stat_only: false,
        no_prefix: false,
        exit_code: false,
        quiet: false,
    };

    let comparisons = collect_comparisons(view, &diff_req)?;
    let width = super::abbrev::abbreviation_width(view.approximate_object_count());

    // Stat block
    let mut stat_req = diff_req.clone();
    stat_req.stat_only = true;
    render_text_to_writer(&mut out, &stat_req, &comparisons, width);
    let _ = writeln!(out);

    // Patch body
    render_text_to_writer(&mut out, &diff_req, &comparisons, width);
    let _ = writeln!(out, "-- \ntaxis 0.1.0");

    Ok(out)
}

/// Generates standard 0001-slug.patch filename.
fn generate_patch_filename(number: usize, subject: &str, suffix: &str) -> String {
    let mut slug = String::new();
    let mut last_was_hyphen = false;
    for ch in subject.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_hyphen = false;
        } else if !last_was_hyphen && !slug.is_empty() {
            slug.push('-');
            last_was_hyphen = true;
        }
        if slug.len() >= 52 {
            break;
        }
    }
    let slug = slug.trim_end_matches('-');
    let slug = if slug.is_empty() { "patch" } else { slug };
    format!("{number:04}-{slug}{suffix}")
}

/// Formats a timestamp + timezone offset as RFC 2822.
fn format_rfc2822(seconds: i64, offset_minutes: i32) -> String {
    let offset_seconds = offset_minutes * 60;
    if let Some(offset) = FixedOffset::east_opt(offset_seconds) {
        if let Some(utc_dt) = Utc.timestamp_opt(seconds, 0).single() {
            let local_dt = utc_dt.with_timezone(&offset);
            return local_dt.to_rfc2822();
        }
    }
    format!("{seconds}")
}
