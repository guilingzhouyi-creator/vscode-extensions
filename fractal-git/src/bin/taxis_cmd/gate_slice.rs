//! Module: taxis_cmd::gate_slice — Incremental 5D Differential Slice Gate
//! File Path: src/bin/taxis_cmd/gate_slice.rs
//! Architecture Role: Evaluates two-tier 5D ELOC differential bounds and empirical admission on staged changes.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

use std::collections::BTreeMap;
use std::fs;

use fg_algorithms::diff::eloc_5d::evaluate_file_diff_5d_eloc;
use fg_core::models::Oid;
use fg_gate::diff_bounds::{
    CommitBatchTotals, DiffBoundsGovernor, DiffBoundsVerdict, SingleFile5dBounds,
    DELETION_TURNOVER_WEIGHT,
};

use super::common::{find_all_arg_values, print_json, CliContext};
use super::repo_view::RepoView;
use super::tree_view::{flatten_commit_tree, TreeEntry};

/// Binary sniff boundary aligned with Git (`xdiff-interface.c`).
const BINARY_SNIFF_LIMIT: usize = 8000;

/// Evaluated differential delta paired with normalized path and file novelty flag.
struct EvaluatedSliceEntry {
    path: String,
    bounds: SingleFile5dBounds,
}

/// Dispatches the `taxis gate-slice` command.
pub fn handle_gate_slice(ctx: &CliContext) {
    let cli_file_arguments = find_all_arg_values(&ctx.args, &["--file", "-f"]);
    let candidate_file_paths: Vec<String> = if !cli_file_arguments.is_empty() {
        cli_file_arguments.into_iter().map(String::from).collect()
    } else {
        super::commit::collect_staged_files(ctx)
    };
    let repo_view = RepoView::open(ctx).ok();
    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    let (_, head_tree) = load_head_tree(repo_view.as_ref());
    let mut evaluated_entries = Vec::with_capacity(candidate_file_paths.len());
    for file_path in &candidate_file_paths {
        if !is_auditable_code_file(file_path) {
            continue;
        }
        let new_bytes = fs::read(work_root.join(file_path)).ok();
        let old_bytes = read_tree_blob_bytes(repo_view.as_ref(), head_tree.get(file_path));
        if let Some(entry) = build_evaluated_slice_entry(
            file_path.clone(),
            !head_tree.contains_key(file_path),
            old_bytes.as_deref(),
            new_bytes.as_deref(),
        ) {
            evaluated_entries.push(entry);
        }
    }
    if evaluated_entries.is_empty() {
        emit_empty_slice_pass(ctx);
        return;
    }
    let batch_totals = compute_batch_totals(&evaluated_entries);
    let governor_inputs: Vec<(&str, SingleFile5dBounds, bool)> = evaluated_entries
        .iter()
        .map(|entry| (entry.path.as_str(), entry.bounds, false))
        .collect();
    let verdict = DiffBoundsGovernor::evaluate_with_witnesses(&governor_inputs, &batch_totals, &[]);
    report_slice_verdict(ctx, &verdict, &batch_totals, evaluated_entries.len());
    if !verdict.is_admitted {
        std::process::exit(1);
    }
}

/// Emits a structured clean PASS verdict when the candidate staging slice contains zero files.
fn emit_empty_slice_pass(ctx: &CliContext) {
    if ctx.json_mode {
        let empty_payload = serde_json::json!({
            "engine": "taxis",
            "operation": "gate_slice",
            "passed": true,
            "admitted_threshold": fg_gate::diff_bounds::ADMISSION_TURNOVER_FLOOR,
            "staged_files_count": 0,
            "batch_totals": {
                "total_physical_lines_added": 0,
                "total_physical_lines_deleted": 0,
                "total_effective_lines_added": 0.0,
                "total_effective_lines_deleted": 0.0,
                "total_net_turnover": 0.0
            },
            "violations": []
        });
        print_json(&empty_payload);
        return;
    }
    println!("=== Taxis 5D Slice Gate: Zero auditable staged files, passing cleanly ===");
}

/// Loads the effective `HEAD` commit OID and flattens its tree into a normalized path map.
fn load_head_tree(repo_view: Option<&RepoView>) -> (Option<Oid>, BTreeMap<String, TreeEntry>) {
    let Some(view) = repo_view else {
        return (None, BTreeMap::new());
    };
    let head_oid = match view.effective_head_commit() {
        Ok(Some((_, oid))) => Some(oid),
        _ => view.head_commit().ok().flatten(),
    };
    let Some(oid) = head_oid else {
        return (None, BTreeMap::new());
    };
    let tree = flatten_commit_tree(view, &oid).unwrap_or_default();
    (Some(oid), tree)
}

/// Reads raw blob payload from a flattened tree entry, excluding gitlinks.
fn read_tree_blob_bytes(
    repo_view: Option<&RepoView>,
    entry: Option<&TreeEntry>,
) -> Option<Vec<u8>> {
    let view = repo_view?;
    let tree_entry = entry?;
    view.payload_for(tree_entry.mode, &tree_entry.oid).ok()
}

/// Computes incremental 5D ELOC delta between two optional raw byte slices.
fn build_evaluated_slice_entry(
    path: String,
    is_new_file: bool,
    old_bytes: Option<&[u8]>,
    new_bytes: Option<&[u8]>,
) -> Option<EvaluatedSliceEntry> {
    if is_binary_payload(old_bytes) || is_binary_payload(new_bytes) {
        return None;
    }
    let old_text = decode_lf_text(old_bytes.unwrap_or(&[]));
    let new_text = decode_lf_text(new_bytes.unwrap_or(&[]));
    let delta = evaluate_file_diff_5d_eloc(&old_text, &new_text);

    Some(EvaluatedSliceEntry {
        path,
        bounds: SingleFile5dBounds::new(
            is_new_file,
            delta.physical_lines_added,
            delta.physical_lines_deleted,
            delta.effective_lines_added,
            delta.effective_lines_deleted,
            delta.substantive_ratio_added,
            delta.preservation_ratio_added,
        ),
    })
}

/// Checks binary status using Git's 8,000-byte NUL heuristic.
#[inline]
fn is_binary_payload(payload: Option<&[u8]>) -> bool {
    let Some(bytes) = payload else {
        return false;
    };
    let inspect_len = bytes.len().min(BINARY_SNIFF_LIMIT);
    bytes[..inspect_len].contains(&0)
}

/// Decodes UTF-8 lossily and normalizes CRLF to LF for line-accurate differential matching.
fn decode_lf_text(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    let lossy = String::from_utf8_lossy(bytes);
    if lossy.contains("\r\n") {
        lossy.replace("\r\n", "\n")
    } else {
        lossy.into_owned()
    }
}

/// Computes macro batch addition, deletion, and 0.8-weighted turnover totals.
fn compute_batch_totals(slice_entries: &[EvaluatedSliceEntry]) -> CommitBatchTotals {
    let mut total_physical_lines_added = 0usize;
    let mut total_physical_lines_deleted = 0usize;
    let mut total_effective_lines_added = 0.0f64;
    let mut total_effective_lines_deleted = 0.0f64;

    for entry in slice_entries {
        total_physical_lines_added += entry.bounds.physical_lines_added;
        total_physical_lines_deleted += entry.bounds.physical_lines_deleted;
        total_effective_lines_added += entry.bounds.effective_lines_added;
        total_effective_lines_deleted += entry.bounds.effective_lines_deleted;
    }

    let raw_turnover =
        total_effective_lines_added + total_effective_lines_deleted * DELETION_TURNOVER_WEIGHT;
    let total_net_turnover = (raw_turnover * 100.0).round() / 100.0;

    CommitBatchTotals::new(
        total_physical_lines_added,
        total_physical_lines_deleted,
        total_effective_lines_added,
        total_effective_lines_deleted,
        total_net_turnover,
    )
}

/// Matches the auditable code file filter owned by `differential-diff-parser.js`.
fn is_auditable_code_file(rel_path: &str) -> bool {
    let Some((_, raw_ext)) = rel_path.rsplit_once('.') else {
        return false;
    };
    let lower_ext = raw_ext.to_ascii_lowercase();
    if matches!(
        lower_ext.as_str(),
        "md" | "json" | "yml" | "yaml" | "txt" | "toml" | "svg" | "png" | "lock"
    ) {
        return false;
    }
    matches!(
        lower_ext.as_str(),
        "ts" | "tsx" | "js" | "jsx" | "rs" | "gd" | "py" | "sh" | "bash" | "ps1"
    )
}

/// Emits slice gate verdict in JSON or human-readable terminal format.
fn report_slice_verdict(
    ctx: &CliContext,
    governance_verdict: &DiffBoundsVerdict,
    batch_totals: &CommitBatchTotals,
    audited_file_count: usize,
) {
    if ctx.json_mode {
        let mut violations = Vec::new();
        for single_violation in &governance_verdict.file_violations {
            violations.push(serde_json::json!({
                "rule_id": single_violation.rule_id,
                "file": single_violation.file_path,
                "message": single_violation.message
            }));
        }
        if let Some(ref batch_violation) = governance_verdict.batch_violation {
            violations.push(serde_json::json!({
                "rule_id": batch_violation.rule_id,
                "message": batch_violation.message
            }));
        }
        if let Some(ref admission_violation) = governance_verdict.admission_violation {
            violations.push(serde_json::json!({
                "rule_id": admission_violation.rule_id,
                "actual_turnover": admission_violation.actual_turnover,
                "required_threshold": admission_violation.required_threshold,
                "message": admission_violation.message
            }));
        }

        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "gate_slice",
            "passed": governance_verdict.is_admitted,
            "admitted_threshold": governance_verdict.admission_threshold,
            "staged_files_count": audited_file_count,
            "batch_totals": {
                "total_physical_lines_added": batch_totals.total_physical_lines_added,
                "total_physical_lines_deleted": batch_totals.total_physical_lines_deleted,
                "total_effective_lines_added": batch_totals.total_effective_lines_added,
                "total_effective_lines_deleted": batch_totals.total_effective_lines_deleted,
                "total_net_turnover": batch_totals.total_net_turnover
            },
            "violations": violations
        });
        print_json(&payload);
        return;
    }

    println!("=== Taxis 5D Slice Gate Verification ===");
    println!(
        "Files Audited: {} | Net 5D Turnover: {:.1} (Threshold: {:.1})",
        audited_file_count, batch_totals.total_net_turnover, governance_verdict.admission_threshold
    );
    if governance_verdict.is_admitted {
        println!("Result: PASS (Within two-tier 5D bounds)");
    } else {
        println!("Result: REJECT (Violations detected):");
        for single_violation in &governance_verdict.file_violations {
            println!(
                "  [MICRO BLOCK] {}: {} ({})",
                single_violation.rule_id, single_violation.message, single_violation.file_path
            );
        }
        if let Some(ref batch_violation) = governance_verdict.batch_violation {
            println!(
                "  [BATCH BLOCK] {}: {}",
                batch_violation.rule_id, batch_violation.message
            );
        }
        if let Some(ref admission_violation) = governance_verdict.admission_violation {
            println!(
                "  [ADMISSION BLOCK] {}: {}",
                admission_violation.rule_id, admission_violation.message
            );
        }
    }
}
