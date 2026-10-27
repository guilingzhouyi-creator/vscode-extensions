//! Integration Test Harness: Governance, Policy, Promotion & Topology
//! File Path: tests/integration_governance.rs
//! Architecture Role: Consolidates governance rules, project lease, worktree boundary,
//!   and references integration tests into a single compiled binary harness.

#[path = "rust/test_governance.rs"]
mod test_governance;

#[path = "rust/test_governance_pipeline.rs"]
mod test_governance_pipeline;

#[path = "rust/test_uac_promotions.rs"]
mod test_uac_promotions;

#[path = "rust/test_project_leases.rs"]
mod test_project_leases;

#[path = "rust/test_bounded_worktree.rs"]
mod test_bounded_worktree;

#[path = "rust/test_refs.rs"]
mod test_refs;

#[path = "rust/test_relocate.rs"]
mod test_relocate;

#[path = "rust/test_remote_transport.rs"]
mod test_remote_transport;

#[path = "rust/test_self_hosted_ipc.rs"]
mod test_self_hosted_ipc;

#[path = "rust/test_submodules.rs"]
mod test_submodules;
