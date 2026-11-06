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
pub mod apply_mailbox;
pub use apply_mailbox as am;
pub mod apply;
pub mod archive;
pub mod bench;
pub mod bench_e2e;
pub mod bisect;
pub mod blackboard;
pub mod blame;
pub mod branch;
pub mod bundle;
pub mod checkout;
pub mod cherry_pick;
pub mod clone;
pub mod commit;
pub mod commit_ops;
pub mod commit_walk;
pub mod common;
pub mod config;
pub mod daemon;
pub mod diagnostics_tool;
pub mod diff;
pub mod diff_render;
pub mod doctor;
pub mod format_patch;
pub mod gate_slice;
pub mod git_hooks;
pub mod hash_object;
pub mod index_plumbing;
pub mod init;
pub mod inspect;
pub mod inspect_grep;
pub mod lineage;
pub mod list_files;
pub mod log;
pub mod log_render;
pub mod maintenance;
pub mod maintenance_ops;
pub mod merge;
pub mod notes_replace;
pub mod operation;
pub mod pack_plumbing;
pub mod patch_parser;
pub mod path_filter;
pub mod plumbing_tree;
pub mod project;
pub mod projection;
pub mod promotion;
pub mod quality;
pub mod quarantine;
pub mod read;
pub mod read_cat_file;
pub mod rebase;
pub mod rebase_state;
pub mod reclaim;
pub mod reflog;
pub mod refs;
pub mod relocate;
pub mod remote;
pub mod remote_sync;
pub mod remote_sync_push;
pub mod repack;
pub mod repo_view;
pub mod reset;
pub mod rev_list;
pub mod revert;
pub mod stage;
pub mod stash;
pub mod status;
pub mod status_collect;
pub mod status_render;
pub mod status_untracked;
pub mod submodule;
pub mod tag;
pub mod tree_view;
pub mod unarchive;
pub mod unarchive_options;
pub mod unarchive_space;
pub mod undo;
pub mod verify;
pub mod worktree;
