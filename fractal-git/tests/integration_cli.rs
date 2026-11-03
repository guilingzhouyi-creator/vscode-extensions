//! Integration Test Harness: CLI Commands, Porcelain & Parity Contracts
//! File Path: tests/integration_cli.rs
//! Architecture Role: Consolidates CLI read/write, plumbing parity, Git differential,
//!   and hook pipeline integration tests into a single compiled binary harness.

#[path = "rust/test_cli_contract_parity.rs"]
mod test_cli_contract_parity;

#[path = "rust/test_read_commands.rs"]
mod test_read_commands;

#[path = "rust/test_plumbing_parity.rs"]
mod test_plumbing_parity;

#[path = "rust/test_config_parity.rs"]
mod test_config_parity;

#[path = "rust/test_git_differential.rs"]
mod test_git_differential;

#[path = "rust/test_git_hooks.rs"]
mod test_git_hooks;

#[path = "rust/test_edge_porcelain.rs"]
mod test_edge_porcelain;

#[path = "rust/test_interactive_operations.rs"]
mod test_interactive_operations;

#[path = "rust/test_offline_workflow_parity.rs"]
mod test_offline_workflow_parity;

#[path = "rust/test_operations.rs"]
mod test_operations;

#[path = "rust/test_edition_capability.rs"]
mod test_edition_capability;
#[path = "rust/test_pathspec_resolution.rs"]
mod test_pathspec_resolution;
#[path = "rust/test_engineering_default_target.rs"]
mod test_engineering_default_target;
#[path = "rust/test_ref_commands.rs"]
mod test_ref_commands;
#[path = "rust/test_inspect_commands.rs"]
mod test_inspect_commands;
#[path = "rust/test_patch_commands.rs"]
mod test_patch_commands;
#[path = "rust/test_lineage_commands.rs"]
mod test_lineage_commands;
#[path = "rust/test_plumbing_tree_commands.rs"]
mod test_plumbing_tree_commands;
