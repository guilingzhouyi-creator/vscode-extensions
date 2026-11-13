//! Module: fg-topology — Self-Similar Topology Verification
//! File Path: crates/fg-topology/src/verifier.rs
//! Architecture Role: Enforces strict four-tier fractal hierarchy constraints,
//!   validating that SubAgents only merge into their parent Card, Cards into Cell Main,
//!   and Cell Mains into System Trunk, preventing cross-tier leakage.

use crate::refs::FractalRef;
use fg_core::error::{FractalError, FractalResult};

/// Verifier for legal topological branch promotions.
pub struct TopologyVerifier;

impl TopologyVerifier {
    /// Validates whether merging `source` into `target` is mathematically
    /// and architecturally legal.
    pub fn assert_legal_merge(source: &FractalRef, target: &FractalRef) -> FractalResult<()> {
        match (source, target) {
            // Level 1: SubAgent can only merge into its direct parent Card worktree
            (
                FractalRef::SubAgentWorktree {
                    cell_id: s_cell,
                    card_id: s_card,
                    ..
                },
                FractalRef::CardWorktree {
                    cell_id: t_cell,
                    card_id: t_card,
                },
            ) => {
                if s_cell == t_cell && s_card == t_card {
                    Ok(())
                } else {
                    Err(FractalError::TopologyBreach {
                        source_ref: source.to_git_ref(),
                        target_ref: target.to_git_ref(),
                        reason: "SubAgent can only merge into its exact parent Card worktree"
                            .into(),
                    })
                }
            }

            // Level 2: Card worktree can only merge into its Cell integration main
            (
                FractalRef::CardWorktree {
                    cell_id: s_cell, ..
                },
                FractalRef::CellMain { cell_id: t_cell },
            ) => {
                if s_cell == t_cell {
                    Ok(())
                } else {
                    Err(FractalError::TopologyBreach {
                        source_ref: source.to_git_ref(),
                        target_ref: target.to_git_ref(),
                        reason: "Card worktree can only merge into its designated Cell Main".into(),
                    })
                }
            }

            // Level 3: Cell integration main can only merge into Integration Trunk
            (FractalRef::CellMain { .. }, FractalRef::Trunk) => Ok(()),

            // Level 4 (Dual-Trunk Iron Invariant):
            // System Trunk strictly ONLY accepts promotions from Integration Trunk!
            (FractalRef::Trunk, FractalRef::SystemTrunk { .. }) => Ok(()),

            // All other promotions are illegal cross-tier or reverse merges
            _ => {
                let reason = if matches!(target, FractalRef::SystemTrunk { .. }) {
                    "Direct merge into System Trunk forbidden; strictly only ingests \
                     verified promotions from Integration Trunk"
                        .to_string()
                } else {
                    "Illegal cross-tier or reverse branch merge detected in fractal hierarchy"
                        .to_string()
                };
                Err(FractalError::TopologyBreach {
                    source_ref: source.to_git_ref(),
                    target_ref: target.to_git_ref(),
                    reason,
                })
            }
        }
    }

    /// Validates whether renaming `old_ref` (`old_raw`) to `new_ref` (`new_raw`) preserves
    /// protected trunks, hierarchical tier, and owning `(cell_id, card_id)` coordinate scope.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::TopologyBreach`] on protected trunk renames or cross-tier/cell drift.
    pub fn assert_legal_rename(
        old_ref: &FractalRef,
        new_ref: &FractalRef,
        old_raw: &str,
        new_raw: &str,
        allow_card_migrate: bool,
    ) -> FractalResult<()> {
        if old_ref.is_protected() {
            return Err(FractalError::TopologyBreach {
                source_ref: old_raw.to_owned(),
                target_ref: new_raw.to_owned(),
                reason: format!(
                    "protected trunk or telemetry branch '{old_raw}' cannot be renamed"
                ),
            });
        }
        if new_ref.is_protected() {
            return Err(FractalError::TopologyBreach {
                source_ref: old_raw.to_owned(),
                target_ref: new_raw.to_owned(),
                reason: format!(
                    "cannot rename '{old_raw}' into protected trunk destination '{new_raw}'"
                ),
            });
        }
        match (old_ref, new_ref) {
            (
                FractalRef::CardWorktree {
                    cell_id: old_cell,
                    card_id: old_card,
                },
                FractalRef::CardWorktree {
                    cell_id: new_cell,
                    card_id: new_card,
                },
            ) => {
                if old_cell != new_cell {
                    return Err(FractalError::TopologyBreach {
                        source_ref: old_raw.to_owned(),
                        target_ref: new_raw.to_owned(),
                        reason: format!(
                            "cross-cell rename forbidden: card '{old_card}' belongs to cell '{old_cell}', cannot rename into '{new_cell}'"
                        ),
                    });
                }
                if allow_card_migrate
                    && (old_card != new_card
                        || !FractalRef::is_predecessor_card_ref(old_raw)
                        || FractalRef::is_predecessor_card_ref(new_raw))
                {
                    return Err(FractalError::TopologyBreach {
                        source_ref: old_raw.to_owned(),
                        target_ref: new_raw.to_owned(),
                        reason: format!(
                            "migration rename must keep card_id '{old_card}' and target canonical 'cell/{old_cell}/card/{old_card}/main'"
                        ),
                    });
                }
                Ok(())
            }
            (
                FractalRef::SubAgentWorktree {
                    cell_id: old_cell,
                    card_id: old_card,
                    ..
                },
                FractalRef::SubAgentWorktree {
                    cell_id: new_cell,
                    card_id: new_card,
                    ..
                },
            ) => {
                if old_cell != new_cell || old_card != new_card {
                    return Err(FractalError::TopologyBreach {
                        source_ref: old_raw.to_owned(),
                        target_ref: new_raw.to_owned(),
                        reason: format!(
                            "subagent rename must preserve owning cell '{old_cell}' and card '{old_card}'"
                        ),
                    });
                }
                Ok(())
            }
            _ => Err(FractalError::TopologyBreach {
                source_ref: old_raw.to_owned(),
                target_ref: new_raw.to_owned(),
                reason: format!(
                    "cross-tier branch rename from '{old_raw}' (tier {}) to '{new_raw}' (tier {}) is forbidden",
                    old_ref.tier(),
                    new_ref.tier()
                ),
            }),
        }
    }

    /// Asserts that a list of modified file paths strictly falls within the
    /// worktree's ScopeProjection. Rejects any promotion containing changes outside the
    /// delegated region.
    pub fn assert_scope_compliance(
        worktree: &crate::worktree::FractalWorktree,
        modified_paths: &[String],
    ) -> FractalResult<()> {
        for path in modified_paths {
            if !worktree.projection.contains_path(path) {
                return Err(FractalError::TopologyBreach {
                    source_ref: path.clone(),
                    target_ref: format!("Scope({:?})", worktree.projection.scopes),
                    reason:
                        "Scope violation: modified file falls outside worktree delegated region"
                            .into(),
                });
            }
        }
        Ok(())
    }
}
