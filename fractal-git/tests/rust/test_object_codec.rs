//! Integration Test: Git Object Codec & Fractal Hierarchy Verification
//! File Path: tests/rust/test_object_codec.rs

use fractal_git::{
    FileMode, FractalRef, GitBlob, GitCommit, GitSignature, GitTree, GitTreeEntry, TopologyVerifier,
};

#[test]
fn test_blob_oid_computation() {
    let payload = b"hello fractal git\n".to_vec();
    let blob = GitBlob::from_bytes(payload.clone());

    // Canonical Git hash: sha1("blob 18\0hello fractal git\n")
    assert_eq!(blob.oid().len(), 40);
    assert_eq!(blob.payload(), &payload);
}

#[test]
fn test_tree_sorting_and_serialization() {
    let entries = vec![
        GitTreeEntry::new(
            FileMode::RegularFile,
            "z_file.txt",
            "1111111111111111111111111111111111111111",
        ),
        GitTreeEntry::new(
            FileMode::RegularFile,
            "a_file.txt",
            "2222222222222222222222222222222222222222",
        ),
        GitTreeEntry::new(
            FileMode::Directory,
            "dir_b",
            "3333333333333333333333333333333333333333",
        ),
    ];

    let tree = GitTree::new(entries);
    assert_eq!(tree.oid().len(), 40);

    // Assert canonical sorting: a_file.txt, dir_b/, z_file.txt
    assert_eq!(tree.entries()[0].name, "a_file.txt");
    assert_eq!(tree.entries()[1].name, "dir_b");
    assert_eq!(tree.entries()[2].name, "z_file.txt");
}

#[test]
fn test_commit_creation_with_metadata() {
    let author = GitSignature::for_agent("agent-42", "cell-alpha", 1700000000);
    let committer = author.clone();

    let commit = GitCommit::new(
        "4444444444444444444444444444444444444444",
        vec!["5555555555555555555555555555555555555555".to_string()],
        author,
        committer,
        "feat(core): initial fractal commit\n\n[Project: fractal-git]",
        None,
    );

    assert_eq!(commit.oid().len(), 40);
    assert_eq!(
        commit.tree_oid(),
        "4444444444444444444444444444444444444444"
    );
    assert_eq!(commit.parent_oids().len(), 1);
}

#[test]
fn test_fractal_topology_rules() {
    let sub = FractalRef::SubAgentWorktree {
        cell_id: "cell-alpha".into(),
        card_id: "card-101".into(),
        subagent_id: "sub-1".into(),
    };

    let parent_card = FractalRef::CardWorktree {
        cell_id: "cell-alpha".into(),
        card_id: "card-101".into(),
    };

    let foreign_card = FractalRef::CardWorktree {
        cell_id: "cell-alpha".into(),
        card_id: "card-999".into(),
    };

    let cell_main = FractalRef::CellMain {
        cell_id: "cell-alpha".into(),
    };

    let trunk = FractalRef::Trunk;

    // SubAgent can merge into its own parent Card
    assert!(TopologyVerifier::assert_legal_merge(&sub, &parent_card).is_ok());

    // SubAgent CANNOT merge into a foreign Card
    assert!(TopologyVerifier::assert_legal_merge(&sub, &foreign_card).is_err());

    // SubAgent CANNOT merge directly into CellMain
    assert!(TopologyVerifier::assert_legal_merge(&sub, &cell_main).is_err());

    // Card can merge into its own CellMain
    assert!(TopologyVerifier::assert_legal_merge(&parent_card, &cell_main).is_ok());

    // CellMain can merge into Trunk (Integration Trunk)
    assert!(TopologyVerifier::assert_legal_merge(&cell_main, &trunk).is_ok());

    let system_trunk = FractalRef::SystemTrunk {
        branch: "main".into(),
    };

    // Integration Trunk can merge into System Trunk (Dual-Trunk Promotion)
    assert!(TopologyVerifier::assert_legal_merge(&trunk, &system_trunk).is_ok());

    // Strict Iron Invariant: SubAgent, Card, and CellMain CANNOT merge directly into System Trunk!
    assert!(TopologyVerifier::assert_legal_merge(&sub, &system_trunk).is_err());
    assert!(TopologyVerifier::assert_legal_merge(&parent_card, &system_trunk).is_err());
    assert!(TopologyVerifier::assert_legal_merge(&cell_main, &system_trunk).is_err());
}

#[test]
fn test_scope_projection_subsumption_and_compliance() {
    use fractal_git::fractal::worktree::{FractalWorktree, ScopeProjection};

    let parent_scope = ScopeProjection::scoped(vec![
        "auto-refactor/src/analyzers/".into(),
        "auto-refactor/tests/".into(),
    ]);

    let child_scope_ok =
        ScopeProjection::scoped(vec!["auto-refactor/src/analyzers/hygiene.ts".into()]);

    let child_scope_breach =
        ScopeProjection::scoped(vec!["workspace-timing/src/extension.ts".into()]);

    // Parent subsumes valid child scope
    assert!(parent_scope.assert_subsumes(&child_scope_ok).is_ok());

    // Parent rejects out-of-scope child breach
    assert!(parent_scope.assert_subsumes(&child_scope_breach).is_err());

    // Scoped parent rejects child requesting full universe
    let child_full = ScopeProjection::full();
    assert!(parent_scope.assert_subsumes(&child_full).is_err());

    // Worktree compliance checking
    let wt = FractalWorktree::with_projection(
        "sub-hygiene",
        FractalRef::SubAgentWorktree {
            cell_id: "cell-core".into(),
            card_id: "card-1".into(),
            subagent_id: "agent-1".into(),
        },
        None,
        None,
        child_scope_ok,
    );

    let ok_mods = vec!["auto-refactor/src/analyzers/hygiene.ts".to_string()];
    assert!(TopologyVerifier::assert_scope_compliance(&wt, &ok_mods).is_ok());

    let breach_mods = vec!["auto-refactor/src/core/scanner.ts".to_string()];
    assert!(TopologyVerifier::assert_scope_compliance(&wt, &breach_mods).is_err());
}
