//! Integration Test: Git Object Codec & Fractal Hierarchy Verification
//! File Path: tests/test_object_codec.rs

use fractal_git::{
    FileMode, FractalRef, GitBlob, GitCommit, GitSignature, GitTree, GitTreeEntry,
    TopologyVerifier,
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
        GitTreeEntry::new(FileMode::RegularFile, "z_file.txt", "1111111111111111111111111111111111111111"),
        GitTreeEntry::new(FileMode::RegularFile, "a_file.txt", "2222222222222222222222222222222222222222"),
        GitTreeEntry::new(FileMode::Directory, "dir_b", "3333333333333333333333333333333333333333"),
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
    assert_eq!(commit.tree_oid(), "4444444444444444444444444444444444444444");
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

    // CellMain can merge into Trunk
    assert!(TopologyVerifier::assert_legal_merge(&cell_main, &trunk).is_ok());
}
