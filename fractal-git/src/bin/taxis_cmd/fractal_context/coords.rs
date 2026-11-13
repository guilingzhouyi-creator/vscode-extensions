//! Module: taxis_cmd::fractal_context::coords — Active HEAD Coordinate Resolver
//! File Path: src/bin/taxis_cmd/fractal_context/coords.rs
//! Architecture Role: Resolves authoritative `(cell, card, agent)` coordinates from symbolic `HEAD`
//!   before falling back to CLI flags or environment variables.
//! Dependencies & Triggers: Re-exported by `taxis_cmd::fractal_context`.
//! Responsibilities: Reject CLI/HEAD coordinate mismatches and prevent implicit `cell-default`
//!   attribution when `Strict` branch governance is active.
//! Exit Semantics & Design Rationale: Fails closed whenever coordinates are missing or conflict.

use std::path::Path;

use fg_core::constants::policy::{DEFAULT_AGENT_ID, DEFAULT_CELL_ID};
use fg_core::models::BranchEnforcementTier;
use fg_gate::BranchGovernanceFloor;
use fg_topology::FractalRef;

use super::super::common::find_arg_value;
use super::{extract_ref_coordinates, resolve_head_short_branch};

/// Resolved fractal execution coordinate triple derived from active `HEAD` and CLI overrides.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ActiveFractalCoordinates {
    /// Canonical domain cell coordinate (never `"cell-default"` in `Strict` mode).
    pub(crate) cell_id: String,
    /// Optional Task Card identifier extracted from `HEAD` or `--card`/`TAXIS_CARD_ID`.
    pub(crate) card_id: Option<String>,
    /// Worker agent identifier extracted from `--agent`, `TAXIS_AGENT_ID`, or `HEAD`.
    pub(crate) agent_id: String,
    /// Parsed symbolic `HEAD` fractal coordinate if `HEAD` is on a recognized fractal branch.
    pub(crate) head_ref: Option<FractalRef>,
    /// Short active branch name (`refs/heads/` and `refs/fractal/` stripped) when symbolic.
    pub(crate) head_short_branch: Option<String>,
    /// `true` when falling back to predecessor `DEFAULT_CELL_ID` compatibility mode in `Native`/`Advisory`.
    pub(crate) is_legacy_default_cell: bool,
}

fn read_flag_or_env(args: &[String], flag: &str, env_key: &str) -> Option<String> {
    find_arg_value(args, &[flag])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            std::env::var(env_key)
                .ok()
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty())
        })
}

impl ActiveFractalCoordinates {
    /// Extracts `(cell_id, card_id, agent_id)` strictly binding `HEAD` before explicit flags.
    pub(crate) fn resolve(
        git_dir: &Path,
        args: &[String],
        floor: &BranchGovernanceFloor,
    ) -> Result<Self, String> {
        let head_short_branch = resolve_head_short_branch(git_dir);
        let head_ref = head_short_branch.as_deref().and_then(FractalRef::parse);
        let (head_cell, head_card, head_agent) = extract_ref_coordinates(head_ref.as_ref());

        let explicit_cell = read_flag_or_env(args, "--cell", "TAXIS_CELL_ID")
            .map(|c| floor.spec.normalize_cell(&c).to_owned());
        if let (Some(ref exp), Some(ref hc)) = (&explicit_cell, &head_cell) {
            if exp != hc {
                return Err(format!(
                    "FGT-TOP-001: coordinate conflict — active HEAD branch '{}' belongs to cell '{hc}', contradicting requested '--cell {exp}'",
                    head_short_branch.as_deref().unwrap_or("HEAD")
                ));
            }
        }

        let explicit_card = read_flag_or_env(args, "--card", "TAXIS_CARD_ID");
        if floor.tier == BranchEnforcementTier::Strict {
            if let (Some(ref exp_card), Some(ref hc)) = (&explicit_card, &head_card) {
                if exp_card != hc {
                    return Err(format!(
                        "FGT-TOP-001: coordinate conflict — active HEAD card '{hc}' contradicts requested '--card {exp_card}'"
                    ));
                }
            }
        }

        let explicit_agent = read_flag_or_env(args, "--agent", "TAXIS_AGENT_ID");
        let (cell_id, is_legacy_default_cell) = match explicit_cell.or(head_cell) {
            Some(cell) => {
                if floor.tier == BranchEnforcementTier::Strict
                    && !floor.spec.recognized_cells.iter().any(|allowed| allowed == &cell)
                {
                    return Err(format!(
                        "FGT-TOP-001: unrecognized domain cell '{cell}'; register via 'taxis policy add-cell {cell}' or checkout a recognized cell branch (allowed: {})",
                        floor.spec.recognized_cells.join(", ")
                    ));
                }
                (cell, false)
            }
            None if floor.tier == BranchEnforcementTier::Strict => {
                return Err(
                    "FGT-TOP-001: active branch has no cell coordinate and '--cell <cell-id>' / 'TAXIS_CELL_ID' was not supplied; strict mode forbids falling back to 'cell-default'"
                        .to_owned(),
                );
            }
            None => (DEFAULT_CELL_ID.to_owned(), true),
        };

        Ok(Self {
            cell_id,
            card_id: explicit_card.or(head_card),
            agent_id: explicit_agent
                .or(head_agent)
                .unwrap_or_else(|| DEFAULT_AGENT_ID.to_owned()),
            head_ref,
            head_short_branch,
            is_legacy_default_cell,
        })
    }
}
