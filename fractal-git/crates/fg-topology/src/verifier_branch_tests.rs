//! Module: fg-topology — Branch Topology Verifier Unit Tests
//! File Path: crates/fg-topology/src/verifier_branch_tests.rs
//! Architecture Role: Regression suite validating fork downward closure, linear rebase,
//!   scope subsumption, same-coordinate rename/migration, and trunk delete protection.

use crate::refs::FractalRef;
use crate::verifier::TopologyVerifier;
use crate::worktree::ScopeProjection;

#[test]
fn test_assert_legal_fork_success() {
    let system_trunk = FractalRef::SystemTrunk {
        branch: "main".to_string(),
    };
    let trunk = FractalRef::Trunk;
    let cell_main = FractalRef::CellMain {
        cell_id: "core".to_string(),
    };
    let card = FractalRef::CardWorktree {
        cell_id: "core".to_string(),
        card_id: "k1".to_string(),
    };
    let sub = FractalRef::SubAgentWorktree {
        cell_id: "core".to_string(),
        card_id: "k1".to_string(),
        subagent_id: "s1".to_string(),
    };

    assert!(TopologyVerifier::assert_legal_fork(&system_trunk, &trunk).is_ok());
    assert!(TopologyVerifier::assert_legal_fork(&trunk, &cell_main).is_ok());
    assert!(TopologyVerifier::assert_legal_fork(&cell_main, &card).is_ok());
    assert!(TopologyVerifier::assert_legal_fork(&card, &sub).is_ok());
}

#[test]
fn test_assert_legal_fork_failures() {
    let system_trunk = FractalRef::SystemTrunk {
        branch: "main".to_string(),
    };
    let cell_a = FractalRef::CellMain {
        cell_id: "cell_a".to_string(),
    };
    let cell_b = FractalRef::CellMain {
        cell_id: "cell_b".to_string(),
    };
    let card_a = FractalRef::CardWorktree {
        cell_id: "cell_a".to_string(),
        card_id: "k1".to_string(),
    };
    let sub_a = FractalRef::SubAgentWorktree {
        cell_id: "cell_a".to_string(),
        card_id: "k1".to_string(),
        subagent_id: "s1".to_string(),
    };

    assert!(TopologyVerifier::assert_legal_fork(&system_trunk, &sub_a).is_err());
    assert!(TopologyVerifier::assert_legal_fork(&cell_a, &sub_a).is_err());
    assert!(TopologyVerifier::assert_legal_fork(&cell_b, &card_a).is_err());
}

#[test]
fn test_assert_legal_rebase() {
    let cell_main = FractalRef::CellMain {
        cell_id: "cell_a".to_string(),
    };
    let card = FractalRef::CardWorktree {
        cell_id: "cell_a".to_string(),
        card_id: "k1".to_string(),
    };
    let sub = FractalRef::SubAgentWorktree {
        cell_id: "cell_a".to_string(),
        card_id: "k1".to_string(),
        subagent_id: "s1".to_string(),
    };
    let foreign_card = FractalRef::CardWorktree {
        cell_id: "cell_b".to_string(),
        card_id: "k2".to_string(),
    };

    assert!(TopologyVerifier::assert_legal_rebase(&sub, &card).is_ok());
    assert!(TopologyVerifier::assert_legal_rebase(&card, &cell_main).is_ok());
    assert!(TopologyVerifier::assert_legal_rebase(&sub, &foreign_card).is_err());
}

#[test]
fn test_assert_scope_subsumption() {
    let parent_scope = ScopeProjection::scoped(vec!["crates/fg-topology".to_string()]);
    let child_valid = ScopeProjection::scoped(vec!["crates/fg-topology/src".to_string()]);
    let child_invalid = ScopeProjection::scoped(vec!["crates/fg-storage".to_string()]);

    assert!(TopologyVerifier::assert_scope_subsumption(&parent_scope, &child_valid).is_ok());
    assert!(TopologyVerifier::assert_scope_subsumption(&parent_scope, &child_invalid).is_err());
}

#[test]
fn test_assert_legal_rename_and_delete() {
    let trunk = FractalRef::Trunk;
    let cell_a = FractalRef::CellMain {
        cell_id: "fractal-git".to_owned(),
    };
    let card_a1 = FractalRef::CardWorktree {
        cell_id: "fractal-git".to_owned(),
        card_id: "k1".to_owned(),
    };
    let card_a2 = FractalRef::CardWorktree {
        cell_id: "fractal-git".to_owned(),
        card_id: "k2".to_owned(),
    };
    let card_b = FractalRef::CardWorktree {
        cell_id: "webgames".to_owned(),
        card_id: "k1".to_owned(),
    };
    let sub_a1 = FractalRef::SubAgentWorktree {
        cell_id: "fractal-git".to_owned(),
        card_id: "k1".to_owned(),
        subagent_id: "s1".to_owned(),
    };
    let sub_a2 = FractalRef::SubAgentWorktree {
        cell_id: "fractal-git".to_owned(),
        card_id: "k1".to_owned(),
        subagent_id: "s2".to_owned(),
    };

    assert!(TopologyVerifier::assert_legal_rename(
        &cell_a,
        &card_a1,
        "cell/fractal-git/main",
        "cell/fractal-git/card/k1/main",
        false
    )
    .is_err());
    assert!(TopologyVerifier::assert_legal_rename(
        &card_a1,
        &card_b,
        "cell/fractal-git/card/k1/main",
        "cell/webgames/card/k1/main",
        false
    )
    .is_err());
    assert!(TopologyVerifier::assert_legal_rename(
        &card_a1,
        &card_a2,
        "cell/fractal-git/card/k1/main",
        "cell/fractal-git/card/k2/main",
        false
    )
    .is_ok());
    assert!(TopologyVerifier::assert_legal_rename(
        &card_a1,
        &card_a1,
        "cell/fractal-git/card/k1",
        "cell/fractal-git/card/k1/main",
        true
    )
    .is_ok());
    assert!(TopologyVerifier::assert_legal_rename(
        &sub_a1,
        &sub_a2,
        "cell/fractal-git/card/k1/sub/s1",
        "cell/fractal-git/card/k1/sub/s2",
        false
    )
    .is_ok());

    assert!(TopologyVerifier::assert_legal_delete(&trunk, true, true).is_err());
    assert!(TopologyVerifier::assert_legal_delete(&cell_a, true, false).is_err());
    assert!(TopologyVerifier::assert_legal_delete(&cell_a, true, true).is_ok());
    assert!(TopologyVerifier::assert_legal_delete(&sub_a1, false, false).is_ok());
}
