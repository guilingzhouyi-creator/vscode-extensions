//! Unit Test: fg-index (InMemoryIndexTree, ConflictStageSlot, IndexStage)
//! File Path: tests/rust/test_index.rs

use fractal_git::core::models::Oid;
use fractal_git::index::{ConflictStageSlot, InMemoryIndexTree, IndexStage};
use fractal_git::object::FileMode;

#[test]
fn test_in_memory_index_tree_clean_workflow() {
    let mut index = InMemoryIndexTree::new();
    let oid1 = Oid::from_bytes([1u8; 20]);
    let oid2 = Oid::from_bytes([2u8; 20]);

    index
        .stage_oid("src/lib.rs", FileMode::RegularFile, oid1)
        .unwrap();
    index
        .stage_oid("README.md", FileMode::RegularFile, oid2)
        .unwrap();

    assert_eq!(index.entry_count(), 2);
    assert!(!index.has_conflicts());

    let mut built_trees = Vec::new();
    let root_oid = index
        .write_tree_with_persister(|tree| {
            built_trees.push(*tree.raw_oid());
            Ok(())
        })
        .expect("Tree build should succeed");

    assert_ne!(root_oid, Oid::ZERO);
    assert!(!built_trees.is_empty());
}

#[test]
fn test_in_memory_index_conflict_stages() {
    let mut index = InMemoryIndexTree::new();
    let base_oid = Oid::from_bytes([1u8; 20]);
    let ours_oid = Oid::from_bytes([2u8; 20]);
    let theirs_oid = Oid::from_bytes([3u8; 20]);

    index
        .stage_conflict(
            "src/conflict.rs",
            FileMode::RegularFile,
            base_oid,
            IndexStage::Base,
        )
        .unwrap();
    index
        .stage_conflict(
            "src/conflict.rs",
            FileMode::RegularFile,
            ours_oid,
            IndexStage::Ours,
        )
        .unwrap();
    index
        .stage_conflict(
            "src/conflict.rs",
            FileMode::RegularFile,
            theirs_oid,
            IndexStage::Theirs,
        )
        .unwrap();

    assert!(index.has_conflicts());

    // Tree build MUST fail while unmerged conflicts exist
    let res = index.write_tree_with_persister(|_| Ok(()));
    assert!(res.is_err());

    // Resolve conflict by staging clean entry
    let resolved_oid = Oid::from_bytes([4u8; 20]);
    index
        .stage_oid("src/conflict.rs", FileMode::RegularFile, resolved_oid)
        .unwrap();
    assert!(!index.has_conflicts());

    let res = index.write_tree_with_persister(|_| Ok(()));
    assert!(res.is_ok());
}

#[test]
fn test_conflict_stage_slot_resolution() {
    let mut slot = ConflictStageSlot::new("src/main.rs");
    let base_oid = Oid::from_bytes([1u8; 20]);
    let ours_oid = Oid::from_bytes([2u8; 20]);
    let theirs_oid = Oid::from_bytes([3u8; 20]);

    slot.record_stage(&fractal_git::index::VirtualIndexEntry::with_stage(
        "src/main.rs",
        FileMode::RegularFile,
        base_oid,
        IndexStage::Base,
    ));
    slot.record_stage(&fractal_git::index::VirtualIndexEntry::with_stage(
        "src/main.rs",
        FileMode::RegularFile,
        ours_oid,
        IndexStage::Ours,
    ));
    slot.record_stage(&fractal_git::index::VirtualIndexEntry::with_stage(
        "src/main.rs",
        FileMode::RegularFile,
        theirs_oid,
        IndexStage::Theirs,
    ));

    let resolved_ours = slot.resolve_ours().unwrap();
    assert_eq!(resolved_ours.oid, ours_oid);

    let resolved_theirs = slot.resolve_theirs().unwrap();
    assert_eq!(resolved_theirs.oid, theirs_oid);
}

#[test]
fn test_scoped_index_filtering_and_parent_grafting() {
    let mut parent_index = InMemoryIndexTree::new();
    let oid_a = Oid::from_bytes([10u8; 20]);
    let oid_b = Oid::from_bytes([20u8; 20]);
    let oid_c = Oid::from_bytes([30u8; 20]);

    parent_index
        .stage_oid("auto-refactor/src/lib.rs", FileMode::RegularFile, oid_a)
        .unwrap();
    parent_index
        .stage_oid("auto-refactor/tests/test1.rs", FileMode::RegularFile, oid_b)
        .unwrap();
    parent_index
        .stage_oid("workspace-timing/src/main.ts", FileMode::RegularFile, oid_c)
        .unwrap();

    // 1. Filter by scope: only pull out auto-refactor/src/
    let scoped = parent_index.filter_by_scope(&["auto-refactor/src".to_string()]);
    assert_eq!(scoped.entry_count(), 1);
    assert!(scoped.entries().contains_key("auto-refactor/src/lib.rs"));
    assert!(!scoped
        .entries()
        .contains_key("workspace-timing/src/main.ts"));

    // 2. Modify within scoped index
    let mut worktree_index = scoped;
    let oid_a_mod = Oid::from_bytes([99u8; 20]);
    worktree_index
        .stage_oid("auto-refactor/src/lib.rs", FileMode::RegularFile, oid_a_mod)
        .unwrap();

    // 3. Graft onto parent entries
    let mut parent_map = std::collections::BTreeMap::new();
    for (k, v) in parent_index.entries() {
        parent_map.insert(k.clone(), (v.mode, v.oid));
    }
    let grafted = worktree_index.graft_onto_parent(&parent_map);

    assert_eq!(grafted.entry_count(), 3);
    assert_eq!(
        grafted
            .entries()
            .get("auto-refactor/src/lib.rs")
            .unwrap()
            .oid,
        oid_a_mod
    );
    assert_eq!(
        grafted
            .entries()
            .get("workspace-timing/src/main.ts")
            .unwrap()
            .oid,
        oid_c
    );
}

#[test]
fn test_first_class_conflict_management() {
    let mut tree = InMemoryIndexTree::new();
    let base_oid = Oid::from_bytes([1u8; 20]);
    let our_oid = Oid::from_bytes([2u8; 20]);
    let their_oid = Oid::from_bytes([3u8; 20]);

    // Record conflict stages
    tree.stage_conflict(
        "src/state.rs",
        FileMode::RegularFile,
        base_oid,
        IndexStage::Base,
    )
    .unwrap();
    tree.stage_conflict(
        "src/state.rs",
        FileMode::RegularFile,
        our_oid,
        IndexStage::Ours,
    )
    .unwrap();
    tree.stage_conflict(
        "src/state.rs",
        FileMode::RegularFile,
        their_oid,
        IndexStage::Theirs,
    )
    .unwrap();

    assert!(tree.has_conflicts());
    assert_eq!(tree.conflict_count(), 1);
    assert!(tree.conflicts().contains_key("src/state.rs"));

    let slot = tree.conflicts().get("src/state.rs").unwrap();
    assert_eq!(slot.base.unwrap().1, base_oid);
    assert_eq!(slot.ours.unwrap().1, our_oid);
    assert_eq!(slot.theirs.unwrap().1, their_oid);

    // Resolve conflict using Ours
    let resolved = slot.resolve_ours().unwrap();
    tree.resolve_conflict("src/state.rs", resolved);

    assert!(!tree.has_conflicts());
    assert_eq!(tree.conflict_count(), 0);
    assert_eq!(tree.entries().get("src/state.rs").unwrap().oid, our_oid);
}

#[test]
fn test_sparse_directory_collapsing_and_reconstruction() {
    let mut index = InMemoryIndexTree::new();
    let main_oid = Oid::from_bytes([42u8; 20]);
    let vendor_subtree_oid = Oid::from_bytes([99u8; 20]);

    // Stage local active files
    index
        .stage_oid("src/main.rs", FileMode::RegularFile, main_oid)
        .expect("Stage file succeeds");

    // Stage out-of-scope vendor subtree as a collapsed sparse directory (Git S_IFDIR truncation)
    index
        .stage_sparse_directory("vendor", vendor_subtree_oid)
        .expect("Stage sparse directory succeeds");

    assert_eq!(index.entry_count(), 2);
    let vendor_entry = index.entries().get("vendor").expect("Vendor entry exists");
    assert!(vendor_entry.is_sparse_dir());
    assert_eq!(vendor_entry.oid, vendor_subtree_oid);
    assert_eq!(vendor_entry.mode, FileMode::Directory);

    let mut created_trees = Vec::new();
    let root_oid = index
        .write_tree_with_persister(|built_tree| {
            created_trees.push(built_tree.clone());
            Ok(())
        })
        .expect("Write tree succeeds");

    assert_ne!(root_oid, Oid::ZERO);
    // Two trees created: "src" containing "main.rs", and the root tree
    assert_eq!(created_trees.len(), 2);

    let root_tree = &created_trees[1];
    let vendor_child = root_tree
        .entries()
        .iter()
        .find(|entry| entry.name == "vendor")
        .expect("Vendor child in root tree");

    assert_eq!(vendor_child.mode, FileMode::Directory);
    assert_eq!(vendor_child.oid, vendor_subtree_oid);
}
