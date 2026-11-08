//! Module: fg-topology — Worktree Fan-Out Guard
//! File Path: crates/fg-topology/src/fanout.rs
//! Architecture Role: Bounds how many worktrees one parent tier may hold, so a cell cannot be
//!   filled with candidates nobody evaluates and one parent cannot consume the whole quota.
//! Dependencies & Triggers: Called by `worktree add` before a worktree is materialized.
//! Responsibilities: Decide the bound that applies to a candidate tier, count the siblings that
//!   already exist under the same parent, and refuse the next one once the bound is reached.
//! Exit Semantics & Design Rationale:
//!   - The bound lives in `fg_core::constants` next to the other policy numbers rather than here,
//!     so a reader asking "how wide may a cell be" has one place to look.
//!   - The count is taken from the references the repository actually holds, not from the worktree
//!     registry. A registry entry records where a checkout landed; a reference records that the
//!     fractal node exists. Only the latter answers "how many siblings does this parent have",
//!     because a pruned or never-checked-out node still occupies its slice of the quota.
//!   - A candidate whose tier has no bound is refused rather than allowed. Silently accepting an
//!     unbounded tier would make the guard look enforced everywhere while covering only two levels.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-TOP-001`: Fractal topology reference guard

use fg_core::error::{FractalError, FractalResult};

use crate::refs::FractalRef;

/// Returns the fan-out bound and a human-readable name for the tier being bounded.
///
/// # Errors
///
/// Returns [`FractalError::PolicyViolation`] when `candidate` belongs to a tier that has no bound,
/// because a guard that silently permits the tiers it does not cover is worse than no guard.
fn bound_for(candidate: &FractalRef) -> FractalResult<(usize, &'static str)> {
    match candidate {
        FractalRef::CardWorktree { .. } => Ok((
            fg_core::constants::MAX_CARDS_PER_CELL,
            "integration cell",
        )),
        FractalRef::SubAgentWorktree { .. } => Ok((
            fg_core::constants::MAX_SUBAGENTS_PER_CARD,
            "parent-Agent worktree",
        )),
        other => Err(FractalError::PolicyViolation(format!(
            "{} is not a tier whose fan-out is bounded",
            other.to_git_ref()
        ))),
    }
}

/// Reports whether two references sit under the same parent of the bounded tier.
///
/// A card's parent is its cell; a SubAgent's parent is its card. Two nodes at different tiers are
/// never siblings, so comparing only the shared prefix would let a card and a SubAgent count
/// against one bound.
fn shares_parent(candidate: &FractalRef, sibling: &FractalRef) -> bool {
    match (candidate, sibling) {
        (
            FractalRef::CardWorktree { cell_id, .. },
            FractalRef::CardWorktree {
                cell_id: other_cell,
                ..
            },
        ) => cell_id == other_cell,
        (
            FractalRef::SubAgentWorktree {
                cell_id,
                card_id,
                ..
            },
            FractalRef::SubAgentWorktree {
                cell_id: other_cell,
                card_id: other_card,
                ..
            },
        ) => cell_id == other_cell && card_id == other_card,
        _ => false,
    }
}

/// Asserts that adding one more worktree keeps its parent's fan-out within the bound.
///
/// `siblings` are the worktrees that already exist under the same parent. The check lives here
/// rather than at each call site so the CLI, the orchestrator, and a direct caller all enforce the
/// same number, and so a bypass cannot be introduced by forgetting one of them.
///
/// # Errors
///
/// Returns [`FractalError::TopologyBreach`] carrying the exceeded bound when `siblings` is already
/// at it, and [`FractalError::PolicyViolation`] when `candidate` has no bounded parent tier.
pub fn assert_fanout_available(candidate: &FractalRef, siblings: &[FractalRef]) -> FractalResult<()> {
    let (bound, parent_label) = bound_for(candidate)?;
    let existing = siblings
        .iter()
        .filter(|sibling| shares_parent(candidate, sibling))
        .count();
    if existing >= bound {
        return Err(FractalError::TopologyBreach {
            source_ref: candidate.to_git_ref(),
            target_ref: parent_label.to_string(),
            reason: format!(
                "{parent_label} already holds {existing} worktrees, which is the bound of {bound}"
            ),
        });
    }
    Ok(())
}

/// Asserts that the repository can accept one more worktree of `candidate`'s tier.
///
/// Reads the references the store holds rather than a caller-supplied list, so the count reflects
/// every node that exists and not only the ones this process happened to create.
///
/// # Errors
///
/// Propagates reference-store read failures, and otherwise returns what
/// [`assert_fanout_available`] returns.
pub fn assert_fanout_available_in(
    candidate: &FractalRef,
    ref_store: &crate::refs::DiskRefStore,
) -> FractalResult<()> {
    let mut existing: Vec<FractalRef> = Vec::new();
    for (name, _oid) in ref_store.list_all()? {
        if let Some(node) = FractalRef::parse(&name) {
            existing.push(node);
        }
    }
    assert_fanout_available(candidate, &existing)
}
