//! Module: taxis_cmd::remote_upstream — Remote URL and Upstream Tracking Configuration
//! File Path: src/bin/taxis_cmd/remote_upstream.rs
//! Architecture Role: Owns the configuration writes that bind a local branch to a remote branch
//!   (`push -u`) and that retarget an existing remote (`remote set-url`).
//! Dependencies & Triggers: Called by `taxis_cmd::remote` after a successful push with
//!   `-u`/`--set-upstream`, and by the `remote set-url` subcommand.
//! Responsibilities: Resolve the local and remote branch names from refspecs, persist
//!   `branch.<name>.remote` / `branch.<name>.merge`, and replace `remote.<name>.url`.
//! Exit Semantics & Design Rationale:
//!   - Upstream recording happens only after the transport reported success, so a refused or
//!     failed push never leaves tracking configuration that points at a branch that was not sent.
//!   - `set-url` refuses unknown remote names instead of silently creating a new remote section,
//!     matching Git's `No such remote` error.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::path::Path;

use fg_index::config::{set_value, ConfigKey, ConfigWriteMode};
use fractal_git::constants::cli::CliTag;
use serde_json::json;

use super::common::{print_json, reject, CliContext};
use super::remote::load_configured_remotes;
use super::repo_view::RepoView;

/// Returns the short branch name named by one side of a refspec, or `None` for `HEAD`/`@`/empty.
fn refspec_branch(side: &str) -> Option<String> {
    let short = side.strip_prefix("refs/heads/").unwrap_or(side);
    if short.is_empty() || short == "HEAD" || short == "@" {
        None
    } else {
        Some(short.to_string())
    }
}

/// Records `branch.<local>.remote` and `branch.<local>.merge` after `taxis push -u`.
///
/// The local branch is the refspec source (or the checked-out branch when no refspec names one);
/// the merge target is the refspec destination, defaulting to the same name as the local branch.
pub(crate) fn configure_upstream_tracking(
    ctx: &CliContext,
    remote_target: &str,
    refspecs: &[String],
) {
    let Ok(view) = RepoView::open(ctx) else {
        return;
    };
    let head_branch = view.head_branch().ok().flatten().map(|(name, _)| name);
    let first_spec = refspecs
        .first()
        .map(|spec| spec.strip_prefix('+').unwrap_or(spec));
    let local_branch = first_spec
        .and_then(|spec| refspec_branch(spec.split(':').next().unwrap_or("")))
        .or(head_branch);
    let Some(local_branch) = local_branch else {
        return;
    };
    let remote_branch = first_spec
        .and_then(|spec| refspec_branch(spec.split_once(':').map_or(spec, |(_, dst)| dst)))
        .unwrap_or_else(|| local_branch.clone());

    let config_path = ctx.git_dir.join("config");
    if let Ok(remote_key) = ConfigKey::new("branch", Some(&local_branch), "remote") {
        let _ = set_value(
            &config_path,
            &remote_key,
            remote_target,
            ConfigWriteMode::Replace,
        );
    }
    let merge_ref = format!("refs/heads/{remote_branch}");
    if let Ok(merge_key) = ConfigKey::new("branch", Some(&local_branch), "merge") {
        let _ = set_value(
            &config_path,
            &merge_key,
            &merge_ref,
            ConfigWriteMode::Replace,
        );
    }
    if !ctx.json_mode {
        println!("branch '{local_branch}' set up to track '{remote_target}/{remote_branch}'.");
    }
}

/// Updates the configured URL of an existing remote (`taxis remote set-url <name> <url>`).
pub(crate) fn set_remote_url(ctx: &CliContext, config_path: &Path, args: &[String]) {
    if args.len() < 2 {
        reject(CliTag::ERROR, "usage: taxis remote set-url <name> <newurl>");
    }
    let remote_name = &args[0];
    let new_url = &args[1];
    let remotes = load_configured_remotes(config_path);
    if !remotes.iter().any(|r| r.name == *remote_name) {
        reject(
            CliTag::ERROR,
            format!("error: No such remote '{remote_name}'"),
        );
    }
    let config_key = match ConfigKey::new("remote", Some(remote_name), "url") {
        Ok(parsed) => parsed,
        Err(err) => reject(
            CliTag::ERROR,
            format!("invalid remote name '{remote_name}': {err}"),
        ),
    };
    if let Err(write_error) = set_value(config_path, &config_key, new_url, ConfigWriteMode::Replace)
    {
        reject(
            CliTag::ERROR,
            format!("failed to update remote configuration: {write_error}"),
        );
    }
    if ctx.json_mode {
        print_json(&json!({
            "status": "updated",
            "name": remote_name,
            "url": new_url,
        }));
    }
}
