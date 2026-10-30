//! Module: taxis_cmd::quality — Composite Quality Trace & Manifold Evaluation Dispatcher
//! File Path: src/bin/taxis_cmd/quality.rs
//! Architecture Role: Dispatches `taxis quality trace` and `taxis quality audit` subcommands,
//!   evaluating and rendering the three-pillar code evolution manifold (cryptographic integrity,
//!   invariants/canary, and 5D Riemann phase space deviation).
//!
//! Dependencies & Triggers: Dispatched by `taxis quality` or `taxis trace`.
//! Responsibilities: Audit chain inspection, manifold metric computation, ASCII trace rendering, and JSON formatting.
//! Exit Semantics & Design Rationale:
//!   - Read-only inspection command with zero repository mutation or lock contention.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-TOP-001`: Fractal topology reference guard

use fg_core::constants::cli::CliTag;
use fg_core::models::{AuditRecord, AuthoritySecret};
use fg_gate::authority::resolve_authority_secret;
use fg_topology::refs::FractalRef;
use fg_topology::{Riemann5DPhaseVector, TrinityManifoldEvaluator};

use super::common::{find_arg_value, print_json, reject, CliContext};

/// Prints usage help for `taxis quality`.
pub fn print_quality_help() {
    println!(
        "Usage: taxis quality <subcommand> [options]\n\n\
         Inspect composite evolution quality and cryptographic audit ledger.\n\n\
         Subcommands:\n\
           trace [--cell <id>] [--json]    Display Trinity manifold evolution quality trace\n\
           audit [--cell <id>] [--json]    Inspect raw cryptographic audit NDJSON records\n\
           -h, --help                      Show this help message"
    );
}

/// Dispatches the `taxis quality` command.
pub fn handle_quality(ctx: &CliContext) {
    if ctx.args.is_empty() {
        handle_trace(ctx, &[]);
        return;
    }

    let subcommand = ctx.args[0].as_str();
    let remaining_args = &ctx.args[1..];

    match subcommand {
        "-h" | "--help" | "help" => print_quality_help(),
        "trace" => handle_trace(ctx, remaining_args),
        "audit" => handle_audit(ctx, remaining_args),
        other => {
            eprintln!("Unknown quality subcommand: '{other}'");
            print_quality_help();
            reject(CliTag::FAIL, format!("unknown subcommand: {other}"));
        }
    }
}

/// Handles `taxis quality trace [--cell <id>]`.
fn handle_trace(ctx: &CliContext, args: &[String]) {
    let cell_id = find_arg_value(args, &["--cell"]).unwrap_or("default");
    let authority_secret = match resolve_authority_secret(&ctx.git_dir) {
        Ok(resolved_secret) => resolved_secret,
        Err(_) => match AuthoritySecret::from_bytes(&[0u8; 32]) {
            Ok(fallback_secret) => fallback_secret,
            Err(init_error) => reject(
                CliTag::FAIL,
                format!("failed to initialize authority secret: {init_error}"),
            ),
        },
    };
    let records = load_cell_telemetry_records(&ctx.git_dir, cell_id);

    let snapshot = TrinityManifoldEvaluator::evaluate(
        &records,
        Some(Riemann5DPhaseVector::default()),
        &authority_secret,
    );

    if ctx.json_mode {
        print_json(&snapshot);
    } else {
        let rendered = TrinityManifoldEvaluator::render_ascii_trace(&snapshot);
        print!("{rendered}");
    }
}

/// Handles `taxis quality audit [--cell <id>]`.
fn handle_audit(ctx: &CliContext, args: &[String]) {
    let cell_id = find_arg_value(args, &["--cell"]).unwrap_or("default");
    let records = load_cell_telemetry_records(&ctx.git_dir, cell_id);

    if ctx.json_mode {
        print_json(&records);
    } else if records.is_empty() {
        println!("No audit records found for cell '{cell_id}'.");
    } else {
        println!(
            "Audit Records for Cell '{cell_id}' ({} total):",
            records.len()
        );
        for (index, record) in records.iter().enumerate() {
            println!(
                "[{:03}] t={} clk={} rev={} actor={} net={:+.1} cred={:.1}% sig={}",
                index + 1,
                record.t,
                record.clk,
                record.rev,
                record.actor,
                record.score.net,
                record.score.cred,
                record.sig
            );
        }
    }
}

/// Loads audit records from the repository's telemetry reference if present.
fn load_cell_telemetry_records(git_dir: &std::path::Path, cell_id: &str) -> Vec<AuditRecord> {
    let cell_ref = FractalRef::CellTelemetryLedger {
        cell_id: cell_id.to_string(),
    };

    let ref_path = cell_ref.disk_path(git_dir);
    if !ref_path.exists() {
        return Vec::new();
    }

    let Ok(ledger_content) = std::fs::read_to_string(&ref_path) else {
        return Vec::new();
    };

    let mut records = Vec::new();
    for raw_line in ledger_content.lines() {
        let trimmed_line = raw_line.trim();
        if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
            continue;
        }
        if let Ok(record) = AuditRecord::from_ndjson_line(trimmed_line) {
            records.push(record);
        }
    }

    records
}
