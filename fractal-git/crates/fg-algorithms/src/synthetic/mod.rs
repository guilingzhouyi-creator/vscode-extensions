//! Module: fg-algorithms — Synthetic Benchmark & Scale Data Factory Facade
//! File Path: crates/fg-algorithms/src/synthetic/mod.rs
//! Architecture Role: Pure in-memory data generation primitives for large-scale
//!   benchmarking and testing.
//! Dependencies & Triggers: Consumed by CLI benchmark suites, integration tests,
//!   and algorithmic proofs.
//! Responsibilities: Export diamond DAG, monorepo tree, and commit chain generators.

pub mod commit_chain;
pub mod diamond_dag;
pub mod monorepo_tree;

pub use commit_chain::{generate_commit_chain, SyntheticCommitChain, STANDARD_QUERY_PATHS};
pub use diamond_dag::{generate_diamond_dag, SyntheticDag};
pub use monorepo_tree::{generate_monorepo_trees, SyntheticMonorepo};
