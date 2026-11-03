//! Module: taxis_cmd::gate_slice — Incremental 5D Differential Slice Gate
//! File Path: src/bin/taxis_cmd/gate_slice.rs
//! Architecture Role: Evaluates two-tier 5D ELOC differential bounds and empirical admission on staged changes.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

use std::fs;
use std::path::Path;

use fg_algorithms::diff::{evaluate_file_5d_eloc, File5dElocMetrics};
use fg_gate::diff_bounds::{
    CommitBatchTotals, DiffBoundsGovernor, DiffBoundsVerdict, SingleFile5dBounds,
};

use super::common::{find_all_arg_values, print_json, CliContext};

/// Dispatches the `taxis gate-slice` command.
pub fn handle_gate_slice(ctx: &CliContext) {
    let cli_file_arguments = find_all_arg_values(&ctx.args, &["--file", "-f"]);
    let source_is_cli = !cli_file_arguments.is_empty();
    let candidate_file_paths: Vec<String> = if cli_file_arguments.is_empty() {
        super::commit::collect_staged_files(ctx)
    } else {
        cli_file_arguments.into_iter().map(String::from).collect()
    };

    if candidate_file_paths.is_empty() {
        if ctx.json_mode {
            let empty_payload = serde_json::json!({
                "engine": "taxis",
                "operation": "gate_slice",
                "passed": true,
                "admitted_threshold": 3.0,
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
        println!("=== Taxis 5D Slice Gate: Zero staged files, passing cleanly ===");
        return;
    }

    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    fg_core::diag_info!(
        "gate_slice",
        "evaluating {} file(s) from {}",
        candidate_file_paths.len(),
        if source_is_cli {
            "cli"
        } else {
            "index"
        }
    );
    let mut evaluated_files = Vec::new();
    let mut file_envelopes = Vec::new();

    let mut total_physical_lines_added = 0usize;
    let mut total_physical_lines_deleted = 0usize;
    let mut total_effective_lines_added = 0.0f64;
    let mut total_effective_lines_deleted = 0.0f64;

    for relative_path in &candidate_file_paths {
        let absolute_file_path = work_root.join(relative_path);
        let file_content = fs::read_to_string(&absolute_file_path).unwrap_or_default();
        let file_metrics: File5dElocMetrics = evaluate_file_5d_eloc(&file_content);

        let is_newly_created = is_file_untracked_in_repo(&ctx.git_dir, relative_path);
        let single_file_envelope = SingleFile5dBounds::new(
            is_newly_created,
            file_metrics.physical_lines,
            0,
            file_metrics.effective_lines_of_code,
            0.0,
            file_metrics.substantive_line_ratio,
            file_metrics.substance_preservation_ratio,
        );

        total_physical_lines_added += single_file_envelope.physical_lines_added;
        total_physical_lines_deleted += single_file_envelope.physical_lines_deleted;
        total_effective_lines_added += single_file_envelope.effective_lines_added;
        total_effective_lines_deleted += single_file_envelope.effective_lines_deleted;

        file_envelopes.push(single_file_envelope);
    }

    for (index, file_path) in candidate_file_paths.iter().enumerate() {
        evaluated_files.push((file_path.as_str(), file_envelopes[index]));
    }

    let total_net_turnover =
        total_effective_lines_added + total_effective_lines_deleted * 0.8;
    let batch_totals = CommitBatchTotals::new(
        total_physical_lines_added,
        total_physical_lines_deleted,
        total_effective_lines_added,
        total_effective_lines_deleted,
        total_net_turnover,
    );

    let historical_turnovers = load_recent_turnover_records(&ctx.git_dir);
    let governance_verdict: DiffBoundsVerdict = DiffBoundsGovernor::evaluate(
        &evaluated_files,
        &batch_totals,
        &historical_turnovers,
        false,
    );

    report_slice_verdict(
        ctx,
        &governance_verdict,
        &batch_totals,
        candidate_file_paths.len(),
    );

    if !governance_verdict.is_admitted {
        std::process::exit(1);
    }
}

fn load_recent_turnover_records(git_dir: &Path) -> Vec<f64> {
    let ledger_path = git_dir.join("telemetry/admission_ledger.ndjson");
    if !ledger_path.is_file() {
        return Vec::new();
    }
    let content = match fs::read_to_string(&ledger_path) {
        Ok(read_content) => read_content,
        Err(_) => return Vec::new(),
    };
    let mut historical_turnovers = Vec::new();
    for ledger_line in content.lines() {
        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(ledger_line.trim()) {
            if let Some(turnover_num) = json_value.get("turnover").and_then(|t| t.as_f64()) {
                historical_turnovers.push(turnover_num);
            }
        }
    }
    historical_turnovers
}

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
        audited_file_count,
        batch_totals.total_net_turnover,
        governance_verdict.admission_threshold
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

fn is_file_untracked_in_repo(git_dir: &Path, relative_file_path: &str) -> bool {
    let index_file = git_dir.join("index");
    if let Ok(git_index) = fg_index::GitIndex::load(&index_file) {
        !git_index
            .entries()
            .iter()
            .any(|entry| entry.path == relative_file_path)
    } else {
        true
    }
}
