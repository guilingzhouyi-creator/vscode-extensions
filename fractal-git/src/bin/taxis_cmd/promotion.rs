//! Module: taxis_cmd::promotion — Staged Promotion & Human Elevation Bridge
//! File Path: src/bin/taxis_cmd/promotion.rs
//! Architecture Role: Dispatches promotion subcommand requests, bridging autonomous agent
//!   staging proposals to the System Trunk through the Human Elevation physical click gate.
//! Dependencies & Triggers: Invoked when `taxis promotion` is dispatched.
//! Responsibilities: Proposal staging, human elevation nonce authorization,
//!   proposal rejection, queue listing.
//! Exit Semantics & Design Rationale: Every rejection terminates with a non-zero status.
//!   The CLI never synthesizes an operator identity or a challenge nonce on the caller's
//!   behalf: both must arrive from the GUI session out of band, otherwise the "physical
//!   click" gate degenerates into a self-signed rubber stamp.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::path::{Path, PathBuf};

use fg_core::models::{AuditRecord, AuthoritySecret};
use fg_gate::resolve_authority_secret;
use fractal_git::constants::cli::CliTag;
use fractal_git::{
    compute_jeffreys_credible_lower, AutoQualityScoreEnvelope, DiskRefStore, ElevationAttestation,
    LooseOdb, Oid, PromotionStagingLedger, RefStore, StandardNonceAuthorizer, TaxisPolicy,
};

use super::common::{find_arg_value, print_json, reject, CliContext};
use super::verify::{compute_sm3_hex, VERIFY_RECEIPT_FILENAME};

/// Fixture secret matching `taxis verify` when no external authority secret is configured.
const VERIFY_FIXTURE_SECRET_BYTES: [u8; 32] = [7u8; 32];

/// Byte length of the GUI challenge nonce carried by an elevation proof.
const NONCE_BYTES: usize = 32;

/// Dispatches promotion subcommand requests (stage, approve, reject, list).
pub fn handle_promotion(ctx: &CliContext) {
    let current_time_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_millis() as i64)
        .unwrap_or(0);

    let mut ledger = match PromotionStagingLedger::load_or_init(&ctx.git_dir) {
        Ok(loaded_ledger) => loaded_ledger,
        Err(load_err) => reject(
            CliTag::ERROR,
            format!("cannot load staged promotion ledger: {}", load_err),
        ),
    };
    let policy = TaxisPolicy::default();

    let action = ctx
        .args
        .first()
        .map(|action_str| action_str.as_str())
        .unwrap_or("list");

    match action {
        "request" | "stage" => {
            handle_stage_request(ctx, &mut ledger, &policy, current_time_ms);
        }
        "authorize-gui-bridge" | "approve" => {
            handle_elevation_approval(ctx, &mut ledger, current_time_ms);
        }
        "reject" => {
            handle_elevation_rejection(ctx, &mut ledger, current_time_ms);
        }
        _ /* list or show */ => {
            handle_elevation_list(ctx, &mut ledger, &policy, current_time_ms);
        }
    }
}

/// Parses candidate commit OID from arguments or falls back to the integration trunk head.
fn resolve_candidate_oid(ctx: &CliContext) -> Oid {
    if let Some(hex_str) = find_arg_value(&ctx.args, &["--oid", "--candidate", "--target-oid"]) {
        return match Oid::from_hex(hex_str) {
            Ok(parsed_oid) => parsed_oid,
            Err(hex_err) => reject(
                CliTag::ERROR,
                format!("invalid candidate OID '{}': {}", hex_str, hex_err),
            ),
        };
    }

    let ref_store = DiskRefStore::new(&ctx.git_dir);
    match ref_store.get_ref(fractal_git::constants::refs::REF_FRACTAL_TRUNK) {
        Ok(Some(trunk_oid)) => trunk_oid,
        Ok(None) => reject(
            CliTag::ERROR,
            concat!(
                "no candidate supplied and integration trunk is absent; ",
                "pass --candidate <40-hex-oid>"
            ),
        ),
        Err(read_err) => reject(
            CliTag::ERROR,
            format!("cannot read integration trunk reference: {}", read_err),
        ),
    }
}

/// Verified fields extracted from a `.taxis/verify-receipt.json` document.
struct VerifiedReceiptEvidence {
    composite_score: f64,
    cai_index: f64,
    ci_lower: f64,
    anti_gaming_passed: bool,
    summary_report: String,
}

/// Parses and validates the Auto Quality score envelope from CLI arguments and receipt evidence.
fn parse_auto_score(ctx: &CliContext) -> AutoQualityScoreEnvelope {
    let args = &ctx.args;
    let receipt_ev = resolve_and_verify_receipt(ctx);
    let cli_score = find_arg_value(args, &["--score"]).and_then(|val| val.parse::<f64>().ok());
    let cli_cai = find_arg_value(args, &["--cai"]).and_then(|val| val.parse::<f64>().ok());
    let custom_ci_lower =
        find_arg_value(args, &["--ci-lower"]).and_then(|val| val.parse::<f64>().ok());
    let verified_report = verify_report_argument(find_arg_value(args, &["--report"]));

    if receipt_ev.is_none()
        && verified_report.is_none()
        && cli_score.unwrap_or(0.0) >= 80.0
        && (cli_cai.is_none() || custom_ci_lower.is_none())
    {
        reject(
            CliTag::PROMOTION_REJECTED,
            "unverified high-score promotion blocked: supply --receipt (.taxis/verify-receipt.json) or complete quality envelope (--cai and --ci-lower)",
        );
    }
    if let (Some(claimed), Some(ref verified)) = (cli_score, &receipt_ev) {
        if claimed > verified.composite_score + 0.5 {
            reject(
                CliTag::PROMOTION_REJECTED,
                format!(
                    "claimed promotion score {:.1} exceeds verified receipt score {:.1}",
                    claimed, verified.composite_score
                ),
            );
        }
    }

    let composite_score = cli_score
        .or_else(|| receipt_ev.as_ref().map(|ev| ev.composite_score))
        .unwrap_or(0.0);
    let cai_index = cli_cai
        .or_else(|| receipt_ev.as_ref().map(|ev| ev.cai_index))
        .unwrap_or(100.0);
    let cyclomatic_complexity_delta = find_arg_value(args, &["--cc-delta"])
        .and_then(|val| val.parse::<i32>().ok())
        .unwrap_or(0);
    let eloc_delta = find_arg_value(args, &["--eloc-delta"])
        .and_then(|val| val.parse::<i32>().ok())
        .unwrap_or(0);
    let anti_gaming_passed = find_arg_value(args, &["--anti-gaming"])
        .and_then(|val| val.parse::<bool>().ok())
        .unwrap_or_else(|| receipt_ev.as_ref().is_none_or(|ev| ev.anti_gaming_passed));
    let summary_report = verified_report
        .or_else(|| receipt_ev.as_ref().map(|ev| ev.summary_report.clone()))
        .unwrap_or_else(|| "Auto-Refactor Quality Gate: zero debt verification.".to_string());
    let credible_interval_lower = custom_ci_lower
        .or_else(|| receipt_ev.as_ref().map(|ev| ev.ci_lower))
        .unwrap_or_else(|| compute_jeffreys_credible_lower(composite_score));

    AutoQualityScoreEnvelope {
        composite_score,
        cai_index,
        cyclomatic_complexity_delta,
        eloc_delta,
        credible_interval_lower,
        anti_gaming_passed,
        summary_report,
    }
}

/// Locates and cryptographically verifies `.taxis/verify-receipt.json` or `--receipt <path>`.
fn resolve_and_verify_receipt(ctx: &CliContext) -> Option<VerifiedReceiptEvidence> {
    let explicit_receipt = find_arg_value(&ctx.args, &["--receipt"]).map(PathBuf::from);
    let default_path = ctx.git_dir.join(VERIFY_RECEIPT_FILENAME);
    let candidate_path = explicit_receipt.or_else(|| default_path.is_file().then_some(default_path));
    let Some(receipt_path) = candidate_path else {
        if ctx.args.iter().any(|arg| arg == "--require-receipt") {
            reject(
                CliTag::PROMOTION_REJECTED,
                "missing required verification receipt (.taxis/verify-receipt.json)",
            );
        }
        return None;
    };
    let Ok(raw_bytes) = std::fs::read(&receipt_path) else {
        reject(CliTag::PROMOTION_REJECTED, "cannot read verification receipt");
    };
    Some(verify_receipt_bytes(ctx, &raw_bytes))
}

/// Verifies the cryptographic signature, SM3 digest, and gate verdicts inside a receipt JSON payload.
fn verify_receipt_bytes(ctx: &CliContext, raw_bytes: &[u8]) -> VerifiedReceiptEvidence {
    let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(raw_bytes) else {
        reject(CliTag::PROMOTION_REJECTED, "malformed verification receipt JSON");
    };
    let gates_passed = parsed["all_gates_passed"].as_bool().unwrap_or(false);
    let anti_gaming = parsed["anti_gaming_passed"].as_bool().unwrap_or(false);
    if !gates_passed || !anti_gaming {
        reject(
            CliTag::PROMOTION_REJECTED,
            "verification receipt indicates failed gate or anti-gaming breach",
        );
    }
    let Ok(record) = serde_json::from_value::<AuditRecord>(parsed["audit_record"].clone()) else {
        reject(CliTag::PROMOTION_REJECTED, "verification receipt missing audit_record");
    };
    let digest_claim = parsed["receipt_digest"].as_str().unwrap_or_default();
    let expected_digest = compute_sm3_hex(&record.canonical_payload());
    if digest_claim.is_empty() || digest_claim != expected_digest {
        reject(
            CliTag::PROMOTION_REJECTED,
            "verification receipt digest mismatch (tampered evidence)",
        );
    }
    let secret = resolve_authority_secret(&ctx.git_dir).unwrap_or_else(|_| {
        AuthoritySecret::from_bytes(&VERIFY_FIXTURE_SECRET_BYTES)
            .unwrap_or_else(|err| reject(CliTag::ERROR, err))
    });
    if !record.verify_signature(&secret) {
        reject(CliTag::PROMOTION_REJECTED, "verification receipt HMAC signature check failed");
    }
    let composite_score = parsed["composite_score"]
        .as_f64()
        .unwrap_or(record.score.cred as f64);
    let cai_index = parsed["cai_index"].as_f64().unwrap_or(composite_score);
    let ci_lower = parsed["credible_interval_lower"]
        .as_f64()
        .unwrap_or((record.score.ci_lo as f64) * 100.0);
    VerifiedReceiptEvidence {
        composite_score,
        cai_index,
        ci_lower,
        anti_gaming_passed: anti_gaming,
        summary_report: format!(
            "Verified Taxis Receipt (digest={})",
            &expected_digest[..expected_digest.len().min(12)]
        ),
    }
}

/// Validates `--report <arg>`, loading file contents when `<arg>` designates a report file path.
fn verify_report_argument(report_arg: Option<&str>) -> Option<String> {
    let raw = report_arg?;
    let is_file_arg = raw.ends_with(".json")
        || raw.ends_with(".md")
        || raw.ends_with(".txt")
        || Path::new(raw).is_file();
    if !is_file_arg {
        return (!raw.trim().is_empty()).then(|| raw.to_string());
    }
    let Ok(content) = std::fs::read_to_string(raw) else {
        reject(CliTag::PROMOTION_REJECTED, "specified report file does not exist");
    };
    if content.trim().is_empty() {
        reject(CliTag::PROMOTION_REJECTED, "specified report file is empty");
    }
    if raw.ends_with(".json") {
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) else {
            reject(CliTag::PROMOTION_REJECTED, "report file is not valid JSON");
        };
        if parsed["all_gates_passed"].as_bool() == Some(false)
            || parsed["anti_gaming_passed"].as_bool() == Some(false)
        {
            reject(CliTag::PROMOTION_REJECTED, "report file indicates failed gate");
        }
    }
    Some(content)
}

/// Handles staging a promotion candidate with quality envelope and TTL lease.
fn handle_stage_request(
    ctx: &CliContext,
    ledger: &mut PromotionStagingLedger,
    policy: &TaxisPolicy,
    current_time_ms: i64,
) {
    let candidate_oid = resolve_candidate_oid(ctx);

    let summary = find_arg_value(&ctx.args, &["--summary"])
        .unwrap_or("Autonomous Agent PR promotion proposal")
        .to_string();
    let agent_uid = find_arg_value(&ctx.args, &["--agent", "--agent-uid"])
        .unwrap_or("agent-sub-001")
        .to_string();
    let auto_score = parse_auto_score(ctx);
    let composite_score = auto_score.composite_score;
    let cai_index = auto_score.cai_index;
    let cc_delta = auto_score.cyclomatic_complexity_delta;
    let anti_gaming = auto_score.anti_gaming_passed;

    match ledger.stage_promotion(
        candidate_oid,
        auto_score,
        summary,
        agent_uid,
        policy,
        current_time_ms,
    ) {
        Ok(req_id) => {
            if ctx.json_mode {
                let promo_payload = serde_json::json!({
                    "status": "staged",
                    "request_id": req_id,
                    "candidate_oid": candidate_oid.to_hex(),
                    "ttl_seconds": policy.staged_promotion_ttl_seconds,
                    "composite_score": composite_score,
                    "elevation_required": policy.elevation_required_for_system_trunk
                });
                print_json(&promo_payload);
            } else {
                println!(
                    "{} Staged Promotion Proposal '{}'",
                    CliTag::PROMOTION_STAGED,
                    req_id
                );
                println!("  Candidate OID     : {}", candidate_oid.to_hex());
                println!(
                    concat!(
                        "  Auto Score        : {:.1}/100 ",
                        "(CAI: {:.1}%, CC Δ: {}, Anti-Gaming: {})"
                    ),
                    composite_score,
                    cai_index,
                    cc_delta,
                    if anti_gaming { "PASS" } else { "FAIL" }
                );
                println!(
                    "  Lease Expiry      : 1 Hour (TTL = {}s)",
                    policy.staged_promotion_ttl_seconds
                );
                println!(
                    "  Promotion Gate    : Awaiting Human Physical Click in GUI Elevation Modal"
                );
            }
        }
        Err(err) => {
            if ctx.json_mode {
                let rejection_payload = serde_json::json!({
                    "status": "rejected",
                    "error": format!("{}", err)
                });
                print_json(&rejection_payload);
            }
            reject(CliTag::PROMOTION_REJECTED, err);
        }
    }
}

/// Decodes the GUI challenge nonce supplied by the human operator out of band.
fn parse_challenge_nonce(raw_nonce: Option<&str>) -> [u8; NONCE_BYTES] {
    let hex_nonce = match raw_nonce {
        Some(value) => value,
        None => reject(
            CliTag::ELEVATION_APPROVAL_FAILED,
            concat!(
                "missing --nonce; the challenge nonce must be read from the GUI elevation modal ",
                "and is never inferred from the ledger"
            ),
        ),
    };

    if hex_nonce.len() != NONCE_BYTES * 2 {
        reject(
            CliTag::ELEVATION_APPROVAL_FAILED,
            format!(
                "challenge nonce must be {} hex characters, received {}",
                NONCE_BYTES * 2,
                hex_nonce.len()
            ),
        );
    }

    let mut nonce = [0u8; NONCE_BYTES];
    for (byte_index, pair) in hex_nonce.as_bytes().as_chunks::<2>().0.iter().enumerate() {
        let pair_text = match std::str::from_utf8(pair) {
            Ok(text) => text,
            Err(utf_err) => reject(
                CliTag::ELEVATION_APPROVAL_FAILED,
                format!("challenge nonce is not valid hex: {}", utf_err),
            ),
        };
        nonce[byte_index] = match u8::from_str_radix(pair_text, 16) {
            Ok(byte_val) => byte_val,
            Err(radix_err) => reject(
                CliTag::ELEVATION_APPROVAL_FAILED,
                format!("challenge nonce is not valid hex: {}", radix_err),
            ),
        };
    }
    nonce
}

/// Requires an operator identity flag, refusing to fabricate one.
fn require_operator_flag(ctx: &CliContext, tag: &str) -> String {
    match find_arg_value(&ctx.args, &["--operator"]) {
        Some(operator) if !operator.trim().is_empty() => operator.to_string(),
        _ => reject(
            tag,
            "--operator is required; the CLI never synthesizes a human identity",
        ),
    }
}

/// Handles approval of an active staged proposal with an externally supplied proof.
fn handle_elevation_approval(
    ctx: &CliContext,
    ledger: &mut PromotionStagingLedger,
    current_time_ms: i64,
) {
    let req_id_opt = find_arg_value(&ctx.args, &["--id"]).map(|val| val.to_string());
    let operator = require_operator_flag(ctx, CliTag::ELEVATION_APPROVAL_FAILED);
    let email = match find_arg_value(&ctx.args, &["--email"]) {
        Some(email_value) if !email_value.trim().is_empty() => email_value.to_string(),
        _ => reject(
            CliTag::ELEVATION_APPROVAL_FAILED,
            "--email is required to attribute the promotion audit entry",
        ),
    };
    let session = match find_arg_value(&ctx.args, &["--session"]) {
        Some(session_value) if !session_value.trim().is_empty() => session_value.to_string(),
        _ => reject(
            CliTag::ELEVATION_APPROVAL_FAILED,
            "--session is required; an unattributed session cannot prove a GUI click",
        ),
    };
    let signed_nonce = parse_challenge_nonce(find_arg_value(&ctx.args, &["--nonce"]));

    let active_req = match ledger.get_active_candidate(current_time_ms) {
        Some(cand) => cand.clone(),
        None => reject(
            CliTag::ELEVATION_APPROVAL_FAILED,
            "no active staged promotion awaiting human elevation approval",
        ),
    };

    let target_id = req_id_opt.unwrap_or(active_req.request_id.clone());
    let proof = ElevationAttestation {
        request_id: target_id.clone(),
        signed_nonce,
        operator_name: operator.clone(),
        operator_email: email,
        approval_session_token: session,
        timestamp_ms: current_time_ms,
    };

    let authorizer = StandardNonceAuthorizer::new();
    let ref_store = DiskRefStore::new(&ctx.git_dir);
    let odb = LooseOdb::without_cache(&ctx.git_dir);

    match ledger.apply_elevation_approval(&target_id, &proof, &authorizer, &ref_store, &odb) {
        Ok(()) => {
            if ctx.json_mode {
                let success_payload = serde_json::json!({
                    "status": "promoted",
                    "request_id": target_id,
                    "promoted_to": "refs/heads/main",
                    "candidate_oid": active_req.candidate_commit_oid.to_hex(),
                    "operator": operator
                });
                print_json(&success_payload);
            } else {
                println!(
                    "{} Human Elevation Permission Granted!",
                    CliTag::HUMAN_APPROVAL_VERIFIED
                );
                println!("  Request ID   : {}", target_id);
                println!("  Operator     : {}", operator);
                println!("  Target Trunk : refs/heads/main (System Trunk)");
                println!(
                    "  Candidate OID: {}",
                    active_req.candidate_commit_oid.to_hex()
                );
                println!("  Result       : Merged into System Trunk atomically.");
            }
        }
        Err(approval_err) => {
            if ctx.json_mode {
                let failure_payload = serde_json::json!({
                    "status": "approval_failed",
                    "error": format!("{}", approval_err)
                });
                print_json(&failure_payload);
            }
            reject(CliTag::ELEVATION_APPROVAL_FAILED, approval_err);
        }
    }
}

/// Handles human operator rejection of an active staged proposal with feedback.
fn handle_elevation_rejection(
    ctx: &CliContext,
    ledger: &mut PromotionStagingLedger,
    current_time_ms: i64,
) {
    let req_id_opt = find_arg_value(&ctx.args, &["--id"]).map(|val| val.to_string());
    let operator = require_operator_flag(ctx, CliTag::ELEVATION_REJECT_FAILED);
    let feedback = find_arg_value(&ctx.args, &["--feedback", "--reason"])
        .unwrap_or("Promotion declined in elevation review")
        .to_string();

    let active_req = match ledger.get_active_candidate(current_time_ms) {
        Some(cand) => cand.clone(),
        None => reject(
            CliTag::ELEVATION_REJECT_FAILED,
            "no active staged promotion awaiting human elevation approval",
        ),
    };
    let target_id = req_id_opt.unwrap_or(active_req.request_id);

    match ledger.reject_elevation_promotion(&target_id, operator, feedback, current_time_ms) {
        Ok(()) => {
            if ctx.json_mode {
                let rejection_payload = serde_json::json!({
                    "status": "rejected",
                    "request_id": target_id
                });
                print_json(&rejection_payload);
            } else {
                println!(
                    "{} Request '{}' rejected.",
                    CliTag::PROMOTION_REJECTED,
                    target_id
                );
            }
        }
        Err(reject_err) => reject(CliTag::ELEVATION_REJECT_FAILED, reject_err),
    }
}

/// Lists active staged promotion candidates awaiting human elevation authorization.
fn handle_elevation_list(
    ctx: &CliContext,
    ledger: &mut PromotionStagingLedger,
    policy: &TaxisPolicy,
    current_time_ms: i64,
) {
    let active = ledger.get_active_candidate(current_time_ms);
    if ctx.json_mode {
        let status_payload = serde_json::json!({
            "engine": "taxis",
            "subsystem": "elevation_staged_promotion",
            "active_candidate": active,
            "policy": {
                "ttl_seconds": policy.staged_promotion_ttl_seconds,
                "score_ratchet_delta": policy.replacement_score_baseline_delta,
                "min_score": policy.minimum_promotion_score,
                "elevation_required": policy.elevation_required_for_system_trunk
            }
        });
        print_json(&status_payload);
    } else {
        println!("=== Staged Promotion Queue (Human Elevation) ===");
        println!("Policy Guardrails:");
        println!(
            "  Human Elevation Required : {}",
            policy.elevation_required_for_system_trunk
        );
        println!(
            "  Staged Lease TTL         : {}s (1 Hour)",
            policy.staged_promotion_ttl_seconds
        );
        println!(
            "  Score Ratchet Δ          : +{:.1} points",
            policy.replacement_score_baseline_delta
        );
        println!(
            "  Minimum Auto Score       : {:.1}/100",
            policy.minimum_promotion_score
        );

        match active {
            Some(cand) => {
                let remaining_sec = (cand.expires_at_ms - current_time_ms).max(0) / 1000;
                println!("Active Candidate Awaiting Human Elevation:");
                println!("  Request ID     : {}", cand.request_id);
                println!("  Candidate OID  : {}", cand.candidate_commit_oid.to_hex());
                println!("  Proposing Agent: {}", cand.agent_uid);
                println!(
                    "  Auto Score     : {:.1}/100 (CAI: {:.1}%, CC Δ: {}, Anti-Gaming: {})",
                    cand.auto_score.composite_score,
                    cand.auto_score.cai_index,
                    cand.auto_score.cyclomatic_complexity_delta,
                    if cand.auto_score.anti_gaming_passed {
                        "PASS"
                    } else {
                        "FAIL"
                    }
                );
                println!(
                    "  Lease Time Left: {}m {}s",
                    remaining_sec / 60,
                    remaining_sec % 60
                );
                println!("  Summary        : {}", cand.summary);
                println!("  Status         : {:?}", cand.status);
            }
            None => {
                println!("No active candidate currently awaiting human elevation approval.");
            }
        }
    }
}
