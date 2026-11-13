//! Module: Fractal Git — Native Pure-Rust Background Snapshot Audit & Receipt Orchestrator
//! File Path: src/audit_runner/mod.rs
//! Architecture Role: Unifies `fg_gate::audit_engine` with `fg_algorithms::scoring` and seals
//!   RFC 8785 HMAC-SM3 `AnalysisEvidence` + `TrustedReviewReceipt` artifacts directly against
//!   `quality-evidence.schema.json`.
//! Dependencies & Triggers: Consumed by Taxis daemon scheduler, `taxis audit`, `taxis promotion`,
//!   and Rust/TS parity harnesses.
//! Responsibilities: Export snapshot audit contracts, seal immutable evaluations, and enforce
//!   fail-closed promotion signature, expiration, and tree-binding verification.
//! Exit Semantics & Design Rationale: Zero Node runtime dependency, zero worktree writes, zero
//!   unwrapped panic paths.

mod binding;
mod cai_eval;
mod eval;
mod evidence;
mod hex_codec;
mod metrics;
mod report;

#[cfg(test)]
mod unit_tests;

use fg_algorithms::scoring::ProjectArchetype;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::quality_contracts::{
    AnalysisEvidence, ReceiptPayloadDecision, TrustedReviewReceipt,
};
use fg_core::models::quality_encoding::verify_canonical_review;
use fg_core::models::{AuthoritySecret, Oid};
use fg_gate::audit_engine::SnapshotFileSlice;

pub use eval::evaluate_and_seal_snapshot;

/// Default receipt validity TTL (1 hour in milliseconds).
pub const DEFAULT_AUDIT_RECEIPT_TTL_MS: u64 = 3_600_000;

/// Request envelope describing an immutable snapshot for native Rust review.
pub struct SnapshotAuditRequest<'a> {
    /// Repository identifier claim bound into receipts.
    pub repository_id: &'a str,
    /// Unique review run identifier (`rev-...`).
    pub review_id: &'a str,
    /// Unique operation identifier (`op-...`).
    pub operation_id: &'a str,
    /// Git tree OID matching the candidate snapshot.
    pub tree_oid: Oid,
    /// Parent commit OIDs defining baseline strategy (`0 = initial`, `1 = parent`, `>=2 = merge`).
    pub parent_oids: &'a [Oid],
    /// Project archetype tuning quality dimension weights.
    pub archetype: ProjectArchetype,
    /// Historical composite scores (oldest -> newest) for ADR-Q VaR/Sharpe/OU metrics.
    pub previous_scores: &'a [f64],
    /// Previous canonical SM3 evidence digest for receipt hash-chaining.
    pub previous_evidence_digest: Option<&'a str>,
    /// Authority secret used to HMAC-SM3 sign `TrustedReviewReceipt`.
    pub authority_secret: &'a AuthoritySecret,
    /// Authority key identifier bound into receipt payload.
    pub key_id: &'a str,
    /// Current UNIX epoch timestamp in milliseconds.
    pub now_ms: u64,
    /// Semantic ELOC delta when known for anti-gaming conjunction.
    pub changed_eloc: usize,
    /// Net debt reduction estimate (`before_minutes - after_minutes`).
    pub net_debt_eliminated: f64,
    /// Whether this candidate claims a quality improvement.
    pub claims_score_gain: bool,
    /// Previous SQALE total debt minutes for inter-revision delta computation when known.
    pub previous_sqale_minutes: Option<f64>,
    /// Previous 10D composite score for inter-revision score-gain claim detection when known.
    pub previous_composite_score: Option<f64>,
    /// Immutable file slices (`rel_path`, `bytes`) read directly from ODB/index.
    pub slices: &'a [SnapshotFileSlice<'a>],
}

/// Complete sealed quality evaluation outcome ready for Fractal Audit Tree persistence or CLI output.
#[derive(Debug, Clone)]
pub struct NativeAuditOutcome {
    /// Canonical `quality-evidence.schema.json` analysis evidence document.
    pub evidence: AnalysisEvidence,
    /// Canonical signed `TrustedReviewReceipt` authorizing or blocking promotion.
    pub receipt: TrustedReviewReceipt,
    /// Canonical SM3 hex digest of `evidence`.
    pub evidence_digest_hex: String,
    /// Canonical RFC 8785 bytes of `evidence`.
    pub evidence_canonical_bytes: Vec<u8>,
    /// Canonical RFC 8785 bytes of `receipt`.
    pub receipt_canonical_bytes: Vec<u8>,
    /// Anti-gaming conjunction result.
    pub anti_gaming_passed: bool,
    /// Anti-gaming trigger reason if blocked.
    pub anti_gaming_reason: Option<String>,
    /// Compact AAS v1 summary JSON bytes for audit tree storage.
    pub aas_summary_json: Vec<u8>,
    /// Concise Markdown report for human inspection (`taxis audit latest`).
    pub markdown_report: String,
    /// Blocking error finding count.
    pub error_count: usize,
    /// Warning finding count.
    pub warning_count: usize,
    /// Info finding count.
    pub info_count: usize,
    /// Total effective lines evaluated across candidate files.
    pub total_eloc: usize,
}

/// Verifies a sealed `TrustedReviewReceipt` for promotion gating against target tree & secret.
///
/// # Errors
///
/// Returns [`FractalError::PolicyViolation`] or [`FractalError::InvalidReviewEvidence`] on tampering,
/// expiration, tree mismatch, or non-approved verdict.
pub fn verify_sealed_receipt_for_promotion(
    receipt: &TrustedReviewReceipt,
    expected_tree_oid: &Oid,
    authority_secret: &AuthoritySecret,
    now_ms: u64,
) -> FractalResult<()> {
    let signing_bytes = binding::receipt_signing_bytes(receipt)?;
    let sig_bytes = hex_codec::decode(&receipt.signature).map_err(|()| {
        FractalError::InvalidReviewEvidence {
            reason: String::from("malformed hex signature in trusted review receipt"),
        }
    })?;
    if !verify_canonical_review(&signing_bytes, &sig_bytes, authority_secret)? {
        return Err(FractalError::PolicyViolation(String::from(
            "trusted review receipt HMAC-SM3 signature verification failed",
        )));
    }
    if receipt.payload.binding.snapshot.tree.value != expected_tree_oid.to_hex() {
        return Err(FractalError::PolicyViolation(format!(
            "receipt snapshot tree '{}' does not match candidate tree '{}'",
            receipt.payload.binding.snapshot.tree.value,
            expected_tree_oid.to_hex()
        )));
    }
    if now_ms > receipt.payload.expires_at_ms {
        return Err(FractalError::PolicyViolation(String::from(
            "trusted review receipt has expired; rerun `taxis audit run`",
        )));
    }
    if receipt.payload.decision != ReceiptPayloadDecision::Approved {
        return Err(FractalError::PolicyViolation(format!(
            "trusted review receipt decision is {:?}: {}",
            receipt.payload.decision,
            receipt.payload.reasons.join("; ")
        )));
    }
    Ok(())
}
