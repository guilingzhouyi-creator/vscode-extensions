//! Module: Fractal Git — Native Audit Evaluation Pipeline
//! File Path: src/audit_runner/eval.rs
//! Architecture Role: Coordinates slice auditing, 10D/SQALE/ADR-Q/CAI scoring, anti-gaming
//!   conjunction, canonical evidence/receipt signing, and AAS/Markdown summary generation.
//! Dependencies & Triggers: Invoked by [`evaluate_and_seal_snapshot`].
//! Responsibilities: Seal deterministic [`NativeAuditOutcome`] without filesystem mutation.
//! Exit Semantics & Design Rationale: Delegates binding/signing cleanly to `binding.rs`.

use std::time::Instant;

use fg_algorithms::scoring::{
    build_quant_metrics_dto, evaluate_adrq_risk, evaluate_anti_gaming_conjunction,
    evaluate_cai_autonomy_rate, evaluate_project_quality, evaluate_technical_debt, AdrqInputs,
    AntiGamingInputs, EvaluatedQualityScore, FileMetricSummary, QualityCurveConfig,
};
use fg_core::error::FractalResult;
use fg_core::models::quality_encoding::{canonical_review_json, canonical_review_sm3};
use fg_gate::audit_engine::audit_snapshot_slices;

use super::binding::{build_review_binding, determine_receipt_decision, seal_trusted_receipt};
use super::cai_eval::{
    build_cai_inputs, compute_adrq_yield_pair, compute_manifest_sm3_hex, compute_pattern_penalty,
    count_severities, hex_sm3,
};
use super::evidence::{build_analysis_evidence, EvidenceBuildInput};
use super::metrics::{
    count_rule_families, evaluate_per_file_scores, evaluate_snapshot_polyglot, to_scoring_finding,
};
use super::report::{build_aas_summary, build_markdown_report, SummaryOutputInput};
use super::{hex_codec, NativeAuditOutcome, SnapshotAuditRequest};

/// Executes full pure-Rust snapshot audit, scoring, anti-gaming check, and HMAC-SM3 signing.
///
/// # Errors
///
/// Propagates [`fg_core::error::FractalError`] on rule drift, canonical JSON, or signing errors.
pub fn evaluate_and_seal_snapshot(
    req: &SnapshotAuditRequest<'_>,
) -> FractalResult<NativeAuditOutcome> {
    let started = Instant::now();
    let bundle = audit_snapshot_slices(req.slices)?;
    let curve = QualityCurveConfig::default();

    let per_file = evaluate_per_file_scores(&bundle, req.archetype, &curve);
    let summary_inputs: Vec<(&FileMetricSummary<'_>, &EvaluatedQualityScore)> = per_file
        .records
        .iter()
        .map(|entry| (&entry.metric_summary, &entry.score))
        .collect();
    let project_score = evaluate_project_quality(summary_inputs.as_slice(), req.archetype, &curve);

    let mut scoring_findings = Vec::with_capacity(per_file.all_findings.len());
    for finding in &per_file.all_findings {
        scoring_findings.push(to_scoring_finding(finding));
    }

    let sqale = evaluate_technical_debt(&scoring_findings, per_file.total_eloc);
    let file_debts: Vec<f64> = per_file
        .records
        .iter()
        .map(|entry| entry.debt_minutes)
        .collect();
    let family_counts = count_rule_families(&per_file.all_findings);
    let net_debt_eliminated = req
        .previous_sqale_minutes
        .map_or(req.net_debt_eliminated, |prev_sqale| {
            prev_sqale - sqale.total_remediation_minutes
        });
    let claims_score_gain = req.claims_score_gain
        || req
            .previous_composite_score
            .is_some_and(|prev_score| project_score.composite_score > prev_score + 1e-6);
    let (refactoring_yield_minutes, debt_accrual_minutes) =
        compute_adrq_yield_pair(req.previous_sqale_minutes.is_some(), net_debt_eliminated);
    let adrq = evaluate_adrq_risk(&AdrqInputs {
        file_debts: &file_debts,
        family_counts: &family_counts,
        history_scores: req.previous_scores,
        complexity_samples: &per_file.all_complexities,
        refactoring_yield_minutes,
        debt_accrual_minutes,
    });

    let polyglot = evaluate_snapshot_polyglot(&bundle, &per_file.records);
    let cai_inputs = build_cai_inputs(&bundle, &per_file.all_findings, per_file.total_eloc);
    let autonomy_rate = evaluate_cai_autonomy_rate(&cai_inputs);
    let quant_metrics = build_quant_metrics_dto(
        project_score.composite_score,
        polyglot.polyglot_index,
        autonomy_rate,
        per_file.total_eloc,
        &sqale,
        &adrq,
        None,
    );

    let pattern_penalty = compute_pattern_penalty(&per_file.all_findings);
    let gaming_verdict = evaluate_anti_gaming_conjunction(&AntiGamingInputs {
        changed_eloc: req.changed_eloc,
        total_eloc: per_file.total_eloc,
        net_debt_eliminated,
        claims_score_gain,
        pattern_penalty,
        min_large_file_entropy: per_file.min_large_entropy,
    });

    let config_hex = hex_sm3(
        serde_json::to_vec(&project_score.indices)
            .unwrap_or_default()
            .as_slice(),
    );
    let manifest_hex = compute_manifest_sm3_hex(req.slices);
    let binding = build_review_binding(req, &manifest_hex, &config_hex);

    let elapsed_ms = (started.elapsed().as_secs_f64() * 1000.0).max(0.01);
    let (error_count, warning_count, info_count) = count_severities(&per_file.all_findings);
    let ten_dimensions = project_score.to_contract_dto();

    let evidence = build_analysis_evidence(&EvidenceBuildInput {
        binding: &binding,
        config_hex: &config_hex,
        findings: &per_file.all_findings,
        ten_dimensions: ten_dimensions.clone(),
        quant_metrics: quant_metrics.clone(),
        total_eloc: per_file.total_eloc,
        elapsed_ms,
        review_id: req.review_id,
    });
    let evidence_canonical_bytes = canonical_review_json(&serde_json::to_vec(&evidence)?)?;
    let evidence_digest_hex = hex_codec::encode(canonical_review_sm3(&evidence_canonical_bytes)?);
    let decision_pair = determine_receipt_decision(
        error_count,
        &gaming_verdict,
        ten_dimensions.composite_score,
        req.slices.len(),
    );
    let sealed = seal_trusted_receipt(req, binding, evidence_digest_hex.clone(), decision_pair)?;

    let summary_in = SummaryOutputInput {
        tree_oid: req.tree_oid,
        ten_dimensions: &ten_dimensions,
        quant: &quant_metrics,
        error_count,
        warning_count,
        info_count,
        gaming: &gaming_verdict,
        decision: &sealed.receipt.payload.decision,
    };
    let aas_summary_json = build_aas_summary(&summary_in)?;
    let markdown_report = build_markdown_report(&summary_in);

    Ok(NativeAuditOutcome {
        evidence,
        receipt: sealed.receipt,
        evidence_digest_hex,
        evidence_canonical_bytes,
        receipt_canonical_bytes: sealed.canonical_bytes,
        anti_gaming_passed: !gaming_verdict.is_gaming,
        anti_gaming_reason: gaming_verdict.reason,
        aas_summary_json,
        markdown_report,
        error_count,
        warning_count,
        info_count,
        total_eloc: per_file.total_eloc,
    })
}
