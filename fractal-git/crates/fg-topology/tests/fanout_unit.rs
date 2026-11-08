//! Module: fg-topology — Worktree Fan-Out Guard Tests
//! File Path: crates/fg-topology/tests/fanout_unit.rs
//! Architecture Role: Pins the fan-out bound to sibling counting under one parent, so a bound that
//!   silently counted the whole repository would fail here rather than in production.
//! Dependencies & Triggers: Runs against `fg_topology::fanout`.
//! Responsibilities: Assert the bound at the boundary, the refusal one past it, the refusal of a
//!   tier with no bound, and that nodes at different tiers never count as siblings.
//! Exit Semantics & Design Rationale: Every case names the tier pairing it exercises, because the
//!   guard's only real failure mode is counting the wrong nodes -- an implementation that counted
//!   everything would still refuse a fourth card in a single-parent fixture.

use fg_core::constants::{MAX_CARDS_PER_CELL, MAX_SUBAGENTS_PER_CARD};
use fg_core::error::FractalError;
use fg_topology::refs::FractalRef;
use fg_topology::assert_fanout_available;

/// Builds a card reference under `cell`.
fn card(cell: &str, card_id: &str) -> FractalRef {
    FractalRef::CardWorktree {
        cell_id: cell.into(),
        card_id: card_id.into(),
    }
}

/// Builds a SubAgent reference under one card.
fn sub(cell: &str, card_id: &str, sub_id: &str) -> FractalRef {
    FractalRef::SubAgentWorktree {
        cell_id: cell.into(),
        card_id: card_id.into(),
        subagent_id: sub_id.into(),
    }
}

#[test]
fn a_cell_accepts_a_third_card_and_refuses_a_fourth() {
    let two = vec![card("core", "a"), card("core", "b")];
    assert!(
        assert_fanout_available(&card("core", "c"), &two).is_ok(),
        "the third card is within the bound"
    );

    let full = vec![card("core", "a"), card("core", "b"), card("core", "c")];
    let err = assert_fanout_available(&card("core", "d"), &full)
        .expect_err("a fourth card exceeds the bound");
    assert!(matches!(err, FractalError::TopologyBreach { .. }));
    assert_eq!(full.len(), MAX_CARDS_PER_CELL);
}

#[test]
fn a_card_accepts_a_third_subagent_and_refuses_a_fourth() {
    let two = vec![sub("core", "a", "s1"), sub("core", "a", "s2")];
    assert!(
        assert_fanout_available(&sub("core", "a", "s3"), &two).is_ok(),
        "the third SubAgent is within the bound"
    );

    let full = vec![
        sub("core", "a", "s1"),
        sub("core", "a", "s2"),
        sub("core", "a", "s3"),
    ];
    let err = assert_fanout_available(&sub("core", "a", "s4"), &full)
        .expect_err("a fourth SubAgent exceeds the bound");
    assert!(matches!(err, FractalError::TopologyBreach { .. }));
    assert_eq!(full.len(), MAX_SUBAGENTS_PER_CARD);
}

#[test]
fn siblings_under_a_different_parent_do_not_consume_the_bound() {
    let other_cell = vec![card("docs", "a"), card("docs", "b"), card("docs", "c")];
    assert!(
        assert_fanout_available(&card("core", "d"), &other_cell).is_ok(),
        "a full sibling cell must not block a different cell"
    );

    let other_card = vec![
        sub("core", "b", "s1"),
        sub("core", "b", "s2"),
        sub("core", "b", "s3"),
    ];
    assert!(
        assert_fanout_available(&sub("core", "a", "s4"), &other_card).is_ok(),
        "a full sibling card must not block a different card"
    );
}

#[test]
fn a_card_and_a_subagent_never_count_as_siblings() {
    let subagents = vec![
        sub("core", "a", "s1"),
        sub("core", "a", "s2"),
        sub("core", "a", "s3"),
    ];
    assert!(
        assert_fanout_available(&card("core", "a"), &subagents).is_ok(),
        "SubAgents under a card do not occupy the card quota of that cell"
    );
}

#[test]
fn a_tier_without_a_bound_is_refused_rather_than_permitted() {
    let branch = FractalRef::SystemTrunk {
        branch: "main".into(),
    };
    let err = assert_fanout_available(&branch, &[])
        .expect_err("an unbounded tier must be refused, not silently allowed");
    assert!(matches!(err, FractalError::PolicyViolation(_)));
}
