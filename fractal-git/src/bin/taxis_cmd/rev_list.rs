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
use fractal_git::{
    CommitCountVerdict, CommitCounter, CommitTelemetryConfig, FractalRef, Oid, TelemetryCommitNode,
};

use super::commit_walk::{walk_commits, CommitRecord};
use super::common::{
    fail_fatal, fail_usage, fatal_ambiguous_argument, print_json, reject, CliContext,
};
use super::log::collect_all_starts;
use super::repo_view::RepoView;

/// Parsed CLI options for `taxis rev-list`.
struct RevListArgs {
    count_only: bool,
    all_transient: bool,
    telemetry: bool,
    limit: Option<usize>,
    includes: Vec<String>,
    excludes: Vec<String>,
    all_polarities: Vec<bool>,
}

/// Computes official commit counts using anti-inflation telemetry filters or prints commit OIDs.
pub fn handle_rev_list(ctx: &CliContext) {
    let parsed = parse_rev_list_args(&ctx.args);
    let config = CommitTelemetryConfig {
        dual_trunk_enabled: !parsed.all_transient,
        target_ref: FractalRef::SystemTrunk {
            branch: "main".into(),
        },
    };

    let view = RepoView::open_or_exit(ctx);
    if parsed.includes.is_empty() && parsed.excludes.is_empty() && parsed.all_polarities.is_empty()
    {
        fail_usage("taxis rev-list <commit>...");
    }
    let head = view
        .head_commit()
        .unwrap_or_else(|resolve_err| reject(CliTag::ERROR, resolve_err));

    let records = collect_filtered_records(&view, &parsed);
    let node_index: HashMap<Oid, TelemetryCommitNode> = records
        .iter()
        .map(|record| (record.oid, record.to_telemetry_node()))
        .collect();

    let anchor = head.or_else(|| records.first().map(|record| record.oid));
    let verdict = anchor.map(|anchor_oid| {
        CommitCounter::count_commits(Some(anchor_oid), &config, |oid| {
            Ok(node_index.get(oid).cloned())
        })
        .unwrap_or_else(|count_err| reject(CliTag::ERROR, count_err))
    });

    render_rev_list_output(ctx, &parsed, (&records, verdict.as_ref()));
}

/// Parses command-line flags and revision arguments for `taxis rev-list`.
fn parse_rev_list_args(args: &[String]) -> RevListArgs {
    let mut parsed = RevListArgs {
        count_only: false,
        all_transient: false,
        telemetry: false,
        limit: None,
        includes: Vec::new(),
        excludes: Vec::new(),
        all_polarities: Vec::new(),
    };
    let mut negate_following = false;
    let mut cursor = 0usize;

    while cursor < args.len() {
        let arg = args[cursor].as_str();
        cursor += 1;
        match arg {
            "--count" => parsed.count_only = true,
            "--all-transient" => parsed.all_transient = true,
            "--telemetry" => parsed.telemetry = true,
            "--all" => parsed.all_polarities.push(negate_following),
            "--not" => negate_following = !negate_following,
            "-n" | "--max-count" => {
                let Some(text) = args.get(cursor) else {
                    reject(CliTag::ERROR, format!("rev-list {arg} requires a count"));
                };
                parsed.limit = Some(parse_limit_value(arg, text));
                cursor += 1;
            }
            other if other.starts_with("--max-count=") => {
                let text = &other["--max-count=".len()..];
                parsed.limit = Some(parse_limit_value("--max-count", text));
            }
            other if other.starts_with('-') && other.len() > 1 => {
                let digits = other.strip_prefix("-n").unwrap_or(&other[1..]);
                match digits.parse::<usize>() {
                    Ok(val) => parsed.limit = Some(val),
                    Err(_) => reject(
                        CliTag::ERROR,
                        format!("rev-list does not support the flag '{other}'"),
                    ),
                }
            }
            spec => classify_revision(
                (spec, negate_following),
                &mut parsed.includes,
                &mut parsed.excludes,
            ),
        }
    }
    parsed
}

/// Parses a numeric limit flag value or exits with an error.
fn parse_limit_value(flag: &str, text: &str) -> usize {
    text.parse::<usize>().unwrap_or_else(|_| {
        reject(
            CliTag::ERROR,
            format!("rev-list {flag} expects a count, got '{text}'"),
        )
    })
}

/// Resolves start/exclude revisions and walks the commit graph.
fn collect_filtered_records(view: &RepoView, parsed: &RevListArgs) -> Vec<CommitRecord> {
    let all_tips = if parsed.all_polarities.is_empty() {
        Vec::new()
    } else {
        collect_all_starts(view).unwrap_or_else(|list_err| fail_fatal(list_err))
    };
    let mut include_oids = resolve_revisions(view, &parsed.includes);
    let mut exclude_oids = resolve_revisions(view, &parsed.excludes);
    for negated in &parsed.all_polarities {
        let destination = if *negated {
            &mut exclude_oids
        } else {
            &mut include_oids
        };
        destination.extend(all_tips.iter().copied());
    }

    let walked = walk_commits(view, &include_oids).unwrap_or_else(|err| fail_fatal(err));
    let excluded_oids: HashSet<Oid> = if exclude_oids.is_empty() {
        HashSet::new()
    } else {
        walk_commits(view, &exclude_oids)
            .unwrap_or_else(|err| fail_fatal(err))
            .into_iter()
            .map(|record| record.oid)
            .collect()
    };
    walked
        .into_iter()
        .filter(|record| !excluded_oids.contains(&record.oid))
        .collect()
}

/// Renders `rev-list` output in `--count`, `--telemetry`, or standard OID list format.
fn render_rev_list_output(
    ctx: &CliContext,
    parsed: &RevListArgs,
    records_and_verdict: (&[CommitRecord], Option<&CommitCountVerdict>),
) {
    let (records, verdict) = records_and_verdict;
    let (official_count, total_raw_commits, filtered_agent_commits, dual_trunk_active) = verdict
        .map_or((0, 0, 0, false), |counted| {
            (
                counted.official_count,
                counted.total_raw_commits,
                counted.filtered_agent_commits,
                counted.dual_trunk_active,
            )
        });

    if parsed.count_only {
        let reachable = parsed
            .limit
            .map_or(records.len(), |cap| records.len().min(cap));
        if ctx.json_mode {
            print_json(&serde_json::json!({
                "count": reachable,
                "official_count": official_count,
                "total_raw_commits": total_raw_commits,
                "filtered_agent_commits": filtered_agent_commits,
                "dual_trunk_active": dual_trunk_active,
            }));
        } else {
            println!("{reachable}");
        }
        return;
    }

    if !parsed.telemetry {
        let shown = &records[..records.len().min(parsed.limit.unwrap_or(records.len()))];
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
        official_count, total_raw_commits, filtered_agent_commits, dual_trunk_active
    );
}

/// Classifies one positional revision specifier into the include or exclude side.
fn classify_revision(
    spec_and_negate: (&str, bool),
    includes: &mut Vec<String>,
    excludes: &mut Vec<String>,
) {
    let (spec, negate_following) = spec_and_negate;
    let (explicit_caret, name) = match spec.strip_prefix('^') {
        Some(rest) => (true, rest),
        None => (false, spec),
    };
    if name.is_empty() {
        fatal_ambiguous_argument(spec);
    }
    if explicit_caret ^ negate_following {
        excludes.push(name.to_string());
    } else {
        includes.push(name.to_string());
    }
}

/// Resolves revision specifiers through the shared RepoView resolver.
fn resolve_revisions(view: &RepoView, specs: &[String]) -> Vec<Oid> {
    let mut resolved = Vec::with_capacity(specs.len());
    for spec in specs {
        match view.resolve(spec) {
            Ok(oid) => resolved.push(oid),
            Err(_) => fatal_ambiguous_argument(spec),
        }
    }
    resolved
}
