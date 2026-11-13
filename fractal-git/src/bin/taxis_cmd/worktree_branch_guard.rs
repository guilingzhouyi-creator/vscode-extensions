//! Module: taxis_cmd::worktree_branch_guard — Worktree Branch & Scope Governance Validator
//! File Path: src/bin/taxis_cmd/worktree_branch_guard.rs
//! Architecture Role: Validates fractal branch coordinates, cascading derivation, fanout quotas,
//!   and parent/child scope subsumption before `worktree add` creates directories on disk.
//! Dependencies & Triggers: Called by `taxis_cmd::worktree::handle_worktree_add`.
//! Responsibilities: Enforce fail-closed `BranchGuard`, `--cascade` resolution, and zero residue.
//! Exit Semantics & Design Rationale: Exits non-zero before touching the worktree filesystem.

use fg_core::models::BranchEnforcementTier;
use fg_gate::{BranchGovernanceFloor, BranchGuard};
use fg_topology::verifier::TopologyVerifier;
use fractal_git::constants::cli::CliTag;
use fractal_git::fractal::refs::HeadState;
use fractal_git::{DiskRefStore, FractalRef, RefStore, ScopeProjection};

use super::common::{reject, CliContext};
use super::fractal_context::{
    derive_cascade_short_branch, extract_ref_coordinates, parse_branch_bypass,
    strip_branch_prefixes,
};
use super::worktree::WorktreeAddOptions;

pub(super) fn apply_branch_and_scope_guards(
    ctx: &CliContext,
    options: &mut WorktreeAddOptions,
    projection: &ScopeProjection,
) {
    let floor = BranchGovernanceFloor::resolve(&ctx.git_dir);
    if let Err(err) = BranchGuard::assert_vault_healthy(&floor) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }
    let bypass = parse_branch_bypass(&ctx.git_dir, &ctx.args);
    let ref_store = DiskRefStore::new(&ctx.git_dir);
    let head_short = ref_store.head().ok().and_then(|state| match state {
        HeadState::Symbolic { name, .. } => Some(strip_branch_prefixes(&name)),
        HeadState::Detached(_) | HeadState::Absent => None,
    });

    resolve_worktree_branch_target(
        ctx,
        options,
        &floor,
        bypass.as_ref(),
        head_short.as_deref(),
    );

    if let Some(candidate) = options.fractal_ref() {
        if !options.parent_scopes.is_empty() {
            let parent_proj = ScopeProjection::scoped(options.parent_scopes.clone());
            if let Err(breach) = TopologyVerifier::assert_scope_subsumption(&parent_proj, projection) {
                reject(
                    CliTag::VERIFY_FAIL,
                    format!("Worktree scope rejected by TopologyVerifier (FGT-TOP-001): {breach}"),
                );
            }
        }
        if matches!(
            candidate,
            FractalRef::CardWorktree { .. } | FractalRef::SubAgentWorktree { .. }
        ) {
            if let Err(fanout_err) = fg_topology::assert_fanout_available_in(&candidate, &ref_store) {
                reject(CliTag::ERROR, fanout_err);
            }
        }
    }
}

fn resolve_worktree_branch_target(
    ctx: &CliContext,
    options: &mut WorktreeAddOptions,
    floor: &BranchGovernanceFloor,
    bypass: Option<&fg_gate::BranchBypassContext>,
    head_short: Option<&str>,
) {
    if let Some(slug) = options.cascade_slug.clone() {
        let base_override = options
            .explicit_branch
            .as_deref()
            .or(options.target_commit.as_deref());
        let (parent_short, child_short) = match derive_cascade_short_branch(
            &ctx.git_dir,
            base_override,
            &slug,
            options.facade_type.as_deref(),
            floor,
        ) {
            Ok(derived) => derived,
            Err(err) => reject(CliTag::VERIFY_FAIL, err),
        };
        if let Err(err) =
            BranchGuard::check_branch_creation(floor, Some(&parent_short), &child_short, bypass)
        {
            reject(CliTag::VERIFY_FAIL, err.to_string());
        }
        let parsed = FractalRef::parse(&child_short);
        let (cell_opt, card_opt, sub_opt) = extract_ref_coordinates(parsed.as_ref());
        options.cell_id = options.cell_id.take().or(cell_opt);
        options.card_id = options.card_id.take().or(card_opt);
        options.subagent_id = options.subagent_id.take().or(sub_opt);
        options.explicit_branch.get_or_insert(child_short);
        options.target_commit.get_or_insert(parent_short);
        return;
    }

    if let Some(candidate) = options.fractal_ref() {
        let child_short = candidate
            .to_short_branch_name()
            .unwrap_or_else(|| candidate.to_git_ref());
        let parent_short = options
            .target_commit
            .as_deref()
            .or(options.explicit_branch.as_deref())
            .map(strip_branch_prefixes)
            .or_else(|| head_short.map(str::to_owned));
        run_branch_check(floor, parent_short.as_deref(), &child_short, bypass);
        if options.target_commit.is_none() {
            options.target_commit = options.explicit_branch.clone();
        }
        return;
    }

    if let Some(ref explicit_br) = options.explicit_branch {
        let short_br = strip_branch_prefixes(explicit_br);
        run_branch_check(floor, head_short, &short_br, bypass);
        if options.target_commit.is_none() {
            options.target_commit = Some(explicit_br.clone());
        }
        return;
    }

    if floor.tier == BranchEnforcementTier::Strict && bypass.is_none() {
        reject(
            CliTag::VERIFY_FAIL,
            "FGT-TOP-001: Strict governance forbids anonymous `worktree add` without `--cascade` or `--cell`/`--card` fractal coordinates (zero disk residue)",
        );
    }
}

fn run_branch_check(
    floor: &BranchGovernanceFloor,
    parent: Option<&str>,
    child: &str,
    bypass: Option<&fg_gate::BranchBypassContext>,
) {
    match BranchGuard::check_branch_creation(floor, parent, child, bypass) {
        Ok(outcome) => {
            for warning in &outcome.warnings {
                eprintln!("[ADVISORY] {warning}");
            }
        }
        Err(err) => reject(CliTag::VERIFY_FAIL, err.to_string()),
    }
}
