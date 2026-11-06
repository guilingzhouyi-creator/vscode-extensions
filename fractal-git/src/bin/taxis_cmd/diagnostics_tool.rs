//! Module: taxis_cmd::diagnostics_tool — Diagnostic Log Inspection Tool
//! File Path: src/bin/taxis_cmd/diagnostics_tool.rs
//! Architecture Role: Inspects, tails, and queries passive commercial diagnostic logs.
//! Dependencies & Triggers: Dispatched by `taxis diagnostics`.
//! Responsibilities: Report log file path, query recent JSONL records, and verify log health.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

use fg_core::constants::cli::CliTag;
use fg_core::diagnostics::{active_subcommand, trace_id, DiagnosticRecord};

use super::common::{print_json, reject, CliContext};

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

            let reader = BufReader::new(file);
            let mut lines: Vec<String> = reader.lines().map_while(Result::ok).collect();
            let limit = 20.min(lines.len());
            let recent: Vec<String> = lines.split_off(lines.len() - limit);

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
