//! Module: taxis_cmd::promotion_audit_odb — Audit Companion ODB Reader & Score Extractor
//! File Path: src/bin/taxis_cmd/promotion_audit_odb.rs
//! Architecture Role: Validates candidate commit tree headers and companion `evidence/analysis.json`
//!   canonical SM3 digests for promotion audit tree verification.
//! Dependencies & Triggers: Invoked exclusively by `promotion_audit`.
//! Responsibilities: Bind ODB evidence payloads to signed receipts and build score envelopes.
//! Exit Semantics & Design Rationale: Fails closed via `CliTag::PROMOTION_REJECTED`.

use std::path::Path;

use fg_core::models::quality_contracts::{
    AnalysisEvidence, ReceiptPayloadDecision, TrustedReviewReceipt,
};
use fg_core::models::quality_encoding::canonical_review_sm3;
use fg_core::models::{parse_commit_header, parse_loose_header, ObjectKind};
use fg_core::traits::OdbStore;
use fg_topology::audit_tree::AuditTreeMaterializer;
use fg_topology::refs::FractalRef;
use fractal_git::constants::cli::CliTag;
use fractal_git::{compute_jeffreys_credible_lower, AutoQualityScoreEnvelope, LooseOdb, Oid};

use crate::taxis_cmd::common::reject;

pub(super) fn load_and_verify_evidence_envelope(
    odb: &LooseOdb,
    git_dir: &Path,
    audit_ref: &FractalRef,
    receipt: &TrustedReviewReceipt,
) -> AutoQualityScoreEnvelope {
    let evidence_bytes = AuditTreeMaterializer::read_audit_artifact(
        odb,
        git_dir,
        audit_ref,
        "evidence/analysis.json",
    )
    .unwrap_or_else(|err| reject(CliTag::PROMOTION_REJECTED, err.to_string()))
    .unwrap_or_else(|| {
        reject(
            CliTag::PROMOTION_REJECTED,
            "missing evidence/analysis.json companion in Fractal Audit Tree",
        )
    });

    let digest_check = canonical_review_sm3(&evidence_bytes).unwrap_or_else(|err| {
        reject(
            CliTag::PROMOTION_REJECTED,
            format!("failed to digest evidence/analysis.json: {err}"),
        )
    });
    if digest_to_lower_hex(&digest_check) != receipt.payload.evidence_digest.value {
        reject(
            CliTag::PROMOTION_REJECTED,
            "evidence/analysis.json digest does not match sealed TrustedReviewReceipt binding",
        );
    }

    let evidence: AnalysisEvidence =
        serde_json::from_slice(&evidence_bytes).unwrap_or_else(|err| {
            reject(
                CliTag::PROMOTION_REJECTED,
                format!("malformed evidence/analysis.json: {err}"),
            )
        });
    let composite_score = evidence
        .measurements
        .ten_dimensions
        .as_ref()
        .map_or(0.0, |dims| dims.composite_score);
    let cai_index = evidence
        .measurements
        .quant_metrics
        .as_ref()
        .map_or(0.0, |qm| qm.autonomy_rate * 100.0);
    let credible_interval_lower = compute_jeffreys_credible_lower(composite_score);
    let anti_gaming_passed = receipt.payload.decision == ReceiptPayloadDecision::Approved;

    AutoQualityScoreEnvelope {
        composite_score,
        cai_index,
        cyclomatic_complexity_delta: 0,
        eloc_delta: 0,
        credible_interval_lower,
        anti_gaming_passed,
        summary_report: format!(
            "Sealed Fractal Audit Tree receipt '{}' verified (review={}, decision={:?})",
            audit_ref.to_git_ref(),
            receipt.payload.binding.review_id,
            receipt.payload.decision
        ),
    }
}

pub(super) fn read_candidate_commit_tree_oid(odb: &LooseOdb, candidate_oid: &Oid) -> Oid {
    let raw_obj = odb.read_object(candidate_oid).unwrap_or_else(|err| {
        reject(
            CliTag::PROMOTION_REJECTED,
            format!(
                "unable to read candidate commit '{}': {err}",
                candidate_oid.to_hex()
            ),
        )
    });
    let (kind, payload) = parse_loose_header(&raw_obj).unwrap_or_else(|err| {
        reject(
            CliTag::PROMOTION_REJECTED,
            format!("corrupt candidate commit object: {err}"),
        )
    });
    if kind != ObjectKind::Commit {
        reject(
            CliTag::PROMOTION_REJECTED,
            format!(
                "candidate OID '{}' is not a commit object",
                candidate_oid.to_hex()
            ),
        );
    }
    parse_commit_header(payload)
        .unwrap_or_else(|err| {
            reject(
                CliTag::PROMOTION_REJECTED,
                format!("failed to parse candidate commit header: {err}"),
            )
        })
        .tree
}

fn digest_to_lower_hex(bytes: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}
