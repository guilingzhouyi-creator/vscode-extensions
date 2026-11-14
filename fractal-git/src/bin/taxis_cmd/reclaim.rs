//! Module: taxis_cmd::reclaim — Worktree Sandbox Reclaimer & Prune Engine
//! File Path: src/bin/taxis_cmd/reclaim.rs
//! Architecture Role: Reclaims orphaned or completed worktree directories registered in the
//!   repository container's WKTR section (equivalent to Git's `worktree prune`).
//! Dependencies & Triggers: Dispatched by `taxis worktree prune` and `taxis reclaim`.
//! Responsibilities: Filesystem directory removal, container registry rewrite, and survival reporting.
//! Exit Semantics & Design Rationale:
//!   - Atomically deletes target worktree folders and updates the native container.
//!   - Exits 0 on complete cleanup; exits 1 if any target directory could not be removed.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::path::PathBuf;

use fg_native::RepoDocument;

use super::common::{fail_io, find_arg_value, print_json, CliContext};
use super::reclaim_branch::{reclaim_branch, ReclaimBranchRequest};

/// Reclaims worktree directories or lineage-verified ephemeral branches (`--branch <ref>`).
pub fn handle_reclaim(ctx: &CliContext) {
    if let Some(target_branch) = find_arg_value(&ctx.args, &["--branch"]) {
        let verify_lineage = ctx.args.iter().any(|a| a == "--verify-lineage");
        let force = ctx.args.iter().any(|a| a == "--force" || a == "-f");
        reclaim_branch(
            ctx,
            &ReclaimBranchRequest {
                raw_branch: target_branch,
                verify_lineage,
                force,
            },
        );
        return;
    }

    let container_path = fg_native::container_path(&ctx.git_dir);
    if !container_path.is_file() {
        report_reclaim(ctx, 0, &[], 0);
        return;
    }
    let mut document = match RepoDocument::load(&container_path) {
        Ok(loaded) => loaded,
        Err(load_err) => fail_io(
            format!("load repository container '{}'", container_path.display()),
            load_err,
        ),
    };

    let registered: Vec<fg_native::WorktreeRecord> = document.wktr.records().to_vec();
    let mut reclaimed = 0usize;
    let mut failed: Vec<String> = Vec::new();
    let mut survivors: Vec<fg_native::WorktreeRecord> = Vec::new();

    for record in registered {
        if record.path.is_empty() {
            continue;
        }
        let target = PathBuf::from(&record.path);
        match std::fs::remove_dir_all(&target) {
            Ok(()) => reclaimed += 1,
            Err(remove_err) if remove_err.kind() == std::io::ErrorKind::NotFound => {
                reclaimed += 1;
            }
            Err(remove_err) => {
                failed.push(format!("{}: {}", record.path, remove_err));
                survivors.push(record);
            }
        }
    }

    document.wktr = fg_native::WktrSection::new();
    for survivor in survivors.iter() {
        if let Err(upsert_err) = document.wktr.upsert(survivor.clone()) {
            fail_io("rewrite worktree registry", upsert_err);
        }
    }
    if let Err(save_err) = document.save_atomic(&container_path) {
        fail_io(
            format!(
                "publish repository container '{}'",
                container_path.display()
            ),
            save_err,
        );
    }

    let retained = survivors.len();
    report_reclaim(ctx, reclaimed, &failed, retained);
    if !failed.is_empty() {
        std::process::exit(1);
    }
}

/// Prints the reclamation outcome in the requested format.
fn report_reclaim(ctx: &CliContext, reclaimed: usize, failures: &[String], retained: usize) {
    if ctx.json_mode {
        let reclaim_payload = serde_json::json!({
            "engine": "taxis",
            "operation": "reclaim",
            "reclaimed_worktrees": reclaimed,
            "retained_worktrees": retained,
            "failures": failures,
        });
        print_json(&reclaim_payload);
        return;
    }

    println!("=== Taxis Worktree & Sandbox Reclaimer ===");
    println!("[RECLAIM] Reclaimed worktree directories: {}", reclaimed);
    println!("[RECLAIM] Retained after failure      : {}", retained);
    for failure in failures {
        eprintln!("[RECLAIM] Retained '{}'", failure);
    }
}
