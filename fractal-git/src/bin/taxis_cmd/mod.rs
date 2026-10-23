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
pub mod branch;
pub mod checkout;
pub mod cherry_pick;
pub mod commit;
pub mod commit_walk;
pub mod common;
pub mod config;
pub mod daemon;
pub mod diff;
pub mod diff_render;
pub mod doctor;
pub mod init;
pub mod log;
pub mod merge;
pub mod operation;
pub mod projection;
pub mod promotion;
pub mod read;
pub mod rebase;
pub mod reclaim;
pub mod relocate;
pub mod repo_view;
pub mod reset;
pub mod rev_list;
pub mod revert;
pub mod stash;
pub mod status;
pub mod tag;
pub mod tree_view;
pub mod undo;
pub mod verify;
pub mod worktree;
