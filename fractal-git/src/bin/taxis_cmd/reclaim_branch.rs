//! Module: taxis_cmd::reclaim_branch — Lineage-Verified Branch Reclaimer
//! File Path: src/bin/taxis_cmd/reclaim_branch.rs
//! Architecture Role: Safely deletes completed Tier 3/4 branches via `taxis reclaim --branch`
//!   after validating vault health, `BranchGuard` protection, and `TXLN` lineage proofs.
//! Dependencies & Triggers: Dispatched by `taxis_cmd::reclaim::handle_reclaim`.
//! Responsibilities: Enforce fail-closed tamper checks, remove loose/container refs, and record reclaim.
//! Exit Semantics & Design Rationale: Refuses deletion when checked out or unauthenticated.

use fg_core::models::BranchEnforcementTier;
use fg_gate::authority::resolve_authority_secret;
use fg_gate::{BranchGovernanceFloor, BranchGuard};
use fg_native::sections::refs::RefsSection;
use fg_native::RepoDocument;
use fg_topology::lineage::{LineageEventKind, LineageLedger, LineageRecordParams};
use fractal_git::constants::cli::CliTag;
use fractal_git::fractal::refs::HeadState;
use fractal_git::{DiskRefStore, FractalRef, RefStore};

use super::common::{print_json, reject, CliContext};
use super::fractal_context::{extract_ref_coordinates, strip_branch_prefixes};

pub(super) struct ReclaimBranchRequest<'a> {
    pub raw_branch: &'a str,
    pub verify_lineage: bool,
    pub force: bool,
}

/// Safely reclaims an obsolete card/subagent branch after verifying vault & cryptographic lineage.
pub(super) fn reclaim_branch(ctx: &CliContext, req: &ReclaimBranchRequest<'_>) {
    let git_dir = &ctx.git_dir;
    let floor = BranchGovernanceFloor::resolve(git_dir);
    if let Err(err) = BranchGuard::assert_vault_healthy(&floor) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }

    let short_branch = strip_branch_prefixes(req.raw_branch);
    let human_authorized = resolve_authority_secret(git_dir).is_ok();
    if let Err(err) = BranchGuard::check_branch_delete(
        &floor,
        &short_branch,
        req.force || req.verify_lineage,
        human_authorized,
    ) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }

    let ref_store = DiskRefStore::new(git_dir);
    if let Ok(HeadState::Symbolic { name, .. }) = ref_store.head() {
        if strip_branch_prefixes(&name) == short_branch {
            reject(
                CliTag::ERROR,
                format!("error: Cannot reclaim checked-out branch '{short_branch}'"),
            );
        }
    }

    let enforce_lineage = req.verify_lineage || (!req.force && floor.tier == BranchEnforcementTier::Strict);
    if enforce_lineage {
        let ledger = LineageLedger::open(git_dir);
        match ledger.has_verified_lineage_for(&short_branch) {
            Ok(true) => {}
            Ok(false) => reject(
                CliTag::VERIFY_FAIL,
                format!(
                    "FGT-TOP-001: refusing to reclaim branch '{short_branch}' without verified Fork/Merge/Migrate receipt in cryptographic lineage ledger"
                ),
            ),
            Err(err) => reject(
                CliTag::VERIFY_FAIL,
                format!("FGT-TOP-001: lineage ledger verification failed (tamper/corruption): {err}"),
            ),
        }
    }

    let full_ref = format!("refs/heads/{short_branch}");
    let oid = match ref_store.get_ref(&full_ref) {
        Ok(Some(oid)) => oid,
        _ => reject(
            CliTag::ERROR,
            format!("error: branch '{short_branch}' not found"),
        ),
    };

    if let Err(del_err) = ref_store.delete_ref(&full_ref) {
        reject(
            CliTag::ERROR,
            format!("delete reclaimed branch '{short_branch}': {del_err}"),
        );
    }

    let container_path = fg_native::container_path(git_dir);
    if let Ok(mut doc) = RepoDocument::load(&container_path) {
        let mut new_refs = RefsSection::new();
        for record in doc.refs.records() {
            if record.name != full_ref {
                let _ = new_refs.upsert(record.clone());
            }
        }
        doc.refs = new_refs;
        let _ = doc.save_atomic(&container_path);
    }

    let parsed = FractalRef::parse(&short_branch);
    let (cell_opt, _, _) = extract_ref_coordinates(parsed.as_ref());
    let oid_hex = oid.to_hex();
    LineageLedger::record_best_effort(
        git_dir,
        &LineageRecordParams {
            event_kind: LineageEventKind::Reclaim,
            cell_id: cell_opt.as_deref().unwrap_or(""),
            source_ref: &short_branch,
            target_ref: "reclaimed",
            commit_oid_hex: &oid_hex,
            parent_oid_hex: "",
        },
    );

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "reclaim_branch",
            "branch": short_branch,
            "oid": oid_hex,
            "lineage_verified": enforce_lineage,
        }));
    } else {
        println!("Reclaimed branch '{short_branch}' ({}).", &oid_hex[..7]);
    }
}
