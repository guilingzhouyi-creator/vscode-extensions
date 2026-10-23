//! Module: taxis_cmd — Taxis CLI Subcommand Dispatchers
//! File Path: src/bin/taxis_cmd/mod.rs
//! Architecture Role: Modular subcommand dispatchers for the Taxis native binary,
//!   isolating promotion, benchmarking, worktree, and commit logic into focused units.
//! Dependencies & Triggers: Loaded by src/bin/taxis.rs.
//! Responsibilities: Submodule export and shared CLI command organization.
//! Exit Semantics & Design Rationale: Zero-cost abstraction organizing CLI subcommands cleanly.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

pub mod abbrev;
pub mod bench;
pub mod checkout;
pub mod cherry_pick_cmd;
pub mod commit;
pub mod commit_walk;
pub mod common;
pub mod config;
pub mod diff_cmd;
pub mod diff_render;
pub mod doctor;
pub mod init;
pub mod log_cmd;
pub mod merge_cmd;
pub mod projection_cmd;
pub mod promotion;
pub mod read_cmd;
pub mod rebase_cmd;
pub mod relocate;
pub mod repo_view;
pub mod reset_cmd;
pub mod revert_cmd;
pub mod stash_cmd;
pub mod status_cmd;
pub mod tag_cmd;
pub mod tree_view;
pub mod worktree;
