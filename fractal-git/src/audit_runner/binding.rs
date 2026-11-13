//! Module: Fractal Git — Review Binding & Sealed Receipt Decision Logic
//! File Path: src/audit_runner/binding.rs
//! Architecture Role: Constructs snapshot identity bindings, baseline ancestry records,
//!   closed-verdict receipt decisions, and canonical HMAC-SM3 signed receipts.
//! Dependencies & Triggers: Invoked by `audit_runner::eval` and `audit_runner::mod`.
//! Responsibilities: Enforce fail-closed verdicts and deterministic RFC 8785 signing payloads.
//! Exit Semantics & Design Rationale: Separates receipt construction cleanly from metric scoring.

use fg_algorithms::scoring::AntiGamingVerdict;
use fg_core::error::FractalResult;
use fg_core::models::quality_contracts::{
    Baseline, BaselineInitial, BaselineInitialStrategy, BaselineMerge, BaselineMergeStrategy,
    BaselineParent, BaselineParentStrategy, Digest, DigestAlgorithm, GitObject, GitObjectAlgorithm,
    ReceiptPayload, ReceiptPayloadDecision, ReceiptPayloadSignatureAlgorithm, ReviewBinding,
    SnapshotIdentity, TrustedReviewReceipt, TrustedReviewReceiptKind,
};
use fg_core::models::quality_encoding::{canonical_review_json, sign_canonical_review};
use fg_core::models::{AuthoritySecret, Oid};

use super::cai_eval::hex_sm3;
use super::{hex_codec, SnapshotAuditRequest, DEFAULT_AUDIT_RECEIPT_TTL_MS};

pub(super) struct SealedReceiptResult {
    pub(super) receipt: TrustedReviewReceipt,
    pub(super) canonical_bytes: Vec<u8>,
}

pub(super) fn build_review_binding(
    req: &SnapshotAuditRequest<'_>,
    manifest_hex: &str,
    config_hex: &str,
) -> ReviewBinding {
    ReviewBinding {
        review_id: req.review_id.to_owned(),
        operation_id: req.operation_id.to_owned(),
        snapshot: SnapshotIdentity {
            repository_id: req.repository_id.to_owned(),
            tree: GitObject {
                algorithm: GitObjectAlgorithm::GitSha1,
                value: req.tree_oid.to_hex(),
            },
            manifest_digest: Digest {
                algorithm: DigestAlgorithm::Sm3,
                value: manifest_hex.to_owned(),
            },
        },
        baseline: build_baseline(req.parent_oids),
        policy_digest: Digest {
            algorithm: DigestAlgorithm::Sm3,
            value: hex_sm3(b"taxis-native-policy/v1"),
        },
        configuration_digest: Digest {
            algorithm: DigestAlgorithm::Sm3,
            value: config_hex.to_owned(),
        },
        required_capabilities_digest: Digest {
            algorithm: DigestAlgorithm::Sm3,
            value: hex_sm3(b"rust-oxc-syn-python-gd-shell-hygiene-10d-sqale-adrq-cai/v1"),
        },
    }
}

fn build_baseline(parents: &[Oid]) -> Baseline {
    match parents.len() {
        0 => Baseline::Initial(BaselineInitial {
            strategy: BaselineInitialStrategy::Initial,
            parents: Vec::new(),
        }),
        1 => Baseline::Parent(BaselineParent {
            strategy: BaselineParentStrategy::Parent,
            parents: vec![GitObject {
                algorithm: GitObjectAlgorithm::GitSha1,
                value: parents[0].to_hex(),
            }],
        }),
        _ => {
            let mut objs = Vec::with_capacity(parents.len().min(64));
            for oid in parents.iter().take(64) {
                objs.push(GitObject {
                    algorithm: GitObjectAlgorithm::GitSha1,
                    value: oid.to_hex(),
                });
            }
            Baseline::Merge(BaselineMerge {
                strategy: BaselineMergeStrategy::Merge,
                parents: objs,
            })
        }
    }
}

pub(super) fn seal_trusted_receipt(
    req: &SnapshotAuditRequest<'_>,
    binding: ReviewBinding,
    evidence_digest_hex: String,
    decision_pair: (ReceiptPayloadDecision, Vec<String>),
) -> FractalResult<SealedReceiptResult> {
    let request_digest_hex = hex_sm3(
        format!(
            "{}:{}:{}",
            req.review_id,
            req.operation_id,
            req.tree_oid.to_hex()
        )
        .as_bytes(),
    );
    let prev_ev_digest = req.previous_evidence_digest.map(|hex_val| Digest {
        algorithm: DigestAlgorithm::Sm3,
        value: hex_val.to_owned(),
    });
    let mut receipt = TrustedReviewReceipt {
        schema_version: 1,
        kind: TrustedReviewReceiptKind::TrustedReviewReceipt,
        payload: ReceiptPayload {
            binding,
            issuer: String::from("taxis-kernel-native-audit"),
            key_id: req.key_id.to_owned(),
            signature_algorithm: ReceiptPayloadSignatureAlgorithm::HmacSm3,
            request_digest: Digest {
                algorithm: DigestAlgorithm::Sm3,
                value: request_digest_hex,
            },
            evidence_digest: Digest {
                algorithm: DigestAlgorithm::Sm3,
                value: evidence_digest_hex,
            },
            previous_evidence_digest: prev_ev_digest,
            decision: decision_pair.0,
            reasons: decision_pair.1,
            issued_at_ms: req.now_ms,
            expires_at_ms: req.now_ms.saturating_add(DEFAULT_AUDIT_RECEIPT_TTL_MS),
        },
        signature: String::new(),
    };
    let signing_bytes = receipt_signing_bytes(&receipt)?;
    receipt.signature = sign_bytes(&signing_bytes, req.authority_secret)?;
    let canonical_bytes = canonical_review_json(&serde_json::to_vec(&receipt)?)?;
    Ok(SealedReceiptResult {
        receipt,
        canonical_bytes,
    })
}

fn sign_bytes(bytes: &[u8], secret: &AuthoritySecret) -> FractalResult<String> {
    Ok(hex_codec::encode(sign_canonical_review(bytes, secret)?))
}

pub(super) fn determine_receipt_decision(
    error_count: usize,
    gaming: &AntiGamingVerdict,
    composite_score: f64,
    file_count: usize,
) -> (ReceiptPayloadDecision, Vec<String>) {
    if gaming.is_gaming {
        return (
            ReceiptPayloadDecision::Blocked,
            vec![gaming
                .reason
                .clone()
                .unwrap_or_else(|| String::from("BLOCK_GAMING_DETECTED"))],
        );
    }
    if error_count > 0 {
        return (
            ReceiptPayloadDecision::Blocked,
            vec![format!(
                "{error_count} blocking static/security finding(s) detected across {file_count} snapshot files"
            )],
        );
    }
    if composite_score < 50.0 {
        return (
            ReceiptPayloadDecision::NeedsReview,
            vec![format!(
                "Composite quality score {composite_score:.2} below minimum promotion threshold 50.0"
            )],
        );
    }
    (
        ReceiptPayloadDecision::Approved,
        vec![format!(
            "Clean pure-Rust snapshot review across {file_count} files (score={composite_score:.2})"
        )],
    )
}

pub(super) fn receipt_signing_bytes(receipt: &TrustedReviewReceipt) -> FractalResult<Vec<u8>> {
    let payload_bytes = serde_json::to_vec(&receipt.payload)?;
    canonical_review_json(&payload_bytes)
}
