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
use super::common::{
    fail_fatal, fail_usage, fatal_ambiguous_argument, print_json, reject, CliContext,
};
use super::log::collect_all_starts;
use super::repo_view::RepoView;

/// Computes official commit counts using anti-inflation telemetry filters or prints commit OIDs.
pub fn handle_rev_list(ctx: &CliContext) {
    let mut count_only = false;
    let mut all_transient = false;
    let mut telemetry = false;
    let mut limit: Option<usize> = None;
    let mut includes: Vec<String> = Vec::new();
    let mut excludes: Vec<String> = Vec::new();
    let mut all_polarities: Vec<bool> = Vec::new();
    let mut negate_following = false;

    let mut cursor = 0usize;
    while cursor < ctx.args.len() {
        let arg = ctx.args[cursor].as_str();
        cursor += 1;
        match arg {
            "--count" => count_only = true,
            "--all-transient" => all_transient = true,
            "--telemetry" => telemetry = true,
            // `--all` names no revision of its own: it expands to the tip of every reference, on the
            // side the current --not state selects. Git applies the reader's negation state at the
            // point the flag appears, so two --all tokens can straddle a --not.
            "--all" => all_polarities.push(negate_following),
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
    // Git's rev-list has no implicit HEAD: with no revision argument at all it prints its usage and
    // exits 129, even inside a populated repository. An exclusion-only invocation such as
    // "--not main" is still an invocation and prints an empty list instead.
    if includes.is_empty() && excludes.is_empty() && all_polarities.is_empty() {
        fail_usage("taxis rev-list <commit>...");
    }
    let head = match view.head_commit() {
        Ok(found) => found,
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };

    let all_tips = if all_polarities.is_empty() {
        Vec::new()
    } else {
        match collect_all_starts(&view) {
            Ok(tips) => tips,
            Err(list_err) => fail_fatal(list_err),
        }
    };
    let mut include_oids = resolve_revisions(&view, &includes);
    let mut exclude_oids = resolve_revisions(&view, &excludes);
    for negated in &all_polarities {
        let destination = if *negated {
            &mut exclude_oids
        } else {
            &mut include_oids
        };
        destination.extend(all_tips.iter().copied());
    }
    let starts = include_oids;

    let walked = match walk_commits(&view, &starts) {
        Ok(walked) => walked,
        Err(walk_err) => fail_fatal(walk_err),
    };
    // A commit reachable from any exclude tip is subtracted from the answer, exactly like Git's
    // ^rev / --not form. Excludes are walked on their own so the subtraction stays set-based.
    let excluded_oids: HashSet<Oid> = if exclude_oids.is_empty() {
        HashSet::new()
    } else {
        match walk_commits(&view, &exclude_oids) {
            Ok(excluded) => excluded.into_iter().map(|record| record.oid).collect(),
            Err(walk_err) => fail_fatal(walk_err),
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

    // The anti-inflation verdict is reported as zero when the walk has no anchor (an
    // exclusion-only invocation in an unborn repository), rather than refusing to print anything.
    let anchor = head.or_else(|| records.first().map(|record| record.oid));
    let verdict = anchor.map(|anchor_oid| {
        match CommitCounter::count_commits(Some(anchor_oid), &config, |oid| {
            Ok(node_index.get(oid).cloned())
        }) {
            Ok(count_verdict) => count_verdict,
            Err(count_err) => reject(CliTag::ERROR, count_err),
        }
    });

    if count_only {
        // Git counts the commits it would print, so -n caps the reported total too.
        let reachable = limit.map_or(records.len(), |cap| records.len().min(cap));
        if ctx.json_mode {
            let (official_count, total_raw_commits, filtered_agent_commits, dual_trunk_active) =
                verdict.as_ref().map_or((0, 0, 0, false), |counted| {
                    (
                        counted.official_count,
                        counted.total_raw_commits,
                        counted.filtered_agent_commits,
                        counted.dual_trunk_active,
                    )
                });
            let rev_payload = serde_json::json!({
                "count": reachable,
                "official_count": official_count,
                "total_raw_commits": total_raw_commits,
                "filtered_agent_commits": filtered_agent_commits,
                "dual_trunk_active": dual_trunk_active,
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

    let (official_count, total_raw_commits, filtered_agent_commits, dual_trunk_active) =
        verdict.as_ref().map_or((0, 0, 0, false), |counted| {
            (
                counted.official_count,
                counted.total_raw_commits,
                counted.filtered_agent_commits,
                counted.dual_trunk_active,
            )
        });
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
        fatal_ambiguous_argument(spec);
    }
    if explicit_caret ^ negate_following {
        excludes.push(name.to_string());
    } else {
        includes.push(name.to_string());
    }
}

/// Resolves revision specifiers through the shared RepoView resolver.
///
/// An unresolvable specifier is fatal with Git's "ambiguous argument" status: `rev-list` is a
/// scripting command, and a caller that mistyped a branch must see 128 rather than a short list.
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
