//! Regression Suite: Corrected Commit Date (CCD v2) reachability semantics
//! File Path: tests/rust/test_ccd_reachability.rs
//!
//! Reachability is the load-bearing primitive of `taxis merge`, `taxis rebase`, `taxis branch`,
//! and `taxis lineage`; a wrong answer silently mis-merges history instead of failing loudly.
//! These tests pin the two failure modes found by inspection:
//!
//!   1. The O(1) cutoff depends on strict monotonicity (`CCD(u) < CCD(v)` whenever `u` is a
//!      proper ancestor of `v`). Git stores committer time at one-second granularity, so a
//!      parent and child committed in the same second carry an identical timestamp. Passing the
//!      raw timestamp in place of the corrected date makes the cutoff veto a true ancestor.
//!   2. Criss-cross histories have several minimal common ancestors that are mutually
//!      incomparable. Pruning common ancestors by comparing a scalar cutoff silently drops the
//!      lower one, so the merge-base set is incomplete and the virtual base tree loses a branch.
//!
//! Both tests are written against the public algorithm surface so they stay valid whether the
//! corrected dates arrive precomputed or are built on demand.

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};

use fractal_git::algorithms::traverse::DagWalker;
use fractal_git::core::models::{CorrectedCommitDate, Oid};

fn oid(byte: u8) -> Oid {
    Oid::from_bytes([byte; 20])
}

/// Unpruned reachability oracle: walk every parent edge, no cutoff, no heuristic.
fn is_ancestor_bfs(parents: &HashMap<Oid, Vec<Oid>>, ancestor: &Oid, descendant: &Oid) -> bool {
    if ancestor == descendant {
        return true;
    }
    let mut seen: HashSet<Oid> = HashSet::new();
    let mut queue: VecDeque<Oid> = VecDeque::new();
    queue.push_back(*descendant);
    seen.insert(*descendant);
    while let Some(current) = queue.pop_front() {
        for parent in parents.get(&current).cloned().unwrap_or_default() {
            if &parent == ancestor {
                return true;
            }
            if seen.insert(parent) {
                queue.push_back(parent);
            }
        }
    }
    false
}

/// Minimal common ancestors computed by brute force, used as the ground truth for merge bases.
fn minimal_common_ancestors(
    parents: &HashMap<Oid, Vec<Oid>>,
    nodes: &[Oid],
    a: &Oid,
    b: &Oid,
) -> BTreeSet<Oid> {
    let common: HashSet<Oid> = nodes
        .iter()
        .copied()
        .filter(|candidate| {
            is_ancestor_bfs(parents, candidate, a) && is_ancestor_bfs(parents, candidate, b)
        })
        .collect();
    // `c` is minimal when it is not an ancestor of any other common ancestor.
    common
        .iter()
        .copied()
        .filter(|candidate| {
            !common
                .iter()
                .any(|other| other != candidate && is_ancestor_bfs(parents, candidate, other))
        })
        .collect()
}

#[test]
fn same_second_ancestry_is_detected() {
    // A fast agent loop routinely lands parent and child in the same wall-clock second. The
    // corrected date is what breaks that tie, so this is the exact shape the recurrence exists for.
    const T: u64 = 1_760_000_000;

    let root = oid(1);
    let child = oid(2);
    let grand = oid(3);

    let ccd_root = CorrectedCommitDate::compute(T, None);
    let ccd_child = CorrectedCommitDate::compute(T, Some(ccd_root));
    let ccd_grand = CorrectedCommitDate::compute(T, Some(ccd_child));

    assert!(
        ccd_root < ccd_child && ccd_child < ccd_grand,
        "corrected dates must be strictly increasing even when every timestamp is identical; \
         got root={ccd_root:?} child={ccd_child:?} grand={ccd_grand:?}"
    );

    let lookup = |target: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
        if *target == grand {
            Some((ccd_grand, vec![child]))
        } else if *target == child {
            Some((ccd_child, vec![root]))
        } else if *target == root {
            Some((ccd_root, vec![]))
        } else {
            None
        }
    };

    for (ancestor, descendant, label) in [
        (root, child, "root -> child"),
        (root, grand, "root -> grand"),
        (child, grand, "child -> grand"),
    ] {
        let ancestor_ccd = if ancestor == root {
            ccd_root
        } else {
            ccd_child
        };
        let descendant_ccd = if descendant == child {
            ccd_child
        } else {
            ccd_grand
        };
        assert!(
            DagWalker::is_ancestor_with_ccd(
                &ancestor,
                &descendant,
                ancestor_ccd,
                descendant_ccd,
                lookup
            ),
            "{label} is a true ancestry edge and must not be pruned by the cutoff"
        );
    }

    assert!(
        !DagWalker::is_ancestor_with_ccd(&grand, &root, ccd_grand, ccd_root, lookup),
        "the reverse direction must still be rejected"
    );
}

#[test]
fn clock_skewed_ancestry_is_detected() {
    // A rebase or a clock correction makes a child commit "earlier" than its parent. Raw
    // timestamps then run backwards along a true ancestry edge; only the recurrence keeps the
    // sequence monotonic.
    let root = oid(10);
    let c1 = oid(11);
    let c2 = oid(12);
    let c3 = oid(13);

    let ccd_root = CorrectedCommitDate::compute(1000, None);
    let ccd_c1 = CorrectedCommitDate::compute(900, Some(ccd_root));
    let ccd_c2 = CorrectedCommitDate::compute(950, Some(ccd_c1));
    let ccd_c3 = CorrectedCommitDate::compute(1200, Some(ccd_c2));

    assert_eq!(
        ccd_c1.get(),
        1001,
        "backwards clock must be corrected upward"
    );
    assert_eq!(ccd_c2.get(), 1002);

    let lookup = |target: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
        if *target == c3 {
            Some((ccd_c3, vec![c2]))
        } else if *target == c2 {
            Some((ccd_c2, vec![c1]))
        } else if *target == c1 {
            Some((ccd_c1, vec![root]))
        } else if *target == root {
            Some((ccd_root, vec![]))
        } else {
            None
        }
    };

    assert!(
        DagWalker::is_ancestor_with_ccd(&root, &c3, ccd_root, ccd_c3, lookup),
        "root must remain reachable from c3 across a backwards clock"
    );
}

#[test]
fn criss_cross_merge_bases_keep_every_incomparable_ancestor() {
    // Classic criss-cross: two branches merge each other twice. Both bases are minimal common
    // ancestors and neither is an ancestor of the other, so a merge-base set of size one is wrong.
    //
    // The pre-existing criss-cross test assigns both bases the SAME corrected date, which makes a
    // scalar cutoff comparison evaluate to "not below" and accidentally skip the prune. Real
    // histories give the two branches different dates; that is what this case pins.
    let root = oid(1);
    let left = oid(2);
    let middle = oid(3);
    let merge_p = oid(4);
    let merge_q = oid(5);

    let ccd_root = CorrectedCommitDate::compute(10, None);
    let ccd_left = CorrectedCommitDate::compute(100, Some(ccd_root));
    let ccd_middle = CorrectedCommitDate::compute(200, Some(ccd_root));
    let ccd_p = CorrectedCommitDate::compute(300, Some(ccd_left.max(ccd_middle)));
    let ccd_q = CorrectedCommitDate::compute(350, Some(ccd_left.max(ccd_middle)));

    let mut parents: HashMap<Oid, Vec<Oid>> = HashMap::new();
    parents.insert(root, vec![]);
    parents.insert(left, vec![root]);
    parents.insert(middle, vec![root]);
    parents.insert(merge_p, vec![left, middle]);
    parents.insert(merge_q, vec![left, middle]);

    let nodes = [root, left, middle, merge_p, merge_q];
    let expected = minimal_common_ancestors(&parents, &nodes, &merge_p, &merge_q);
    assert_eq!(
        expected,
        BTreeSet::from([left, middle]),
        "test fixture self-check: both branches must be minimal common ancestors"
    );

    let ccd_of = |target: &Oid| -> CorrectedCommitDate {
        if *target == root {
            ccd_root
        } else if *target == left {
            ccd_left
        } else if *target == middle {
            ccd_middle
        } else if *target == merge_p {
            ccd_p
        } else {
            ccd_q
        }
    };
    let lookup = |target: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
        parents
            .get(target)
            .map(|parents_of| (ccd_of(target), parents_of.clone()))
    };

    let actual: BTreeSet<Oid> = DagWalker::find_merge_bases_with_ccd(&merge_p, &merge_q, lookup)
        .into_iter()
        .collect();

    assert_eq!(
        actual, expected,
        "every minimal common ancestor must survive pruning; a missing base silently removes a \
         branch from the virtual base tree, which turns a clean three-way merge into a conflict"
    );
}

#[test]
fn linear_history_keeps_a_single_merge_base() {
    // Guard against "fix it by never pruning", which would leave every ancestor in the result and
    // make the virtual base tree enormous.
    let root = oid(1);
    let middle = oid(2);
    let tip = oid(3);

    let ccd_root = CorrectedCommitDate::compute(10, None);
    let ccd_middle = CorrectedCommitDate::compute(20, Some(ccd_root));
    let ccd_tip = CorrectedCommitDate::compute(30, Some(ccd_middle));

    let lookup = |target: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
        if *target == tip {
            Some((ccd_tip, vec![middle]))
        } else if *target == middle {
            Some((ccd_middle, vec![root]))
        } else if *target == root {
            Some((ccd_root, vec![]))
        } else {
            None
        }
    };

    let bases = DagWalker::find_merge_bases_with_ccd(&tip, &middle, lookup);
    assert_eq!(
        bases,
        vec![middle],
        "a linear ancestry chain must collapse to the single nearest common ancestor"
    );
}
