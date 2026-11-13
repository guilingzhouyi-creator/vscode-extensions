//! Module: taxis_cmd::promotion_audit — Sealed Fractal Audit Tree Promotion Gate
//! File Path: src/bin/taxis_cmd/promotion_audit.rs
//! Architecture Role: Resolves the candidate commit's corresponding Fractal Audit Tree ref and
//!   verifies HMAC-SM3 sealed `TrustedReviewReceipt` + `evidence/analysis.json` digest bindings
//!   before allowing promotion to the System Trunk.
//! Dependencies & Triggers: Invoked from `promotion::parse_auto_score`.
//! Responsibilities: Enforce fail-closed signature, expiration, tree-OID, and digest parity.
//! Exit Semantics & Design Rationale: Rejects tampered or stale audit trees cleanly via `CliTag`.

use fg_core::models::quality_contracts::TrustedReviewReceipt;
use fg_gate::resolve_authority_secret;
use fg_topology::audit_tree::AuditTreeMaterializer;
use fg_topology::refs::FractalRef;
use fractal_git::audit_runner::verify_sealed_receipt_for_promotion;
use fractal_git::constants::cli::CliTag;
use fractal_git::{AutoQualityScoreEnvelope, DiskRefStore, LooseOdb, Oid};

use crate::taxis_cmd::common::{find_arg_value, reject, CliContext};
use crate::taxis_cmd::daemon::daemon_scheduler::{
    is_self_owned_audit_or_telemetry_ref, resolve_audit_target_ref,
};
use super::promotion_audit_odb::{
    load_and_verify_evidence_envelope, read_candidate_commit_tree_oid,
};

fn resolve_audit_ref_for_candidate(
    ctx: &CliContext,
    candidate_oid: Oid,
    explicit_audit_ref: Option<&str>,
) -> FractalRef {
    let source_hint = explicit_audit_ref.or_else(|| find_arg_value(&ctx.args, &["--ref"]));
    if let Some(hint) = source_hint {
        return resolve_audit_target_ref(Some(hint));
    }

    let mut fallback_match: Option<FractalRef> = None;
    if let Ok(refs) = DiskRefStore::new(&ctx.git_dir).list_all() {
        for (ref_name, oid) in &refs {
            if *oid != candidate_oid
                || ref_name == "HEAD"
                || is_self_owned_audit_or_telemetry_ref(ref_name)
            {
                continue;
            }
            if let Some(counterpart) =
                FractalRef::parse(ref_name).and_then(|parsed| parsed.audit_counterpart())
            {
                if counterpart.read_oid(&ctx.git_dir).ok().flatten().is_some() {
                    if counterpart != FractalRef::AuditTrunk {
                        return counterpart;
                    }
                    if fallback_match.is_none() {
                        fallback_match = Some(counterpart);
                    }
                }
            }
        }
    }

    fallback_match.unwrap_or(FractalRef::AuditTrunk)
}

/// Verifies a sealed HMAC-SM3 Fractal Audit Tree receipt from `refs/fractal/audit/...` if present or required.
pub(super) fn resolve_and_verify_audit_tree_receipt(
    ctx: &CliContext,
    candidate_oid: Oid,
    current_time_ms: i64,
) -> Option<AutoQualityScoreEnvelope> {
    let explicit_audit_ref = find_arg_value(&ctx.args, &["--audit-ref"]);
    let require_audit_tree = ctx.args.iter().any(|arg| arg == "--require-audit-tree");
    let explicit_receipt = find_arg_value(&ctx.args, &["--receipt"]);
    if explicit_receipt.is_some() && explicit_audit_ref.is_none() && !require_audit_tree {
        return None;
    }

    let audit_ref = resolve_audit_ref_for_candidate(ctx, candidate_oid, explicit_audit_ref);
    let audit_head = audit_ref
        .read_oid(&ctx.git_dir)
        .unwrap_or_else(|err| reject(CliTag::PROMOTION_REJECTED, err.to_string()));
    if audit_head.is_none() {
        if require_audit_tree || explicit_audit_ref.is_some() {
            reject(
                CliTag::PROMOTION_REJECTED,
                format!(
                    "missing required Fractal Audit Tree commit on '{}'",
                    audit_ref.to_git_ref()
                ),
            );
        }
        return None;
    }

    let odb = LooseOdb::new(&ctx.git_dir);
    let receipt_bytes = AuditTreeMaterializer::read_audit_artifact(
        &odb,
        &ctx.git_dir,
        &audit_ref,
        "receipt/trusted.json",
    )
    .unwrap_or_else(|err| reject(CliTag::PROMOTION_REJECTED, err.to_string()));
    let Some(raw_receipt) = receipt_bytes else {
        if require_audit_tree || explicit_audit_ref.is_some() {
            reject(
                CliTag::PROMOTION_REJECTED,
                format!(
                    "missing receipt/trusted.json on audit ref '{}'",
                    audit_ref.to_git_ref()
                ),
            );
        }
        return None;
    };

    let candidate_tree_oid = read_candidate_commit_tree_oid(&odb, &candidate_oid);
    let receipt: TrustedReviewReceipt =
        serde_json::from_slice(&raw_receipt).unwrap_or_else(|err| {
            reject(
                CliTag::PROMOTION_REJECTED,
                format!("malformed receipt/trusted.json: {err}"),
            )
        });
    let secret = resolve_authority_secret(&ctx.git_dir).unwrap_or_else(|err| {
        reject(
            CliTag::PROMOTION_REJECTED,
            format!("missing authority secret for sealed audit tree receipt: {err}"),
        )
    });
    let now_ms = u64::try_from(current_time_ms.max(0)).unwrap_or(0);
    if let Err(err) =
        verify_sealed_receipt_for_promotion(&receipt, &candidate_tree_oid, &secret, now_ms)
    {
        reject(CliTag::PROMOTION_REJECTED, err.to_string());
    }

    Some(load_and_verify_evidence_envelope(
        &odb,
        &ctx.git_dir,
        &audit_ref,
        &receipt,
    ))
}
