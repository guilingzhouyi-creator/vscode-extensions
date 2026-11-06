//! Module: taxis_cmd::repack — Object Repack and Packfile Generator CLI
//! File Path: src/bin/taxis_cmd/repack.rs
//! Architecture Role: Dispatches `taxis repack` to consolidate loose Git objects into
//!   high-density Git Packfile v2 streams and Index v2 files.
//! Dependencies & Triggers: Dispatched by `taxis repack` / `taxis pack-objects`.
//! Responsibilities: Parse CLI flags, coordinate RepackEngine, and report progress in human/JSON format.
//! Exit Semantics & Design Rationale:
//!   - Zero-exit on clean repack or when no loose objects exist.
//!   - Supports `--async` for zero-blocking background auto-repack triggers.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-PRF-001`: Resource recycling and zero-transient allocation guard

use std::path::PathBuf;

use fg_storage::repack::REPACK_BLOCKED_MARKER;
use fg_storage::{RepackEngine, RepackOptions, RepackReport};
use serde_json::json;

use super::common::{fail_io, fail_usage, parse_byte_size, print_json, CliContext, EXIT_REJECTED};

/// Prints usage and options help for `taxis repack`.
pub fn print_repack_help() {
    println!(
        "Usage: taxis repack [options]\n\n\
         Consolidate loose Git objects into packfiles and Index v2.\n\n\
         Options:\n\
           -w, --window <size>     Sliding window size for delta search (default: 10)\n\
           -d, --max-depth <depth> Maximum delta chain depth (default: 50)\n\
           --low-disk              Progressively pack and purge loose objects in 64MB pack slices\n\
                                   (default; tune the slice size with --max-pack-size)\n\
           --max-pack-size <size>  Pack slice limit for --low-disk (default: 64M, minimum: 1M)\n\
           --micro-pack <size>     Compatibility alias for --max-pack-size\n\
           -k, --keep-loose        Keep loose objects on disk after creating packfile\n\
           --auto                  Only repack if loose object count exceeds threshold\n\
           --threshold <count>     Threshold for auto-repack (default: 50)\n\
           --async                 Spawn background worker thread\n\
           -h, --help              Show this help message"
    );
}

/// Parses command line options for `taxis repack`.
fn parse_repack_options(args: &[String]) -> (RepackOptions, bool, bool) {
    let mut options = RepackOptions::default();
    let mut is_async = false;
    let mut auto_check_only = false;

    let mut cursor = 0;
    while cursor < args.len() {
        cursor += apply_repack_option_token(
            args,
            cursor,
            (&mut options, &mut is_async, &mut auto_check_only),
        );
    }

    (options, is_async, auto_check_only)
}

/// Applies one option token for `taxis repack`, returning how many tokens were consumed.
fn apply_repack_option_token(
    args: &[String],
    cursor: usize,
    state: (&mut RepackOptions, &mut bool, &mut bool),
) -> usize {
    let (options, is_async, auto_check_only) = state;
    match args[cursor].as_str() {
        "-h" | "--help" | "help" => {
            print_repack_help();
            std::process::exit(0);
        }
        "--window" | "-w" if cursor + 1 < args.len() => {
            if let Ok(w) = args[cursor + 1].parse::<usize>() {
                options.window_size = w;
            }
            2
        }
        "--max-depth" if cursor + 1 < args.len() => {
            if let Ok(d) = args[cursor + 1].parse::<usize>() {
                options.max_depth = d;
            }
            2
        }
        "-d" if cursor + 1 < args.len() && args[cursor + 1].chars().all(|c| c.is_ascii_digit()) => {
            if let Ok(d) = args[cursor + 1].parse::<usize>() {
                options.max_depth = d;
            }
            2
        }
        "-d" => {
            options.keep_loose = false;
            1
        }
        "-a" | "-A" => 1,
        "--threshold" if cursor + 1 < args.len() => {
            if let Ok(t) = args[cursor + 1].parse::<usize>() {
                options.auto_repack_threshold = t;
            }
            2
        }
        "--keep-loose" | "-k" => {
            options.keep_loose = true;
            1
        }
        "--low-disk" => {
            options.low_disk = true;
            1
        }
        "--max-pack-size" | "--micro-pack" => {
            options.max_pack_bytes = parse_repack_pack_size(args, cursor);
            2
        }
        "--async" => {
            *is_async = true;
            1
        }
        "--auto" => {
            *auto_check_only = true;
            1
        }
        unknown if unknown.starts_with('-') => {
            fail_usage(format!(
                "unknown repack option '{unknown}' (see --help for the supported flags)"
            ));
        }
        _ => 1,
    }
}

/// Parses `--max-pack-size` / `--micro-pack` byte size argument.
fn parse_repack_pack_size(args: &[String], cursor: usize) -> u64 {
    let flag = args[cursor].as_str();
    let raw = match args.get(cursor + 1) {
        Some(value) => value.as_str(),
        None => fail_usage(format!("{flag} requires a size value (e.g. {flag} 64M)")),
    };
    match parse_byte_size(raw) {
        Some(bytes) if bytes >= 1024 * 1024 => bytes,
        Some(_) => fail_usage(format!(
            "{flag} {raw} is below the 1M floor required for slice verification"
        )),
        None => fail_usage(format!(
            "{flag} {raw} is not a byte size (expected e.g. 64M, 512K, 1048576)"
        )),
    }
}

/// Resolves the Git directory where objects reside.
fn resolve_git_dir(ctx: &CliContext) -> PathBuf {
    if ctx.git_dir.join("objects").is_dir() {
        ctx.git_dir.clone()
    } else if ctx.git_dir.join(".git").join("objects").is_dir() {
        ctx.git_dir.join(".git")
    } else {
        ctx.git_dir.clone()
    }
}

/// Dispatches the `taxis repack` CLI subcommand.
pub fn handle_repack(ctx: &CliContext) {
    if ctx
        .args
        .iter()
        .any(|a| a == "-h" || a == "--help" || a == "help")
    {
        print_repack_help();
        return;
    }

    let (options, is_async, auto_check_only) = parse_repack_options(&ctx.args);
    let target_dir = resolve_git_dir(ctx);

    if auto_check_only {
        let should_run =
            RepackEngine::should_auto_repack(&target_dir, options.auto_repack_threshold);
        if !should_run {
            if ctx.json_mode {
                print_json(&json!({
                    "status": "skipped",
                    "reason": "loose object count below threshold"
                }));
            } else {
                println!("Auto-repack: skipped (loose object count below threshold).");
            }
            return;
        }
    }

    if is_async {
        let _handle = RepackEngine::trigger_async_repack(target_dir, options);
        if ctx.json_mode {
            print_json(&json!({
                "status": "async_spawned",
                "message": "Background repack worker spawned successfully"
            }));
        } else {
            println!("Background repack worker spawned.");
        }
        return;
    }

    match RepackEngine::repack_repository(&target_dir, &options) {
        Ok(Some(report)) => {
            report_repack_success(ctx, &report);
        }
        Ok(None) => {
            if ctx.json_mode {
                print_json(&json!({
                    "status": "noop",
                    "message": "No loose objects found to repack"
                }));
            } else {
                println!("Nothing to pack: no loose objects found.");
            }
        }
        Err(err) => {
            let message = err.to_string();
            if message.contains(REPACK_BLOCKED_MARKER) {
                if ctx.json_mode {
                    print_json(&json!({
                        "status": "blocked",
                        "message": message
                    }));
                } else {
                    eprintln!("{}", message);
                }
                std::process::exit(EXIT_REJECTED);
            }
            fail_io(format!("repack repository '{}'", target_dir.display()), err)
        }
    }
}

/// Formats successful repack output.
fn report_repack_success(ctx: &CliContext, report: &RepackReport) {
    let artifacts: Vec<serde_json::Value> = report
        .artifacts
        .iter()
        .map(|artifact| {
            json!({
                "pack_oid": artifact.pack_oid.to_hex(),
                "idx_oid": artifact.idx_oid.to_hex(),
                "objects_packed": artifact.objects_packed,
                "pack_bytes": artifact.pack_bytes
            })
        })
        .collect();

    if ctx.json_mode {
        print_json(&json!({
            "status": "ok",
            "pack_oid": report.pack_oid.to_hex(),
            "idx_oid": report.idx_oid.to_hex(),
            "objects_packed": report.objects_packed,
            "objects_verified": report.objects_verified,
            "pack_bytes": report.pack_bytes,
            "pack_count": report.artifacts.len(),
            "total_pack_bytes": report.total_pack_bytes,
            "artifacts": artifacts,
            "loose_pruned": report.loose_pruned,
            "duration_ms": report.duration_ms
        }));
    } else {
        println!("=== Taxis Packfile Consolidation ===");
        println!("Pack SHA-1:       {}", report.pack_oid.to_hex());
        println!("Index SHA-1:      {}", report.idx_oid.to_hex());
        println!("Objects Packed:   {}", report.objects_packed);
        println!("Objects Verified: {}", report.objects_verified);
        println!("Packfile Size:    {} bytes", report.pack_bytes);
        if report.artifacts.len() > 1 {
            println!(
                "Pack Slices:      {} published, {} bytes total",
                report.artifacts.len(),
                report.total_pack_bytes
            );
        }
        println!("Loose Pruned:     {}", report.loose_pruned);
        println!("Time Elapsed:     {} ms", report.duration_ms);
    }
}
