//! Module: fg-topology — Stored Reference Fan-Out Test
//! File Path: crates/fg-topology/tests/fanout_store_unit.rs
//! Architecture Role: Proves the fan-out guard counts references the repository holds, so a node
//!   created by another process consumes the quota instead of vanishing from the count.
//! Dependencies & Triggers: Runs against `fg_topology::assert_fanout_available_in` with a real
//!   reference store rooted in a scratch directory.
//! Responsibilities: Seed sibling references, assert the bound accepts the last slot and refuses
//!   the next, and assert a reference in another cell does not consume this cell's budget.
//! Exit Semantics & Design Rationale: The counting source is the whole point of the function, so
//!   this test drives it through a store rather than through an in-memory slice. A version that
//!   counted only the caller's own nodes would pass every list-based test and fail this one.

use fg_core::error::FractalError;
use fg_core::models::Oid;
use fg_core::traits::RefStore;
use fg_topology::assert_fanout_available_in;
use fg_topology::refs::{DiskRefStore, FractalRef};

/// Builds a card reference under `cell`.
fn card(cell: &str, card_id: &str) -> FractalRef {
    FractalRef::CardWorktree {
        cell_id: cell.into(),
        card_id: card_id.into(),
    }
}

/// Creates an empty scratch directory the test owns outright.
///
/// `std::env::temp_dir()` is not writable in this sandbox, so the fixture lives under the build
/// directory the test harness already provides.
fn scratch_dir(tag: &str) -> std::path::PathBuf {
    let base = std::env::var("CARGO_TARGET_TMPDIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("target")
        });
    let git_dir = base.join(format!("fg_fanout_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&git_dir);
    std::fs::create_dir_all(&git_dir).expect("create scratch git dir");
    git_dir
}

#[test]
fn stored_sibling_references_consume_the_bound() {
    let git_dir = scratch_dir("siblings");
    let store = DiskRefStore::new(&git_dir);
    let oid = Oid::from_bytes([0x11; 20]);

    for name in ["a", "b"] {
        store
            .update_ref(&format!("refs/fractal/cell/core/card/{name}"), &oid, None)
            .expect("write sibling ref");
    }
    assert!(
        assert_fanout_available_in(&card("core", "c"), &store).is_ok(),
        "the third card fits the bound"
    );

    store
        .update_ref("refs/fractal/cell/core/card/c", &oid, None)
        .expect("write third sibling");
    let err = assert_fanout_available_in(&card("core", "d"), &store)
        .expect_err("a fourth card exceeds the bound");
    assert!(matches!(err, FractalError::TopologyBreach { .. }));

    let _ = std::fs::remove_dir_all(&git_dir);
}

#[test]
fn a_reference_in_another_cell_does_not_consume_this_budget() {
    let git_dir = scratch_dir("other_cell");
    let store = DiskRefStore::new(&git_dir);
    let oid = Oid::from_bytes([0x22; 20]);

    for name in ["a", "b", "c"] {
        store
            .update_ref(&format!("refs/fractal/cell/docs/card/{name}"), &oid, None)
            .expect("write sibling ref in another cell");
    }
    assert!(
        assert_fanout_available_in(&card("core", "d"), &store).is_ok(),
        "a full sibling cell must not block a different cell"
    );

    let _ = std::fs::remove_dir_all(&git_dir);
}
