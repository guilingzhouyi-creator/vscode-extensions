//! Module: taxis_cmd::common — Shared CLI Context & Argument Utilities
//! File Path: src/bin/taxis_cmd/common.rs
//! Architecture Role: Provides shared CLI context, JSON rendering, and argument parsing
//!   utilities across all Taxis subcommand dispatchers.
//! Dependencies & Triggers: Consumed by taxis.rs and all taxis_cmd submodules.
//! Responsibilities: Context extraction, serialized machine-readable output, flag parsing.
//! Exit Semantics & Design Rationale: Zero-allocation helpers with predictable fallback semantics.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::path::PathBuf;

/// Execution context holding common flags, repository path, and subcommand arguments.
#[derive(Debug, Clone)]
pub struct CliContext {
    pub git_dir: PathBuf,
    pub json_mode: bool,
    pub args: Vec<String>,
}

/// Serializes and prints any serializable structure as pretty-formatted JSON to stdout.
pub fn print_json<T: serde::Serialize>(value: &T) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).unwrap_or_default()
    );
}

/// Scans CLI arguments for the first occurrence of any provided flag and returns its value.
pub fn find_arg_value<'a>(args: &'a [String], flags: &[&str]) -> Option<&'a str> {
    for index in 0..args.len().saturating_sub(1) {
        if flags.contains(&args[index].as_str()) {
            return Some(args[index + 1].as_str());
        }
    }
    None
}
