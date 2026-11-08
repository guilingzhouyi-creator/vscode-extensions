//! Module: fg-core — Projection Tier Ordering
//! File Path: crates/fg-core/src/models/projection_tier.rs
//! Architecture Role: Names the four fractal levels and their containment order, so a scope can
//!   state which level it belongs to and a child can be refused when it claims a wider one.
//! Dependencies & Triggers: Used by [`super::projection::ProjectionScope`] and by lease records.
//! Responsibilities: The tier enumeration, its child relation, and the strict ordering that makes
//!   `is_within` implementable.
//! Exit Semantics & Design Rationale:
//!   - The variants are ordered widest-first and the derive is load-bearing. `is_within` is written
//!     as a numeric comparison of the discriminants, so reordering the variants for readability
//!     would silently invert every containment check. The order is part of the contract, not a
//!     presentation choice.
//!   - `child` returns `Option` rather than clamping. A caller that asks for the level below a
//!     SubAgent has made a mistake, and returning `SubAgent` again would let a worktree create a
//!     sibling of itself while appearing to nest.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TOP-001`: Fractal topology reference guard

use serde::{Deserialize, Serialize};

/// Which of the four fractal tiers a projection belongs to.
///
/// Ordered from widest to narrowest. The ordering is used for containment checks, so it must not
/// be rearranged for cosmetic reasons: a Card above a Cell would let a leaf authorize more than the
/// line it was cut from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ProjectionTier {
    /// The system trunk. Holds the only complete view of the history and the only complete diff.
    SystemTrunk,
    /// An integration main line cut from the trunk.
    IntegrationCell,
    /// A parent Agent's worktree, cut from a cell.
    AgentCard,
    /// A SubAgent's worktree, cut from a card.
    SubAgent,
}

impl ProjectionTier {
    /// Returns the tier one level narrower, or `None` for the narrowest.
    ///
    /// Used when creating a child: the child's tier is decided by the parent's, not by the caller,
    /// so a card cannot declare itself a trunk.
    #[must_use]
    pub const fn child(self) -> Option<Self> {
        match self {
            Self::SystemTrunk => Some(Self::IntegrationCell),
            Self::IntegrationCell => Some(Self::AgentCard),
            Self::AgentCard => Some(Self::SubAgent),
            Self::SubAgent => None,
        }
    }

    /// Reports whether this tier is at or below `other` in the four-level nesting.
    #[must_use]
    pub const fn is_within(self, other: Self) -> bool {
        // Both enums are ordered widest-first, so "at or below" is simply "not above".
        (self as u8) >= (other as u8)
    }

    /// Stable name used in diagnostics and persisted records.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SystemTrunk => "system-trunk",
            Self::IntegrationCell => "integration-cell",
            Self::AgentCard => "agent-card",
            Self::SubAgent => "sub-agent",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ProjectionTier;

    #[test]
    fn the_tier_order_runs_widest_to_narrowest() {
        // The derives are load-bearing: `is_within` compares discriminants, so a reordered variant
        // list would invert every containment check without failing to compile.
        assert!(ProjectionTier::SystemTrunk < ProjectionTier::IntegrationCell);
        assert!(ProjectionTier::IntegrationCell < ProjectionTier::AgentCard);
        assert!(ProjectionTier::AgentCard < ProjectionTier::SubAgent);
    }

    #[test]
    fn a_tier_is_within_itself_and_everything_wider() {
        assert!(ProjectionTier::SubAgent.is_within(ProjectionTier::SubAgent));
        assert!(ProjectionTier::SubAgent.is_within(ProjectionTier::SystemTrunk));
        assert!(ProjectionTier::AgentCard.is_within(ProjectionTier::IntegrationCell));
    }

    #[test]
    fn a_wider_tier_is_not_within_a_narrower_one() {
        assert!(!ProjectionTier::SystemTrunk.is_within(ProjectionTier::AgentCard));
        assert!(!ProjectionTier::IntegrationCell.is_within(ProjectionTier::SubAgent));
    }

    #[test]
    fn child_walks_one_level_down_and_stops() {
        assert_eq!(
            ProjectionTier::SystemTrunk.child(),
            Some(ProjectionTier::IntegrationCell)
        );
        assert_eq!(
            ProjectionTier::IntegrationCell.child(),
            Some(ProjectionTier::AgentCard)
        );
        assert_eq!(
            ProjectionTier::AgentCard.child(),
            Some(ProjectionTier::SubAgent)
        );
        assert_eq!(
            ProjectionTier::SubAgent.child(),
            None,
            "a sub-agent has no level below it; returning itself would let a worktree nest in itself"
        );
    }

    #[test]
    fn every_tier_has_a_distinct_stable_name() {
        let names = [
            ProjectionTier::SystemTrunk.as_str(),
            ProjectionTier::IntegrationCell.as_str(),
            ProjectionTier::AgentCard.as_str(),
            ProjectionTier::SubAgent.as_str(),
        ];
        for (index, name) in names.iter().enumerate() {
            assert!(!name.is_empty(), "a tier name must not be blank");
            for other in names.iter().skip(index + 1) {
                assert_ne!(name, other, "two tiers share the name {name}");
            }
        }
    }
}
