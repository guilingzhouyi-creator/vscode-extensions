//! Unit Test: fg-algorithms (FastCDC, TreeDiff, ThreeWayMerge, PatchGenerator, DagWalker)
//! File Path: tests/rust/test_algorithms.rs

use fractal_git::algorithms::cdc::FastCdcChunker;
use fractal_git::algorithms::diff::patch::{PatchGenerator, PatchLine};
use fractal_git::algorithms::diff::{ChangeKind, TreeDiff};
use fractal_git::algorithms::merge::{ThreeWayMerge, ThreeWayMergeResult};
use fractal_git::algorithms::traverse::DagWalker;
use fractal_git::core::models::Oid;
use std::collections::BTreeMap;

#[test]
fn test_fast_cdc_chunking() {
    let chunker = FastCdcChunker::new(64, 128, 256);
    let mut data = Vec::with_capacity(1024);
    for i in 0..1024 {
        data.push((i % 251) as u8);
    }

    let chunks = chunker.chunk(&data);
    assert!(!chunks.is_empty());

    let mut total_len = 0;
    for chunk in &chunks {
        assert!(chunk.length >= 64);
        assert!(chunk.length <= 256);
        total_len += chunk.length;
    }
    assert_eq!(total_len, 1024);
}

#[test]
fn test_tree_diff() {
    let mut old_tree = BTreeMap::new();
    let mut new_tree = BTreeMap::new();

    let oid_a = Oid::from_bytes([1u8; 20]);
    let oid_b = Oid::from_bytes([2u8; 20]);
    let oid_c = Oid::from_bytes([3u8; 20]);

    old_tree.insert("file_kept.txt".to_string(), oid_a);
    old_tree.insert("file_modified.txt".to_string(), oid_a);
    old_tree.insert("file_deleted.txt".to_string(), oid_b);

    new_tree.insert("file_kept.txt".to_string(), oid_a);
    new_tree.insert("file_modified.txt".to_string(), oid_c);
    new_tree.insert("file_added.txt".to_string(), oid_b);

    let diffs = TreeDiff::compare(&old_tree, &new_tree);
    assert_eq!(diffs.len(), 3);

    let modified = diffs.iter().find(|d| d.path == "file_modified.txt").unwrap();
    assert_eq!(modified.kind, ChangeKind::Modified);

    let deleted = diffs.iter().find(|d| d.path == "file_deleted.txt").unwrap();
    assert_eq!(deleted.kind, ChangeKind::Deleted);

    let added = diffs.iter().find(|d| d.path == "file_added.txt").unwrap();
    assert_eq!(added.kind, ChangeKind::Added);
}

#[test]
fn test_three_way_merge_clean_and_conflict() {
    let oid_base = Oid::from_bytes([1u8; 20]);
    let oid_ours = Oid::from_bytes([2u8; 20]);
    let oid_theirs = Oid::from_bytes([3u8; 20]);
    let oid_clean = Oid::from_bytes([4u8; 20]);

    let mut base = BTreeMap::new();
    base.insert("shared.txt".to_string(), oid_base);
    base.insert("conflict.txt".to_string(), oid_base);

    // Fast-forward test
    let res_ff = ThreeWayMerge::merge(&base, &base, &base);
    assert_eq!(res_ff, ThreeWayMergeResult::FastForward);

    // Clean merge: ours modifies nothing on shared, theirs adds a file
    let mut ours = base.clone();
    let mut theirs = base.clone();
    theirs.insert("theirs_new.txt".to_string(), oid_clean);
    theirs.insert("conflict.txt".to_string(), oid_theirs);
    ours.insert("conflict.txt".to_string(), oid_ours); // Both modified conflict.txt!

    let merge_res = ThreeWayMerge::merge(&base, &ours, &theirs);
    match merge_res {
        ThreeWayMergeResult::Conflicted { merged_tree, conflicts } => {
            assert_eq!(conflicts.len(), 1);
            assert_eq!(conflicts[0].path, "conflict.txt");
            assert_eq!(conflicts[0].base_oid, Some(oid_base));
            assert_eq!(conflicts[0].ours_oid, Some(oid_ours));
            assert_eq!(conflicts[0].theirs_oid, Some(oid_theirs));

            // Clean file was merged automatically
            assert_eq!(merged_tree.get("theirs_new.txt"), Some(&oid_clean));
            assert_eq!(merged_tree.get("shared.txt"), Some(&oid_base));
        }
        _ => panic!("Expected conflicted merge result"),
    }
}

#[test]
fn test_unified_patch_generation() {
    let old_text = "line 1\nline 2\nline 3\n";
    let new_text = "line 1\nline 2 modified\nline 3\n";

    let patch = PatchGenerator::generate_patch("src/test.txt", old_text, new_text);
    assert_eq!(patch.file_path, "src/test.txt");
    assert_eq!(patch.hunks.len(), 1);

    let hunk = &patch.hunks[0];
    assert!(hunk.lines.iter().any(|l| matches!(l, PatchLine::Addition(s) if s.contains("modified"))));
    assert!(hunk.lines.iter().any(|l| matches!(l, PatchLine::Deletion(s) if s == "line 2")));
}

#[test]
fn test_dag_walker_ancestry() {
    let root = Oid::from_bytes([10u8; 20]);
    let commit1 = Oid::from_bytes([11u8; 20]);
    let commit2 = Oid::from_bytes([12u8; 20]);
    let leaf = Oid::from_bytes([13u8; 20]);

    let get_parents = |oid: &Oid| -> Vec<Oid> {
        if oid == &leaf {
            vec![commit2]
        } else if oid == &commit2 {
            vec![commit1]
        } else if oid == &commit1 {
            vec![root]
        } else {
            vec![]
        }
    };

    assert!(DagWalker::is_ancestor(&root, &leaf, get_parents));
    assert!(DagWalker::is_ancestor(&commit1, &leaf, get_parents));
    assert!(!DagWalker::is_ancestor(&leaf, &root, get_parents));

    let ancestors = DagWalker::walk_ancestors(&leaf, get_parents);
    assert_eq!(ancestors, vec![leaf, commit2, commit1, root]);
}
