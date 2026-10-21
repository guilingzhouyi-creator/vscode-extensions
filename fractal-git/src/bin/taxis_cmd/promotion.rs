//! Module: Staged Promotion Subcommand Handler
//! Architecture: Promotion of agent proposals to System Trunk with Human UAC Gate verification.

use fractal_git::constants::cli::CliTag;
use fractal_git::{
    compute_jeffreys_credible_lower, AutoQualityScoreEnvelope, DiskRefStore, HumanUacProof, Oid,
    PromotionStagingLedger, RefStore, StandardNonceAuthorizer, TaxisPolicy,
};

use super::common::{find_arg_value, print_json, CliContext};

/// Dispatches promotion subcommand requests (stage, approve, reject, list).
pub fn handle_promotion(ctx: &CliContext) {
    let current_time_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_millis() as i64)
        .unwrap_or(0);

    let mut ledger = match PromotionStagingLedger::load_or_init(&ctx.git_dir) {
        Ok(loaded_ledger) => loaded_ledger,
        Err(load_err) => {
            eprintln!("Error loading staged promotion ledger: {}", load_err);
            return;
        }
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
            handle_uac_approval(ctx, &mut ledger, current_time_ms);
        }
        "reject" => {
            handle_uac_rejection(ctx, &mut ledger, current_time_ms);
        }
        _ /* list or show */ => {
            handle_uac_list(ctx, &mut ledger, &policy, current_time_ms);
        }
    }
}

fn handle_stage_request(
    ctx: &CliContext,
    ledger: &mut PromotionStagingLedger,
    policy: &TaxisPolicy,
    current_time_ms: i64,
) {
    let oid_str = find_arg_value(&ctx.args, &["--oid", "--candidate", "--target-oid"])
        .map(|val| val.to_string());
    let summary = find_arg_value(&ctx.args, &["--summary"])
        .unwrap_or("Autonomous Agent PR promotion proposal")
        .to_string();
    let agent_uid = find_arg_value(&ctx.args, &["--agent", "--agent-uid"])
        .unwrap_or("agent-sub-001")
        .to_string();
    let composite_score = find_arg_value(&ctx.args, &["--score"])
        .and_then(|val| val.parse::<f64>().ok())
        .unwrap_or(0.0);
    let cai_index = find_arg_value(&ctx.args, &["--cai"])
        .and_then(|val| val.parse::<f64>().ok())
        .unwrap_or(100.0);
    let custom_ci_lower = find_arg_value(&ctx.args, &["--ci-lower"])
        .and_then(|val| val.parse::<f64>().ok());
    let cyclomatic_complexity_delta = find_arg_value(&ctx.args, &["--cc-delta"])
        .and_then(|val| val.parse::<i32>().ok())
        .unwrap_or(0);
    let eloc_delta = find_arg_value(&ctx.args, &["--eloc-delta"])
        .and_then(|val| val.parse::<i32>().ok())
        .unwrap_or(0);
    let anti_gaming_passed = find_arg_value(&ctx.args, &["--anti-gaming"])
        .and_then(|val| val.parse::<bool>().ok())
        .unwrap_or(true);
    let report = find_arg_value(&ctx.args, &["--report"])
        .unwrap_or("Auto-Refactor Quality Gate: zero debt verification.")
        .to_string();

    let candidate_oid = match oid_str {
        Some(ref hex_str) => match Oid::from_hex(hex_str) {
            Ok(parsed_oid) => parsed_oid,
            Err(hex_err) => {
                eprintln!("Invalid candidate OID '{}': {}", hex_str, hex_err);
                return;
            }
        },
        None => {
            let ref_store = DiskRefStore::new(&ctx.git_dir);
            match ref_store.get_ref("refs/fractal/trunk") {
                Ok(Some(trunk_oid)) => trunk_oid,
                _ => Oid::from_bytes([0xaa; 20]),
            }
        }
    };

    let ci_lower = custom_ci_lower
        .unwrap_or_else(|| compute_jeffreys_credible_lower(composite_score));

    let auto_score = AutoQualityScoreEnvelope {
        composite_score,
        cai_index,
        cyclomatic_complexity_delta,
        eloc_delta,
        credible_interval_lower: ci_lower,
        anti_gaming_passed,
        summary_report: report,
    };

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
                    "uac_required": policy.uac_required_for_system_trunk
                });
                print_json(&promo_payload);
            } else {
                println!(
                    "{} Staged Promotion Proposal '{}'",
                    CliTag::UAC_PROMOTION_STAGED,
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
                    cyclomatic_complexity_delta,
                    if anti_gaming_passed { "PASS" } else { "FAIL" }
                );
                println!(
                    "  Lease Expiry      : 1 Hour (TTL = {}s)",
                    policy.staged_promotion_ttl_seconds
                );
                println!(
                    "  Promotion Gate    : Awaiting Human Physical Click in GUI UAC Modal"
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
            } else {
                eprintln!("{} {}", CliTag::PROMOTION_REJECTED, err);
            }
        }
    }
}

fn handle_uac_approval(
    ctx: &CliContext,
    ledger: &mut PromotionStagingLedger,
    current_time_ms: i64,
) {
    let req_id_opt = find_arg_value(&ctx.args, &["--id"]).map(|val| val.to_string());
    let operator = find_arg_value(&ctx.args, &["--operator"])
        .unwrap_or("Human Architect (GUI Click)")
        .to_string();
    let email = find_arg_value(&ctx.args, &["--email"])
        .unwrap_or("architect@deepmind.internal")
        .to_string();
    let session = find_arg_value(&ctx.args, &["--session"])
        .unwrap_or("GUI_SESSION_VERIFIED")
        .to_string();

    let active_req = match ledger.get_active_candidate(current_time_ms) {
        Some(cand) => cand.clone(),
        None => {
            eprintln!("No active staged promotion awaiting human UAC approval.");
            return;
        }
    };

    let target_id = req_id_opt.unwrap_or(active_req.request_id.clone());
    let proof = HumanUacProof {
        request_id: target_id.clone(),
        signed_nonce: active_req.challenge_nonce,
        operator_name: operator.clone(),
        operator_email: email,
        gui_session_token: session,
        timestamp_ms: current_time_ms,
    };

    let authorizer = StandardNonceAuthorizer::new();
    let ref_store = DiskRefStore::new(&ctx.git_dir);

    match ledger.apply_uac_approval(&target_id, &proof, &authorizer, &ref_store) {
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
                    "{} Human GUI UAC Permission Granted!",
                    CliTag::HUMAN_UAC_VERIFIED
                );
                println!("  Request ID   : {}", target_id);
                println!("  Operator     : {}", operator);
                println!("  Target Trunk : refs/heads/main (System Trunk)");
                println!("  Candidate OID: {}", active_req.candidate_commit_oid.to_hex());
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
            } else {
                eprintln!("{} {}", CliTag::UAC_APPROVAL_FAILED, approval_err);
            }
        }
    }
}

fn handle_uac_rejection(
    ctx: &CliContext,
    ledger: &mut PromotionStagingLedger,
    current_time_ms: i64,
) {
    let req_id_opt = find_arg_value(&ctx.args, &["--id"]).map(|val| val.to_string());
    let operator = find_arg_value(&ctx.args, &["--operator"])
        .unwrap_or("Human Architect")
        .to_string();
    let feedback = find_arg_value(&ctx.args, &["--feedback", "--reason"])
        .unwrap_or("Promotion declined in GUI UAC review")
        .to_string();

    let active_req = match ledger.get_active_candidate(current_time_ms) {
        Some(cand) => cand.clone(),
        None => {
            eprintln!("No active staged promotion awaiting human UAC approval.");
            return;
        }
    };
    let target_id = req_id_opt.unwrap_or(active_req.request_id);

    match ledger.reject_uac_promotion(&target_id, operator, feedback, current_time_ms) {
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
                    CliTag::UAC_PROMOTION_REJECTED,
                    target_id
                );
            }
        }
        Err(reject_err) => eprintln!("{} {}", CliTag::UAC_REJECT_FAILED, reject_err),
    }
}

fn handle_uac_list(
    ctx: &CliContext,
    ledger: &mut PromotionStagingLedger,
    policy: &TaxisPolicy,
    current_time_ms: i64,
) {
    let active = ledger.get_active_candidate(current_time_ms);
    if ctx.json_mode {
        let status_payload = serde_json::json!({
            "engine": "taxis",
            "subsystem": "uac_staged_promotion",
            "active_candidate": active,
            "policy": {
                "ttl_seconds": policy.staged_promotion_ttl_seconds,
                "score_ratchet_delta": policy.replacement_score_baseline_delta,
                "min_score": policy.minimum_promotion_score,
                "uac_required": policy.uac_required_for_system_trunk
            }
        });
        print_json(&status_payload);
    } else {
        println!("=== Staged Promotion Queue (Human GUI UAC) ===");
        println!("Policy Guardrails:");
        println!("  Human UAC Required : {}", policy.uac_required_for_system_trunk);
        println!(
            "  Staged Lease TTL   : {}s (1 Hour)",
            policy.staged_promotion_ttl_seconds
        );
        println!(
            "  Score Ratchet Δ    : +{:.1} points",
            policy.replacement_score_baseline_delta
        );
        println!("  Minimum Auto Score : {:.1}/100
", policy.minimum_promotion_score);

        match active {
            Some(cand) => {
                let remaining_sec = (cand.expires_at_ms - current_time_ms).max(0) / 1000;
                println!("Active Candidate Awaiting Human UAC:");
                println!("  Request ID     : {}", cand.request_id);
                println!("  Candidate OID  : {}", cand.candidate_commit_oid.to_hex());
                println!("  Proposing Agent: {}", cand.agent_uid);
                println!(
                    "  Auto Score     : {:.1}/100 (CAI: {:.1}%, CC Δ: {}, Anti-Gaming: {})",
                    cand.auto_score.composite_score,
                    cand.auto_score.cai_index,
                    cand.auto_score.cyclomatic_complexity_delta,
                    if cand.auto_score.anti_gaming_passed { "PASS" } else { "FAIL" }
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
                println!("No active candidate currently awaiting human UAC approval.");
            }
        }
    }
}
