//! Module: taxis_cmd::gate_slice — Incremental 5D Differential Slice Gate
//! File Path: src/bin/taxis_cmd/gate_slice.rs
//! Architecture Role: Evaluates two-tier 5D ELOC differential bounds and empirical admission on staged changes.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use fg_algorithms::diff::eloc_5d::evaluate_file_diff_5d_eloc;
use fg_core::models::{FileMode, IndexStage, Oid};
use fg_gate::diff_bounds::{
    CommitBatchTotals, DiffBoundsGovernor, DiffBoundsVerdict, SingleFile5dBounds,
    DELETION_TURNOVER_WEIGHT,
};
use fg_native::RepoDocument;

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
    let staged_only_mode = ctx.args.iter().any(|arg| arg == "--staged");
    let source_is_cli = !cli_file_arguments.is_empty();

    let repo_view = RepoView::open(ctx).ok();
    let work_root = repo_view
        .as_ref()
        .map(|view| view.work_root().to_path_buf())
        .unwrap_or_else(|| super::repo_view::resolve_work_root(&ctx.git_dir));

    let (_, head_tree) = load_head_tree(repo_view.as_ref());
    let index_map = load_active_index_map(&ctx.git_dir);

    let slice_entries = if source_is_cli {
        collect_cli_slice_entries(
            &cli_file_arguments,
            staged_only_mode,
            &work_root,
            repo_view.as_ref(),
            &head_tree,
            &index_map,
        )
    } else {
        collect_staged_slice_entries(&head_tree, &index_map, repo_view.as_ref())
    };

    if slice_entries.is_empty() {
        emit_empty_slice_pass(ctx);
        return;
    }

    fg_core::diag_info!(
        "gate_slice",
        "evaluating {} file(s) from {}",
        slice_entries.len(),
        if source_is_cli { "cli" } else { "index" }
    );

    let batch_totals = compute_batch_totals(&slice_entries);
    let governor_inputs: Vec<(&str, SingleFile5dBounds, bool)> = slice_entries
        .iter()
        .map(|entry| (entry.path.as_str(), entry.bounds, false))
        .collect();

    let governance_verdict: DiffBoundsVerdict =
        DiffBoundsGovernor::evaluate_with_witnesses(&governor_inputs, &batch_totals, &[]);

    report_slice_verdict(ctx, &governance_verdict, &batch_totals, slice_entries.len());

    if !governance_verdict.is_admitted {
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

/// Loads stage-0 entries from `.git/index` or falls back to the native container index section.
fn load_active_index_map(git_dir: &Path) -> BTreeMap<String, (Oid, FileMode)> {
    let mut index_map = BTreeMap::new();
    let index_file = git_dir.join("index");
    if index_file.is_file() {
        if let Ok(git_index) = fg_index::GitIndex::load(&index_file) {
            for entry in git_index.entries() {
                if entry.stage == IndexStage::Normal {
                    index_map.insert(normalize_repo_path(&entry.path), (entry.oid, entry.mode));
                }
            }
        }
        return index_map;
    }

    let container_path = fg_native::container_path(git_dir);
    if container_path.is_file() {
        if let Ok(doc) = RepoDocument::load(&container_path) {
            for entry in doc.indx.entries() {
                if entry.stage == IndexStage::Normal {
                    index_map.insert(normalize_repo_path(&entry.path), (entry.oid, entry.mode));
                }
            }
        }
    }
    index_map
}

/// Collects differential deltas for staged auditable code files comparing Index against `HEAD`.
fn collect_staged_slice_entries(
    head_tree: &BTreeMap<String, TreeEntry>,
    index_map: &BTreeMap<String, (Oid, FileMode)>,
    repo_view: Option<&RepoView>,
) -> Vec<EvaluatedSliceEntry> {
    let candidate_paths = collect_changed_index_paths(head_tree, index_map);
    let mut entries = Vec::with_capacity(candidate_paths.len());
    for rel_path in candidate_paths {
        if !is_auditable_code_file(&rel_path) {
            continue;
        }
        if let Some(evaluated) = evaluate_staged_pair(&rel_path, head_tree, index_map, repo_view) {
            entries.push(evaluated);
        }
    }
    entries
}

/// Collects differential deltas for explicit `--file`/`-f` CLI targets against `HEAD`.
fn collect_cli_slice_entries(
    cli_paths: &[&str],
    staged_only_mode: bool,
    work_root: &Path,
    repo_view: Option<&RepoView>,
    head_tree: &BTreeMap<String, TreeEntry>,
    index_map: &BTreeMap<String, (Oid, FileMode)>,
) -> Vec<EvaluatedSliceEntry> {
    let mut unique_paths = BTreeSet::new();
    for raw_path in cli_paths {
        let normalized = normalize_repo_path(raw_path);
        if !normalized.is_empty() {
            unique_paths.insert(normalized);
        }
    }
    let mut entries = Vec::with_capacity(unique_paths.len());
    for rel_path in unique_paths {
        if let Some(evaluated) = evaluate_cli_target(
            rel_path,
            staged_only_mode,
            work_root,
            repo_view,
            head_tree,
            index_map,
        ) {
            entries.push(evaluated);
        }
    }
    entries
}

/// Collects all paths whose Index entry differs from the `HEAD` tree.
fn collect_changed_index_paths(
    head_tree: &BTreeMap<String, TreeEntry>,
    index_map: &BTreeMap<String, (Oid, FileMode)>,
) -> Vec<String> {
    let mut changed = Vec::new();
    for (path, (idx_oid, idx_mode)) in index_map {
        let unchanged = head_tree
            .get(path)
            .is_some_and(|head_entry| head_entry.oid == *idx_oid && head_entry.mode == *idx_mode);
        if !unchanged {
            changed.push(path.clone());
        }
    }
    for path in head_tree.keys() {
        if !index_map.contains_key(path) {
            changed.push(path.clone());
        }
    }
    changed
}

/// Evaluates a staged path by comparing its Index blob payload against its `HEAD` blob payload.
fn evaluate_staged_pair(
    rel_path: &str,
    head_tree: &BTreeMap<String, TreeEntry>,
    index_map: &BTreeMap<String, (Oid, FileMode)>,
    repo_view: Option<&RepoView>,
) -> Option<EvaluatedSliceEntry> {
    let old_bytes = read_tree_blob_bytes(repo_view, head_tree.get(rel_path));
    let new_bytes = read_index_blob_bytes(repo_view, index_map.get(rel_path));
    build_evaluated_slice_entry(
        rel_path.to_string(),
        !head_tree.contains_key(rel_path),
        old_bytes.as_deref(),
        new_bytes.as_deref(),
    )
}

/// Evaluates a CLI-specified file target from staged Index or worktree against `HEAD`.
fn evaluate_cli_target(
    rel_path: String,
    staged_only_mode: bool,
    work_root: &Path,
    repo_view: Option<&RepoView>,
    head_tree: &BTreeMap<String, TreeEntry>,
    index_map: &BTreeMap<String, (Oid, FileMode)>,
) -> Option<EvaluatedSliceEntry> {
    let old_bytes = read_tree_blob_bytes(repo_view, head_tree.get(&rel_path));
    let new_bytes = if staged_only_mode {
        read_index_blob_bytes(repo_view, index_map.get(&rel_path))
    } else {
        fs::read(work_root.join(&rel_path)).ok()
    };
    let is_new_file = !head_tree.contains_key(&rel_path);
    build_evaluated_slice_entry(
        rel_path,
        is_new_file,
        old_bytes.as_deref(),
        new_bytes.as_deref(),
    )
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

/// Reads raw blob payload from a staged index entry, excluding gitlinks.
fn read_index_blob_bytes(
    repo_view: Option<&RepoView>,
    entry: Option<&(Oid, FileMode)>,
) -> Option<Vec<u8>> {
    let view = repo_view?;
    let (oid, mode) = entry?;
    view.payload_for(*mode, oid).ok()
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

/// Normalizes repository-relative paths to forward-slash notation.
fn normalize_repo_path(raw_path: &str) -> String {
    let trimmed = raw_path
        .trim()
        .trim_start_matches("./")
        .trim_start_matches(".\\");
    trimmed.replace('\\', "/")
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
