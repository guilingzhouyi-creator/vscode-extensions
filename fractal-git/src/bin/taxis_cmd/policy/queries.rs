//! Module: taxis_cmd::policy::queries — Read-Only Policy Vault Queries & Grammar Checks
//! File Path: src/bin/taxis_cmd/policy/queries.rs
//! Architecture Role: Executes `policy status`, `policy show`, and `policy check`.
//! Dependencies & Triggers: Called by `policy::handle_policy`.
//! Responsibilities: Report verification state, decrypt vault fields when authorized, and check refs.
//! Exit Semantics & Design Rationale: Fails closed on missing, tampered, or unauthenticated state.

use fg_gate::{BranchGovernanceFloor, BranchGuard, PolicyFloor};
use fg_topology::{FractalRef, PolicyVaultState, PolicyVaultStore};
use fractal_git::constants::cli::CliTag;

use super::super::common::{fail_usage, print_json, reject, CliContext, EXIT_REJECTED};
use super::{load_sealed_or_reject, require_authority};

pub(super) fn handle_policy_status(ctx: &CliContext) {
    let state = PolicyVaultStore::load_state(&ctx.git_dir);
    let branch_floor = BranchGovernanceFloor::resolve(&ctx.git_dir);
    let commit_floor = PolicyFloor::resolve(&ctx.git_dir);
    let health = match &state {
        PolicyVaultState::Sealed(_) => "verified",
        PolicyVaultState::MissingAfterInit { .. } => "missing_after_init",
        PolicyVaultState::TamperedOrCorrupt { .. } => "tampered_or_corrupt",
        PolicyVaultState::UninitializedExternal => "uninitialized_external",
    };
    let revision = match &state {
        PolicyVaultState::Sealed(loaded) => loaded.payload.revision,
        _ => 0,
    };
    let locked = match &state {
        PolicyVaultState::Sealed(loaded) => loaded.payload.locked_by_authority,
        _ => false,
    };

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "policy_status",
            "health": health,
            "revision": revision,
            "locked": locked,
            "branch_tier": branch_floor.tier.as_str(),
            "commit_tier": commit_floor.preset,
        }));
    } else {
        println!("=== Taxis Binary Policy Vault Status ===");
        println!("  Health      : {health}");
        println!("  Revision    : {revision}");
        println!("  Locked      : {locked}");
        println!("  Branch Tier : {}", branch_floor.tier);
        println!("  Commit Tier : {}", commit_floor.preset);
    }

    if matches!(
        state,
        PolicyVaultState::MissingAfterInit { .. } | PolicyVaultState::TamperedOrCorrupt { .. }
    ) {
        std::process::exit(EXIT_REJECTED);
    }
}

pub(super) fn handle_policy_show(ctx: &CliContext) {
    require_authority(&ctx.git_dir, "show");
    let loaded = load_sealed_or_reject(&ctx.git_dir, "show");
    let p = &loaded.payload;
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "policy_show",
            "revision": p.revision,
            "locked_by_authority": p.locked_by_authority,
            "branch_floor": p.branch_floor.as_str(),
            "commit_floor": format!("{:?}", p.commit_floor),
            "card_canonical_leaf": p.branch_spec.card_canonical_leaf,
            "recognized_cells": p.branch_spec.recognized_cells,
            "facade_types": p.branch_spec.facade_types,
            "forbidden_prefixes": p.branch_spec.forbidden_prefixes,
            "max_segment_len": p.branch_spec.max_segment_len,
        }));
        return;
    }
    println!("=== Decrypted Taxis Policy Vault (TXPF v1) ===");
    println!("  Revision        : {}", p.revision);
    println!("  Locked          : {}", p.locked_by_authority);
    println!("  Branch Floor    : {}", p.branch_floor);
    println!("  Commit Floor    : {:?}", p.commit_floor);
    println!("  Card Leaf       : {}", p.branch_spec.card_canonical_leaf);
    println!(
        "  Recognized Cells: {}",
        p.branch_spec.recognized_cells.join(", ")
    );
    println!(
        "  Facade Types    : {}",
        p.branch_spec.facade_types.join(", ")
    );
}

pub(super) fn handle_policy_check(ctx: &CliContext) {
    let Some(branch) = ctx.args.get(1) else {
        fail_usage("taxis policy check <branch>");
    };
    let floor = BranchGovernanceFloor::resolve(&ctx.git_dir);
    if let Err(err) = BranchGuard::assert_vault_healthy(&floor) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }
    let checked = FractalRef::from_git_ref_checked(branch, &floor.spec, false);
    match checked {
        Ok(parsed) => {
            let short = parsed
                .to_short_branch_name()
                .unwrap_or_else(|| branch.clone());
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "engine": "taxis",
                    "operation": "policy_check",
                    "valid": true,
                    "branch": branch,
                    "canonical_short": short,
                    "tier": parsed.tier(),
                }));
            } else {
                println!(
                    "{} '{}' conforms to Tier {} ({})",
                    CliTag::VERIFY_PASS,
                    branch,
                    parsed.tier(),
                    short
                );
            }
        }
        Err(err) => reject(CliTag::VERIFY_FAIL, err.to_string()),
    }
}
