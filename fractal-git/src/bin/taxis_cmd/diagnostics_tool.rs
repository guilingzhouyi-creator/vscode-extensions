//! Module: taxis_cmd::diagnostics_tool — Diagnostic Log Inspection Tool
//! File Path: src/bin/taxis_cmd/diagnostics_tool.rs
//! Architecture Role: Inspects, tails, and queries passive commercial diagnostic logs.
//! Dependencies & Triggers: Dispatched by `taxis diagnostics`.
//! Responsibilities: Report log file path, query recent JSONL records, and verify log health.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use fg_core::constants::cli::CliTag;
use fg_core::diagnostics::{active_subcommand, trace_id, DiagnosticRecord};

use super::common::{print_json, reject, CliContext};

/// Bytes read from the end of the log when serving `tail`.
///
/// One record is bounded by the sanitized message plus fixed metadata, so a few dozen KiB is far
/// more than the 20 lines `tail` prints while staying independent of the total log size.
const TAIL_WINDOW_BYTES: u64 = 64 * 1024;

/// Reads at most `window_bytes` from the end of `file` and splits it into complete lines.
///
/// The first line of the window is dropped unless the window began at offset zero, because a
/// window that starts mid-file almost always starts mid-record; printing that fragment as if it
/// were a record is worse than omitting it.
fn read_tail_window(mut file: fs::File, window_bytes: u64) -> std::io::Result<Vec<String>> {
    let total_len = file.metadata()?.len();
    let start = total_len.saturating_sub(window_bytes);
    file.seek(SeekFrom::Start(start))?;

    let mut buffer = String::new();
    file.take(window_bytes).read_to_string(&mut buffer)?;

    let mut lines: Vec<String> = buffer.lines().map(str::to_string).collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    Ok(lines)
}

/// Resolves the diagnostic log file path for the active repository.
fn resolve_log_path(ctx: &CliContext) -> PathBuf {
    if let Ok(custom) = std::env::var("TAXIS_LOG_FILE") {
        return PathBuf::from(custom);
    }
    ctx.git_dir.join("diagnostics/taxis.jsonl")
}

/// Dispatches `taxis diagnostics`.
pub fn handle_diagnostics(ctx: &CliContext) {
    let action = ctx.args.first().map(String::as_str).unwrap_or("status");
    let log_path = resolve_log_path(ctx);

    match action {
        "status" => {
            let exists = log_path.is_file();
            let size = if exists {
                fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0)
            } else {
                0
            };
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "engine": "taxis",
                    "operation": "diagnostics",
                    "active_trace_id": trace_id(),
                    "active_subcommand": active_subcommand(),
                    "log_path": log_path.display().to_string(),
                    "exists": exists,
                    "size_bytes": size
                }));
            } else {
                println!("=== Taxis Commercial Diagnostics System ===");
                println!("Active Trace ID     : {}", trace_id());
                println!(
                    "Active Subcommand   : {}",
                    active_subcommand().as_deref().unwrap_or("none")
                );
                println!("Diagnostic Log File : {}", log_path.display());
                println!(
                    "File Status         : {}",
                    if exists { "present" } else { "absent" }
                );
                println!("Current Size        : {} bytes", size);
            }
        }
        "path" => {
            if ctx.json_mode {
                print_json(&serde_json::json!({ "log_path": log_path.display().to_string() }));
            } else {
                println!("{}", log_path.display());
            }
        }
        "tail" | "recent" => {
            if !log_path.is_file() {
                if ctx.json_mode {
                    print_json(&serde_json::json!({ "records": [] }));
                } else {
                    println!("No diagnostic logs recorded yet at {}", log_path.display());
                }
                return;
            }

            let file = match fs::File::open(&log_path) {
                Ok(f) => f,
                Err(err) => reject(CliTag::ERROR, format!("open log file: {err}")),
            };

            // Only the window that will be printed is read. Reading the whole file and then
            // discarding everything but the tail couples memory use to log size, which is exactly
            // the quantity rotation is allowed to grow up to the 5 MiB ceiling — and a user
            // running `tail` during an incident is asking for the cheapest possible read, not the
            // most expensive. The window is generous relative to the 20 lines requested so a
            // partial trailing record cannot crowd real ones out.
            let recent = match read_tail_window(file, TAIL_WINDOW_BYTES) {
                Ok(lines) => lines,
                Err(err) => reject(CliTag::ERROR, format!("read log tail: {err}")),
            };
            let limit = 20.min(recent.len());
            let recent = recent[recent.len() - limit..].to_vec();

            if ctx.json_mode {
                let records: Vec<serde_json::Value> = recent
                    .iter()
                    .filter_map(|l| serde_json::from_str(l).ok())
                    .collect();
                print_json(&serde_json::json!({
                    "log_path": log_path.display().to_string(),
                    "count": records.len(),
                    "records": records
                }));
            } else {
                for line in recent {
                    if let Ok(rec) = serde_json::from_str::<DiagnosticRecord>(&line) {
                        println!(
                            "[{}] [{}] {} - {}",
                            rec.timestamp, rec.level, rec.target, rec.message
                        );
                    } else {
                        println!("{line}");
                    }
                }
            }
        }
        _ => reject(
            CliTag::ERROR,
            format!("unknown diagnostics action '{action}'. Valid: status, path, tail"),
        ),
    }
}
