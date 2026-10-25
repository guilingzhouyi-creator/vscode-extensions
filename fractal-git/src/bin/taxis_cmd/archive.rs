//! Module: taxis_cmd::archive — Native Archive Command Dispatcher
//! File Path: src/bin/taxis_cmd/archive.rs
//! Architecture Role: Dispatches `taxis archive`, packaging tree-ish object states into streaming
//!   Tar, Tar.gz, or Zip archives straight from the CAS ODB without disk worktree materialization.
//! Dependencies & Triggers: Dispatched by `taxis archive`.
//! Responsibilities: CLI option parsing, tree-ish resolution, recursive tree flattening, and streaming packaging.
//! Exit Semantics & Design Rationale:
//!   - Supports stdout streaming for standard shell pipes (`taxis archive HEAD | tar -t`).
//!   - Supports optional `-o <file>` destination and `--prefix <pfx>/` path namespaces.
//!   - Supports Tar, Tar.gz, and Zip formats.

use std::fs::File;
use std::io::{self, Write};
use std::path::PathBuf;

use fg_storage::archive::{ArchiveEntry, ArchiveFormat, ArchiveGenerator};
use fractal_git::constants::cli::CliTag;

use super::commit_walk::parse_commit_record;
use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::tree_view::flatten_commit_tree;

/// Options for `taxis archive`.
#[derive(Debug, Clone)]
struct ArchiveOptions {
    format: Option<ArchiveFormat>,
    prefix: Option<String>,
    output_path: Option<PathBuf>,
    tree_ish: String,
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

    // Extract commit timestamp for deterministic archive member mtimes
    let commit_time = if let Ok(obj) = view.object(&commit_oid) {
        if let Ok(rec) = parse_commit_record(commit_oid, &obj.payload) {
            rec.author_time
        } else {
            0
        }
    } else {
        0
    };

    // Flatten tree
    let files = match flatten_commit_tree(&view, &commit_oid) {
        Ok(f) => f,
        Err(err) => reject(
            CliTag::ERROR,
            format!("read tree for '{}': {err}", opts.tree_ish),
        ),
    };

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

    // Determine effective format
    let effective_format = opts.format.unwrap_or_else(|| {
        if let Some(ref out) = opts.output_path {
            let out_str = out.to_string_lossy();
            if out_str.ends_with(".zip") {
                ArchiveFormat::Zip
            } else if out_str.ends_with(".tar.gz") || out_str.ends_with(".tgz") {
                ArchiveFormat::TarGz
            } else {
                ArchiveFormat::Tar
            }
        } else {
            ArchiveFormat::Tar
        }
    });

    let prefix_ref = opts.prefix.as_deref();

    if let Some(ref out_file) = opts.output_path {
        let file = match File::create(out_file) {
            Ok(f) => f,
            Err(err) => reject(
                CliTag::ERROR,
                format!("create output file '{}': {err}", out_file.display()),
            ),
        };

        if let Err(err) =
            ArchiveGenerator::write_archive(effective_format, prefix_ref, &entries, file)
        {
            reject(CliTag::ERROR, format!("generate archive: {err}"));
        }

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
        // Stream to standard output
        let stdout = io::stdout();
        let mut handle = stdout.lock();

        if let Err(err) =
            ArchiveGenerator::write_archive(effective_format, prefix_ref, &entries, &mut handle)
        {
            reject(CliTag::ERROR, format!("stream archive to stdout: {err}"));
        }
        let _ = handle.flush();
    }
}

fn parse_archive_options(args: &[String]) -> ArchiveOptions {
    let mut format = None;
    let mut prefix = None;
    let mut output_path = None;
    let mut tree_ish = "HEAD".to_string();

    let mut cursor = 0;
    while cursor < args.len() {
        let arg = &args[cursor];
        if arg == "--format" && cursor + 1 < args.len() {
            format = ArchiveFormat::parse(&args[cursor + 1]);
            cursor += 2;
        } else if let Some(stripped) = arg.strip_prefix("--format=") {
            format = ArchiveFormat::parse(stripped);
            cursor += 1;
        } else if (arg == "--prefix" || arg == "-p") && cursor + 1 < args.len() {
            prefix = Some(args[cursor + 1].clone());
            cursor += 2;
        } else if let Some(stripped) = arg.strip_prefix("--prefix=") {
            prefix = Some(stripped.to_string());
            cursor += 1;
        } else if (arg == "--output" || arg == "-o") && cursor + 1 < args.len() {
            output_path = Some(PathBuf::from(&args[cursor + 1]));
            cursor += 2;
        } else if let Some(stripped) = arg.strip_prefix("--output=") {
            output_path = Some(PathBuf::from(stripped));
            cursor += 1;
        } else if !arg.starts_with('-') {
            tree_ish = arg.clone();
            cursor += 1;
        } else {
            cursor += 1;
        }
    }

    ArchiveOptions {
        format,
        prefix,
        output_path,
        tree_ish,
    }
}
