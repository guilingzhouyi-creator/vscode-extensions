//! Unit tests: fg-algorithms::traverse::corrected_date_index
//! File Path: crates/fg-algorithms/tests/corrected_date_index_unit.rs
//!
//! The index states an invariant in its own documentation — corrected dates strictly increase
//! along ancestry edges — and every failure mode below is a case where a lazier implementation
//! would still look reasonable. They live in their own target rather than inline in the module so
//! the module itself stays inside the per-file size envelope and the tests keep their own budget.

use std::collections::HashMap;

use fg_algorithms::traverse::CcdIndex;
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
