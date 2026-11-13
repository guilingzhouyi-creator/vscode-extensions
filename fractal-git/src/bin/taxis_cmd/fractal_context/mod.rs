//! Module: taxis_cmd::fractal_context — Active Fractal Coordinate Penetration & Policy Parsing
//! File Path: src/bin/taxis_cmd/fractal_context/mod.rs
//! Architecture Role: Extracts active `(cell, card, subagent)` coordinates and shares tier,
//!   bypass, and `--cascade` derivation helpers across CLI subcommands.
//! Dependencies & Triggers: Consumed by `commit`, `blackboard`, `unarchive`, `branch`, `switch`,
//!   `checkout`, `worktree`, `reclaim`, `merge`, `rebase`, `init`, and `policy`.
//! Responsibilities: Resolve authoritative coordinates and validate policy/bypass options.
//! Exit Semantics & Design Rationale: Fails closed in `Strict` mode when coordinates are missing
//!   or contradict active `HEAD`.

mod coords;
#[cfg(test)]
mod tests;

pub(crate) use coords::ActiveFractalCoordinates;

use std::path::Path;

use fg_core::models::{BranchEnforcementTier, EnforcementTier};
use fg_gate::authority::resolve_authority_secret;
use fg_gate::{BranchBypassContext, BranchGovernanceFloor};
use fg_native::RepoDocument;
use fg_topology::{DiskRefStore, FractalRef, HeadState};

use super::common::find_arg_value;

/// Strips `refs/heads/` or `refs/fractal/` prefix from a reference name.
#[must_use]
pub(crate) fn strip_branch_prefixes(raw: &str) -> String {
    let trimmed = raw.trim();
    trimmed
        .strip_prefix("refs/heads/")
        .or_else(|| trimmed.strip_prefix("refs/fractal/"))
        .unwrap_or(trimmed)
        .to_owned()
}

/// Resolves the checked-out short branch name from `HEAD` loose ref or container metadata.
#[must_use]
pub(crate) fn resolve_head_short_branch(git_dir: &Path) -> Option<String> {
    let ref_store = DiskRefStore::new(git_dir);
    if let Ok(HeadState::Symbolic { name, .. }) = ref_store.head() {
        return Some(strip_branch_prefixes(&name));
    }
    let container_path = fg_native::container_path(git_dir);
    if let Ok(doc) = RepoDocument::load(&container_path) {
        if let fg_native::HeadState::Symbolic { target } = doc.head {
            return Some(strip_branch_prefixes(&target));
        }
    }
    None
}

/// Extracts `(cell_id, card_id, agent_id)` components from a parsed [`FractalRef`].
#[must_use]
pub(crate) fn extract_ref_coordinates(
    parsed: Option<&FractalRef>,
) -> (Option<String>, Option<String>, Option<String>) {
    match parsed {
        Some(FractalRef::CellMain { cell_id }) => (Some(cell_id.clone()), None, None),
        Some(FractalRef::CardWorktree { cell_id, card_id }) => {
            (Some(cell_id.clone()), Some(card_id.clone()), None)
        }
        Some(FractalRef::SubAgentWorktree {
            cell_id,
            card_id,
            subagent_id,
        }) => (
            Some(cell_id.clone()),
            Some(card_id.clone()),
            Some(subagent_id.clone()),
        ),
        _ => (None, None, None),
    }
}

/// Parses a branch governance tier string (`strict` | `advisory` | `native`).
pub(crate) fn parse_branch_tier(raw: &str) -> Result<BranchEnforcementTier, String> {
    BranchEnforcementTier::parse_str(raw).ok_or_else(|| {
        format!("invalid branch policy tier '{raw}'; expected 'strict', 'advisory', or 'native'")
    })
}

/// Parses a commit governance tier string (`strict` | `conventional` | `native`).
pub(crate) fn parse_commit_tier(raw: &str) -> Result<EnforcementTier, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "strict" | "workspace-strict" | "rust-strict" => Ok(EnforcementTier::Strict),
        "conventional" | "conventional-semantic" => Ok(EnforcementTier::Conventional),
        "native" | "git-native" => Ok(EnforcementTier::Native),
        other => Err(format!(
            "invalid commit policy tier '{other}'; expected 'strict', 'conventional', or 'native'"
        )),
    }
}

/// Extracts optional `--bypass-branch-guard` + `--bypass-reason` + human `AuthoritySecret`.
pub(crate) fn parse_branch_bypass(git_dir: &Path, args: &[String]) -> Option<BranchBypassContext> {
    if !args.iter().any(|a| a == "--bypass-branch-guard") {
        return None;
    }
    let reason = find_arg_value(args, &["--bypass-reason", "--reason"])
        .unwrap_or("")
        .to_owned();
    let human_authorized = resolve_authority_secret(git_dir).is_ok();
    Some(BranchBypassContext {
        reason,
        human_authorized,
    })
}

/// Derives a child short branch name by cascading from an explicit base branch or active `HEAD`.
pub(crate) fn derive_cascade_short_branch(
    git_dir: &Path,
    base_override: Option<&str>,
    child_slug: &str,
    facade_type: Option<&str>,
    floor: &BranchGovernanceFloor,
) -> Result<(String, String), String> {
    let parent_name = base_override
        .map(strip_branch_prefixes)
        .or_else(|| resolve_head_short_branch(git_dir))
        .ok_or_else(|| {
            "FGT-TOP-001: cannot use '--cascade' from detached or unborn HEAD without an explicit parent branch".to_owned()
        })?;
    let parent_ref = FractalRef::parse(&parent_name).ok_or_else(|| {
        format!(
            "FGT-TOP-001: active parent branch '{parent_name}' is not a valid fractal node and cannot cascade"
        )
    })?;
    let (_derived_ref, short_child) = parent_ref
        .derive_child(child_slug, facade_type, &floor.spec)
        .map_err(|err| err.to_string())?;
    Ok((parent_name, short_child))
}
