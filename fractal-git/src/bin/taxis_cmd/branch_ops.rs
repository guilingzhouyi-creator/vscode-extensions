//! Module: taxis_cmd::branch_ops — Branch Governance Guards & Lineage Helpers
//! File Path: src/bin/taxis_cmd/branch_ops.rs
//! Architecture Role: Enforces vault health, `BranchGuard` lifecycle rules, fanout ceilings,
//!   and `TXLN` lineage recording on behalf of `taxis_cmd::branch`.
//! Dependencies & Triggers: Invoked by `taxis_cmd::branch` and `taxis_cmd::branch_migrate`.
//! Responsibilities: Resolve cascade children, guard create/delete/rename, and log TXLN events.
//! Exit Semantics & Design Rationale: Rejects policy or tamper failures before ref mutations.

use std::path::Path;

use fg_gate::authority::resolve_authority_secret;
use fg_gate::{BranchGovernanceFloor, BranchGuard};
use fg_topology::lineage::{LineageEventKind, LineageLedger, LineageRecordParams};
use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, FractalRef, Oid};

use super::common::{reject, CliContext};
use super::fractal_context::{
    derive_cascade_short_branch, extract_ref_coordinates, parse_branch_bypass,
    strip_branch_prefixes,
};
use super::repo_view::RepoView;

pub(super) struct BranchCascadeRequest<'a> {
    pub slug: &'a str,
    pub base_override: Option<&'a str>,
    pub facade: Option<&'a str>,
}

pub(super) struct BranchCreateSpec<'a> {
    pub name: &'a str,
    pub start_point: Option<&'a str>,
}

pub(super) struct BranchLineageEntry<'a> {
    pub event_kind: LineageEventKind,
    pub source_ref: &'a str,
    pub target_ref: &'a str,
    pub oid: Oid,
}

pub(super) fn create_cascade_branch(
    view: &RepoView,
    req: &BranchCascadeRequest<'_>,
    ctx: &CliContext,
) {
    let floor = BranchGovernanceFloor::resolve(view.git_dir());
    let (parent_short, child_short) = match derive_cascade_short_branch(
        view.git_dir(),
        req.base_override,
        req.slug,
        req.facade,
        &floor,
    ) {
        Ok(derived) => derived,
        Err(err) => reject(CliTag::VERIFY_FAIL, err),
    };
    super::branch::create_branch(view, &child_short, Some(&parent_short), ctx);
}

pub(super) fn guard_branch_creation(
    view: &RepoView,
    spec: &BranchCreateSpec<'_>,
    ctx: &CliContext,
) -> Option<String> {
    let git_dir = view.git_dir();
    let floor = BranchGovernanceFloor::resolve(git_dir);
    let bypass = parse_branch_bypass(git_dir, &ctx.args);
    let parent_name = spec
        .start_point
        .map(strip_branch_prefixes)
        .or_else(|| view.head_branch().ok().flatten().map(|(b, _)| b));

    let gate_outcome =
        match BranchGuard::check_branch_creation(&floor, parent_name.as_deref(), spec.name, bypass.as_ref()) {
            Ok(outcome) => outcome,
            Err(err) => {
                let msg = err.to_string();
                if msg.contains("FGT-") {
                    reject(CliTag::VERIFY_FAIL, msg);
                } else {
                    reject(CliTag::VERIFY_FAIL, format!("FGT-TOP-001: {msg}"));
                }
            }
        };
    for warning in &gate_outcome.warnings {
        eprintln!("[ADVISORY] {warning}");
    }
    if let Some(ref child_ref) = gate_outcome.parsed_child {
        if matches!(
            child_ref,
            FractalRef::CardWorktree { .. } | FractalRef::SubAgentWorktree { .. }
        ) {
            let ref_store = DiskRefStore::new(git_dir);
            if let Err(fanout_err) = fg_topology::assert_fanout_available_in(child_ref, &ref_store) {
                reject(CliTag::ERROR, fanout_err);
            }
        }
    }
    parent_name
}

pub(super) fn assert_branch_vault_healthy(git_dir: &Path) {
    let floor = BranchGovernanceFloor::resolve(git_dir);
    if let Err(err) = BranchGuard::assert_vault_healthy(&floor) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }
}

pub(super) fn guard_branch_delete(git_dir: &Path, name: &str, force: bool) {
    let floor = BranchGovernanceFloor::resolve(git_dir);
    if let Err(err) = BranchGuard::assert_vault_healthy(&floor) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }
    let human_authorized = resolve_authority_secret(git_dir).is_ok();
    if let Err(err) = BranchGuard::check_branch_delete(&floor, name, force, human_authorized) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }
}

pub(super) fn guard_branch_rename(git_dir: &Path, old_name: &str, new_name: &str) {
    let floor = BranchGovernanceFloor::resolve(git_dir);
    if let Err(err) = BranchGuard::assert_vault_healthy(&floor) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }
    if let Err(err) = BranchGuard::check_branch_rename(&floor, old_name, new_name, false) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }
}

pub(super) fn record_branch_lineage(git_dir: &Path, entry: BranchLineageEntry<'_>) {
    let parsed = FractalRef::parse(entry.target_ref);
    let (cell_opt, _, _) = extract_ref_coordinates(parsed.as_ref());
    let oid_hex = entry.oid.to_hex();
    LineageLedger::record_best_effort(
        git_dir,
        &LineageRecordParams {
            event_kind: entry.event_kind,
            cell_id: cell_opt.as_deref().unwrap_or(""),
            source_ref: entry.source_ref,
            target_ref: entry.target_ref,
            commit_oid_hex: &oid_hex,
            parent_oid_hex: "",
        },
    );
}
