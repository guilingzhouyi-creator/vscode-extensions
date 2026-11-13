//! Module: fg-topology — Cascading Fractal Branch Derivation
//! File Path: crates/fg-topology/src/branch_grammar/derive.rs
//! Architecture Role: Deterministically computes child branch coordinates and Git
//!   branch names directly from a parent [`FractalRef`] across Tiers 0..4.
//! Dependencies & Triggers: Uses `fg_core::models::BranchPolicySpec`, `super::parse`,
//!   and `crate::refs::FractalRef`.
//! Responsibilities: Enforce tier-downward derivation, cell alias canonicalization,
//!   facade formatting, and canonical `/main` Tier 3 emission.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::BranchPolicySpec;

use crate::refs::FractalRef;

use super::{validate_strict_cell, validate_strict_segment};

impl FractalRef {
    /// Deterministically derives a child coordinate and canonical Git short branch name from `self`.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::TopologyBreach`] if the parent tier cannot fork, if `child_slug`
    /// fails lexical validation or cell whitelist checks, or if `--facade` is applied outside Tier 2.
    pub fn derive_child(
        &self,
        child_slug: &str,
        facade_type: Option<&str>,
        policy: &BranchPolicySpec,
    ) -> FractalResult<(Self, String)> {
        let slug = child_slug.trim();
        let parent_display = self
            .to_short_branch_name()
            .unwrap_or_else(|| self.to_git_ref());

        if let Some(kind) = facade_type {
            if !matches!(self, Self::CellMain { .. }) {
                return Err(FractalError::TopologyBreach {
                    source_ref: parent_display,
                    target_ref: format!("{kind}/{slug}"),
                    reason: "--facade <type> can only derive Tier 3 card branches from a Tier 2 'cell/<cell>/main' parent".to_owned(),
                });
            }
        }

        match self {
            Self::SystemTrunk { .. } => derive_from_system_trunk(&parent_display, slug),
            Self::Trunk => derive_from_integration(slug, policy),
            Self::CellMain { cell_id } => derive_from_cell_main(&parent_display, cell_id, slug, facade_type, policy),
            Self::CardWorktree { cell_id, card_id } => derive_from_card(&parent_display, cell_id, card_id, slug, policy),
            Self::SubAgentWorktree { .. } => Err(FractalError::TopologyBreach {
                source_ref: parent_display,
                target_ref: slug.to_owned(),
                reason: "Tier 4 subagent branch is a leaf coordinate and cannot derive child branches".to_owned(),
            }),
            _ => Err(FractalError::TopologyBreach {
                source_ref: parent_display,
                target_ref: slug.to_owned(),
                reason: "telemetry reference cannot derive worktree child branches".to_owned(),
            }),
        }
    }
}

fn derive_from_system_trunk(parent_display: &str, slug: &str) -> FractalResult<(FractalRef, String)> {
    if slug != "integration" {
        return Err(FractalError::TopologyBreach {
            source_ref: parent_display.to_owned(),
            target_ref: slug.to_owned(),
            reason: "SystemTrunk ('main'/'master') can only cascade-derive 'integration' (Tier 1)".to_owned(),
        });
    }
    Ok((FractalRef::Trunk, "integration".to_owned()))
}

fn derive_from_integration(slug: &str, policy: &BranchPolicySpec) -> FractalResult<(FractalRef, String)> {
    let normalized_cell = policy.normalize_cell(slug);
    validate_strict_cell(slug, normalized_cell, policy)?;
    Ok((
        FractalRef::CellMain { cell_id: normalized_cell.to_owned() },
        format!("cell/{normalized_cell}/main"),
    ))
}

fn derive_from_cell_main(
    parent_display: &str,
    cell_id: &str,
    slug: &str,
    facade_type: Option<&str>,
    policy: &BranchPolicySpec,
) -> FractalResult<(FractalRef, String)> {
    validate_strict_cell(parent_display, cell_id, policy)?;
    validate_strict_segment(slug, "card", slug, policy)?;
    if let Some(kind) = facade_type {
        if !policy.is_allowed_facade(kind) {
            return Err(FractalError::TopologyBreach {
                source_ref: parent_display.to_owned(),
                target_ref: format!("{kind}/{cell_id}/{slug}"),
                reason: format!(
                    "unsupported facade type '{kind}'; permitted: {}",
                    policy.facade_types.join(", ")
                ),
            });
        }
        return Ok((
            FractalRef::CardWorktree { cell_id: cell_id.to_owned(), card_id: format!("{kind}-{slug}") },
            format!("{kind}/{cell_id}/{slug}"),
        ));
    }
    Ok((
        FractalRef::CardWorktree { cell_id: cell_id.to_owned(), card_id: slug.to_owned() },
        format!("cell/{cell_id}/card/{slug}/{}", policy.card_canonical_leaf),
    ))
}

fn derive_from_card(
    parent_display: &str,
    cell_id: &str,
    card_id: &str,
    slug: &str,
    policy: &BranchPolicySpec,
) -> FractalResult<(FractalRef, String)> {
    validate_strict_cell(parent_display, cell_id, policy)?;
    validate_strict_segment(slug, "subagent", slug, policy)?;
    Ok((
        FractalRef::SubAgentWorktree {
            cell_id: cell_id.to_owned(),
            card_id: card_id.to_owned(),
            subagent_id: slug.to_owned(),
        },
        format!("cell/{cell_id}/card/{card_id}/sub/{slug}"),
    ))
}
