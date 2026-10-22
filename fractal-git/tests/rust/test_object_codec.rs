//! Integration Test: Git Object Codec & Fractal Hierarchy Verification
//! File Path: tests/rust/test_object_codec.rs
//! Architecture Role: Pins the public object-codec contract: object ids are typed values, hex is a
//!   projection, and tree ordering follows Git's directory-trailing-slash rule.
//! Exit Semantics & Design Rationale: Every assertion names the invariant it protects, so a future
//!   change that widens a signature fails here rather than at a downstream call site.

use fractal_git::{
    FileMode, FractalRef, GitBlob, GitCommit, GitSignature, GitTree, GitTreeEntry, Oid,
    TopologyVerifier,
};

#[test]
fn test_blob_oid_computation() {
    let payload = b"hello fractal git\n".to_vec();
    let blob = GitBlob::from_bytes(payload.clone());

    // The typed id and its hex projection must agree, and the hex form must be a full object id.
    assert_eq!(blob.oid_hex().len(), 40);
    assert_eq!(blob.oid().to_hex(), blob.oid_hex());
    assert_eq!(blob.payload(), &payload);
}

#[test]
fn test_tree_sorting_and_serialization() {
    let entries = vec![
        GitTreeEntry::new(
            FileMode::RegularFile,
            "z_file.txt",
            Oid::from_hex("1111111111111111111111111111111111111111").expect("hex"),
        ),
        GitTreeEntry::new(
            FileMode::RegularFile,
            "a_file.txt",
            Oid::from_hex("2222222222222222222222222222222222222222").expect("hex"),
        ),
        GitTreeEntry::new(
            FileMode::Directory,
            "dir_b",
            Oid::from_hex("3333333333333333333333333333333333333333").expect("hex"),
        ),
    ];

    let tree = GitTree::new(entries);
    assert_eq!(tree.oid_hex().len(), 40);

    // Canonical ordering: a_file.txt, dir_b/, z_file.txt
    assert_eq!(tree.entries()[0].name, "a_file.txt");
    assert_eq!(tree.entries()[1].name, "dir_b");
    assert_eq!(tree.entries()[2].name, "z_file.txt");
}

#[test]
fn a_tree_carrying_a_gitlink_serializes_and_round_trips() {
    use fractal_git::object::GitTreeRef;

    // A submodule entry is a commit id in another repository; it has no blob of its own, so a codec
    // that rejects mode 160000 cannot read any repository that uses submodules.
    let submodule_commit = Oid::from_hex("6666666666666666666666666666666666666666").expect("hex");
    let tree = GitTree::new(vec![
        GitTreeEntry::new(
            FileMode::RegularFile,
            "a.txt",
            Oid::from_hex("7777777777777777777777777777777777777777").expect("hex"),
        ),
        GitTreeEntry::new(FileMode::Gitlink, "vendor", submodule_commit),
    ]);

    let raw_payload = tree.to_raw_object();
    let header_end = raw_payload
        .iter()
        .position(|byte| *byte == 0)
        .expect("object header must be NUL terminated");
    let parsed = GitTreeRef::from_bytes(&raw_payload[header_end + 1..]);

    let entries: Vec<_> = parsed
        .iter()
        .collect::<Result<Vec<_>, _>>()
        .expect("tree must parse");
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[1].name, "vendor");
    assert_eq!(entries[1].mode, FileMode::Gitlink);
    assert_eq!(entries[1].oid, submodule_commit);
}

#[test]
fn test_commit_creation_with_metadata() {
    let author = GitSignature::for_agent("agent-42", "cell-alpha", 1700000000);
    let committer = author.clone();

    let tree_oid = Oid::from_hex("4444444444444444444444444444444444444444").expect("hex");
    let parent_oid = Oid::from_hex("5555555555555555555555555555555555555555").expect("hex");

    let commit = GitCommit::new(
        tree_oid,
        vec![parent_oid],
        author,
        committer,
        "feat(core): initial fractal commit\n\n[Project: fractal-git]",
        None,
    );

    assert_eq!(commit.oid_hex().len(), 40);
    assert_eq!(commit.tree_oid(), &tree_oid);
    assert_eq!(commit.parent_oids(), &[parent_oid]);
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

    // A subagent may merge into its own parent card.
    assert!(TopologyVerifier::assert_legal_merge(&sub, &parent_card).is_ok());

    // A subagent may not merge into a foreign card.
    assert!(TopologyVerifier::assert_legal_merge(&sub, &foreign_card).is_err());

    // A subagent may not merge directly into the cell main line.
    assert!(TopologyVerifier::assert_legal_merge(&sub, &cell_main).is_err());

    // A card may merge into its own cell main line.
    assert!(TopologyVerifier::assert_legal_merge(&parent_card, &cell_main).is_ok());

    // The cell main line may merge into the integration trunk.
    assert!(TopologyVerifier::assert_legal_merge(&cell_main, &trunk).is_ok());

    let system_trunk = FractalRef::SystemTrunk {
        branch: "main".into(),
    };

    // The integration trunk may merge into the system trunk.
    assert!(TopologyVerifier::assert_legal_merge(&trunk, &system_trunk).is_ok());

    // Iron invariant: no lower layer may reach the system trunk directly.
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

    // The parent subsumes a child scope that stays inside it.
    assert!(parent_scope.assert_subsumes(&child_scope_ok).is_ok());

    // The parent rejects a child scope that leaves it.
    assert!(parent_scope.assert_subsumes(&child_scope_breach).is_err());

    // A scoped parent rejects a child that requests the full universe.
    let child_full = ScopeProjection::full();
    assert!(parent_scope.assert_subsumes(&child_full).is_err());

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
