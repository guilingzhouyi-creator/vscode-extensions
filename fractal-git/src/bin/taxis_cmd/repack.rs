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

use super::common::{fail_io, print_json, CliContext, EXIT_REJECTED};

/// Prints usage and options help for `taxis repack`.
pub fn print_repack_help() {
    println!(
        "Usage: taxis repack [options]\n\n\
         Consolidate loose Git objects into packfiles and Index v2.\n\n\
         Options:\n\
           -w, --window <size>     Sliding window size for delta search (default: 10)\n\
           -d, --max-depth <depth> Maximum delta chain depth (default: 50)\n\
           --low-disk              Progressively pack and purge loose objects in micro-pack slices (256MB~512MB)\n\
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
        match args[cursor].as_str() {
            "-h" | "--help" | "help" => {
                print_repack_help();
                std::process::exit(0);
            }
            "--window" | "-w" if cursor + 1 < args.len() => {
                if let Ok(w) = args[cursor + 1].parse::<usize>() {
                    options.window_size = w;
                }
                cursor += 2;
            }
            "--max-depth" | "-d" if cursor + 1 < args.len() => {
                if let Ok(d) = args[cursor + 1].parse::<usize>() {
                    options.max_depth = d;
                }
                cursor += 2;
            }
            "--threshold" if cursor + 1 < args.len() => {
                if let Ok(t) = args[cursor + 1].parse::<usize>() {
                    options.auto_repack_threshold = t;
                }
                cursor += 2;
            }
            "--keep-loose" | "-k" => {
                options.keep_loose = true;
                cursor += 1;
            }
            "--low-disk" => {
                options.low_disk = true;
                cursor += 1;
            }
            "--async" => {
                is_async = true;
                cursor += 1;
            }
            "--auto" => {
                auto_check_only = true;
                cursor += 1;
            }
            _ => {
                cursor += 1;
            }
        }
    }

    (options, is_async, auto_check_only)
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
    if ctx.json_mode {
        print_json(&json!({
            "status": "ok",
            "pack_oid": report.pack_oid.to_hex(),
            "idx_oid": report.idx_oid.to_hex(),
            "objects_packed": report.objects_packed,
            "objects_verified": report.objects_verified,
            "pack_bytes": report.pack_bytes,
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
        println!("Loose Pruned:     {}", report.loose_pruned);
        println!("Time Elapsed:     {} ms", report.duration_ms);
    }
}
