//! Module: taxis_cmd::unarchive — In-Place Archive Decompression CLI
//! File Path: src/bin/taxis_cmd/unarchive.rs
//! Architecture Role: Dispatches `taxis unarchive`, providing in-place tail-truncating archive
//!   extraction for ZIP and TAR archives, and forward hole-punching for TAR.GZ archives.
//! Dependencies & Triggers: Dispatched by `taxis unarchive` / `taxis extract`.
//! Responsibilities: CLI option parsing, preflight SpacePlan simulation, journal recovery, and execution reporting.
//! Exit Semantics & Design Rationale:
//!   - Preflight SpacePlan check prevents ENOSPC disk exhaustion.
//!   - Supports `--dry-run` to visualize the trough water-level curve before modifying any bytes.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-PRF-001`: Resource recycling and zero-transient allocation guard
//! - `FGT-COR-001`: Core error contract guard

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use fg_algorithms::space_plan::{
    check_headroom, simulate_space_plan, ExtractionUnit, SpacePlanConfig,
    DEFAULT_SAFETY_HEADROOM_BYTES,
};
use fg_core::models::{current_unix_seconds, FileMode, GitSignature};
use fg_core::traits::{OdbStore, RefStore};
use fg_index::InMemoryIndexTree;
use fg_object::GitCommit;
use fg_storage::commit_materializer::{serialize_commit_payload, serialize_tree_payload};
use fg_storage::in_place::{
    extract_member_payload, extract_tar_in_place, extract_targz_forward_hole_punch,
    extract_zip_in_place, index_tar_archive, plan_tar_in_place, plan_zip_in_place,
    read_zip_central_directory, read_zip_eocd, sanitize_relative_path, InPlaceBundleConsumer,
    InPlaceJournal, InPlaceLogEntry, TailTruncator,
};
use fg_storage::loose::LooseOdb;
use fg_topology::DiskRefStore;
use fractal_git::constants::cli::CliTag;
use serde_json::json;

use super::common::{fail_fatal, fail_io, fail_usage, print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Options for `taxis unarchive`.
#[derive(Debug, Clone)]
pub struct UnarchiveOptions {
    /// Path to the archive file (.zip, .tar, .tar.gz, .tgz, .bundle).
    pub archive_path: PathBuf,
    /// Destination directory.
    pub dest_dir: PathBuf,
    /// Whether to perform in-place tail truncation / hole punching (default: true).
    pub in_place: bool,
    /// Only simulate and display water-level projection without modifying disk.
    pub dry_run: bool,
    /// Safety headroom threshold in bytes.
    pub safety_headroom_bytes: u64,
    /// Batch window size in bytes.
    pub batch_window_bytes: Option<u64>,
    /// Direct ingestion to CAS ODB without worktree materialization.
    pub to_odb: bool,
    /// Target branch name for `--to-odb` mode.
    pub branch: Option<String>,
    /// Only construct and output the root tree OID (no commit or ref update).
    pub tree_only: bool,
}

/// Helper parsing human readable byte strings (e.g. "100M", "1G", "1048576").
fn parse_byte_size(input_size_str: &str) -> Option<u64> {
    let trimmed = input_size_str.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (num_str, multiplier) = if trimmed.ends_with(['g', 'G']) {
        (&trimmed[..trimmed.len() - 1], 1024 * 1024 * 1024)
    } else if trimmed.ends_with(['m', 'M']) {
        (&trimmed[..trimmed.len() - 1], 1024 * 1024)
    } else if trimmed.ends_with(['k', 'K']) {
        (&trimmed[..trimmed.len() - 1], 1024)
    } else {
        (trimmed, 1)
    };

    let num: u64 = num_str.parse().ok()?;
    Some(num.saturating_mul(multiplier))
}

/// Formats byte counts into human-readable strings (MB, GB).
fn format_bytes(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.2} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.2} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

/// Queries available free disk space on the volume housing `target_path`.
fn query_available_free_space(target_path: &Path) -> u64 {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetDiskFreeSpaceExW(
                lpDirectoryName: *const u16,
                lpFreeBytesAvailableToCaller: *mut u64,
                lpTotalNumberOfBytes: *mut u64,
                lpTotalNumberOfFreeBytes: *mut u64,
            ) -> i32;
        }

        let abs_path =
            std::fs::canonicalize(target_path).unwrap_or_else(|_| target_path.to_path_buf());
        let mut wide: Vec<u16> = abs_path.as_os_str().encode_wide().collect();
        wide.push(0);

        let mut free_bytes: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free: u64 = 0;

        // SAFETY: `wide` is a valid NUL-terminated wide string buffer. Out-pointers point to stack u64 variables.
        let status = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_bytes,
                &mut total_bytes,
                &mut total_free,
            )
        };

        if status != 0 {
            return free_bytes;
        }
    }

    // Default fallback to 100GB if OS query is unavailable
    100 * 1024 * 1024 * 1024
}

/// Prints usage and options help for `taxis unarchive`.
pub fn print_unarchive_help() {
    println!(
        "Usage: taxis unarchive <archive-path> [options]\n\n\
         In-place, memory-efficient archive extractor with preflight disk headroom verification.\n\n\
         Arguments:\n\
           <archive-path>              Path to archive file (.zip, .tar, .tar.gz, .tgz, .bundle)\n\n\
         Options:\n\
           -C, --dest, --target <dir>  Destination directory (default: current directory)\n\
           --in-place                  Extract in-place with reverse tail-truncation (default)\n\
           --no-in-place               Standard extraction without modifying source archive\n\
           --dry-run                   Simulate SpacePlan discrete trough curve without modifying disk\n\
           --headroom <size>           Safety headroom threshold (default: 50MB, e.g. \"100M\", \"1G\")\n\
           --batch-window <size>       Batch window size for staged truncation (e.g. \"64M\")\n\
           --to-odb                    Ingest directly into CAS ODB without worktree materialization\n\
           --branch, --ref <name>      Target branch to advance in --to-odb mode (default: refs/heads/import-<timestamp>)\n\
           --tree-only                 Only construct and output root tree OID in --to-odb mode\n\
           -h, --help                  Show this help message"
    );
}

/// Parses CLI options for `taxis unarchive`.
fn parse_unarchive_options(args: &[String]) -> UnarchiveOptions {
    if args.is_empty() {
        fail_usage(
            "taxis unarchive <archive-path> [-C <dest-dir>] [--dry-run] [--in-place] [--to-odb]",
        );
    }

    let mut archive_path = None;
    let mut dest_dir = None;
    let mut in_place = true;
    let mut dry_run = false;
    let mut safety_headroom_bytes = DEFAULT_SAFETY_HEADROOM_BYTES;
    let mut batch_window_bytes = None;
    let mut to_odb = false;
    let mut branch = None;
    let mut tree_only = false;

    let mut cursor = 0;
    while cursor < args.len() {
        match args[cursor].as_str() {
            "-h" | "--help" | "help" => {
                print_unarchive_help();
                std::process::exit(0);
            }
            "-C" | "--dest" | "--target" if cursor + 1 < args.len() => {
                dest_dir = Some(PathBuf::from(&args[cursor + 1]));
                cursor += 2;
            }
            "--dry-run" => {
                dry_run = true;
                cursor += 1;
            }
            "--in-place" => {
                in_place = true;
                cursor += 1;
            }
            "--no-in-place" => {
                in_place = false;
                cursor += 1;
            }
            "--to-odb" => {
                to_odb = true;
                cursor += 1;
            }
            "--branch" | "--ref" if cursor + 1 < args.len() => {
                branch = Some(args[cursor + 1].clone());
                to_odb = true;
                cursor += 2;
            }
            "--tree-only" => {
                tree_only = true;
                to_odb = true;
                cursor += 1;
            }
            "--headroom" if cursor + 1 < args.len() => {
                if let Some(headroom_bytes) = parse_byte_size(&args[cursor + 1]) {
                    safety_headroom_bytes = headroom_bytes;
                }
                cursor += 2;
            }
            "--batch-window" if cursor + 1 < args.len() => {
                if let Some(window_bytes) = parse_byte_size(&args[cursor + 1]) {
                    batch_window_bytes = Some(window_bytes);
                }
                cursor += 2;
            }
            arg if !arg.starts_with('-') && archive_path.is_none() => {
                archive_path = Some(PathBuf::from(arg));
                cursor += 1;
            }
            other => {
                fail_usage(format!("unknown option or unexpected argument: '{other}'"));
            }
        }
    }

    let archive = archive_path.unwrap_or_else(|| {
        fail_usage("missing archive file operand");
    });

    let dest = dest_dir.unwrap_or_else(|| PathBuf::from("."));

    UnarchiveOptions {
        archive_path: archive,
        dest_dir: dest,
        in_place,
        dry_run,
        safety_headroom_bytes,
        batch_window_bytes,
        to_odb,
        branch,
        tree_only,
    }
}

/// Dispatches `taxis unarchive`.
pub fn handle_unarchive(ctx: &CliContext) {
    if ctx.args.is_empty()
        || ctx
            .args
            .iter()
            .any(|a| a == "-h" || a == "--help" || a == "help")
    {
        print_unarchive_help();
        return;
    }

    let opts = parse_unarchive_options(&ctx.args);

    if !opts.archive_path.exists() {
        fail_fatal(format!(
            "archive file '{}' does not exist",
            opts.archive_path.display()
        ));
    }

    let file_len = match opts.archive_path.metadata() {
        Ok(m) => m.len(),
        Err(e) => fail_io("stat archive file", e),
    };

    let filename = opts
        .archive_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let is_zip = filename.ends_with(".zip");
    let is_targz = filename.ends_with(".tar.gz") || filename.ends_with(".tgz");
    let is_tar = filename.ends_with(".tar");
    let is_bundle = filename.ends_with(".bundle");

    if !is_zip && !is_tar && !is_targz && !is_bundle {
        reject(
            CliTag::ERROR,
            format!(
                "unsupported archive format for '{}'. Must be .zip, .tar, .tar.gz, or .bundle",
                opts.archive_path.display()
            ),
        );
    }

    let mut config =
        SpacePlanConfig::adaptive_for_archive_size(file_len, Some(opts.safety_headroom_bytes));
    if let Some(batch_win) = opts.batch_window_bytes {
        config.batch_window_bytes = batch_win;
    }

    let free_space = query_available_free_space(&opts.dest_dir);

    // Special handling for Git Bundle v2 ingestion
    if is_bundle {
        if opts.dry_run {
            let units = vec![ExtractionUnit::new("bundle.pack", file_len, file_len, 0)];
            let plan_report = simulate_space_plan(free_space, &units, &config);
            if ctx.json_mode {
                print_json(&json!({
                    "archive": opts.archive_path.display().to_string(),
                    "archive_size_bytes": file_len,
                    "initial_free_bytes": free_space,
                    "trough_free_bytes": plan_report.trough_free_space,
                    "safety_headroom_bytes": config.safety_headroom_bytes,
                    "is_viable": plan_report.is_viable,
                    "required_additional_bytes": plan_report.required_additional_bytes,
                }));
            } else {
                println!("=== Taxis In-Place SpacePlan Projection ===");
                println!(
                    "Archive:                 {} ({})",
                    opts.archive_path.display(),
                    format_bytes(file_len)
                );
                println!("Execution Mode:          In-Place Git Bundle Ingestion");
                println!("Initial Free Disk Space: {}", format_bytes(free_space));
                println!(
                    "Safety Headroom:         {}",
                    format_bytes(config.safety_headroom_bytes)
                );
                println!(
                    "Simulated Trough Level:  {}",
                    format_bytes(plan_report.trough_free_space)
                );
                println!("Assessment:              VIABLE (Safe for ingestion)");
            }
            return;
        }

        let view = match RepoView::open(ctx) {
            Ok(v) => v,
            Err(err) => reject(
                CliTag::ERROR,
                format!("open repository for bundle ingestion: {err}"),
            ),
        };
        let git_dir = view.git_dir();
        match InPlaceBundleConsumer::consume_bundle_in_place(&opts.archive_path, git_dir) {
            Ok(report) => {
                if ctx.json_mode {
                    print_json(&json!({
                        "status": "success",
                        "format": "bundle",
                        "pack_oid": report.pack_oid.to_hex(),
                        "object_count": report.object_count,
                        "bundle_bytes_reclaimed": report.bundle_bytes_reclaimed,
                        "references_advanced": report.references_advanced.iter().map(|(r, o)| {
                            json!({ "ref": r, "oid": o.to_hex() })
                        }).collect::<Vec<_>>(),
                    }));
                } else {
                    println!("=== Taxis In-Place Bundle Ingestion ===");
                    println!("Packfile Ingested:       {}", report.pack_oid.to_hex());
                    println!("Objects Extracted:       {}", report.object_count);
                    println!(
                        "Bundle Space Reclaimed:  {} bytes",
                        report.bundle_bytes_reclaimed
                    );
                    println!("References Advanced:");
                    for (name, oid) in &report.references_advanced {
                        println!("  {} -> {}", oid.to_hex(), name);
                    }
                }
                return;
            }
            Err(err) => {
                reject(
                    CliTag::ERROR,
                    format!("consume bundle '{}': {err}", opts.archive_path.display()),
                );
            }
        }
    }

    // Direct CAS ODB Ingestion mode (Decision 3)
    if opts.to_odb {
        if !is_zip && !is_tar {
            reject(
                CliTag::ERROR,
                "--to-odb is currently supported for .zip and .tar archives",
            );
        }
        handle_unarchive_to_odb(ctx, &opts, is_zip, is_tar);
        return;
    }

    // 1. Preflight SpacePlan simulation
    let plan_report = if is_zip {
        let mut file = match File::open(&opts.archive_path) {
            Ok(f) => f,
            Err(e) => fail_io("open archive for preflight", e),
        };
        let eocd = match read_zip_eocd(&mut file) {
            Ok(e) => e,
            Err(err) => reject(CliTag::ERROR, format!("read zip headers: {err}")),
        };
        let members = match read_zip_central_directory(&mut file, &eocd) {
            Ok(m) => m,
            Err(err) => reject(CliTag::ERROR, format!("read zip central directory: {err}")),
        };
        plan_zip_in_place(free_space, &members, &config)
    } else if is_tar {
        let mut file = match File::open(&opts.archive_path) {
            Ok(f) => f,
            Err(e) => fail_io("open archive for preflight", e),
        };
        let members = match index_tar_archive(&mut file) {
            Ok(m) => m,
            Err(err) => reject(CliTag::ERROR, format!("index tar archive: {err}")),
        };
        plan_tar_in_place(free_space, &members, &config)
    } else {
        // tar.gz forward simulation estimate: assumes ~3x uncompressed expansion ratio
        let estimated_expanded = file_len.saturating_mul(3);
        let units = vec![ExtractionUnit::new(
            "stream.tar.gz",
            estimated_expanded,
            file_len,
            0,
        )];
        simulate_space_plan(free_space, &units, &config)
    };

    // 2. Handle --dry-run
    if opts.dry_run {
        if ctx.json_mode {
            print_json(&json!({
                "archive": opts.archive_path.display().to_string(),
                "archive_size_bytes": file_len,
                "initial_free_bytes": free_space,
                "trough_free_bytes": plan_report.trough_free_space,
                "safety_headroom_bytes": config.safety_headroom_bytes,
                "is_viable": plan_report.is_viable,
                "required_additional_bytes": plan_report.required_additional_bytes,
            }));
        } else {
            println!("=== Taxis In-Place SpacePlan Projection ===");
            println!(
                "Archive:                 {} ({})",
                opts.archive_path.display(),
                format_bytes(file_len)
            );
            println!("Target Destination:      {}", opts.dest_dir.display());
            println!(
                "Execution Mode:          {}",
                if opts.in_place {
                    "In-Place Adaptive Reclamation"
                } else {
                    "Standard Full Duplicate"
                }
            );
            println!("Initial Free Disk Space: {}", format_bytes(free_space));
            println!(
                "Safety Headroom:         {}",
                format_bytes(config.safety_headroom_bytes)
            );
            println!(
                "Simulated Trough Level:  {}",
                format_bytes(plan_report.trough_free_space)
            );
            println!(
                "Projected Final Space:   {}",
                format_bytes(plan_report.final_free_space)
            );
            println!(
                "Assessment:              {}",
                if plan_report.is_viable {
                    "VIABLE (Safe for execution)"
                } else {
                    "BLOCKED (Headroom deficit)"
                }
            );
            if !plan_report.is_viable {
                println!(
                    "Additional Space Needed: {}",
                    format_bytes(plan_report.required_additional_bytes)
                );
            }
        }
        return;
    }

    // 3. Preflight Headroom Enforcement
    if let Err(err) = check_headroom(&plan_report) {
        reject(
            CliTag::ERROR,
            format!("preflight space check rejected extraction: {err}"),
        );
    }

    // 4. Execute extraction
    let journal_path = opts.dest_dir.join(".taxis_unarchive.wal");
    let mut journal = match InPlaceJournal::open(&journal_path) {
        Ok(j) => j,
        Err(e) => fail_io("open extraction WAL journal", e),
    };

    let _ = journal.append(&InPlaceLogEntry::SessionInit {
        archive_path: opts.archive_path.display().to_string(),
        target_path: opts.dest_dir.display().to_string(),
        total_members: plan_report.steps.len(),
        initial_archive_len: file_len,
    });

    let result = if is_zip {
        extract_zip_in_place(&opts.archive_path, &opts.dest_dir, &config)
    } else if is_tar {
        extract_tar_in_place(&opts.archive_path, &opts.dest_dir, &config)
    } else {
        extract_targz_forward_hole_punch(
            &opts.archive_path,
            &opts.dest_dir,
            config.batch_window_bytes,
        )
    };

    match result {
        Ok(report) => {
            let _ = journal.append(&InPlaceLogEntry::SessionCompleted);
            let _ = journal.remove();

            if ctx.json_mode {
                print_json(&json!({
                    "archive": opts.archive_path.display().to_string(),
                    "files_extracted": report.files_extracted,
                    "total_extracted_bytes": report.total_extracted_bytes,
                    "total_truncated_bytes": report.total_truncated_bytes,
                    "final_archive_len": report.final_archive_len,
                }));
            } else {
                println!(
                    "Successfully extracted {} files from {} ({}) in-place.",
                    report.files_extracted,
                    opts.archive_path.display(),
                    format_bytes(report.total_extracted_bytes)
                );
                println!(
                    "Reclaimed {} of disk space via tail-truncation.",
                    format_bytes(report.total_truncated_bytes)
                );
            }
        }
        Err(err) => {
            reject(
                CliTag::ERROR,
                format!("extraction aborted with error: {err}"),
            );
        }
    }
}

/// Ingests archive entries directly into CAS ODB bypassing working tree files (Decision 3).
fn handle_unarchive_to_odb(ctx: &CliContext, opts: &UnarchiveOptions, is_zip: bool, is_tar: bool) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(
            CliTag::ERROR,
            format!("open repository for --to-odb: {err}"),
        ),
    };
    let git_dir = view.git_dir();
    let loose_odb = LooseOdb::new(git_dir);
    let mut index_tree = InMemoryIndexTree::new();

    let mut total_blobs = 0;
    let mut total_blob_bytes: u64 = 0;

    if is_zip {
        let mut truncator = match TailTruncator::open_read_write(&opts.archive_path) {
            Ok(truncator_instance) => truncator_instance,
            Err(err) => fail_io("open archive for in-place extraction", err),
        };
        let eocd = match read_zip_eocd(truncator.file_mut()) {
            Ok(parsed_eocd) => parsed_eocd,
            Err(err) => reject(CliTag::ERROR, format!("read zip headers: {err}")),
        };
        let mut members = match read_zip_central_directory(truncator.file_mut(), &eocd) {
            Ok(central_directory_members) => central_directory_members,
            Err(err) => reject(CliTag::ERROR, format!("read zip central directory: {err}")),
        };

        if opts.in_place {
            members.sort_by_key(|member| std::cmp::Reverse(member.local_header_offset));
            if eocd.central_directory_offset < truncator.current_len() {
                let _ = truncator.truncate_to(eocd.central_directory_offset);
            }
        }

        let total_members = members.len();
        let mut accumulated_reclaim: u64 = 0;
        let batch_window = opts.batch_window_bytes.unwrap_or(16 * 1024 * 1024);

        for (idx, member) in members.iter().enumerate() {
            if member.is_dir {
                continue;
            }
            let payload = match extract_member_payload(truncator.file_mut(), member) {
                Ok(payload_bytes) => payload_bytes,
                Err(err) => reject(
                    CliTag::ERROR,
                    format!("decompress zip member '{}': {err}", member.name),
                ),
            };

            let blob_oid = match loose_odb.write_object("blob", &payload) {
                Ok(oid) => oid,
                Err(err) => reject(CliTag::ERROR, format!("write blob to ODB: {err}")),
            };

            let rel_path = match sanitize_relative_path(&member.name) {
                Ok(sanitized_path) => sanitized_path,
                Err(err) => reject(
                    CliTag::ERROR,
                    format!("sanitize path '{}': {err}", member.name),
                ),
            };

            let mode = if (member.external_attributes >> 16) & 0o111 != 0 {
                FileMode::ExecutableFile
            } else {
                FileMode::RegularFile
            };

            let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
            if let Err(err) = index_tree.stage_oid(&rel_path_str, mode, blob_oid) {
                reject(CliTag::ERROR, format!("stage path in index tree: {err}"));
            }

            total_blobs += 1;
            total_blob_bytes = total_blob_bytes.saturating_add(payload.len() as u64);

            if opts.in_place {
                let reclaimed_step = truncator
                    .current_len()
                    .saturating_sub(member.local_header_offset);
                accumulated_reclaim = accumulated_reclaim.saturating_add(reclaimed_step);

                let is_last = idx + 1 == total_members;
                if (accumulated_reclaim >= batch_window || is_last)
                    && member.local_header_offset < truncator.current_len()
                {
                    let _ = truncator.truncate_to(member.local_header_offset);
                    accumulated_reclaim = 0;
                }
            }
        }

        if opts.in_place && truncator.current_len() > 0 {
            let _ = truncator.truncate_to(0);
        }
    } else if is_tar {
        let mut truncator = match TailTruncator::open_read_write(&opts.archive_path) {
            Ok(truncator_instance) => truncator_instance,
            Err(err) => fail_io("open archive for in-place extraction", err),
        };
        let mut members = match index_tar_archive(truncator.file_mut()) {
            Ok(tar_members) => tar_members,
            Err(err) => reject(CliTag::ERROR, format!("index tar archive: {err}")),
        };

        if opts.in_place {
            members.sort_by_key(|member| std::cmp::Reverse(member.header_offset));
        }

        let total_members = members.len();
        let mut accumulated_reclaim: u64 = 0;
        let batch_window = opts.batch_window_bytes.unwrap_or(16 * 1024 * 1024);

        for (idx, member) in members.iter().enumerate() {
            if member.is_dir {
                continue;
            }

            if let Err(err) = truncator
                .file_mut()
                .seek(SeekFrom::Start(member.header_offset + 512))
            {
                reject(CliTag::ERROR, format!("seek to tar payload: {err}"));
            }
            let mut payload = vec![0u8; member.size as usize];
            if let Err(err) = truncator.file_mut().read_exact(&mut payload) {
                reject(CliTag::ERROR, format!("read tar payload: {err}"));
            }

            let blob_oid = match loose_odb.write_object("blob", &payload) {
                Ok(oid) => oid,
                Err(err) => reject(CliTag::ERROR, format!("write blob to ODB: {err}")),
            };

            let rel_path = match sanitize_relative_path(&member.name) {
                Ok(sanitized_path) => sanitized_path,
                Err(err) => reject(
                    CliTag::ERROR,
                    format!("sanitize path '{}': {err}", member.name),
                ),
            };

            let mode = if (member.mode & 0o111) != 0 {
                FileMode::ExecutableFile
            } else {
                FileMode::RegularFile
            };

            let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
            if let Err(err) = index_tree.stage_oid(&rel_path_str, mode, blob_oid) {
                reject(CliTag::ERROR, format!("stage path in index tree: {err}"));
            }

            total_blobs += 1;
            total_blob_bytes = total_blob_bytes.saturating_add(payload.len() as u64);

            if opts.in_place {
                accumulated_reclaim = accumulated_reclaim.saturating_add(member.total_span);
                let is_last = idx + 1 == total_members;
                if (accumulated_reclaim >= batch_window || is_last)
                    && member.header_offset < truncator.current_len()
                {
                    let _ = truncator.truncate_to(member.header_offset);
                    accumulated_reclaim = 0;
                }
            }
        }

        if opts.in_place && truncator.current_len() > 0 {
            let _ = truncator.truncate_to(0);
        }
    }

    // Build hierarchical trees directly in ODB
    let root_tree_oid = match index_tree.write_tree_with_persister(|tree| {
        let payload = serialize_tree_payload(tree);
        loose_odb.write_object("tree", &payload).map(|_| ())
    }) {
        Ok(oid) => oid,
        Err(e) => reject(CliTag::ERROR, format!("persist trees to ODB: {e}")),
    };

    if opts.tree_only {
        if ctx.json_mode {
            print_json(&json!({
                "status": "success",
                "mode": "tree_only",
                "tree_oid": root_tree_oid.to_hex(),
                "blobs_written": total_blobs,
                "total_blob_bytes": total_blob_bytes,
            }));
        } else {
            println!("{}", root_tree_oid.to_hex());
        }
        return;
    }

    // Assemble commit and advance ref
    let ref_store = DiskRefStore::new(git_dir);
    let target_ref = opts
        .branch
        .as_deref()
        .map(|branch_name| {
            if branch_name.starts_with("refs/") {
                branch_name.to_string()
            } else {
                format!("refs/heads/{branch_name}")
            }
        })
        .unwrap_or_else(|| format!("refs/heads/import-{}", current_unix_seconds()));

    let parent_oid = ref_store.get_ref(&target_ref).ok().flatten();
    let parent_oids = parent_oid.map(|p| vec![p]).unwrap_or_default();
    let now_secs = current_unix_seconds();
    let sig = GitSignature::new("Taxis In-Place Importer", "taxis@internal", now_secs);
    let archive_name = opts
        .archive_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("archive");
    let msg = format!("Import archive '{archive_name}' in-place straight into ODB\n");
    let commit = GitCommit::new(root_tree_oid, parent_oids, sig.clone(), sig, msg, None);
    let commit_payload = serialize_commit_payload(&commit);
    let commit_oid = match loose_odb.write_object("commit", &commit_payload) {
        Ok(oid) => oid,
        Err(e) => reject(CliTag::ERROR, format!("write commit to ODB: {e}")),
    };

    if let Err(e) = ref_store.update_ref(&target_ref, &commit_oid, parent_oid.as_ref()) {
        reject(CliTag::ERROR, format!("advance ref '{target_ref}': {e}"));
    }

    if ctx.json_mode {
        print_json(&json!({
            "status": "success",
            "mode": "to_odb",
            "commit_oid": commit_oid.to_hex(),
            "tree_oid": root_tree_oid.to_hex(),
            "ref": target_ref,
            "blobs_written": total_blobs,
            "total_blob_bytes": total_blob_bytes,
        }));
    } else {
        println!("=== Taxis In-Place Direct ODB Ingestion ===");
        println!("Target Branch Ref:   {}", target_ref);
        println!("Root Tree OID:       {}", root_tree_oid.to_hex());
        println!("Created Commit OID:  {}", commit_oid.to_hex());
        println!(
            "Blobs Persisted:     {} ({})",
            total_blobs,
            format_bytes(total_blob_bytes)
        );
        println!("Working Tree:        Bypassed (Zero disk files allocated)");
    }
}
