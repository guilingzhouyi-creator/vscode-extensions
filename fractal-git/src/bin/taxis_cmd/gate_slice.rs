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
    AdmissionSample, CommitBatchTotals, DiffBoundsGovernor, DiffBoundsVerdict, SingleFile5dBounds,
    DELETION_TURNOVER_WEIGHT, WITNESS_COVERAGE_RATIO,
};
use fg_native::RepoDocument;
use fg_object::borrowed::GitCommitRef;

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

    let (head_oid_opt, head_tree) = load_head_tree(repo_view.as_ref());
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
    let head_add_eloc =
        compute_previous_head_add_eloc(repo_view.as_ref(), head_oid_opt, &head_tree);
    let witness_flags = build_witness_flags(
        &slice_entries,
        batch_totals.total_effective_lines_added,
        head_add_eloc,
    );
    let recent_samples = load_dual_ledger_samples(&ctx.git_dir, &work_root);

    let mut governor_inputs = Vec::with_capacity(slice_entries.len());
    for (entry, &has_witness) in slice_entries.iter().zip(witness_flags.iter()) {
        governor_inputs.push((entry.path.as_str(), entry.bounds, has_witness));
    }

    let governance_verdict: DiffBoundsVerdict = DiffBoundsGovernor::evaluate_with_witnesses(
        &governor_inputs,
        &batch_totals,
        &recent_samples,
    );

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
        let normalized = normalize_cli_path(raw_path, work_root);
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

/// Computes total 5D added ELOC in `HEAD~1..HEAD` as cross-commit refactoring capacity witness.
fn compute_previous_head_add_eloc(
    repo_view: Option<&RepoView>,
    head_oid_opt: Option<Oid>,
    head_tree: &BTreeMap<String, TreeEntry>,
) -> f64 {
    let Some(view) = repo_view else {
        return 0.0;
    };
    let Some(head_oid) = head_oid_opt else {
        return 0.0;
    };
    let Ok(head_obj) = view.object(&head_oid) else {
        return 0.0;
    };
    let Ok(commit_ref) = GitCommitRef::parse(&head_obj.payload) else {
        return 0.0;
    };
    let Some(parent_oid) = commit_ref.parents().first().copied() else {
        return 0.0;
    };
    let Ok(parent_tree) = flatten_commit_tree(view, &parent_oid) else {
        return 0.0;
    };

    let mut head_add_eloc = 0.0f64;
    for (path, head_entry) in head_tree {
        if !is_auditable_code_file(path) {
            continue;
        }
        let parent_entry = parent_tree.get(path);
        if parent_entry.is_some_and(|prev| prev.oid == head_entry.oid) {
            continue;
        }
        head_add_eloc += compute_blob_pair_added_eloc(view, parent_entry, head_entry);
    }
    head_add_eloc
}

/// Evaluates added 5D ELOC for a single changed commit tree pair.
fn compute_blob_pair_added_eloc(
    view: &RepoView,
    parent_entry: Option<&TreeEntry>,
    head_entry: &TreeEntry,
) -> f64 {
    let old_bytes = read_tree_blob_bytes(Some(view), parent_entry);
    let new_bytes = read_tree_blob_bytes(Some(view), Some(head_entry));
    if is_binary_payload(old_bytes.as_deref()) || is_binary_payload(new_bytes.as_deref()) {
        return 0.0;
    }
    let old_text = decode_lf_text(old_bytes.as_deref().unwrap_or(&[]));
    let new_text = decode_lf_text(new_bytes.as_deref().unwrap_or(&[]));
    evaluate_file_diff_5d_eloc(&old_text, &new_text).effective_lines_added
}

/// Computes per-file refactoring witness flags aligned with `diff-envelope-judge.js`.
fn build_witness_flags(
    slice_entries: &[EvaluatedSliceEntry],
    batch_add_eloc: f64,
    head_add_eloc: f64,
) -> Vec<bool> {
    let mut flags = Vec::with_capacity(slice_entries.len());
    for entry in slice_entries {
        let required = entry.bounds.effective_lines_deleted * WITNESS_COVERAGE_RATIO;
        let has_witness = !entry.bounds.is_new_file
            && (batch_add_eloc >= required
                || head_add_eloc >= entry.bounds.effective_lines_deleted);
        flags.push(has_witness);
    }
    flags
}

/// Reads recent Jeffreys admission samples across both Taxis and auto-refactor NDJSON ledgers.
fn load_dual_ledger_samples(git_dir: &Path, work_root: &Path) -> Vec<AdmissionSample> {
    let mut samples = Vec::new();
    let candidate_paths = [
        git_dir.join("telemetry/admission_ledger.ndjson"),
        work_root.join(".auto-refactor-cache/admission-turnover-ledger.ndjson"),
        work_root.join("auto-refactor/.auto-refactor-cache/admission-turnover-ledger.ndjson"),
    ];
    for ledger_path in &candidate_paths {
        append_ledger_samples_from_file(ledger_path, &mut samples);
    }
    samples
}

/// Parses one NDJSON ledger file and appends valid admission samples into `samples`.
fn append_ledger_samples_from_file(ledger_path: &Path, samples: &mut Vec<AdmissionSample>) {
    if !ledger_path.is_file() {
        return;
    }
    let Ok(content) = fs::read_to_string(ledger_path) else {
        return;
    };
    for ledger_line in content.lines() {
        let trimmed = ledger_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(sample) = parse_ledger_sample_line(trimmed) {
            samples.push(sample);
        }
    }
}

/// Parses one JSONL record supporting both `taxis` and `auto-refactor` ledger schemas.
fn parse_ledger_sample_line(trimmed_json: &str) -> Option<AdmissionSample> {
    let value: serde_json::Value = serde_json::from_str(trimmed_json).ok()?;
    let turnover = value
        .get("turnover")
        .and_then(|num| num.as_f64())
        .or_else(|| {
            value
                .get("netSemanticTurnover")
                .and_then(|num| num.as_f64())
        })?;
    if !turnover.is_finite() {
        return None;
    }
    let passed = value
        .get("passed")
        .and_then(|flag| flag.as_bool())
        .or_else(|| value.get("gatePassed").and_then(|flag| flag.as_bool()))
        .or_else(|| {
            value
                .get("verdict")
                .and_then(|verdict| verdict.as_str())
                .map(|verdict| verdict == "ADMITTED")
        })
        .unwrap_or(turnover >= fg_gate::diff_bounds::ADMISSION_TURNOVER_FLOOR);
    Some(AdmissionSample::new(turnover, passed))
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

/// Normalizes CLI `--file`/`-f` inputs relative to `work_root` when passed as worktree paths.
fn normalize_cli_path(raw_path: &str, work_root: &Path) -> String {
    let candidate = Path::new(raw_path);
    if candidate.is_absolute() {
        if let Ok(stripped) = candidate.strip_prefix(work_root) {
            return stripped.to_string_lossy().replace('\\', "/");
        }
    }
    normalize_repo_path(raw_path)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_existing_file_single_line_edit_avoids_whole_file_overflow() {
        let mut old_lines: Vec<String> = (0..135)
            .map(|idx| format!("pub fn compute_step_{idx}(v: usize) -> usize {{ v + {idx} }}"))
            .collect();
        let old_text = format!("{}\n", old_lines.join("\n"));
        old_lines[12] = "pub fn compute_step_12(v: usize) -> usize { v * 2 + 12 }".to_string();
        let new_text = format!("{}\n", old_lines.join("\n"));

        let evaluated = build_evaluated_slice_entry(
            "src/large_existing.rs".to_string(),
            false,
            Some(old_text.as_bytes()),
            Some(new_text.as_bytes()),
        )
        .expect("non-binary text entry");

        assert_eq!(evaluated.bounds.physical_lines_added, 1);
        assert_eq!(evaluated.bounds.physical_lines_deleted, 1);
        assert_eq!(evaluated.bounds.effective_lines_added, 1.0);
        assert_eq!(evaluated.bounds.effective_lines_deleted, 1.0);
        assert!(!evaluated.bounds.is_new_file);
        assert!(fg_gate::diff_bounds::audit_single_file_envelope(
            &evaluated.path,
            &evaluated.bounds,
            false
        )
        .is_ok());
    }

    #[test]
    fn large_existing_file_small_substantive_patch_passes_full_governor_admission() {
        let mut old_lines: Vec<String> = (0..140)
            .map(|idx| format!("pub fn item_{idx}(x: i64) -> i64 {{ x + {idx} }}"))
            .collect();
        let old_text = format!("{}\n", old_lines.join("\n"));
        old_lines[20] = "pub fn item_20(x: i64) -> i64 { x.saturating_add(42) }".to_string();
        old_lines.insert(
            21,
            "pub fn item_extra_a(x: i64) -> i64 { x * 3 }".to_string(),
        );
        old_lines.insert(
            22,
            "pub fn item_extra_b(x: i64) -> i64 { x * 5 }".to_string(),
        );
        let new_text = format!("{}\n", old_lines.join("\n"));

        let evaluated = build_evaluated_slice_entry(
            "src/large_module.rs".to_string(),
            false,
            Some(old_text.as_bytes()),
            Some(new_text.as_bytes()),
        )
        .expect("non-binary text entry");

        let entries = [evaluated];
        let totals = compute_batch_totals(&entries);
        let witness_flags = build_witness_flags(&entries, totals.total_effective_lines_added, 0.0);
        let governor_inputs = [(
            entries[0].path.as_str(),
            entries[0].bounds,
            witness_flags[0],
        )];
        let verdict = DiffBoundsGovernor::evaluate_with_witnesses(&governor_inputs, &totals, &[]);

        assert!(verdict.is_admitted);
        assert!(verdict.file_violations.is_empty());
        assert_eq!(totals.total_effective_lines_added, 3.0);
        assert_eq!(totals.total_net_turnover, 3.8);
    }

    #[test]
    fn edit_inside_block_comment_yields_zero_effective_additions() {
        let old_text = "/*\n * Old comment interior line\n */\npub fn live() -> usize { 1 }\n";
        let new_text =
            "/*\nUpdated plain prose without leading asterisk\n */\npub fn live() -> usize { 1 }\n";

        let evaluated = build_evaluated_slice_entry(
            "src/commented.rs".to_string(),
            false,
            Some(old_text.as_bytes()),
            Some(new_text.as_bytes()),
        )
        .expect("non-binary");
        assert_eq!(evaluated.bounds.physical_lines_added, 1);
        assert_eq!(evaluated.bounds.effective_lines_added, 0.0);
    }

    #[test]
    fn dual_ledger_parser_supports_both_schemas() {
        let taxis_sample = parse_ledger_sample_line(r#"{"turnover":12.5,"passed":true}"#)
            .expect("taxis ledger entry");
        assert_eq!(taxis_sample, AdmissionSample::new(12.5, true));

        let ar_sample =
            parse_ledger_sample_line(r#"{"netSemanticTurnover":8.0,"verdict":"ADMITTED"}"#)
                .expect("auto-refactor ledger entry");
        assert_eq!(ar_sample, AdmissionSample::new(8.0, true));

        let ar_blocked = parse_ledger_sample_line(
            r#"{"netSemanticTurnover":2.0,"verdict":"BLOCKED_INSUFFICIENT_TURNOVER"}"#,
        )
        .expect("auto-refactor blocked entry");
        assert_eq!(ar_blocked, AdmissionSample::new(2.0, false));
    }

    #[test]
    fn collect_changed_index_paths_returns_empty_when_index_matches_head() {
        let oid = Oid::from_bytes([9u8; 20]);
        let mut head_tree = BTreeMap::new();
        head_tree.insert(
            "src/unchanged.rs".to_string(),
            TreeEntry {
                mode: FileMode::RegularFile,
                oid,
            },
        );
        let mut index_map = BTreeMap::new();
        index_map.insert("src/unchanged.rs".to_string(), (oid, FileMode::RegularFile));
        let changed = collect_changed_index_paths(&head_tree, &index_map);
        assert!(changed.is_empty());
    }
}
