//! Module: fg-storage — Synthetic Repository Generator Unit Tests
//! File Path: crates/fg-storage/tests/synth_repo_unit.rs
//! Architecture Role: Verifies deterministic generation, churn accounting, and incremental tree
//!   equivalence against the canonical index builder.
//! Dependencies & Triggers: Executed by `cargo test -p fg-storage`.
//! Responsibilities: Assert that `SynthRepoSpec` validation, `generate`, and incremental tree
//!   builders match `InMemoryIndexTree` byte for byte.
//! Exit Semantics & Design Rationale: Uses process-scoped scratch directories under `target` and
//!   fixed SplitMix64 seeds so tests remain reproducible offline without spawning `git`.

use std::path::PathBuf;

use fg_core::models::FileMode;
use fg_core::traits::OdbStore;
use fg_index::InMemoryIndexTree;
use fg_storage::loose::LooseOdb;
use fg_storage::synth_spec::{SynthRepoSpec, SynthRepoStats};
use fg_storage::synth_write::{
    generate, write_leaf_tree, write_root_tree, write_source_tree, BLOB_TYPE, DIRECTORY_FANOUT,
    TREE_TYPE,
};

fn scratch(label: &str) -> PathBuf {
    let base = std::env::var("CARGO_TARGET_TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("target")
        })
        .join("synth_repo");
    let _ = std::fs::create_dir_all(&base);
    let path = base.join(format!("{}_{}", label, std::process::id()));
    let _ = std::fs::remove_dir_all(&path);
    path
}

#[test]
fn the_same_spec_produces_the_same_head_and_totals() {
    let spec = SynthRepoSpec {
        commits: 8,
        working_tree_files: 12,
        bytes_per_file: 64,
        churn_percent: 25,
        seed: 7,
    };

    let first_dir = scratch("deterministic_a");
    let first = generate(&first_dir, spec).expect("first generation");
    let second_dir = scratch("deterministic_b");
    let second = generate(&second_dir, spec).expect("second generation");

    assert_eq!(first.head, second.head);
    assert_eq!(first.stats, second.stats);

    let _ = std::fs::remove_dir_all(&first_dir);
    let _ = std::fs::remove_dir_all(&second_dir);
}

#[test]
fn a_different_seed_produces_a_different_head() {
    let base = SynthRepoSpec {
        commits: 4,
        working_tree_files: 8,
        bytes_per_file: 32,
        churn_percent: 50,
        seed: 1,
    };
    let other = SynthRepoSpec { seed: 2, ..base };

    let dir_a = scratch("seed_a");
    let dir_b = scratch("seed_b");
    let first = generate(&dir_a, base).expect("seed one");
    let second = generate(&dir_b, other).expect("seed two");
    assert_ne!(first.head, second.head);

    let _ = std::fs::remove_dir_all(&dir_a);
    let _ = std::fs::remove_dir_all(&dir_b);
}

#[test]
fn history_grows_with_commit_count_while_the_checkout_does_not() {
    let small = SynthRepoSpec {
        commits: 4,
        working_tree_files: 16,
        bytes_per_file: 128,
        churn_percent: 25,
        seed: 11,
    };
    let large = SynthRepoSpec {
        commits: 16,
        ..small
    };

    let small_dir = scratch("growth_small");
    let large_dir = scratch("growth_large");
    let small_repo = generate(&small_dir, small).expect("small history");
    let large_repo = generate(&large_dir, large).expect("large history");

    assert_eq!(
        small_repo.stats.working_tree_bytes, large_repo.stats.working_tree_bytes,
        "the final checkout must not depend on how many commits came before it"
    );
    assert!(
        large_repo.stats.history_bytes() > small_repo.stats.history_bytes(),
        "more commits must cost more history bytes"
    );

    let _ = std::fs::remove_dir_all(&small_dir);
    let _ = std::fs::remove_dir_all(&large_dir);
}

#[test]
fn higher_churn_costs_more_history_for_the_same_commit_count() {
    let low = SynthRepoSpec {
        commits: 8,
        working_tree_files: 16,
        bytes_per_file: 128,
        churn_percent: 10,
        seed: 21,
    };
    let high = SynthRepoSpec {
        churn_percent: 90,
        ..low
    };

    let low_dir = scratch("churn_low");
    let high_dir = scratch("churn_high");
    let low_repo = generate(&low_dir, low).expect("low churn");
    let high_repo = generate(&high_dir, high).expect("high churn");

    assert!(
        high_repo.stats.payload_bytes > low_repo.stats.payload_bytes,
        "rewriting more files per commit must write more bytes"
    );

    let _ = std::fs::remove_dir_all(&low_dir);
    let _ = std::fs::remove_dir_all(&high_dir);
}

#[test]
fn a_low_churn_history_still_starts_from_a_complete_working_tree() {
    // The failure this guards: churning only a rotating slice left every untouched slot holding
    // `Oid::ZERO`, so the early trees pointed at an object that does not exist and the checkout
    // size tracked churn instead of the working tree. A real first commit adds every file.
    let spec = SynthRepoSpec {
        commits: 2,
        working_tree_files: 40,
        bytes_per_file: 64,
        churn_percent: 1,
        seed: 3,
    };
    let dir = scratch("low_churn_complete");
    let repo = generate(&dir, spec).expect("low churn history");

    let odb = LooseOdb::without_cache(&dir);
    // A slot still holding `Oid::ZERO` resolves to nothing and contributes zero bytes, so an
    // exact total proves every slot was populated by the first commit.
    assert_eq!(
        repo.stats.working_tree_bytes,
        u64::from(spec.working_tree_files) * u64::from(spec.bytes_per_file),
        "one percent churn must not shrink the checked-out tree"
    );
    assert!(
        repo.stats.history_bytes() > 0,
        "the second commit must leave history behind the checkout"
    );
    assert!(
        odb.read_object(&repo.head).is_ok(),
        "the head commit must be readable"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_spec_without_commits_is_refused() {
    let spec = SynthRepoSpec {
        commits: 0,
        ..SynthRepoSpec::default()
    };
    assert!(spec.validate().is_err());
}

#[test]
fn a_spec_without_churn_is_refused() {
    let spec = SynthRepoSpec {
        churn_percent: 0,
        ..SynthRepoSpec::default()
    };
    assert!(spec.validate().is_err());
}

#[test]
fn churn_batch_never_rounds_down_to_zero() {
    let spec = SynthRepoSpec {
        working_tree_files: 100,
        churn_percent: 1,
        ..SynthRepoSpec::default()
    };
    assert_eq!(spec.churn_batch(), 1);
}

/// Differential check: the incrementally built tree must equal what the canonical index builder
/// produces for the same file set. The incremental path exists only for speed, so any divergence
/// would be a silent correctness loss in every measurement taken through it.
#[test]
fn the_incremental_tree_matches_the_canonical_index_builder() {
    let root_dir = scratch("diff_tree");
    std::fs::create_dir_all(&root_dir).expect("create scratch");
    let odb = LooseOdb::without_cache(&root_dir);

    let files: u32 = 40;
    let mut slot_blobs = Vec::new();
    for slot in 0..files {
        let payload = format!("payload {slot}");
        slot_blobs.push(
            odb.write_object(BLOB_TYPE, payload.as_bytes())
                .expect("write blob"),
        );
    }

    let mut dir_trees = Vec::new();
    for dir in 0..DIRECTORY_FANOUT {
        let (oid, _) = write_leaf_tree(&odb, &slot_blobs, dir).expect("leaf tree");
        dir_trees.push(oid);
    }
    let (source_oid, _) = write_source_tree(&odb, &dir_trees).expect("source tree");
    let (incremental_root, _) = write_root_tree(&odb, source_oid).expect("root tree");

    let mut index = InMemoryIndexTree::new();
    for (slot, blob) in slot_blobs.iter().enumerate() {
        index
            .stage_oid(
                &format!("src/d{}/f{slot:06}.rs", slot as u32 % DIRECTORY_FANOUT),
                FileMode::RegularFile,
                *blob,
            )
            .expect("stage");
    }
    let canonical_root = index
        .write_tree_with_payload_persister(|payload| odb.write_object(TREE_TYPE, payload))
        .expect("canonical tree");

    assert_eq!(
        incremental_root, canonical_root,
        "the incremental tree must be byte-identical to the canonical builder"
    );

    let _ = std::fs::remove_dir_all(&root_dir);
}

#[test]
fn history_bytes_exclude_the_final_checkout() {
    let stats = SynthRepoStats {
        commits: 4,
        blobs: 10,
        trees: 2,
        payload_bytes: 1_000,
        working_tree_bytes: 400,
        final_checkout_bytes: 400,
    };
    assert_eq!(stats.history_bytes(), 600);
    assert!((stats.history_bytes_per_commit() - 150.0).abs() < f64::EPSILON);
}

#[test]
fn a_commit_that_references_its_own_tree_objects_leaves_no_false_history() {
    // The failure this guards: subtracting only file contents made a short, low-churn history
    // report zero history bytes, because its blobs all belonged to the final checkout and its
    // tree objects were never subtracted.
    let stats = SynthRepoStats {
        commits: 16,
        blobs: 4511,
        trees: 10,
        payload_bytes: 12_640_000,
        working_tree_bytes: 12_630_800,
        final_checkout_bytes: 12_640_000,
    };
    assert_eq!(stats.history_bytes(), 0);
    assert_eq!(stats.history_bytes_per_commit(), 0.0);
}
