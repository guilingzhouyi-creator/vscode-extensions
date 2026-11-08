//! Module: fg-core — History Horizon Model
//! File Path: crates/fg-core/src/models/horizon.rs
//! Architecture Role: Declares how much history a fractal node is expected to hold locally, so a
//!   reader that meets a missing commit can tell "beyond the window" from "corrupted store".
//! Dependencies & Triggers: Attached to project and sub-lease records; read by traversal windows.
//! Responsibilities: Express the anchor a node was derived from, the span it keeps, and the span's
//!   measured properties.
//! Exit Semantics & Design Rationale:
//!   - The anchor is an `Option<Oid>`, not a zero object id. Git spells "no object" as forty zeros,
//!     which is why its absence semantics needed separate marker files; an explicit `None` cannot be
//!     confused with a commit hash that happens to be zero.
//!   - The span is expressed in both commits and elapsed seconds because the two drift apart. A
//!     fixed commit count grows stale as a repository's activity rate changes, and a fixed duration
//!     changes size as it does. Callers pick the axis their question is actually measured on.
//!   - `Full` is the default and must remain behaviourally identical to having no horizon at all.
//!     A bounded window is an opt-in claim about what a node needs, never an inference.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TOP-001`: Fractal topology reference guard

use serde::{Deserialize, Serialize};

use super::oid::Oid;

/// How much history a node keeps locally.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum HorizonSpan {
    /// Every commit reachable from the anchor. The default, and identical to having no horizon.
    #[default]
    Full,
    /// The most recent `depth` commits, counted back from the anchor.
    Depth(u32),
    /// Commits committed within `seconds` before the anchor's own committer time.
    ///
    /// Preferred when the activity rate is unknown or changing: a fixed commit count means different
    /// amounts of elapsed work at different rates, while a duration stays comparable.
    Recent { seconds: u64 },
}

impl HorizonSpan {
    /// Reports whether this span keeps everything reachable.
    ///
    /// Call sites use this to take the untouched traversal path, so the fast path stays provably
    /// identical rather than merely equivalent.
    #[must_use]
    pub const fn is_unbounded(&self) -> bool {
        matches!(self, Self::Full)
    }

    /// Reports whether this span keeps at least as much history as `other`.
    ///
    /// Spans on different axes are not comparable. `Depth(100)` may or may not exceed
    /// `Recent { seconds: 60 }`; the answer depends on the commit rate, which this type does not
    /// carry. Guessing would either widen a horizon past what the parent holds or narrow it more
    /// than the caller asked, so an incomparable pair reports `false` and the caller refuses the
    /// change instead of inventing an ordering.
    #[must_use]
    pub const fn covers_at_least(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Full, _) => true,
            (Self::Depth(kept), Self::Depth(wanted)) => *kept >= *wanted,
            (Self::Recent { seconds: kept }, Self::Recent { seconds: wanted }) => *kept >= *wanted,
            _ => false,
        }
    }
}

/// Which tier a node's baseline came from, so a request can be routed back to its source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AnchorOrigin {
    /// Derived from the integration trunk.
    Trunk,
    /// Derived from a cell's integration main line.
    Cell { cell_id: String },
    /// Derived from a parent Agent worktree.
    Card { cell_id: String, card_id: String },
    /// Created locally with no upstream baseline.
    Local,
}

/// The snapshot a node was derived from, plus how much of its history the node keeps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BaselineAnchor {
    /// Commit this node branched from. `None` before the node has produced any commit.
    pub oid: Option<Oid>,
    /// Portion of the history below `oid` that this node is expected to hold.
    #[serde(default)]
    pub span: HorizonSpan,
    /// Tier the anchor came from, which is also where a missing object should be requested.
    pub origin: AnchorOrigin,
}

impl BaselineAnchor {
    /// Creates a full-history anchor at `oid` from the trunk.
    #[must_use]
    pub fn full(oid: Oid, origin: AnchorOrigin) -> Self {
        Self {
            oid: Some(oid),
            span: HorizonSpan::Full,
            origin,
        }
    }

    /// Creates an anchor for a node that has not committed yet.
    #[must_use]
    pub fn unborn(origin: AnchorOrigin) -> Self {
        Self {
            oid: None,
            span: HorizonSpan::Full,
            origin,
        }
    }

    /// Reports whether a missing object at `candidate` may simply be outside the window.
    ///
    /// An unbounded anchor never excuses a missing object: the node claims to hold everything, so a
    /// gap is damage. A bounded anchor excuses a gap, but only by admitting the node cannot tell
    /// whether the commit exists. That distinction is what lets a reader refuse to call a window
    /// edge corruption without also accepting silent truncation.
    #[must_use]
    pub fn may_excuse_absence(&self) -> bool {
        !self.span.is_unbounded()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(byte: u8) -> Oid {
        Oid::from_bytes([byte; 20])
    }

    #[test]
    fn the_default_span_keeps_everything() {
        assert_eq!(HorizonSpan::default(), HorizonSpan::Full);
        assert!(HorizonSpan::default().is_unbounded());
    }

    #[test]
    fn a_depth_span_is_bounded() {
        assert!(!HorizonSpan::Depth(1000).is_unbounded());
    }

    #[test]
    fn a_recent_span_is_bounded() {
        assert!(!HorizonSpan::Recent { seconds: 3600 }.is_unbounded());
    }

    #[test]
    fn a_full_span_covers_every_bounded_span() {
        assert!(HorizonSpan::Full.covers_at_least(&HorizonSpan::Depth(1)));
        assert!(HorizonSpan::Full.covers_at_least(&HorizonSpan::Full));
        assert!(!HorizonSpan::Depth(10).covers_at_least(&HorizonSpan::Full));
    }

    #[test]
    fn spans_on_the_same_axis_compare_by_size() {
        assert!(HorizonSpan::Depth(20).covers_at_least(&HorizonSpan::Depth(10)));
        assert!(!HorizonSpan::Depth(10).covers_at_least(&HorizonSpan::Depth(20)));
        assert!(HorizonSpan::Recent { seconds: 600 }
            .covers_at_least(&HorizonSpan::Recent { seconds: 60 }));
        assert!(!HorizonSpan::Recent { seconds: 60 }
            .covers_at_least(&HorizonSpan::Recent { seconds: 600 }));
    }

    #[test]
    fn spans_on_different_axes_are_not_ordered() {
        // Neither answer is derivable without a commit rate, so both directions report false and
        // a caller that requires coverage refuses the change instead of guessing.
        assert!(!HorizonSpan::Depth(1_000_000).covers_at_least(&HorizonSpan::Recent { seconds: 1 }));
        assert!(!HorizonSpan::Recent { seconds: 1_000_000 }.covers_at_least(&HorizonSpan::Depth(1)));
    }
    #[test]
    fn an_unbounded_anchor_never_excuses_a_missing_object() {
        let anchor = BaselineAnchor::full(oid(0x11), AnchorOrigin::Trunk);
        assert!(!anchor.may_excuse_absence());
    }

    #[test]
    fn a_bounded_anchor_may_excuse_a_missing_object() {
        let mut anchor = BaselineAnchor::full(oid(0x11), AnchorOrigin::Trunk);
        anchor.span = HorizonSpan::Depth(50);
        assert!(anchor.may_excuse_absence());
    }

    #[test]
    fn an_unborn_anchor_has_no_oid() {
        let anchor = BaselineAnchor::unborn(AnchorOrigin::Local);
        assert!(anchor.oid.is_none());
        assert_eq!(anchor.span, HorizonSpan::Full);
    }

    #[test]
    fn an_anchor_round_trips_through_json_without_losing_the_span() {
        let anchor = BaselineAnchor {
            oid: Some(oid(0x22)),
            span: HorizonSpan::Recent { seconds: 86_400 },
            origin: AnchorOrigin::Card {
                cell_id: "core".into(),
                card_id: "card-1".into(),
            },
        };
        let encoded = serde_json::to_string(&anchor).expect("encode");
        let decoded: BaselineAnchor = serde_json::from_str(&encoded).expect("decode");
        assert_eq!(decoded, anchor);
    }

    #[test]
    fn a_record_without_a_span_field_decodes_as_full() {
        // Records written before the span existed carry no `span` key; they must keep meaning
        // "everything", not fail to load and not silently become bounded.
        let legacy = r#"{"oid":"1111111111111111111111111111111111111111","origin":"Trunk"}"#;
        let decoded: BaselineAnchor = serde_json::from_str(legacy).expect("decode legacy");
        assert_eq!(decoded.span, HorizonSpan::Full);
    }
}
