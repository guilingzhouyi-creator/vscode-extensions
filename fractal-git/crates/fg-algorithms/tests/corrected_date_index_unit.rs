//! Unit tests: fg-algorithms::traverse::corrected_date_index
//! File Path: crates/fg-algorithms/tests/corrected_date_index_unit.rs
//!
//! The index states an invariant in its own documentation — corrected dates strictly increase
//! along ancestry edges — and every failure mode below is a case where a lazier implementation
//! would still look reasonable. They live in their own target rather than inline in the module so
//! the module itself stays inside the per-file size envelope and the tests keep their own budget.

use std::collections::HashMap;

use fg_algorithms::traverse::{CcdIndex, Window};
use fg_core::error::FractalError;
use fg_core::models::Oid;

fn oid(byte: u8) -> Oid {
    Oid::from_bytes([byte; 20])
}

#[test]
fn identical_timestamps_still_produce_strictly_increasing_dates() {
    // Git records committer time at one-second granularity, so a fast agent loop lands parent and
    // child in the same second routinely. The recurrence exists precisely to break that tie.
    const T: u64 = 1_760_000_000;
    let root = oid(1);
    let child = oid(2);
    let grand = oid(3);

    let mut table: HashMap<Oid, (Vec<Oid>, u64)> = HashMap::new();
    table.insert(root, (vec![], T));
    table.insert(child, (vec![root], T));
    table.insert(grand, (vec![child], T));

    let index = CcdIndex::from_table(&table, &[grand]).expect("index must build");
    let root_ccd = index.corrected_date(&root).expect("root");
    let child_ccd = index.corrected_date(&child).expect("child");
    let grand_ccd = index.corrected_date(&grand).expect("grand");

    assert!(root_ccd < child_ccd, "identical timestamps must be broken");
    assert!(child_ccd < grand_ccd);
    assert!(index.is_ancestor(&root, &grand));
    assert!(!index.is_ancestor(&grand, &root));
}

#[test]
fn a_cycle_is_rejected_instead_of_guessed() {
    let a = oid(1);
    let b = oid(2);
    let mut table: HashMap<Oid, (Vec<Oid>, u64)> = HashMap::new();
    table.insert(a, (vec![b], 10));
    table.insert(b, (vec![a], 20));

    let result = CcdIndex::from_table(&table, &[a]);
    assert!(
        matches!(result, Err(FractalError::CorruptStore(_))),
        "a cycle has no corrected-date fixpoint, so it must be an error"
    );
}

#[test]
fn a_missing_parent_is_rejected() {
    // Treating an unreadable parent as a root detaches everything below it, which makes unrelated
    // histories look related. The build must refuse rather than produce a plausible wrong answer.
    let root = oid(1);
    let mut table: HashMap<Oid, (Vec<Oid>, u64)> = HashMap::new();
    table.insert(root, (vec![oid(9)], 10));

    let result = CcdIndex::from_table(&table, &[root]);
    assert!(
        matches!(result, Err(FractalError::CorruptStore(_))),
        "a parent that cannot be read must not be treated as a root"
    );
}

#[test]
fn commits_outside_the_index_are_not_claimed_as_related() {
    // The index covers one tip set. Claiming ancestry for a commit it never visited would be a
    // fabrication, so absence must read as "not known to be related" rather than "probably fine".
    let root = oid(1);
    let mut table: HashMap<Oid, (Vec<Oid>, u64)> = HashMap::new();
    table.insert(root, (vec![], 10));

    let index = CcdIndex::from_table(&table, &[root]).expect("index");
    assert!(!index.is_ancestor(&oid(7), &root));
    assert!(!index.is_ancestor(&root, &oid(7)));
    assert!(index.merge_bases(&root, &oid(7)).is_empty());
}

#[test]
fn a_windowed_index_covers_only_the_span_it_was_given() {
    // A ten-commit chain, timestamped one second apart, indexed to a depth of four. The index must
    // describe the four newest commits and report that its lower edge was cut off, so a caller
    // cannot mistake a suffix for the whole history.
    const BASE: u64 = 1_760_000_000;
    let mut table: HashMap<Oid, (Vec<Oid>, u64)> = HashMap::new();
    let chain: Vec<Oid> = (0..10).map(oid).collect();
    for (index, commit) in chain.iter().enumerate() {
        let parents = if index == 0 {
            vec![]
        } else {
            vec![chain[index - 1]]
        };
        table.insert(*commit, (parents, BASE + index as u64));
    }

    let tip = chain[9];
    let (index, set) =
        CcdIndex::build_windowed(&[tip], Window::Depth(4), |oid| table.get(oid).cloned())
            .expect("windowed index must build");

    assert_eq!(index.len(), 4);
    assert!(set.truncated, "the window stopped short of the root");
    assert!(index.contains(&tip));
    assert!(
        !index.contains(&chain[0]),
        "the root lies beyond the horizon"
    );
    assert!(
        !index.is_window_complete(),
        "the boundary leaves a parent unresolved, and that must be reported"
    );
}

#[test]
fn a_complete_window_reports_itself_as_complete() {
    // The opposite claim: when the window does cover everything, `is_window_complete` must be true,
    // otherwise a caller would refuse work it can actually do.
    const BASE: u64 = 1_760_000_000;
    let mut table: HashMap<Oid, (Vec<Oid>, u64)> = HashMap::new();
    let chain: Vec<Oid> = (0..4).map(oid).collect();
    for (index, commit) in chain.iter().enumerate() {
        let parents = if index == 0 {
            vec![]
        } else {
            vec![chain[index - 1]]
        };
        table.insert(*commit, (parents, BASE + index as u64));
    }

    let (index, set) = CcdIndex::build_windowed(&[chain[3]], Window::Depth(100), |oid| {
        table.get(oid).cloned()
    })
    .expect("windowed index must build");

    assert_eq!(index.len(), 4);
    assert!(!set.truncated);
    assert!(index.is_window_complete());
    assert!(index.is_ancestor(&chain[0], &chain[3]));
}

#[test]
fn an_unbounded_window_matches_the_complete_index() {
    // `Full` must be behaviourally identical to indexing the whole table, or the default path would
    // silently change answers for callers that never asked for a horizon.
    const BASE: u64 = 1_760_000_000;
    let mut table: HashMap<Oid, (Vec<Oid>, u64)> = HashMap::new();
    let chain: Vec<Oid> = (0..6).map(oid).collect();
    for (index, commit) in chain.iter().enumerate() {
        let parents = if index == 0 {
            vec![]
        } else {
            vec![chain[index - 1]]
        };
        table.insert(*commit, (parents, BASE + index as u64));
    }

    let complete = CcdIndex::from_table(&table, &[chain[5]]).expect("complete index");
    let (windowed, set) =
        CcdIndex::build_windowed(&[chain[5]], Window::Full, |oid| table.get(oid).cloned())
            .expect("windowed index");

    assert!(!set.truncated);
    assert_eq!(windowed.len(), complete.len());
    for commit in &chain {
        assert_eq!(
            windowed.corrected_date(commit),
            complete.corrected_date(commit),
            "an unbounded window must not change any corrected date"
        );
    }
}
