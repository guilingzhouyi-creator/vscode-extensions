//! Module: taxis_cmd::merge_lineage — Post-Merge Lineage Ledger & Ephemeral Reclaim
//! File Path: src/bin/taxis_cmd/merge_lineage.rs
//! Architecture Role: Records `LineageEventKind::Merge` receipts into `TXLN` ledgers and
//!   optionally reclaims merged Tier 3/4 source branches when `taxis merge --reclaim` succeeds.
//! Dependencies & Triggers: Called by `taxis_cmd::merge`.
//! Responsibilities: Preserve topological audit history and remove completed card/sub branches.
//! Exit Semantics & Design Rationale: Best-effort ledger persistence and atomic container ref sync.

use fg_native::sections::refs::RefsSection;
use fg_native::RepoDocument;
use fg_topology::lineage::{LineageEventKind, LineageLedger, LineageRecordParams};
use fractal_git::{DiskRefStore, FractalRef, Oid, RefStore};

use super::fractal_context::{extract_ref_coordinates, strip_branch_prefixes};
use super::repo_view::RepoView;

pub(super) struct MergeLineageContext<'a> {
    pub source_raw: &'a str,
    pub dest_branch: Option<&'a str>,
    pub merged_commit: Oid,
}

pub(super) fn record_merge_lineage(view: &RepoView, ctx: &MergeLineageContext<'_>) {
    let dest_short = ctx
        .dest_branch
        .map(strip_branch_prefixes)
        .unwrap_or_else(|| "HEAD".to_owned());
    let src_short = strip_branch_prefixes(ctx.source_raw);
    let parsed_src = FractalRef::parse(&src_short);
    let parsed_dst = FractalRef::parse(&dest_short);
    let (src_cell, _, _) = extract_ref_coordinates(parsed_src.as_ref());
    let (dst_cell, _, _) = extract_ref_coordinates(parsed_dst.as_ref());
    let cell = src_cell.or(dst_cell);
    let commit_hex = ctx.merged_commit.to_hex();
    LineageLedger::record_best_effort(
        view.git_dir(),
        &LineageRecordParams {
            event_kind: LineageEventKind::Merge,
            cell_id: cell.as_deref().unwrap_or(""),
            source_ref: &src_short,
            target_ref: &dest_short,
            commit_oid_hex: &commit_hex,
            parent_oid_hex: "",
        },
    );
}

/// Safely reclaims ephemeral Tier 3/4 source branches when `--reclaim` follows an upward merge.
pub(super) fn maybe_reclaim_merged_source(view: &RepoView, ctx: &MergeLineageContext<'_>) {
    let src_short = strip_branch_prefixes(ctx.source_raw);
    if ctx
        .dest_branch
        .is_some_and(|b| strip_branch_prefixes(b) == src_short)
    {
        return;
    }
    let Some(parsed) = FractalRef::parse(&src_short) else {
        return;
    };
    if !matches!(
        parsed,
        FractalRef::CardWorktree { .. } | FractalRef::SubAgentWorktree { .. }
    ) {
        return;
    }
    let full_ref = format!("refs/heads/{src_short}");
    let ref_store = DiskRefStore::new(view.git_dir());
    if ref_store.delete_ref(&full_ref).ok() != Some(true) {
        return;
    }
    let container_path = fg_native::container_path(view.git_dir());
    if let Ok(mut doc) = RepoDocument::load(&container_path) {
        let mut new_refs = RefsSection::new();
        for r in doc.refs.records() {
            if r.name != full_ref {
                let _ = new_refs.upsert(r.clone());
            }
        }
        doc.refs = new_refs;
        let _ = doc.save_atomic(&container_path);
    }
    let (cell_opt, _, _) = extract_ref_coordinates(Some(&parsed));
    let commit_hex = ctx.merged_commit.to_hex();
    LineageLedger::record_best_effort(
        view.git_dir(),
        &LineageRecordParams {
            event_kind: LineageEventKind::Reclaim,
            cell_id: cell_opt.as_deref().unwrap_or(""),
            source_ref: &src_short,
            target_ref: ctx.dest_branch.unwrap_or("HEAD"),
            commit_oid_hex: &commit_hex,
            parent_oid_hex: "",
        },
    );
}
