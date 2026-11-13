//! Module: fg-topology — Strict Branch Grammar Unit Tests
//! File Path: crates/fg-topology/src/branch_grammar/tests.rs
//! Architecture Role: Regression suite covering canonical five-tier grammar acceptance,
//!   D/F 4-segment card rejection, facade mapping, and cascading child derivation.

use crate::refs::FractalRef;
use fg_core::models::BranchPolicySpec;

#[test]
fn strict_branch_grammar_accepts_canonical_and_blocks_adhoc() {
    let policy = BranchPolicySpec::workspace_default();

    assert_eq!(
        FractalRef::from_git_ref_checked("cell/fractal-git/card/phase-4/main", &policy, false)
            .expect("canonical tier 3"),
        FractalRef::CardWorktree {
            cell_id: "fractal-git".to_owned(),
            card_id: "phase-4".to_owned(),
        }
    );
    assert_eq!(
        FractalRef::from_git_ref_checked("ci/infra/pipeline-fix", &policy, false)
            .expect("new facade type ci"),
        FractalRef::CardWorktree {
            cell_id: "infra".to_owned(),
            card_id: "ci-pipeline-fix".to_owned(),
        }
    );

    for invalid in [
        "foo",
        "wip-hack",
        "temp/quick",
        "cell/unknown-cell/main",
        "cell/fractal-git/card/BadCase/main",
        "cell/fractal-git/card/no-leaf-collision",
    ] {
        assert!(
            FractalRef::from_git_ref_checked(invalid, &policy, false).is_err(),
            "must reject invalid branch '{invalid}'"
        );
    }
}

#[test]
fn cascading_derivation_enforces_exact_hierarchy_and_eliminates_df_collision() {
    let policy = BranchPolicySpec::workspace_default();
    let root = FractalRef::SystemTrunk {
        branch: "main".to_owned(),
    };

    let (trunk, trunk_name) = root
        .derive_child("integration", None, &policy)
        .expect("main -> integration");
    assert_eq!(trunk_name, "integration");

    let (cell, cell_name) = trunk
        .derive_child("web-games", None, &policy)
        .expect("integration -> cell/webgames/main");
    assert_eq!(cell_name, "cell/webgames/main");

    let (card, card_name) = cell
        .derive_child("boss-ai", None, &policy)
        .expect("cell -> card/main");
    assert_eq!(card_name, "cell/webgames/card/boss-ai/main");
    assert_eq!(
        card.to_head_ref(),
        "refs/heads/cell/webgames/card/boss-ai/main"
    );
    assert_eq!(
        card.to_git_ref(),
        "refs/fractal/cell/webgames/card/boss-ai/main"
    );

    let (facade_card, facade_name) = cell
        .derive_child("hud-polish", Some("style"), &policy)
        .expect("cell -> style facade");
    assert_eq!(facade_name, "style/webgames/hud-polish");
    assert_eq!(
        facade_card,
        FractalRef::CardWorktree {
            cell_id: "webgames".to_owned(),
            card_id: "style-hud-polish".to_owned(),
        }
    );

    let (sub, sub_name) = card
        .derive_child("wg-construct", None, &policy)
        .expect("card -> subagent");
    assert_eq!(sub_name, "cell/webgames/card/boss-ai/sub/wg-construct");

    assert!(
        sub.derive_child("nested", None, &policy).is_err(),
        "Tier 4 leaf must not derive further children"
    );
}
