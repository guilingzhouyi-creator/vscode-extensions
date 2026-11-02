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
    let raw_files = find_all_arg_values(&ctx.args, &["--file", "-f"]);
    let files_to_audit: Vec<String> = if raw_files.is_empty() {
        super::commit::collect_staged_files(ctx)
    } else {
        raw_files.into_iter().map(String::from).collect()
    };

    if files_to_audit.is_empty() {
        if ctx.json_mode {
            let empty_payload = serde_json::json!({
                "engine": "taxis",
                "operation": "gate_slice",
                "passed": true,
                "admitted_threshold": 3.0,
                "staged_files_count": 0,
                "batch_totals": {
                    "total_phys_add": 0,
                    "total_phys_del": 0,
                    "total_eloc_5d_add": 0.0,
                    "total_eloc_5d_del": 0.0,
                    "total_net_5d_turnover": 0.0
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
    let mut evaluated_files = Vec::new();
    let mut bounds_list = Vec::new();

    let mut total_phys_add = 0usize;
    let mut total_phys_del = 0usize;
    let mut total_eloc_5d_add = 0.0f64;
    let mut total_eloc_5d_del = 0.0f64;

    for path_str in &files_to_audit {
        let full_path = work_root.join(path_str);
        let content = fs::read_to_string(&full_path).unwrap_or_default();
        let metrics: File5dElocMetrics = evaluate_file_5d_eloc(&content);

        let is_new = is_file_new_in_repo(&ctx.git_dir, path_str);
        let bounds = SingleFile5dBounds {
            is_new_file: is_new,
            phys_add: metrics.physical_lines,
            phys_del: 0,
            eloc_5d_add: metrics.eloc_5d,
            eloc_5d_del: 0.0,
            substantive_ratio_add: metrics.substantive_line_ratio,
            tspr_add: metrics.tspr,
        };

        total_phys_add += bounds.phys_add;
        total_phys_del += bounds.phys_del;
        total_eloc_5d_add += bounds.eloc_5d_add;
        total_eloc_5d_del += bounds.eloc_5d_del;

        bounds_list.push(bounds);
    }

    for (i, path_str) in files_to_audit.iter().enumerate() {
        evaluated_files.push((path_str.as_str(), bounds_list[i]));
    }

    let batch_totals = CommitBatchTotals {
        total_phys_add,
        total_phys_del,
        total_eloc_5d_add,
        total_eloc_5d_del,
        total_net_5d_turnover: total_eloc_5d_add + total_eloc_5d_del * 0.8,
    };

    let recent_turnovers = load_recent_turnovers(&ctx.git_dir);
    let verdict: DiffBoundsVerdict = DiffBoundsGovernor::evaluate(
        &evaluated_files,
        &batch_totals,
        &recent_turnovers,
        false,
    );

    report_slice_verdict(ctx, &verdict, &batch_totals, files_to_audit.len());

    if !verdict.is_passed {
        std::process::exit(1);
    }
}

fn load_recent_turnovers(git_dir: &Path) -> Vec<f64> {
    let ledger_path = git_dir.join("telemetry/admission_ledger.ndjson");
    if !ledger_path.is_file() {
        return Vec::new();
    }
    let content = match fs::read_to_string(&ledger_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut turnovers = Vec::new();
    for line in content.lines() {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line.trim()) {
            if let Some(turn) = val.get("turnover").and_then(|t| t.as_f64()) {
                turnovers.push(turn);
            }
        }
    }
    turnovers
}

fn report_slice_verdict(
    ctx: &CliContext,
    verdict: &DiffBoundsVerdict,
    totals: &CommitBatchTotals,
    file_count: usize,
) {
    if ctx.json_mode {
        let mut violations = Vec::new();
        for v in &verdict.micro_violations {
            violations.push(serde_json::json!({
                "rule_id": v.rule_id,
                "file": v.file_path,
                "message": v.message
            }));
        }
        if let Some(ref b) = verdict.batch_violation {
            violations.push(serde_json::json!({
                "rule_id": b.rule_id,
                "message": b.message
            }));
        }
        if let Some(ref a) = verdict.admission_violation {
            violations.push(serde_json::json!({
                "rule_id": a.rule_id,
                "turnover": a.turnover,
                "threshold": a.threshold,
                "message": a.message
            }));
        }

        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "gate_slice",
            "passed": verdict.is_passed,
            "admitted_threshold": verdict.admitted_threshold,
            "staged_files_count": file_count,
            "batch_totals": {
                "total_phys_add": totals.total_phys_add,
                "total_phys_del": totals.total_phys_del,
                "total_eloc_5d_add": totals.total_eloc_5d_add,
                "total_eloc_5d_del": totals.total_eloc_5d_del,
                "total_net_5d_turnover": totals.total_net_5d_turnover
            },
            "violations": violations
        });
        print_json(&payload);
        return;
    }

    println!("=== Taxis 5D Slice Gate Verification ===");
    println!(
        "Files Audited: {} | Net 5D Turnover: {:.1} (Threshold: {:.1})",
        file_count, totals.total_net_5d_turnover, verdict.admitted_threshold
    );
    if verdict.is_passed {
        println!("Result: PASS (Within two-tier 5D bounds)");
    } else {
        println!("Result: REJECT (Violations detected):");
        for v in &verdict.micro_violations {
            println!("  [MICRO BLOCK] {}: {} ({})", v.rule_id, v.message, v.file_path);
        }
        if let Some(ref b) = verdict.batch_violation {
            println!("  [BATCH BLOCK] {}: {}", b.rule_id, b.message);
        }
        if let Some(ref a) = verdict.admission_violation {
            println!("  [ADMISSION BLOCK] {}: {}", a.rule_id, a.message);
        }
    }
}

fn is_file_new_in_repo(git_dir: &Path, rel_path: &str) -> bool {
    let index_file = git_dir.join("index");
    if let Ok(git_index) = fg_index::GitIndex::load(&index_file) {
        !git_index.entries().iter().any(|e| e.path == rel_path)
    } else {
        true
    }
}
