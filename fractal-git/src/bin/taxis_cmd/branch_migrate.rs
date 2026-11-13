//! Module: taxis_cmd::branch_migrate — Card Ref D/F Migration & Container Sync
//! File Path: src/bin/taxis_cmd/branch_migrate.rs
//! Architecture Role: Upgrades legacy 4-segment card refs (`cell/<c>/card/<k>`) to 5-segment
//!   D/F-safe canonical branches (`cell/<c>/card/<k>/main`) and syncs container refs on moves.
//! Dependencies & Triggers: Dispatched by `taxis branch migrate`.
//! Responsibilities: Remove legacy loose refs prior to writing `/main`, update symbolic `HEAD`,
//!   synchronize `repo.txc`, and append cryptographic `LineageEventKind::Migrate` receipts.
//! Exit Semantics & Design Rationale: Rolls back deleted legacy loose ref if canonical write fails.

use std::path::Path;

use fg_core::constants::branch::CARD_CANONICAL_LEAF;
use fg_gate::{BranchGovernanceFloor, BranchGuard};
use fg_native::sections::head::HeadState as NativeHeadState;
use fg_native::sections::refs::{RefRecord, RefsSection};
use fg_native::RepoDocument;
use fg_topology::lineage::LineageEventKind;
use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, FractalRef, Oid, RefStore};

use super::branch_ops::{record_branch_lineage, BranchLineageEntry};
use super::common::{print_json, reject, CliContext};
use super::fractal_context::strip_branch_prefixes;
use super::repo_view::RepoView;

pub(super) struct CardMigrationTarget<'a> {
    pub old_name: &'a str,
    pub explicit_new: Option<&'a str>,
}

pub(super) struct ContainerRefMove<'a> {
    pub old_full_ref: &'a str,
    pub new_full_ref: &'a str,
    pub oid: Oid,
    pub update_head: bool,
}

/// Upgrades a predecessor 4-segment card branch to canonical 5-segment `<card>/main`.
pub(super) fn migrate_card_branch(
    view: &RepoView,
    target: CardMigrationTarget<'_>,
    ctx: &CliContext,
) {
    let git_dir = view.git_dir();
    let floor = BranchGovernanceFloor::resolve(git_dir);
    if let Err(err) = BranchGuard::assert_vault_healthy(&floor) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }

    let old_short = strip_branch_prefixes(target.old_name);
    if !FractalRef::is_predecessor_card_ref(&old_short) {
        reject(
            CliTag::VERIFY_FAIL,
            format!(
                "FGT-TOP-001: 'taxis branch migrate' requires a legacy 4-segment card ref 'cell/<cell-id>/card/<card-id>', got '{}'",
                target.old_name
            ),
        );
    }

    let new_short = target
        .explicit_new
        .map(strip_branch_prefixes)
        .unwrap_or_else(|| format!("{old_short}/{CARD_CANONICAL_LEAF}"));

    if let Err(err) = BranchGuard::check_branch_rename(&floor, &old_short, &new_short, true) {
        reject(CliTag::VERIFY_FAIL, err.to_string());
    }

    let ref_store = DiskRefStore::new(git_dir);
    let old_full_ref = format!("refs/heads/{old_short}");
    let new_full_ref = format!("refs/heads/{new_short}");

    let oid = match ref_store.get_ref(&old_full_ref) {
        Ok(Some(oid)) => oid,
        _ => reject(
            CliTag::ERROR,
            format!("error: legacy card branch '{old_short}' not found."),
        ),
    };
    if let Ok(Some(_)) = ref_store.get_ref(&new_full_ref) {
        reject(
            CliTag::ERROR,
            format!("fatal: target canonical branch '{new_short}' already exists."),
        );
    }

    // Delete the 4-segment file before creating `<card>/main` to avoid OS D/F errors.
    if let Err(del_err) = ref_store.delete_ref(&old_full_ref) {
        reject(
            CliTag::ERROR,
            format!("remove legacy card ref '{old_full_ref}': {del_err}"),
        );
    }
    let migrate_msg = format!("Branch: migrated {old_full_ref} to {new_full_ref}");
    if let Err(write_err) =
        ref_store.update_ref_with_message(&new_full_ref, &oid, None, &migrate_msg)
    {
        let _ = ref_store.update_ref(&old_full_ref, &oid, None);
        reject(
            CliTag::ERROR,
            format!("write canonical card ref '{new_full_ref}' (rolled back): {write_err}"),
        );
    }

    let is_active = view
        .head_branch()
        .ok()
        .flatten()
        .is_some_and(|(curr, _)| curr == old_short);
    if is_active {
        if let Err(err) = ref_store.update_head_symbolic(&new_full_ref) {
            reject(CliTag::ERROR, format!("write symbolic HEAD: {err}"));
        }
    }
    sync_container_ref_move(
        git_dir,
        &ContainerRefMove {
            old_full_ref: &old_full_ref,
            new_full_ref: &new_full_ref,
            oid,
            update_head: is_active,
        },
    );

    record_branch_lineage(
        git_dir,
        BranchLineageEntry {
            event_kind: LineageEventKind::Migrate,
            source_ref: &old_short,
            target_ref: &new_short,
            oid,
        },
    );

    let oid_hex = oid.to_hex();
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "branch_migrate",
            "old": old_short,
            "new": new_short,
            "oid": oid_hex,
        }));
    } else {
        println!(
            "Migrated legacy card branch '{}' -> '{}' ({}).",
            old_short,
            new_short,
            &oid_hex[..7]
        );
    }
}

/// Synchronizes a moved/renamed/migrated ref into `repo.txc` if the native container exists.
pub(super) fn sync_container_ref_move(git_dir: &Path, spec: &ContainerRefMove<'_>) {
    let container_path = fg_native::container_path(git_dir);
    let Ok(mut doc) = RepoDocument::load(&container_path) else {
        return;
    };
    let mut new_refs = RefsSection::new();
    for r in doc.refs.records() {
        if r.name != spec.old_full_ref {
            let _ = new_refs.upsert(r.clone());
        }
    }
    let _ = new_refs.upsert(RefRecord {
        name: spec.new_full_ref.to_string(),
        oid: spec.oid,
        peeled: None,
    });
    doc.refs = new_refs;
    if spec.update_head {
        doc.head = NativeHeadState::Symbolic {
            target: spec.new_full_ref.to_string(),
        };
    }
    let _ = doc.save_atomic(&container_path);
}
