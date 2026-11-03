//! Module: taxis_cmd::lineage — Commit Lineage Analysis (range-diff & cherry)
//! File Path: src/bin/taxis_cmd/lineage.rs
//! Architecture Role: Implements `git range-diff` and `git cherry`, comparing commit series,
//!   detecting applied upstream commits, and diagnosing branch rebasing/evolution.
//! Dependencies & Triggers: Dispatched by `taxis range-diff` and `taxis cherry`.
//! Responsibilities: Compare two commit ranges (structural diff of diffs), match commits
//!   by patch equivalence, and detect upstream unapplied cherry candidates.
//! Exit Semantics & Design Rationale:
//!   - `cherry` exits 0 with standard `+ <oid>` / `- <oid>` lines.
//!   - `range-diff` exits 0 with comparison markers (`=`, `!`, `<`, `>`).
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TOP-001`: DAG topology traversal guard

use std::collections::HashSet;

use fg_algorithms::traverse::dag_walk::{CorrectedCommitDate, DagWalker};
use fg_algorithms::PatchGenerator;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use sha1::{Digest, Sha1};

use super::commit_walk::{parse_commit_record, walk_commits, CommitRecord};
use super::common::{fail_fatal, fail_usage, CliContext};
use super::diff::{collect_comparisons, DiffRequest, DiffScope, EMPTY_TREE_MARKER};
use super::diff_render::render_text_to_writer;
use super::repo_view::RepoView;

/// One commit inside a lineage comparison with its patch identity.
struct LineageCommit {
    record: CommitRecord,
    patch_id: Oid,
    diff_text: String,
}

/// Dispatches `taxis cherry`.
pub fn handle_cherry(ctx: &CliContext) {
    let mut verbose = false;
    let mut positional = Vec::new();

    for arg in &ctx.args {
        match arg.as_str() {
            "-v" => verbose = true,
            other if other.starts_with('-') => {
                fail_usage(format!("cherry: unsupported option '{other}'"));
            }
            _other => positional.push(arg.as_str()),
        }
    }

    if positional.is_empty() {
        fail_usage("usage: taxis cherry [-v] <upstream> [<head>]");
    }

    let upstream_spec = positional[0];
    let head_spec = positional.get(1).copied().unwrap_or("HEAD");

    let view = RepoView::open_or_exit(ctx);
    let upstream_oid = match view.resolve(upstream_spec) {
        Ok(oid) => oid,
        Err(err) => fail_fatal(format!("cannot resolve upstream '{upstream_spec}': {err}")),
    };
    let head_oid = match view.resolve(head_spec) {
        Ok(oid) => oid,
        Err(err) => fail_fatal(format!("cannot resolve head '{head_spec}': {err}")),
    };

    let upstream_commits = walk_commits(&view, &[upstream_oid]).unwrap_or_default();
    let head_commits = walk_commits(&view, &[head_oid]).unwrap_or_default();

    let upstream_set: HashSet<Oid> = upstream_commits.iter().map(|c| c.oid).collect();
    let upstream_patch_ids: HashSet<Oid> = upstream_commits
        .iter()
        .filter_map(|c| compute_commit_patch_id(&view, c).ok())
        .collect();

    // Commits in head that are not in upstream by ancestry
    let mut candidate_commits: Vec<CommitRecord> = head_commits
        .into_iter()
        .filter(|c| !upstream_set.contains(&c.oid))
        .collect();

    // Reorder chronological (oldest first)
    candidate_commits.reverse();

    for commit in &candidate_commits {
        let patch_id = compute_commit_patch_id(&view, commit).unwrap_or(Oid::ZERO);
        let sign = if upstream_patch_ids.contains(&patch_id) {
            '-'
        } else {
            '+'
        };

        if verbose {
            println!("{sign} {} {}", commit.oid.to_hex(), commit.subject());
        } else {
            println!("{sign} {}", commit.oid.to_hex());
        }
    }
}

/// Dispatches `taxis range-diff`.
pub fn handle_range_diff(ctx: &CliContext) {
    let mut positional = Vec::new();
    for arg in &ctx.args {
        if !arg.starts_with('-') {
            positional.push(arg.as_str());
        }
    }

    if positional.is_empty() {
        fail_usage("usage: taxis range-diff <range1> <range2> or <rev1>...<rev2>");
    }

    let view = RepoView::open_or_exit(ctx);
    let (list1, list2) = if positional.len() == 1 && positional[0].contains("...") {
        let (left_str, right_str) = positional[0]
            .split_once("...")
            .unwrap_or(("", ""));
        let left_oid = match view.resolve(left_str) {
            Ok(oid) => oid,
            Err(err) => fail_fatal(format!("cannot resolve '{left_str}': {err}")),
        };
        let right_oid = match view.resolve(right_str) {
            Ok(oid) => oid,
            Err(err) => fail_fatal(format!("cannot resolve '{right_str}': {err}")),
        };
        if left_oid == right_oid {
            (Vec::new(), Vec::new())
        } else {
            let mut get_node = |oid: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
                let obj = view.object(oid).ok()?;
                let rec = parse_commit_record(*oid, &obj.payload).ok()?;
                Some((
                    CorrectedCommitDate(rec.committer_time.max(0) as u64),
                    rec.parents,
                ))
            };
            let bases = DagWalker::find_merge_bases_with_ccd(
                &left_oid,
                &right_oid,
                &mut get_node,
            );
            let base_oid = bases.first().copied().unwrap_or(left_oid);
            let l1 = resolve_commits_between(&view, base_oid, left_oid).unwrap_or_default();
            let l2 = resolve_commits_between(&view, base_oid, right_oid).unwrap_or_default();
            (l1, l2)
        }
    } else if positional.len() >= 2 {
        let l1 = match resolve_range_commits(&view, positional[0]) {
            Ok(c) => c,
            Err(err) => fail_fatal(format!("range 1 error: {err}")),
        };
        let l2 = match resolve_range_commits(&view, positional[1]) {
            Ok(c) => c,
            Err(err) => fail_fatal(format!("range 2 error: {err}")),
        };
        (l1, l2)
    } else {
        fail_usage("usage: taxis range-diff <range1> <range2> or <rev1>...<rev2>");
    };

    let items1 = build_lineage_items(&view, list1);
    let items2 = build_lineage_items(&view, list2);

    render_range_diff(&items1, &items2);
}

/// Resolves commits between base and tip (exclusive base, inclusive tip, oldest first).
fn resolve_commits_between(
    view: &RepoView,
    base_oid: Oid,
    tip_oid: Oid,
) -> FractalResult<Vec<CommitRecord>> {
    let walked = walk_commits(view, &[tip_oid])?;
    let excluded: HashSet<Oid> = walk_commits(view, &[base_oid])?
        .into_iter()
        .map(|c| c.oid)
        .collect();

    let mut filtered: Vec<CommitRecord> = walked
        .into_iter()
        .filter(|c| !excluded.contains(&c.oid))
        .collect();

    filtered.reverse();
    Ok(filtered)
}

/// Resolves commits in a range string `A..B` (oldest first).
fn resolve_range_commits(view: &RepoView, range_str: &str) -> FractalResult<Vec<CommitRecord>> {
    let (left, right) = range_str
        .split_once("..")
        .ok_or_else(|| FractalError::ObjectCodec(format!("expected range format A..B, got '{range_str}'")))?;

    let left_oid = view.resolve(left)?;
    let right_oid = view.resolve(right)?;
    resolve_commits_between(view, left_oid, right_oid)
}

/// Builds LineageCommit records with patch IDs and diff strings.
fn build_lineage_items(view: &RepoView, commits: Vec<CommitRecord>) -> Vec<LineageCommit> {
    commits
        .into_iter()
        .map(|record| {
            let (patch_id, diff_text) = compute_commit_diff(view, &record).unwrap_or((Oid::ZERO, String::new()));
            LineageCommit {
                record,
                patch_id,
                diff_text,
            }
        })
        .collect()
}

/// Computes commit patch id and diff text.
fn compute_commit_diff(view: &RepoView, record: &CommitRecord) -> FractalResult<(Oid, String)> {
    let parent_rev = record
        .parents
        .first()
        .map(|p| p.to_hex())
        .unwrap_or_else(|| EMPTY_TREE_MARKER.to_string());

    let diff_req = DiffRequest {
        scope: DiffScope::Revisions,
        context: 3,
        revisions: vec![parent_rev, record.oid.to_hex()],
        nul_terminated: false,
        name_only: false,
        stat_only: false,
        no_prefix: false,
        exit_code: false,
        quiet: false,
    };

    let comparisons = collect_comparisons(view, &diff_req)?;
    let width = super::abbrev::abbreviation_width(view.approximate_object_count());

    let mut buf = Vec::new();
    render_text_to_writer(&mut buf, &diff_req, &comparisons, width);
    let diff_text = String::from_utf8_lossy(&buf).into_owned();

    let mut hasher = Sha1::new();
    for line in diff_text.lines() {
        if line.starts_with('+') || line.starts_with('-') {
            hasher.update(line.trim().as_bytes());
            hasher.update(b"\n");
        }
    }
    let patch_oid = Oid::from_bytes(hasher.finalize().into());

    Ok((patch_oid, diff_text))
}

/// Computes just the patch id of a commit.
fn compute_commit_patch_id(view: &RepoView, record: &CommitRecord) -> FractalResult<Oid> {
    let (pid, _) = compute_commit_diff(view, record)?;
    Ok(pid)
}

/// Renders range-diff comparison lines.
fn render_range_diff(range1: &[LineageCommit], range2: &[LineageCommit]) {
    let mut used2 = vec![false; range2.len()];

    // Pass 1: exact patch-id matches
    for (i, c1) in range1.iter().enumerate() {
        let mut matched = None;
        for (j, c2) in range2.iter().enumerate() {
            if !used2[j] && c1.patch_id == c2.patch_id {
                matched = Some(j);
                break;
            }
        }

        if let Some(j) = matched {
            used2[j] = true;
            let c2 = &range2[j];
            let short1 = &c1.record.oid.to_hex()[..7];
            let short2 = &c2.record.oid.to_hex()[..7];
            println!(
                "{:>2}: {} = {:>2}: {} {}",
                i + 1,
                short1,
                j + 1,
                short2,
                c1.record.subject()
            );
            continue;
        }

        // Pass 2: subject matches (modified patch)
        let mut subj_matched = None;
        for (j, c2) in range2.iter().enumerate() {
            if !used2[j] && c1.record.subject() == c2.record.subject() {
                subj_matched = Some(j);
                break;
            }
        }

        if let Some(j) = subj_matched {
            used2[j] = true;
            let c2 = &range2[j];
            let short1 = &c1.record.oid.to_hex()[..7];
            let short2 = &c2.record.oid.to_hex()[..7];
            println!(
                "{:>2}: {} ! {:>2}: {} {}",
                i + 1,
                short1,
                j + 1,
                short2,
                c1.record.subject()
            );
            // Render diff of diffs
            render_diff_of_diffs(&c1.diff_text, &c2.diff_text);
        } else {
            // Dropped from range 1
            let short1 = &c1.record.oid.to_hex()[..7];
            println!(
                "{:>2}: {} <  -: ------- {}",
                i + 1,
                short1,
                c1.record.subject()
            );
        }
    }

    // Remaining in range 2 (added)
    for (j, c2) in range2.iter().enumerate() {
        if !used2[j] {
            let short2 = &c2.record.oid.to_hex()[..7];
            println!(
                " -: ------- > {:>2}: {} {}",
                j + 1,
                short2,
                c2.record.subject()
            );
        }
    }
}

/// Renders a diff of two unified diff bodies.
fn render_diff_of_diffs(d1: &str, d2: &str) {
    let patch = PatchGenerator::generate_patch_ref_with_context("commit-delta", d1, d2, 1);
    for hunk in patch.hunks {
        for line in hunk.lines {
            match line {
                fg_algorithms::PatchLineRef::Addition(a) => println!("    + {}", a),
                fg_algorithms::PatchLineRef::Deletion(d) => println!("    - {}", d),
                fg_algorithms::PatchLineRef::Context(c) => println!("      {}", c),
            }
        }
    }
}
