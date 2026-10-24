//! Module: taxis_cmd::rev_list — Commit History Walker & Telemetry Counter
//! File Path: src/bin/taxis_cmd/rev_list.rs
//! Architecture Role: Dispatches commit revision list queries and anti-inflation telemetry
//!   filtering directly over native and git object stores.
//! Dependencies & Triggers: Dispatched by `taxis rev-list`.
//! Responsibilities: Fast DAG traversal, revision limits, count computation, and anti-gaming
//!   telemetry node filtering.
//! Exit Semantics & Design Rationale:
//!   - Emits pure object IDs on standard stdout (Git plumbing compatible).
//!   - Emits structured telemetry summary under `--telemetry`.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TOP-001`: DAG topology traversal guard

use std::collections::HashMap;

use fractal_git::constants::cli::CliTag;
use fractal_git::{CommitCounter, CommitTelemetryConfig, FractalRef, Oid, TelemetryCommitNode};

use super::commit_walk::walk_commits;
use super::common::{fail_fatal, print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Computes official commit counts using anti-inflation telemetry filters or prints commit OIDs.
pub fn handle_rev_list(ctx: &CliContext) {
    let mut count_only = false;
    let mut all_transient = false;
    let mut telemetry = false;
    let mut limit: Option<usize> = None;

    let mut cursor = 0usize;
    while cursor < ctx.args.len() {
        let arg = ctx.args[cursor].as_str();
        cursor += 1;
        match arg {
            "--count" => count_only = true,
            "--all-transient" => all_transient = true,
            "--telemetry" => telemetry = true,
            "-n" => match ctx.args.get(cursor) {
                Some(text) => match text.parse::<usize>() {
                    Ok(parsed) => {
                        limit = Some(parsed);
                        cursor += 1;
                    }
                    Err(_) => reject(
                        CliTag::ERROR,
                        format!("rev-list -n expects a count, got '{text}'"),
                    ),
                },
                None => reject(CliTag::ERROR, "rev-list -n requires a count"),
            },
            "--max-count" => match ctx.args.get(cursor) {
                Some(text) => match text.parse::<usize>() {
                    Ok(parsed) => {
                        limit = Some(parsed);
                        cursor += 1;
                    }
                    Err(_) => reject(
                        CliTag::ERROR,
                        format!("rev-list --max-count expects a count, got '{text}'"),
                    ),
                },
                None => reject(CliTag::ERROR, "rev-list --max-count requires a count"),
            },
            other if other.starts_with("--max-count=") => {
                let text = &other["--max-count=".len()..];
                match text.parse::<usize>() {
                    Ok(parsed) => limit = Some(parsed),
                    Err(_) => reject(
                        CliTag::ERROR,
                        format!("rev-list --max-count expects a count, got '{text}'"),
                    ),
                }
            }
            other if other.starts_with('-') && other.len() > 1 => {
                let digits = other.strip_prefix("-n").unwrap_or(&other[1..]);
                match digits.parse::<usize>() {
                    Ok(parsed) => limit = Some(parsed),
                    Err(_) => reject(
                        CliTag::ERROR,
                        format!("rev-list does not support the flag '{other}'"),
                    ),
                }
            }
            _ => {}
        }
    }

    let config = CommitTelemetryConfig {
        dual_trunk_enabled: !all_transient,
        target_ref: FractalRef::SystemTrunk {
            branch: "main".into(),
        },
    };

    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };
    let head = match view.head_commit() {
        Ok(Some(head_oid)) => head_oid,
        Ok(None) => reject(
            CliTag::ERROR,
            format!(
                "HEAD is unborn in '{}'; nothing to count",
                view.git_dir().display()
            ),
        ),
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };

    let records = match walk_commits(&view, &[head]) {
        Ok(walked) => walked,
        Err(walk_err) => reject(CliTag::ERROR, walk_err),
    };
    let node_index: HashMap<Oid, TelemetryCommitNode> = records
        .iter()
        .map(|record| (record.oid, record.to_telemetry_node()))
        .collect();

    let verdict = match CommitCounter::count_commits(Some(head), &config, |oid| {
        Ok(node_index.get(oid).cloned())
    }) {
        Ok(count_verdict) => count_verdict,
        Err(count_err) => reject(CliTag::ERROR, count_err),
    };

    if count_only {
        if ctx.json_mode {
            let rev_payload = serde_json::json!({
                "official_count": verdict.official_count,
                "total_raw_commits": verdict.total_raw_commits,
                "filtered_agent_commits": verdict.filtered_agent_commits,
                "dual_trunk_active": verdict.dual_trunk_active,
            });
            print_json(&rev_payload);
        } else {
            println!("{}", verdict.official_count);
        }
        return;
    }

    if !telemetry {
        let shown = &records[..records.len().min(limit.unwrap_or(records.len()))];
        for record in shown {
            println!("{}", record.oid.to_hex());
        }
        return;
    }

    println!(
        "=== Taxis Commit Telemetry (Anti-Inflation Model) ===\n\
           Official Commits        : {}\n\
           Total Raw Commits       : {}\n\
           Filtered Agent Commits  : {} (Micro-snapshots)\n\
           Dual-Trunk Mode Active  : {}",
        verdict.official_count,
        verdict.total_raw_commits,
        verdict.filtered_agent_commits,
        verdict.dual_trunk_active
    );
}
