//! Module: taxis_cmd::policy::mutations — Authenticated Policy Vault Mutation Handlers
//! File Path: src/bin/taxis_cmd/policy/mutations.rs
//! Architecture Role: Executes `init`, `set-branch-tier`, `set-commit-tier`, `add-cell`,
//!   `lock`/`unlock`, and `reset` mutations against `.taxis-policy.txp`.
//! Dependencies & Triggers: Called by `policy::handle_policy`.
//! Responsibilities: Enforce authority gates before downgrades, unlocks, resets, or locked updates.
//! Exit Semantics & Design Rationale: Bumps revision + timestamp atomically via `PolicyVaultStore`.

use fg_core::constants::branch::{is_forbidden_branch_prefix, is_valid_kebab_segment};
use fg_core::models::{
    current_unix_seconds, BranchEnforcementTier, BranchPolicySpec, EnforcementTier,
};
use fg_topology::{LoadedPolicyVault, PolicyVaultState, PolicyVaultStore};
use fractal_git::constants::cli::CliTag;

use super::super::common::{fail_usage, find_arg_value, reject, CliContext};
use super::super::fractal_context::{parse_branch_tier, parse_commit_tier};
use super::{load_sealed_or_reject, report_sealed_summary, require_authority};

fn persist_updated_vault(
    ctx: &CliContext,
    operation: &str,
    loaded: &mut LoadedPolicyVault,
) {
    loaded.payload.revision = loaded.payload.revision.saturating_add(1);
    loaded.payload.updated_at_secs = current_unix_seconds();
    let saved = match PolicyVaultStore::save_sealed(&ctx.git_dir, &loaded.payload) {
        Ok(vault) => vault,
        Err(err) => reject(CliTag::ERROR, format!("save policy vault: {err}")),
    };
    report_sealed_summary(ctx, operation, &saved);
}

pub(super) fn handle_policy_init(ctx: &CliContext) {
    let branch_tier = match find_arg_value(&ctx.args, &["--branch-tier", "--branch-policy"]) {
        Some(raw) => match parse_branch_tier(raw) {
            Ok(parsed) => parsed,
            Err(err) => reject(CliTag::ERROR, err),
        },
        None => BranchEnforcementTier::Strict,
    };
    let commit_tier = match find_arg_value(&ctx.args, &["--commit-tier", "--commit-policy"]) {
        Some(raw) => match parse_commit_tier(raw) {
            Ok(parsed) => parsed,
            Err(err) => reject(CliTag::ERROR, err),
        },
        None => EnforcementTier::Strict,
    };
    let lock = ctx.args.iter().any(|arg| arg == "--lock");

    match PolicyVaultStore::load_state(&ctx.git_dir) {
        PolicyVaultState::Sealed(existing) => {
            let needs_authority = existing.payload.locked_by_authority
                || branch_tier < existing.payload.branch_floor
                || commit_tier.rank() < existing.payload.commit_floor.rank();
            if needs_authority {
                require_authority(&ctx.git_dir, "init (override locked or lower floor)");
            }
        }
        PolicyVaultState::TamperedOrCorrupt { .. } => {
            require_authority(&ctx.git_dir, "init (recover corrupted policy vault)");
        }
        PolicyVaultState::MissingAfterInit { .. } | PolicyVaultState::UninitializedExternal => {}
    }

    let loaded = match PolicyVaultStore::initialize_or_regenerate(
        &ctx.git_dir,
        commit_tier,
        branch_tier,
        lock,
    ) {
        Ok(vault) => vault,
        Err(err) => reject(
            CliTag::ERROR,
            format!("failed to seal hidden policy vault: {err}"),
        ),
    };
    report_sealed_summary(ctx, "init", &loaded);
}

pub(super) fn handle_set_branch_tier(ctx: &CliContext) {
    let Some(raw) = ctx.args.get(1) else {
        fail_usage("taxis policy set-branch-tier <strict|advisory|native>");
    };
    let next_tier = match parse_branch_tier(raw) {
        Ok(parsed) => parsed,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let mut loaded = load_sealed_or_reject(&ctx.git_dir, "set-branch-tier");
    if loaded.payload.locked_by_authority || next_tier < loaded.payload.branch_floor {
        require_authority(&ctx.git_dir, "set-branch-tier");
    }
    loaded.payload.branch_floor = next_tier;
    persist_updated_vault(ctx, "set_branch_tier", &mut loaded);
}

pub(super) fn handle_set_commit_tier(ctx: &CliContext) {
    let Some(raw) = ctx.args.get(1) else {
        fail_usage("taxis policy set-commit-tier <strict|conventional|native>");
    };
    let next_tier = match parse_commit_tier(raw) {
        Ok(parsed) => parsed,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let mut loaded = load_sealed_or_reject(&ctx.git_dir, "set-commit-tier");
    if loaded.payload.locked_by_authority || next_tier.rank() < loaded.payload.commit_floor.rank() {
        require_authority(&ctx.git_dir, "set-commit-tier");
    }
    loaded.payload.commit_floor = next_tier;
    persist_updated_vault(ctx, "set_commit_tier", &mut loaded);
}

pub(super) fn handle_add_cell(ctx: &CliContext) {
    let Some(cell_id) = ctx.args.get(1).map(|s| s.trim()) else {
        fail_usage("taxis policy add-cell <cell-id>");
    };
    if !is_valid_kebab_segment(cell_id) || is_forbidden_branch_prefix(cell_id) {
        reject(
            CliTag::VERIFY_FAIL,
            format!("invalid cell identifier '{cell_id}': must be lowercase ASCII kebab-case"),
        );
    }
    let mut loaded = load_sealed_or_reject(&ctx.git_dir, "add-cell");
    if loaded.payload.locked_by_authority {
        require_authority(&ctx.git_dir, "add-cell");
    }
    let already_exists = loaded
        .payload
        .branch_spec
        .recognized_cells
        .iter()
        .any(|existing| existing == cell_id);
    if !already_exists {
        loaded.payload.branch_spec.recognized_cells.push(cell_id.to_owned());
        persist_updated_vault(ctx, "add_cell", &mut loaded);
        return;
    }
    report_sealed_summary(ctx, "add_cell", &loaded);
}

pub(super) fn handle_set_lock(ctx: &CliContext, locked: bool) {
    let action = if locked { "lock" } else { "unlock" };
    require_authority(&ctx.git_dir, action);
    let mut loaded = load_sealed_or_reject(&ctx.git_dir, action);
    loaded.payload.locked_by_authority = locked;
    persist_updated_vault(ctx, action, &mut loaded);
}

pub(super) fn handle_policy_reset(ctx: &CliContext) {
    require_authority(&ctx.git_dir, "reset");
    let mut loaded = load_sealed_or_reject(&ctx.git_dir, "reset");
    loaded.payload.commit_floor = EnforcementTier::Strict;
    loaded.payload.branch_floor = BranchEnforcementTier::Strict;
    loaded.payload.locked_by_authority = false;
    loaded.payload.branch_spec = BranchPolicySpec::workspace_default();
    persist_updated_vault(ctx, "reset", &mut loaded);
}
