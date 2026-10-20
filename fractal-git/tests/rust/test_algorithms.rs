//! Unit Test: fg-algorithms (FastCDC, TreeDiff, ThreeWayMerge, PatchGenerator, DagWalker)
//! File Path: tests/rust/test_algorithms.rs

use fractal_git::algorithms::cdc::FastCdcChunker;
use fractal_git::algorithms::diff::patch::{PatchGenerator, PatchLine};
use fractal_git::algorithms::diff::{ChangeKind, TreeDiff, TreeDiffState};
use fractal_git::algorithms::merge::{FastPathMerge, ThreeWayMerge, ThreeWayMergeResult};
use fractal_git::algorithms::traverse::DagWalker;
use fractal_git::core::models::{CorrectedCommitDate, Oid, PathBloomFilter};
use fractal_git::object::{FileMode, GitTree, GitTreeEntry};
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

    let modified = diffs
        .iter()
        .find(|d| d.path == "file_modified.txt")
        .unwrap();
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
        ThreeWayMergeResult::Conflicted {
            merged_tree,
            conflicts,
        } => {
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
    assert!(hunk
        .lines
        .iter()
        .any(|l| matches!(l, PatchLine::Addition(s) if s.contains("modified"))));
    assert!(hunk
        .lines
        .iter()
        .any(|l| matches!(l, PatchLine::Deletion(s) if s == "line 2")));
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

#[test]
fn test_myers_diff_minimal_edit_script() {
    // Test that inserting a single line at the top does NOT turn the rest of
    // the file into deletions!
    let old_text = "fn main() {\n    let x = 42;\n    println!(\"{}\", x);\n}\n";
    let new_text =
        "// Top header comment\nfn main() {\n    let x = 42;\n    println!(\"{}\", x);\n}\n";

    let patch = PatchGenerator::generate_patch("src/main.rs", old_text, new_text);
    assert_eq!(patch.hunks.len(), 1);
    let hunk = &patch.hunks[0];

    let additions: Vec<_> = hunk
        .lines
        .iter()
        .filter(|l| matches!(l, PatchLine::Addition(_)))
        .collect();
    let deletions: Vec<_> = hunk
        .lines
        .iter()
        .filter(|l| matches!(l, PatchLine::Deletion(_)))
        .collect();
    let contexts: Vec<_> = hunk
        .lines
        .iter()
        .filter(|l| matches!(l, PatchLine::Context(_)))
        .collect();

    // Exactly 1 line added, 0 lines deleted, 4 lines preserved as Context!
    assert_eq!(additions.len(), 1);
    assert_eq!(deletions.len(), 0);
    assert_eq!(contexts.len(), 4);
}

#[test]
fn test_canonical_tree_diff_hierarchical_short_circuit() {
    let mut state = TreeDiffState::new();

    // Construct common subtree
    let sub_entry = GitTreeEntry::new(
        FileMode::RegularFile,
        "lib.rs",
        "1111111111111111111111111111111111111111",
    );
    let common_subtree = GitTree::new(vec![sub_entry]);
    let common_sub_oid = *common_subtree.raw_oid();

    // Construct root trees with identical subtree "src"
    let root_old_entries = vec![
        GitTreeEntry::from_oid(FileMode::Directory, "src", common_sub_oid),
        GitTreeEntry::new(
            FileMode::RegularFile,
            "README.md",
            "2222222222222222222222222222222222222222",
        ),
    ];
    let root_new_entries = vec![
        GitTreeEntry::from_oid(FileMode::Directory, "src", common_sub_oid), // IDENTICAL SUBTREE!
        GitTreeEntry::new(
            FileMode::RegularFile,
            "README.md",
            "3333333333333333333333333333333333333333",
        ), // MODIFIED
    ];

    let old_root = GitTree::new(root_old_entries);
    let new_root = GitTree::new(root_new_entries);

    let mut lookup_count = 0;
    let mut lookup = |_oid: &Oid| -> Option<GitTree> {
        lookup_count += 1;
        Some(common_subtree.clone())
    };

    TreeDiff::compare_canonical_trees(Some(&old_root), Some(&new_root), &mut lookup, &mut state);
    let changes = state.take_changes();

    // Because "src" subtree OIDs matched, lookup_tree was NEVER called!
    // O(1) short-circuit verified!
    assert_eq!(
        lookup_count, 0,
        "Identical subtree must not trigger sub-tree lookups"
    );
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, "README.md");
    assert_eq!(changes[0].kind, ChangeKind::Modified);
}

#[test]
fn test_dag_walker_generation_pruning() {
    let root = Oid::from_bytes([10u8; 20]);
    let c1 = Oid::from_bytes([11u8; 20]);
    let c2 = Oid::from_bytes([12u8; 20]);
    let unrelated = Oid::from_bytes([99u8; 20]);

    let get_node = |oid: &Oid| -> Option<(u64, Vec<Oid>)> {
        if oid == &c2 {
            Some((3, vec![c1]))
        } else if oid == &c1 {
            Some((2, vec![root]))
        } else if oid == &root {
            Some((1, vec![]))
        } else if oid == &unrelated {
            Some((4, vec![]))
        } else {
            None
        }
    };

    // 1. Ancestor generation >= Descendant generation: O(1) negative cutoff!
    let fast_rejection = DagWalker::is_ancestor_with_generation(&c2, &root, 3, 1, get_node);
    assert!(
        !fast_rejection,
        "Ancestor with generation >= descendant must return false in O(1)"
    );

    // 2. Unrelated branch with higher generation
    let unrelated_rejection =
        DagWalker::is_ancestor_with_generation(&unrelated, &c2, 4, 3, get_node);
    assert!(!unrelated_rejection);

    // 3. Valid ancestor path
    assert!(DagWalker::is_ancestor_with_generation(
        &root, &c2, 1, 3, get_node
    ));
    assert!(DagWalker::is_ancestor_with_generation(
        &c1, &c2, 2, 3, get_node
    ));
}

#[test]
fn test_three_way_merge_fast_paths() {
    let base = Oid::from_bytes([1u8; 20]);
    let ours = Oid::from_bytes([2u8; 20]);
    let theirs = Oid::from_bytes([3u8; 20]);

    // Unchanged on both
    assert_eq!(
        ThreeWayMerge::evaluate_tree_fast_paths(&base, &base, &base),
        Some(FastPathMerge::BothUnchanged)
    );

    // Only theirs changed
    assert_eq!(
        ThreeWayMerge::evaluate_tree_fast_paths(&base, &base, &theirs),
        Some(FastPathMerge::TakeTheirs)
    );

    // Only ours changed
    assert_eq!(
        ThreeWayMerge::evaluate_tree_fast_paths(&base, &ours, &base),
        Some(FastPathMerge::TakeOurs)
    );

    // Identical changes on both
    assert_eq!(
        ThreeWayMerge::evaluate_tree_fast_paths(&base, &ours, &ours),
        Some(FastPathMerge::TakeOurs)
    );

    // Divergent changes on both -> None (recurse)
    assert_eq!(
        ThreeWayMerge::evaluate_tree_fast_paths(&base, &ours, &theirs),
        None
    );
}

#[test]
fn test_corrected_commit_date_monotonicity_and_pruning() {
    let root = Oid::from_bytes([10u8; 20]);
    let c1 = Oid::from_bytes([11u8; 20]);
    let c2 = Oid::from_bytes([12u8; 20]);
    let c3 = Oid::from_bytes([13u8; 20]);

    // Simulate clock skew / rebase where raw timestamp goes backwards!
    // root: time = 1000
    // c1: time = 900 (clock drifted back!), but parents=[root],
    // so CCD must be max(900, 1000 + 1) = 1001!
    // c2: time = 950, parents=[c1], CCD = max(950, 1001 + 1) = 1002!
    // c3: time = 1200, parents=[c2], CCD = max(1200, 1002 + 1) = 1200!
    let root_ccd = CorrectedCommitDate::compute(1000, None);
    let c1_ccd = CorrectedCommitDate::compute(900, Some(root_ccd));
    let c2_ccd = CorrectedCommitDate::compute(950, Some(c1_ccd));
    let c3_ccd = CorrectedCommitDate::compute(1200, Some(c2_ccd));

    assert_eq!(root_ccd.0, 1000);
    assert_eq!(
        c1_ccd.0, 1001,
        "CCD must monotonically increment despite backwards clock"
    );
    assert_eq!(c2_ccd.0, 1002, "CCD must monotonically increment");
    assert_eq!(c3_ccd.0, 1200, "CCD takes natural timestamp if greater");

    // Monotonic order: root < c1 < c2 < c3
    assert!(root_ccd < c1_ccd);
    assert!(c1_ccd < c2_ccd);
    assert!(c2_ccd < c3_ccd);

    let get_node = |oid: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
        if oid == &c3 {
            Some((c3_ccd, vec![c2]))
        } else if oid == &c2 {
            Some((c2_ccd, vec![c1]))
        } else if oid == &c1 {
            Some((c1_ccd, vec![root]))
        } else if oid == &root {
            Some((root_ccd, vec![]))
        } else {
            None
        }
    };

    // 1. Valid ancestry path
    assert!(DagWalker::is_ancestor_with_ccd(
        &root, &c3, root_ccd, c3_ccd, get_node
    ));
    assert!(DagWalker::is_ancestor_with_ccd(
        &c1, &c3, c1_ccd, c3_ccd, get_node
    ));

    // 2. Inverse check: c3 cannot be ancestor of root -> O(1) instant rejection!
    assert!(!DagWalker::is_ancestor_with_ccd(
        &c3, &root, c3_ccd, root_ccd, get_node
    ));
}

#[test]
fn test_path_bloom_filter_accuracy_and_history_walk() {
    let mut bloom1 = PathBloomFilter::empty();
    bloom1.insert("src/lib.rs");
    bloom1.insert("Cargo.toml");

    // Positive checks
    assert!(bloom1.may_contain("src/lib.rs"));
    assert!(bloom1.may_contain("Cargo.toml"));

    // Negative checks (100% certainty)
    assert!(!bloom1.may_contain("docs/README.md"));
    assert!(!bloom1.may_contain("tests/test.rs"));

    // Union operation
    let mut bloom2 = PathBloomFilter::empty();
    bloom2.insert("tests/test.rs");

    let union_bloom = bloom1.union(&bloom2);
    assert!(union_bloom.may_contain("src/lib.rs"));
    assert!(union_bloom.may_contain("tests/test.rs"));
    assert!(!union_bloom.may_contain("unrelated.txt"));

    // Serialization & Deserialization
    let bytes = union_bloom.to_bytes();
    let decoded = PathBloomFilter::from_bytes(&bytes);
    assert_eq!(decoded, union_bloom);

    // Path history walk test
    let c_root = Oid::from_bytes([20u8; 20]);
    let c_mid = Oid::from_bytes([21u8; 20]);
    let c_leaf = Oid::from_bytes([22u8; 20]);

    // c_leaf touches "src/lib.rs"
    // c_mid touches "docs/README.md" (does NOT touch "src/lib.rs")
    // c_root touches "src/lib.rs"
    let mut bloom_root = PathBloomFilter::empty();
    bloom_root.insert("src/lib.rs");

    let mut bloom_mid = PathBloomFilter::empty();
    bloom_mid.insert("docs/README.md");

    let mut bloom_leaf = PathBloomFilter::empty();
    bloom_leaf.insert("src/lib.rs");

    let get_commit = |oid: &Oid| -> Option<(Option<PathBloomFilter>, Vec<Oid>)> {
        if oid == &c_leaf {
            Some((Some(bloom_leaf), vec![c_mid]))
        } else if oid == &c_mid {
            Some((Some(bloom_mid), vec![c_root]))
        } else if oid == &c_root {
            Some((Some(bloom_root), vec![]))
        } else {
            None
        }
    };

    let hits = DagWalker::walk_path_history(&c_leaf, "src/lib.rs", get_commit);
    // Only c_leaf and c_root touched src/lib.rs; c_mid was bypassed!
    assert_eq!(hits, vec![c_leaf, c_root]);

    let doc_hits = DagWalker::walk_path_history(&c_leaf, "docs/README.md", get_commit);
    assert_eq!(doc_hits, vec![c_mid]);
}

#[test]
fn test_swar_prefix_suffix_word_alignment() {
    let a: Vec<u64> = vec![1, 2, 3, 4, 5, 6, 7, 8, 100, 200, 999, 1000, 1001, 1002];
    let b: Vec<u64> = vec![1, 2, 3, 4, 5, 6, 7, 8, 300, 400, 999, 1000, 1001, 1002];

    // Common prefix has 8 items (two 4-wide chunks)
    let p_len = PatchGenerator::swar_trim_prefix(&a, &b);
    assert_eq!(p_len, 8);

    // Common suffix has 4 items (one 4-wide chunk)
    let s_len = PatchGenerator::swar_trim_suffix(&a, &b, p_len);
    assert_eq!(s_len, 4);

    // Identical file fast path
    let text = "Line 1\nLine 2\nLine 3\n";
    let patch = PatchGenerator::generate_patch("file.txt", text, text);
    assert_eq!(patch.hunks.len(), 1);
    assert_eq!(patch.hunks[0].lines.len(), 3);
    assert!(patch.hunks[0]
        .lines
        .iter()
        .all(|l| matches!(l, PatchLine::Context(_))));
}

#[test]
fn test_recursive_virtual_merge_base_and_criss_cross() {
    use fractal_git::algorithms::merge::{ThreeWayMerge, ThreeWayMergeResult};
    use std::collections::BTreeMap;

    let base_oid = Oid::from_bytes([1u8; 20]);
    let mod1_oid = Oid::from_bytes([2u8; 20]);
    let mod2_oid = Oid::from_bytes([3u8; 20]);
    let our_oid = Oid::from_bytes([4u8; 20]);
    let their_oid = Oid::from_bytes([5u8; 20]);

    // Ancestor 1: touches "common.rs"
    let mut anc1 = BTreeMap::new();
    anc1.insert("common.rs".to_string(), mod1_oid);
    anc1.insert("other.rs".to_string(), base_oid);

    // Ancestor 2: touches "other.rs"
    let mut anc2 = BTreeMap::new();
    anc2.insert("common.rs".to_string(), base_oid);
    anc2.insert("other.rs".to_string(), mod2_oid);

    // Root common ancestor of anc1 and anc2
    let mut anc_root = BTreeMap::new();
    anc_root.insert("common.rs".to_string(), base_oid);
    anc_root.insert("other.rs".to_string(), base_oid);

    // Synthesize virtual base from anc1 and anc2 using their common root
    let virtual_base = ThreeWayMerge::synthesize_virtual_base(Some(&anc_root), &[&anc1, &anc2]);
    assert_eq!(virtual_base.get("common.rs"), Some(&mod1_oid));
    assert_eq!(virtual_base.get("other.rs"), Some(&mod2_oid));

    // Now merge ours and theirs against the multiple ancestors
    let mut ours = BTreeMap::new();
    ours.insert("common.rs".to_string(), our_oid);
    ours.insert("other.rs".to_string(), mod2_oid);

    let mut theirs = BTreeMap::new();
    theirs.insert("common.rs".to_string(), mod1_oid);
    theirs.insert("other.rs".to_string(), their_oid);

    let res =
        ThreeWayMerge::merge_with_virtual_bases(Some(&anc_root), &[&anc1, &anc2], &ours, &theirs);
    match res {
        ThreeWayMergeResult::Clean { merged_tree } => {
            assert_eq!(merged_tree.get("common.rs"), Some(&our_oid));
            assert_eq!(merged_tree.get("other.rs"), Some(&their_oid));
        }
        _ => panic!("Expected clean merge with synthesized virtual base"),
    }
}
