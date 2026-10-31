//! Module: taxis_cmd::archive — Native Archive Command Dispatcher
//! File Path: src/bin/taxis_cmd/archive.rs
//! Architecture Role: Dispatches `taxis archive`, packaging tree-ish object states into streaming
//!   Tar, Tar.gz, or Zip archives straight from the CAS ODB without disk worktree materialization.
//! Dependencies & Triggers: Dispatched by `taxis archive`.
//! Responsibilities: CLI option parsing, tree-ish resolution, recursive tree flattening,
//!   and streaming packaging.
//! Exit Semantics & Design Rationale:
//!   - Supports stdout streaming for standard shell pipes (`taxis archive HEAD | tar -t`).
//!   - Supports optional `-o <file>` destination and `--prefix <pfx>/` path namespaces.
//!   - Supports Tar, Tar.gz, and Zip formats.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, Write};
use std::path::PathBuf;

use fg_core::models::Oid;
use fg_storage::archive::{ArchiveEntry, ArchiveFormat, ArchiveGenerator};
use fractal_git::constants::cli::CliTag;

use super::commit_walk::parse_commit_record;
use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::tree_view::{flatten_commit_tree, TreeEntry};

const EXT_ZIP: &str = ".zip";
const EXT_TAR_GZ: &str = ".tar.gz";
const EXT_TGZ: &str = ".tgz";
const DEFAULT_TREE_ISH: &str = "HEAD";
const OPT_FORMAT: &str = "--format";
const PREFIX_EQ_FORMAT: &str = "--format=";
const OPT_PREFIX: &str = "--prefix";
const OPT_PREFIX_SHORT: &str = "-p";
const PREFIX_EQ_PREFIX: &str = "--prefix=";
const OPT_OUTPUT: &str = "--output";
const OPT_OUTPUT_SHORT: &str = "-o";
const PREFIX_EQ_OUTPUT: &str = "--output=";

/// Options for `taxis archive`.
#[derive(Debug, Clone)]
struct ArchiveOptions {
    format: Option<ArchiveFormat>,
    prefix: Option<String>,
    output_path: Option<PathBuf>,
    tree_ish: String,
}

/// Resolves the commit timestamp for deterministic archive member mtimes.
fn resolve_commit_timestamp(view: &RepoView, commit_oid: &Oid) -> i64 {
    view.object(commit_oid)
        .ok()
        .and_then(|obj| parse_commit_record(*commit_oid, &obj.payload).ok())
        .map(|rec| rec.author_time)
        .unwrap_or(0)
}

/// Infers the effective archive format from explicit options or output file extension.
fn determine_archive_format(opts: &ArchiveOptions) -> ArchiveFormat {
    if let Some(fmt) = opts.format {
        return fmt;
    }
    if let Some(ref out) = opts.output_path {
        let out_str = out.to_string_lossy();
        if out_str.ends_with(EXT_ZIP) {
            return ArchiveFormat::Zip;
        }
        if out_str.ends_with(EXT_TAR_GZ) || out_str.ends_with(EXT_TGZ) {
            return ArchiveFormat::TarGz;
        }
    }
    ArchiveFormat::Tar
}

/// Collects uncompressed archive entries and total byte footprint from tree entries.
fn collect_archive_entries(
    view: &RepoView,
    files: BTreeMap<String, TreeEntry>,
    commit_time: i64,
) -> (Vec<ArchiveEntry>, usize) {
    let mut entries = Vec::with_capacity(files.len());
    let mut total_uncompressed_bytes: usize = 0;

    for (file_path, tree_entry) in files {
        let payload = match view.blob_payload(&tree_entry.oid) {
            Ok(p) => p,
            Err(err) => reject(CliTag::ERROR, format!("read blob '{}': {err}", file_path)),
        };

        total_uncompressed_bytes += payload.len();
        entries.push(ArchiveEntry {
            path: file_path,
            mode: tree_entry.mode as u32,
            mtime: commit_time,
            payload,
        });
    }

    (entries, total_uncompressed_bytes)
}

/// Writes generated archive contents to a target file on disk.
fn write_archive_to_file(
    format: ArchiveFormat,
    prefix: Option<&str>,
    entries: &[ArchiveEntry],
    out_file: &PathBuf,
) {
    let file = match File::create(out_file) {
        Ok(f) => f,
        Err(err) => reject(
            CliTag::ERROR,
            format!("create output file '{}': {err}", out_file.display()),
        ),
    };

    if let Err(err) = ArchiveGenerator::write_archive(format, prefix, entries, file) {
        reject(CliTag::ERROR, format!("generate archive: {err}"));
    }
}

/// Streams generated archive contents directly to standard output for piping.
fn stream_archive_to_stdout(
    format: ArchiveFormat,
    prefix: Option<&str>,
    entries: &[ArchiveEntry],
) {
    let stdout = io::stdout();
    let mut handle = stdout.lock();

    if let Err(err) = ArchiveGenerator::write_archive(format, prefix, entries, &mut handle) {
        reject(CliTag::ERROR, format!("stream archive to stdout: {err}"));
    }
    let _ = handle.flush();
}

/// Dispatches `taxis archive`.
pub fn handle_archive(ctx: &CliContext) {
    let opts = parse_archive_options(&ctx.args);

    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let commit_oid = match view.resolve(&opts.tree_ish) {
        Ok(oid) => oid,
        Err(err) => reject(
            CliTag::ERROR,
            format!("resolve revision '{}': {err}", opts.tree_ish),
        ),
    };

    let commit_time = resolve_commit_timestamp(&view, &commit_oid);
    let files = match flatten_commit_tree(&view, &commit_oid) {
        Ok(f) => f,
        Err(err) => reject(
            CliTag::ERROR,
            format!("read tree for '{}': {err}", opts.tree_ish),
        ),
    };

    let (entries, total_uncompressed_bytes) = collect_archive_entries(&view, files, commit_time);
    let effective_format = determine_archive_format(&opts);
    dispatch_archive_target(effective_format, &opts, &entries, total_uncompressed_bytes, ctx);
}

/// Dispatches archive generation either to a disk file or stdout stream.
fn dispatch_archive_target(
    effective_format: ArchiveFormat,
    opts: &ArchiveOptions,
    entries: &[ArchiveEntry],
    total_uncompressed_bytes: usize,
    ctx: &CliContext,
) {
    let prefix_ref = opts.prefix.as_deref();
    if let Some(ref out_file) = opts.output_path {
        write_archive_to_file(effective_format, prefix_ref, entries, out_file);

        if ctx.json_mode {
            print_json(&serde_json::json!({
                "status": "success",
                "format": format!("{:?}", effective_format),
                "output": out_file.to_string_lossy(),
                "entries": entries.len(),
                "uncompressed_bytes": total_uncompressed_bytes,
                "tree_ish": opts.tree_ish,
            }));
        }
    } else {
        stream_archive_to_stdout(effective_format, prefix_ref, entries);
    }
}

fn try_parse_format_option(
    opts: &mut ArchiveOptions,
    args: &[String],
    cursor: usize,
    arg: &str,
) -> Option<usize> {
    if arg == OPT_FORMAT && cursor + 1 < args.len() {
        opts.format = ArchiveFormat::parse(&args[cursor + 1]);
        Some(cursor + 2)
    } else {
        arg.strip_prefix(PREFIX_EQ_FORMAT).map(|stripped| {
            opts.format = ArchiveFormat::parse(stripped);
            cursor + 1
        })
    }
}

fn try_parse_prefix_option(
    opts: &mut ArchiveOptions,
    args: &[String],
    cursor: usize,
    arg: &str,
) -> Option<usize> {
    if (arg == OPT_PREFIX || arg == OPT_PREFIX_SHORT) && cursor + 1 < args.len() {
        opts.prefix = Some(args[cursor + 1].clone());
        Some(cursor + 2)
    } else {
        arg.strip_prefix(PREFIX_EQ_PREFIX).map(|stripped| {
            opts.prefix = Some(stripped.to_string());
            cursor + 1
        })
    }
}

fn try_parse_output_option(
    opts: &mut ArchiveOptions,
    args: &[String],
    cursor: usize,
    arg: &str,
) -> Option<usize> {
    if (arg == OPT_OUTPUT || arg == OPT_OUTPUT_SHORT) && cursor + 1 < args.len() {
        opts.output_path = Some(PathBuf::from(&args[cursor + 1]));
        Some(cursor + 2)
    } else {
        arg.strip_prefix(PREFIX_EQ_OUTPUT).map(|stripped| {
            opts.output_path = Some(PathBuf::from(stripped));
            cursor + 1
        })
    }
}

/// Steps through CLI argument parsing cursor with early-return branching.
fn step_parse_archive_option(opts: &mut ArchiveOptions, args: &[String], cursor: usize) -> usize {
    let arg = &args[cursor];
    if let Some(next) = try_parse_format_option(opts, args, cursor, arg) {
        return next;
    }
    if let Some(next) = try_parse_prefix_option(opts, args, cursor, arg) {
        return next;
    }
    if let Some(next) = try_parse_output_option(opts, args, cursor, arg) {
        return next;
    }
    if !arg.starts_with('-') {
        opts.tree_ish = arg.clone();
    }
    cursor + 1
}

fn parse_archive_options(args: &[String]) -> ArchiveOptions {
    let mut opts = ArchiveOptions {
        format: None,
        prefix: None,
        output_path: None,
        tree_ish: DEFAULT_TREE_ISH.to_string(),
    };

    let mut cursor = 0;
    while cursor < args.len() {
        cursor = step_parse_archive_option(&mut opts, args, cursor);
    }
    opts
}
