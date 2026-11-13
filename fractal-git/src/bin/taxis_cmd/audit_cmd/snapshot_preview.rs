//! Module: taxis_cmd::audit_cmd — Read-Only `--snapshot-dir` Preview Evaluator
//! File Path: src/bin/taxis_cmd/audit_cmd/snapshot_preview.rs
//! Architecture Role: Evaluates an arbitrary filesystem snapshot directory purely in memory
//!   via `fractal_git::audit_runner` for parity harnesses without mutating ODB or refs.
//! Dependencies & Triggers: Triggered by `taxis audit run --snapshot-dir <dir>`.
//! Responsibilities: Return structured 10D, SQALE, ADR-Q, and AAS outputs in JSON or Markdown.
//! Exit Semantics & Design Rationale: Zero writes to `.audit-logs/` or Git references.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use fg_core::crypto::sm3_hash;
use fg_core::models::AuthoritySecret;
use fg_gate::audit_engine::SnapshotFileSlice;
use fg_gate::authority::resolve_authority_secret;
use fractal_git::audit_runner::{evaluate_and_seal_snapshot, SnapshotAuditRequest};
use fractal_git::constants::cli::CliTag;
use serde_json::Value;

use crate::taxis_cmd::common::{print_json, reject, CliContext};
use crate::taxis_cmd::daemon::daemon_scheduler::{
    parse_archetype_flag, resolve_or_ephemeral_secret,
};

use super::snapshot_walk::{collect_snapshot_files, compute_snapshot_tree_oid};

pub(super) fn handle_snapshot_dir_audit(ctx: &CliContext, snapshot_dir: &Path) {
    if !snapshot_dir.is_dir() {
        reject(
            CliTag::ERROR,
            format!(
                "snapshot directory does not exist: {}",
                snapshot_dir.display()
            ),
        );
    }

    let owned_files = collect_snapshot_files(snapshot_dir);
    let mut slices = Vec::with_capacity(owned_files.len());
    for (rel_path, content) in &owned_files {
        slices.push(SnapshotFileSlice {
            rel_path: rel_path.as_str(),
            content: content.as_slice(),
        });
    }

    let now_ms = current_epoch_ms();
    let review_id = format!("rev-{now_ms}");
    let operation_id = format!("op-{now_ms}");
    let tree_oid = compute_snapshot_tree_oid(&owned_files);
    let archetype = parse_archetype_flag(&ctx.args);
    let secret = resolve_snapshot_secret(&ctx.git_dir);
    let repo_id = snapshot_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("snapshot-fixture");

    let outcome = evaluate_and_seal_snapshot(&SnapshotAuditRequest {
        repository_id: repo_id,
        review_id: review_id.as_str(),
        operation_id: operation_id.as_str(),
        tree_oid,
        parent_oids: &[],
        archetype,
        previous_scores: &[],
        previous_evidence_digest: None,
        authority_secret: &secret,
        key_id: "snapshot-preview",
        now_ms,
        changed_eloc: 0,
        net_debt_eliminated: 0.0,
        claims_score_gain: false,
        previous_sqale_minutes: None,
        previous_composite_score: None,
        slices: &slices,
    })
    .unwrap_or_else(|err| reject(CliTag::ERROR, err.to_string()));

    let composite_score = outcome
        .evidence
        .measurements
        .ten_dimensions
        .as_ref()
        .map(|dims| dims.composite_score);
    let grade = outcome
        .evidence
        .measurements
        .ten_dimensions
        .as_ref()
        .map_or("F", |dims| dims.grade.as_str());
    let aas_val: Value = serde_json::from_slice(&outcome.aas_summary_json).unwrap_or(Value::Null);
    let decision_str = format!("{:?}", outcome.receipt.payload.decision).to_lowercase();

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "ok": true,
            "mode": "snapshot-dir",
            "snapshot_dir": snapshot_dir.to_string_lossy(),
            "file_count": owned_files.len(),
            "total_eloc": outcome.total_eloc,
            "error_count": outcome.error_count,
            "warning_count": outcome.warning_count,
            "info_count": outcome.info_count,
            "anti_gaming_passed": outcome.anti_gaming_passed,
            "anti_gaming_reason": outcome.anti_gaming_reason,
            "decision": decision_str,
            "grade": grade,
            "composite_score": composite_score,
            "ten_dimensions": outcome.evidence.measurements.ten_dimensions,
            "quant_metrics": outcome.evidence.measurements.quant_metrics,
            "diagnostics": outcome.evidence.diagnostics,
            "evidence": outcome.evidence,
            "receipt": outcome.receipt,
            "aas": aas_val,
            "writes_audit_logs_dir": false,
        }));
    } else {
        println!("{}", outcome.markdown_report);
    }
}

fn resolve_snapshot_secret(git_dir: &Path) -> AuthoritySecret {
    if let Ok(secret) = resolve_authority_secret(git_dir) {
        return secret;
    }
    if let Ok(secret) = resolve_or_ephemeral_secret(git_dir) {
        return secret;
    }
    let key = sm3_hash(b"taxis-snapshot-preview-ephemeral");
    AuthoritySecret::from_bytes(&key).unwrap_or_else(|err| reject(CliTag::ERROR, err.to_string()))
}

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|dur| u64::try_from(dur.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}
