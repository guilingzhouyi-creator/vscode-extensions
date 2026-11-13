//! Module: fg-topology — Branch Lifecycle Topology Rules
//! File Path: crates/fg-topology/src/verifier_branch.rs
//! Architecture Role: Enforces downward fork closure, linear rebase ancestry, trunk/cell
//!   deletion protection, and scope subsumption over [`TopologyVerifier`].
//! Dependencies & Triggers: Uses `crate::refs::FractalRef` and `fg_core::error`.

use fg_core::error::{FractalError, FractalResult};

use crate::refs::FractalRef;
use crate::verifier::TopologyVerifier;

impl TopologyVerifier {
    /// Asserts that a child branch can be legally forked from the parent reference
    /// according to Axiom 1 (Fractal Derivation Downward Closure).
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::TopologyBreach`] on tier jumps, missing parents, or root trunks.
    pub fn assert_legal_fork(parent: &FractalRef, child: &FractalRef) -> FractalResult<()> {
        let Some(ref expected_parent) = child.parent() else {
            return Err(FractalError::TopologyBreach {
                source_ref: child.to_git_ref(),
                target_ref: parent.to_git_ref(),
                reason: "Root trunk reference cannot be forked as a child branch".into(),
            });
        };
        if expected_parent == parent {
            return Ok(());
        }
        Err(FractalError::TopologyBreach {
            source_ref: child.to_git_ref(),
            target_ref: parent.to_git_ref(),
            reason: format!(
                "Illegal fractal branch derivation: '{}' must fork strictly from its direct parent '{}', but attempted from '{}'",
                child.to_git_ref(),
                expected_parent.to_git_ref(),
                parent.to_git_ref()
            ),
        })
    }

    /// Asserts that rebasing `source` onto `upstream` preserves fractal ancestry without cross-cell drift.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::TopologyBreach`] when rebasing onto an unrelated ancestor.
    pub fn assert_legal_rebase(source: &FractalRef, upstream: &FractalRef) -> FractalResult<()> {
        if let Some(ref expected_parent) = source.parent() {
            if expected_parent == upstream || source == upstream {
                return Ok(());
            }
        }
        Err(FractalError::TopologyBreach {
            source_ref: source.to_git_ref(),
            target_ref: upstream.to_git_ref(),
            reason: format!(
                "Illegal fractal rebase: '{}' cannot be rebased onto unauthorized upstream '{}'",
                source.to_git_ref(),
                upstream.to_git_ref()
            ),
        })
    }

    /// Validates whether deleting `target` is permitted under fractal trunk protection rules.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::TopologyBreach`] when attempting to delete Tier 0/1 trunks,
    /// telemetry records, or Tier 2 `cell/<cell>/main` without verified human authority.
    pub fn assert_legal_delete(
        target: &FractalRef,
        _force: bool,
        human_authorized: bool,
    ) -> FractalResult<()> {
        match target {
            FractalRef::SystemTrunk { branch }
                if branch == "main" || branch == "master" || branch == "trunk" =>
            {
                Err(FractalError::TopologyBreach {
                    source_ref: target.to_git_ref(),
                    target_ref: "delete".to_owned(),
                    reason: format!("SystemTrunk branch '{branch}' is permanently protected against deletion"),
                })
            }
            FractalRef::Trunk => Err(FractalError::TopologyBreach {
                source_ref: target.to_git_ref(),
                target_ref: "delete".to_owned(),
                reason: "Integration Trunk ('integration') is permanently protected against deletion".to_owned(),
            }),
            FractalRef::CellMain { cell_id } if !human_authorized => Err(FractalError::TopologyBreach {
                source_ref: target.to_git_ref(),
                target_ref: "delete".to_owned(),
                reason: format!(
                    "deleting Tier 2 cell main 'cell/{cell_id}/main' requires verified human authority credentials"
                ),
            }),
            other if other.is_telemetry() => Err(FractalError::TopologyBreach {
                source_ref: other.to_git_ref(),
                target_ref: "delete".to_owned(),
                reason: "telemetry reference is append-only and cannot be deleted".to_owned(),
            }),
            _ => Ok(()),
        }
    }

    /// Asserts that a child worktree's `ScopeProjection` is strictly subsumed by its parent's projection.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::TopologyBreach`] when the child exceeds parent path scope.
    pub fn assert_scope_subsumption(
        parent_scope: &crate::worktree::ScopeProjection,
        child_scope: &crate::worktree::ScopeProjection,
    ) -> FractalResult<()> {
        parent_scope.assert_subsumes(child_scope)
    }
}
