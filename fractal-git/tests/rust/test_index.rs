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

    index.stage_oid("src/lib.rs", FileMode::RegularFile, oid1).unwrap();
    index.stage_oid("README.md", FileMode::RegularFile, oid2).unwrap();

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

    index.stage_conflict("src/conflict.rs", FileMode::RegularFile, base_oid, IndexStage::Base).unwrap();
    index.stage_conflict("src/conflict.rs", FileMode::RegularFile, ours_oid, IndexStage::Ours).unwrap();
    index.stage_conflict("src/conflict.rs", FileMode::RegularFile, theirs_oid, IndexStage::Theirs).unwrap();

    assert!(index.has_conflicts());

    // Tree build MUST fail while unmerged conflicts exist
    let res = index.write_tree_with_persister(|_| Ok(()));
    assert!(res.is_err());

    // Resolve conflict by staging clean entry
    let resolved_oid = Oid::from_bytes([4u8; 20]);
    index.stage_oid("src/conflict.rs", FileMode::RegularFile, resolved_oid).unwrap();
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
