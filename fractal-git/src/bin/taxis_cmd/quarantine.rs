//! Module: taxis_cmd::quarantine — Elastic Quarantine & Violation Isolation Dispatcher
//! File Path: src/bin/taxis_cmd/quarantine.rs
//! Architecture Role: Dispatches elastic quarantine commands (`list`, `show`, `restore`, `discard`,
//!   `isolate`) supporting the 1+3 hybrid violation model.
//! Dependencies & Triggers: Dispatched by `taxis quarantine` or `taxis quar`.
//! Responsibilities: Quarantine inspection, unified patch display, recovery, and manual isolation.
//! Exit Semantics & Design Rationale: Provides safe auditability for isolated modifications without
//!   compromising the formal commit DAG.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use fg_index::quarantine::{
    default_quarantine_dir, IsolateMutationRequest, QuarantineRegistry, QuarantineStatus,
};
use fractal_git::constants::cli::CliTag;

use super::common::{fail_io, find_arg_value, print_json, reject, CliContext};

/// Returns the host system time in seconds since the UNIX epoch.
fn current_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Prints usage and options help for `taxis quarantine`.
pub fn print_quarantine_help() {
    println!(
        "Usage: taxis quarantine <subcommand> [options]\n\n\
         Manage elastic quarantine stash for unauthorized changes.\n\n\
         Subcommands:\n\
           list, ls [--all]       List quarantined modifications\n\
           show, view <id>        Inspect quarantined patch\n\
           restore, apply <id>    Restore quarantined patch to working tree\n\
           discard, drop <id>     Discard quarantined patch\n\
           isolate <files...>     Manually isolate files into quarantine\n\
           -h, --help             Show this help message"
    );
}

/// Dispatches the `taxis quarantine` command.
pub fn handle_quarantine(ctx: &CliContext) {
    if ctx.args.is_empty() {
        handle_list(ctx, &[]);
        return;
    }

    let subcommand = ctx.args[0].as_str();
    let remaining_args = &ctx.args[1..];

    match subcommand {
        "-h" | "--help" | "help" => print_quarantine_help(),
        "list" | "ls" => handle_list(ctx, remaining_args),
        "show" | "view" => handle_show(ctx, remaining_args),
        "restore" | "apply" => handle_restore(ctx, remaining_args),
        "discard" | "drop" => handle_discard(ctx, remaining_args),
        "isolate" => handle_isolate(ctx, remaining_args),
        _ => {
            // If argument is not a keyword, treat as `show <id>`
            if !subcommand.starts_with('-') {
                handle_show(ctx, &ctx.args);
            } else {
                handle_list(ctx, &ctx.args);
            }
        }
    }
}

/// Lists quarantine records (active by default, or all if --all is given).
fn handle_list(ctx: &CliContext, args: &[String]) {
    let show_all = args.iter().any(|arg| arg == "--all" || arg == "-a");
    let quarantine_directory = default_quarantine_dir(&ctx.git_dir);

    let ledger = QuarantineRegistry::load_from_dir(&quarantine_directory)
        .unwrap_or_else(|load_error| fail_io("load quarantine ledger", load_error));

    let records: Vec<_> = if show_all {
        ledger.records
    } else {
        ledger
            .records
            .into_iter()
            .filter(|record| record.status == QuarantineStatus::Isolated)
            .collect()
    };

    if ctx.json_mode {
        print_json(&records);
        return;
    }

    if records.is_empty() {
        println!(
            "No quarantined records found in {}",
            quarantine_directory.display()
        );
        return;
    }

    println!(
        "{:<20} {:<15} {:<15} {:<10} {:<30}",
        "QUARANTINE ID", "PROJECT", "AGENT", "STATUS", "FILE PATH"
    );
    println!("{:-<95}", "");

    for record in &records {
        let status_str = match record.status {
            QuarantineStatus::Isolated => "ISOLATED",
            QuarantineStatus::Restored => "RESTORED",
            QuarantineStatus::Discarded => "DISCARDED",
        };
        println!(
            "{:<20} {:<15} {:<15} {:<10} {:<30}",
            record.quarantine_id, record.project_id, record.agent_id, status_str, record.rel_path
        );
    }
}

/// Shows full details and unified patch content for a quarantined record.
fn handle_show(ctx: &CliContext, args: &[String]) {
    if args.is_empty() {
        reject(
            CliTag::ERROR,
            "Usage: taxis quarantine show <quarantine-id>",
        );
    }

    let quarantine_id = &args[0];
    let quarantine_directory = default_quarantine_dir(&ctx.git_dir);

    let record = QuarantineRegistry::find_by_id(&quarantine_directory, quarantine_id)
        .unwrap_or_else(|query_error| fail_io("query quarantine record", query_error))
        .unwrap_or_else(|| {
            reject(
                CliTag::ERROR,
                format!("Quarantine record '{}' not found", quarantine_id),
            );
        });

    let patch_content = QuarantineRegistry::read_patch_content(&quarantine_directory, &record)
        .unwrap_or_else(|read_error| fail_io("read quarantine patch", read_error));

    if ctx.json_mode {
        #[derive(serde::Serialize)]
        struct QuarantineDetail<'a> {
            #[serde(flatten)]
            record: &'a fg_index::quarantine::QuarantineRecord,
            patch: &'a str,
        }
        print_json(&QuarantineDetail {
            record: &record,
            patch: &patch_content,
        });
        return;
    }

    println!("=== Quarantine Record: {} ===", record.quarantine_id);
    println!("  Project    : {}", record.project_id);
    println!("  Agent      : {}", record.agent_id);
    println!("  Target Path: {}", record.rel_path);
    if let Some(uid) = record.file_uid {
        println!("  FileUid    : {}", uid);
    }
    println!("  Reason     : {}", record.reason);
    println!("  Timestamp  : {}", record.quarantined_at);
    println!("  Status     : {:?}", record.status);
    println!("\n--- Unified Patch ---");
    print!("{}", patch_content);
}

/// Marks a quarantine record as restored.
fn handle_restore(ctx: &CliContext, args: &[String]) {
    if args.is_empty() {
        reject(
            CliTag::ERROR,
            "Usage: taxis quarantine restore <quarantine-id>",
        );
    }

    let quarantine_id = &args[0];
    let quarantine_directory = default_quarantine_dir(&ctx.git_dir);

    QuarantineRegistry::mark_restored(&quarantine_directory, quarantine_id)
        .unwrap_or_else(|restore_error| fail_io("restore quarantine record", restore_error));

    if ctx.json_mode {
        #[derive(serde::Serialize)]
        struct RestoreResult<'a> {
            quarantine_id: &'a str,
            restored: bool,
        }
        print_json(&RestoreResult {
            quarantine_id,
            restored: true,
        });
    } else {
        println!(
            "Quarantine record '{}' successfully marked as RESTORED.",
            quarantine_id
        );
    }
}

/// Marks a quarantine record as discarded.
fn handle_discard(ctx: &CliContext, args: &[String]) {
    if args.is_empty() {
        reject(
            CliTag::ERROR,
            "Usage: taxis quarantine discard <quarantine-id>",
        );
    }

    let quarantine_id = &args[0];
    let quarantine_directory = default_quarantine_dir(&ctx.git_dir);

    QuarantineRegistry::mark_discarded(&quarantine_directory, quarantine_id)
        .unwrap_or_else(|discard_error| fail_io("discard quarantine record", discard_error));

    if ctx.json_mode {
        #[derive(serde::Serialize)]
        struct DiscardResult<'a> {
            quarantine_id: &'a str,
            discarded: bool,
        }
        print_json(&DiscardResult {
            quarantine_id,
            discarded: true,
        });
    } else {
        println!(
            "Quarantine record '{}' successfully marked as DISCARDED.",
            quarantine_id
        );
    }
}

/// Manually or programmatically isolates a file into quarantine.
fn handle_isolate(ctx: &CliContext, args: &[String]) {
    if args.is_empty() {
        reject(
            CliTag::ERROR,
            "Usage: taxis quarantine isolate <file-path> [--project <id>] [--agent <id>] [--reason <text>]",
        );
    }

    let rel_path = &args[0];
    let project_id = find_arg_value(args, &["--project"]).unwrap_or("default");
    let agent_id = find_arg_value(args, &["--agent"]).unwrap_or("operator");
    let reason = find_arg_value(args, &["--reason"]).unwrap_or("Manual quarantine isolation");

    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    let file_to_read = if Path::new(rel_path).is_absolute() {
        Path::new(rel_path).to_path_buf()
    } else {
        work_root.join(rel_path)
    };

    let content = fs::read_to_string(&file_to_read).unwrap_or_else(|read_error| {
        fail_io(format!("read file {}", file_to_read.display()), read_error)
    });

    let quarantine_directory = default_quarantine_dir(&ctx.git_dir);
    let current_time = current_now_secs();
    let nonce = (current_time % 10000) ^ 0xABCD;

    let record = QuarantineRegistry::isolate_mutation(IsolateMutationRequest {
        quarantine_dir: &quarantine_directory,
        project_id,
        agent_id,
        rel_path,
        file_uid: None,
        patch_or_content: &content,
        reason,
        current_time,
        nonce,
    })
    .unwrap_or_else(|isolate_error| fail_io("isolate file mutation", isolate_error));

    if ctx.json_mode {
        print_json(&record);
    } else {
        println!(
            "File '{}' safely isolated into quarantine with ID '{}'.",
            rel_path, record.quarantine_id
        );
    }
}
