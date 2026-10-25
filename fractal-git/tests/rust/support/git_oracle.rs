//! Module: tests::support::git_oracle — Compatibility Re-exports for Git Reference Baseline
//! File Path: fractal-git/tests/rust/support/git_oracle.rs
//! Architecture Role: Re-exports baseline types for legacy test compatibility.
//! Dependencies & Triggers: Tests referencing support/git_oracle.rs.
//! Responsibilities: Type alias re-exports.
//! Exit Semantics & Design Rationale: Forwards to git_baseline.rs directly.
//!
//! Domain Governance Rules: FGT-COR-001 (differential parity).

#[path = "git_baseline.rs"]
mod git_baseline;

pub use git_baseline::{
    BaselineSignature as OracleSignature,
    BaselineTreeEntry as OracleTreeEntry,
    GitBaseline as GitOracle,
};
