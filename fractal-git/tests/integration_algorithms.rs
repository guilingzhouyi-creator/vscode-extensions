//! Integration Test Harness: Algorithms, DAG Poset, Merge & Benchmarks
//! File Path: tests/integration_algorithms.rs
//! Architecture Role: Consolidates diff algorithms, graph traversals, algebraic merge,
//!   and performance ratchet tests into a single compiled binary harness.

#[path = "rust/test_algorithms.rs"]
mod test_algorithms;

#[path = "rust/test_benchmarks.rs"]
mod test_benchmarks;

#[path = "rust/test_benchmark_profile.rs"]
mod test_benchmark_profile;

#[path = "rust/test_algebraic_conflicts.rs"]
mod test_algebraic_conflicts;

#[path = "rust/test_conflict_modes.rs"]
mod test_conflict_modes;

#[path = "rust/test_commit_graph.rs"]
mod test_commit_graph;

#[path = "rust/test_corrected_date_reachability.rs"]
mod test_corrected_date_reachability;

#[path = "rust/test_commit_graph_ancestry.rs"]
mod test_commit_graph_ancestry;
