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

use std::collections::{HashMap, HashSet};

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
    let mut includes: Vec<String> = Vec::new();
    let mut excludes: Vec<String> = Vec::new();
    let mut negate_following = false;

    let mut cursor = 0usize;
    while cursor < ctx.args.len() {
        let arg = ctx.args[cursor].as_str();
        cursor += 1;
        match arg {
            "--count" => count_only = true,
            "--all-transient" => all_transient = true,
            "--telemetry" => telemetry = true,
            "--not" => negate_following = !negate_following,
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
            spec => classify_revision(spec, negate_following, &mut includes, &mut excludes),
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

    // Git treats a bare revision list as "everything reachable from these tips"; with no tips at
    // all it falls back to HEAD, which this command has always used as its default walk start.
    let include_oids = resolve_revisions(&view, &includes, "included");
    let exclude_oids = resolve_revisions(&view, &excludes, "excluded");
    let starts = if include_oids.is_empty() {
        vec![head]
    } else {
        include_oids
    };

    let walked = match walk_commits(&view, &starts) {
        Ok(walked) => walked,
        Err(walk_err) => reject(CliTag::ERROR, walk_err),
    };
    // A commit reachable from any exclude tip is subtracted from the answer, exactly like Git's
    // ^rev / --not form. Excludes are walked on their own so the subtraction stays set-based.
    let excluded_oids: HashSet<Oid> = if exclude_oids.is_empty() {
        HashSet::new()
    } else {
        match walk_commits(&view, &exclude_oids) {
            Ok(excluded) => excluded.into_iter().map(|record| record.oid).collect(),
            Err(walk_err) => reject(CliTag::ERROR, walk_err),
        }
    };
    let records: Vec<_> = walked
        .into_iter()
        .filter(|record| !excluded_oids.contains(&record.oid))
        .collect();

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
        // Git counts the commits it would print, so -n caps the reported total too.
        let reachable = limit.map_or(records.len(), |cap| records.len().min(cap));
        if ctx.json_mode {
            let rev_payload = serde_json::json!({
                "count": reachable,
                "official_count": verdict.official_count,
                "total_raw_commits": verdict.total_raw_commits,
                "filtered_agent_commits": verdict.filtered_agent_commits,
                "dual_trunk_active": verdict.dual_trunk_active,
            });
            print_json(&rev_payload);
        } else {
            println!("{reachable}");
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

/// Classifies one positional revision specifier into the include or exclude side.
///
/// The explicit caret form and a preceding --not compose the way Git documents them: either one
/// flips the side, so two negations cancel out.
fn classify_revision(
    spec: &str,
    negate_following: bool,
    includes: &mut Vec<String>,
    excludes: &mut Vec<String>,
) {
    let (explicit_caret, name) = match spec.strip_prefix('^') {
        Some(rest) => (true, rest),
        None => (false, spec),
    };
    if name.is_empty() {
        reject(
            CliTag::ERROR,
            format!("rev-list received an empty revision in '{spec}'"),
        );
    }
    if explicit_caret ^ negate_following {
        excludes.push(name.to_string());
    } else {
        includes.push(name.to_string());
    }
}

/// Resolves revision specifiers through the shared RepoView resolver, reporting the failing side.
fn resolve_revisions(view: &RepoView, specs: &[String], role: &str) -> Vec<Oid> {
    let mut resolved = Vec::with_capacity(specs.len());
    for spec in specs {
        match view.resolve(spec) {
            Ok(oid) => resolved.push(oid),
            Err(resolve_err) => reject(
                CliTag::ERROR,
                format!("rev-list cannot resolve the {role} revision '{spec}': {resolve_err}"),
            ),
        }
    }
    resolved
}
