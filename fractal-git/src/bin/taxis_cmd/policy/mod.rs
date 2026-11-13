//! Module: taxis_cmd::policy — Encrypted Binary Policy Vault Controller (`TXPF`)
//! File Path: src/bin/taxis_cmd/policy/mod.rs
//! Architecture Role: Sole authorized CLI surface for `.taxis-policy.txp` (`TXPF` v1)
//!   and `.taxis-policy.seal` management.
//! Dependencies & Triggers: Dispatched by `taxis policy <subcommand>`.
//! Responsibilities: Dispatch subcommands, enforce `AuthoritySecret`, and format vault summaries.
//! Exit Semantics & Design Rationale: Unauthenticated mutations reject with `AUTHORITY_BREACH`.

mod mutations;
mod queries;

use std::path::Path;

use fg_gate::authority::resolve_authority_secret;
use fg_topology::{LoadedPolicyVault, PolicyVaultState, PolicyVaultStore};
use fractal_git::constants::cli::CliTag;

use super::common::{fail_usage, print_json, reject, CliContext};

/// Prints CLI usage summary for `taxis policy`.
pub fn print_policy_help() {
    println!(
        "Usage: taxis policy <subcommand> [options]\n\n\
         Kernel-exclusive manager for hidden encrypted '.taxis-policy.txp' configuration.\n\n\
         Subcommands:\n\
           init [--branch-tier <strict|advisory|native>] [--commit-tier <strict|conventional|native>] [--lock]\n\
           status                      Inspect vault verification health & active enforcement tiers\n\
           show                        Decrypt and print full policy spec (requires AuthoritySecret)\n\
           set-branch-tier <tier>      Update branch floor (downgrade requires AuthoritySecret)\n\
           set-commit-tier <tier>      Update commit floor (downgrade requires AuthoritySecret)\n\
           add-cell <cell-id>          Register an additional kebab-case workspace domain cell\n\
           lock | unlock               Toggle authority lock (requires AuthoritySecret)\n\
           reset                       Restore compiled strict defaults (requires AuthoritySecret)\n\
           check <branch>              Evaluate a branch name against current vault grammar"
    );
}

/// Dispatches `taxis policy` subcommands.
pub fn handle_policy(ctx: &CliContext) {
    let Some(action) = ctx.args.first().map(String::as_str) else {
        print_policy_help();
        return;
    };
    if action == "-h" || action == "--help" || action == "help" {
        print_policy_help();
        return;
    }

    match action {
        "init" => mutations::handle_policy_init(ctx),
        "status" => queries::handle_policy_status(ctx),
        "show" => queries::handle_policy_show(ctx),
        "set-branch-tier" => mutations::handle_set_branch_tier(ctx),
        "set-commit-tier" => mutations::handle_set_commit_tier(ctx),
        "add-cell" => mutations::handle_add_cell(ctx),
        "lock" => mutations::handle_set_lock(ctx, true),
        "unlock" => mutations::handle_set_lock(ctx, false),
        "reset" => mutations::handle_policy_reset(ctx),
        "check" => queries::handle_policy_check(ctx),
        other => fail_usage(format!(
            "unknown policy subcommand '{other}'; run 'taxis policy --help'"
        )),
    }
}

pub(super) fn require_authority(git_dir: &Path, action: &str) {
    if let Err(auth_err) = resolve_authority_secret(git_dir) {
        reject(
            CliTag::AUTHORITY_BREACH,
            format!("taxis policy {action} requires verified AuthoritySecret: {auth_err}"),
        );
    }
}

pub(super) fn load_sealed_or_reject(git_dir: &Path, action: &str) -> LoadedPolicyVault {
    match PolicyVaultStore::load_state(git_dir) {
        PolicyVaultState::Sealed(loaded) => *loaded,
        PolicyVaultState::MissingAfterInit { expected_path, .. } => reject(
            CliTag::ERROR,
            format!(
                "hidden policy vault '{}' is missing after init; run 'taxis policy init' first (required for '{action}')",
                expected_path.display()
            ),
        ),
        PolicyVaultState::TamperedOrCorrupt { path, reason } => reject(
            CliTag::AUTHORITY_BREACH,
            format!(
                "hidden policy vault '{}' failed HMAC-SM3 integrity check ({reason}); recover via 'taxis policy init' with AuthoritySecret",
                path.display()
            ),
        ),
        PolicyVaultState::UninitializedExternal => reject(
            CliTag::ERROR,
            "repository has no sealed policy vault yet; run 'taxis policy init' first".to_owned(),
        ),
    }
}

pub(super) fn report_sealed_summary(
    ctx: &CliContext,
    operation: &str,
    loaded: &LoadedPolicyVault,
) {
    let p = &loaded.payload;
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": format!("policy_{operation}"),
            "revision": p.revision,
            "branch_tier": p.branch_floor.as_str(),
            "commit_tier": format!("{:?}", p.commit_floor),
            "locked": p.locked_by_authority,
            "vault_file": loaded.vault_path.file_name().and_then(|n| n.to_str()).unwrap_or(""),
        }));
        return;
    }
    println!(
        "{} Policy vault {operation}: revision={}, branch_tier={}, commit_tier={:?}, locked={}",
        CliTag::VERIFY_PASS,
        p.revision,
        p.branch_floor,
        p.commit_floor,
        p.locked_by_authority
    );
}
