//! Unit tests: fg-core::models::projection
//! File Path: crates/fg-core/tests/projection_scope_unit.rs
//!
//! The scope's job is to answer "is this path visible here" without letting a child see more than
//! its parent. Every case below is one a plausible implementation gets wrong: treating a directory
//! as if it were a file, ordering an unchecked pattern pair as if it were ordered, letting an
//! extension pattern escape a directory-scoped parent, or reporting a widened child as contained.

use fg_core::models::{ProjectionScope, ProjectionTier};
fn scope(tier: ProjectionTier, include: &[&str]) -> ProjectionScope {
    ProjectionScope::restricted(
        tier,
        include.iter().map(|p| (*p).to_string()).collect(),
        Vec::new(),
    )
    .expect("scope")
}

#[test]
fn an_empty_include_set_means_the_whole_tree() {
    let whole = ProjectionScope::whole(ProjectionTier::SystemTrunk);
    assert!(whole.is_whole());
    assert!(whole.admits("anything/at/all.rs"));
    assert!(!whole.admits(""));
}

#[test]
fn a_blank_pattern_is_refused() {
    let err = ProjectionScope::restricted(
        ProjectionTier::AgentCard,
        vec!["  ".to_string()],
        Vec::new(),
    );
    assert!(err.is_err());
}

#[test]
fn a_prefix_pattern_admits_only_that_subtree() {
    let card = scope(ProjectionTier::AgentCard, &["crates/fg-core/**"]);
    assert!(card.admits("crates/fg-core/src/lib.rs"));
    assert!(!card.admits("crates/fg-storage/src/lib.rs"));
    // Component boundary: a sibling whose name merely starts the same way is not inside.
    assert!(!card.admits("crates/fg-core-evil/src/lib.rs"));
}

#[test]
fn exclusions_are_applied_after_inclusions() {
    let card = ProjectionScope::restricted(
        ProjectionTier::AgentCard,
        vec!["crates/fg-core/**".to_string()],
        vec!["crates/fg-core/target/**".to_string()],
    )
    .expect("scope");
    assert!(card.admits("crates/fg-core/src/lib.rs"));
    assert!(!card.admits("crates/fg-core/target/debug/out.rs"));
}

#[test]
fn an_extension_pattern_matches_at_any_depth() {
    let card = scope(ProjectionTier::AgentCard, &["*.rs"]);
    assert!(card.admits("crates/fg-core/src/lib.rs"));
    assert!(!card.admits("crates/fg-core/src/lib.md"));
}

#[test]
fn a_child_may_narrow_below_an_unrestricted_parent() {
    let parent = ProjectionScope::whole(ProjectionTier::IntegrationCell);
    let child = scope(ProjectionTier::AgentCard, &["crates/fg-core/**"]);
    assert!(child.assert_within(&parent).is_ok());
}

#[test]
fn a_child_may_not_widen_beyond_an_ancestor() {
    // The failure this guards: a card declaring the whole tree while its cell holds one crate.
    // Accepting that would let the card claim history its cell cannot produce.
    let ancestor = scope(ProjectionTier::IntegrationCell, &["crates/fg-core/**"]);
    let child = ProjectionScope::whole(ProjectionTier::AgentCard);
    assert!(child.assert_within(&ancestor).is_err());
}

#[test]
fn a_tier_may_not_authorize_its_own_level() {
    let card = ProjectionScope::whole(ProjectionTier::AgentCard);
    let sibling = ProjectionScope::whole(ProjectionTier::AgentCard);
    assert!(sibling.assert_within(&card).is_err());
}

#[test]
fn a_trunk_may_not_be_cut_from_a_card() {
    let card = ProjectionScope::whole(ProjectionTier::AgentCard);
    let trunk = ProjectionScope::whole(ProjectionTier::SystemTrunk);
    assert!(trunk.assert_within(&card).is_err());
}

#[test]
fn visibility_intersects_with_the_ancestor_on_demand() {
    // A card narrowed to one file inside a cell narrowed to one crate: the file is visible, its
    // sibling is not, even though the card's own pattern would admit it.
    let cell = scope(ProjectionTier::IntegrationCell, &["crates/fg-core/**"]);
    let card = scope(ProjectionTier::AgentCard, &["*.rs"]);
    assert!(card.admits_within("crates/fg-core/src/lib.rs", &cell));
    assert!(!card.admits_within("crates/fg-storage/src/lib.rs", &cell));
}

#[test]
fn a_descendant_inherits_the_next_tier_down() {
    let trunk = ProjectionScope::whole(ProjectionTier::SystemTrunk);
    let cell = trunk.descendant().expect("cell");
    assert_eq!(cell.tier, ProjectionTier::IntegrationCell);
    let card = cell.descendant().expect("card");
    assert_eq!(card.tier, ProjectionTier::AgentCard);
    let sub = card.descendant().expect("sub");
    assert_eq!(sub.tier, ProjectionTier::SubAgent);
    assert!(
        sub.descendant().is_none(),
        "the nesting stops at sub-agents"
    );
}

#[test]
fn a_directory_on_the_path_to_an_included_file_must_be_entered() {
    // The failure this guards: answering `may_contain` with `admits`. `admits("crates")` is
    // false for this scope, so the whole slice would be pruned and reported as empty.
    let card = scope(ProjectionTier::AgentCard, &["crates/fg-core/**"]);
    assert!(
        !card.admits("crates"),
        "a directory is not an included file"
    );
    assert!(
        card.may_contain("crates"),
        "but it must still be descended into"
    );
    assert!(card.may_contain("crates/fg-core"));
    assert!(card.may_contain("crates/fg-core/src"));
}

#[test]
fn a_directory_off_the_slice_is_pruned() {
    let card = scope(ProjectionTier::AgentCard, &["crates/fg-core/**"]);
    assert!(!card.may_contain("crates/fg-storage"));
    assert!(!card.may_contain("docs"));
}

#[test]
fn a_dominating_exclusion_prunes_its_directory() {
    let card = ProjectionScope::restricted(
        ProjectionTier::AgentCard,
        vec!["crates/fg-core/**".to_string()],
        vec!["crates/fg-core/target/**".to_string()],
    )
    .expect("scope");
    assert!(!card.may_contain("crates/fg-core/target"));
    assert!(card.may_contain("crates/fg-core/src"));
}

#[test]
fn the_root_directory_is_always_entered() {
    let card = scope(ProjectionTier::AgentCard, &["crates/fg-core/**"]);
    assert!(card.may_contain(""));
}

#[test]
fn an_unrestricted_scope_enters_every_directory() {
    let whole = ProjectionScope::whole(ProjectionTier::SystemTrunk);
    assert!(whole.may_contain("anything"));
    assert!(whole.may_contain("anything/deeper"));
}

#[test]
fn a_child_nested_inside_the_parents_region_is_contained() {
    // The ordinary case: a card cut from a cell that holds a wider prefix. Rejecting this pair
    // would ban nesting entirely, which is the whole topology.
    let cell = scope(ProjectionTier::IntegrationCell, &["crates/**"]);
    let card = scope(ProjectionTier::AgentCard, &["crates/fg-core/**"]);
    assert!(card.covers(&cell));
    assert!(card.assert_within(&cell).is_ok());
}

#[test]
fn a_child_reaching_outside_the_parents_region_is_refused() {
    let cell = scope(ProjectionTier::IntegrationCell, &["crates/fg-core/**"]);
    let card = scope(ProjectionTier::AgentCard, &["crates/**"]);
    assert!(!card.covers(&cell), "a wider child region is not contained");
    assert!(card.assert_within(&cell).is_err());
}

#[test]
fn a_child_cannot_claim_a_region_the_parent_subtracted() {
    let cell = ProjectionScope::restricted(
        ProjectionTier::IntegrationCell,
        vec!["crates/**".to_string()],
        vec!["crates/vendor/**".to_string()],
    )
    .expect("cell");
    let card = scope(ProjectionTier::AgentCard, &["crates/vendor/**"]);
    assert!(!card.covers(&cell));
}

#[test]
fn an_extension_scope_is_contained_only_by_the_same_extension() {
    let cell = scope(ProjectionTier::IntegrationCell, &["*.rs"]);
    assert!(scope(ProjectionTier::AgentCard, &["*.rs"]).covers(&cell));
    assert!(!scope(ProjectionTier::AgentCard, &["*.md"]).covers(&cell));
    // A directory-scoped parent cannot claim every file with an extension anywhere in the tree.
    let narrow_cell = scope(ProjectionTier::IntegrationCell, &["crates/fg-core/**"]);
    assert!(!scope(ProjectionTier::AgentCard, &["*.rs"]).covers(&narrow_cell));
}

#[test]
fn an_inheriting_child_carries_the_parents_region_forward() {
    let cell = scope(ProjectionTier::IntegrationCell, &["crates/fg-core/**"]);
    let card = cell.inheriting().expect("card");
    assert_eq!(card.tier, ProjectionTier::AgentCard);
    assert!(card.admits("crates/fg-core/src/lib.rs"));
    assert!(!card.admits("crates/fg-storage/src/lib.rs"));
}

#[test]
fn narrowing_below_an_inherited_scope_is_allowed_and_widening_is_not() {
    let cell = scope(ProjectionTier::IntegrationCell, &["crates/fg-core/**"]);
    let mut card = cell.inheriting().expect("card");
    card.narrow_to(vec!["crates/fg-core/src/**".to_string()], Vec::new())
        .expect("narrowing inside the inherited region must be allowed");
    assert!(card.admits("crates/fg-core/src/lib.rs"));

    let widened = card.narrow_to(vec!["crates/**".to_string()], Vec::new());
    assert!(widened.is_err(), "a child may not widen back out");
    assert!(
        card.admits("crates/fg-core/src/lib.rs"),
        "the failed call left the scope intact"
    );
}

#[test]
fn the_scope_round_trips_through_json() {
    let scope = ProjectionScope::restricted(
        ProjectionTier::AgentCard,
        vec!["crates/fg-core/**".to_string()],
        vec!["*.md".to_string()],
    )
    .expect("scope");
    let json = serde_json::to_string(&scope).expect("serialize");
    let back: ProjectionScope = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(back, scope);
}
