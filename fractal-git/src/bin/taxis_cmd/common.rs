//! Module: taxis_cmd::common — Shared CLI Context & Argument Utilities
//! File Path: src/bin/taxis_cmd/common.rs
//! Architecture Role: Provides shared CLI context, JSON rendering, argument parsing,
//!   and uniform failure termination across all Taxis subcommand dispatchers.
//! Dependencies & Triggers: Consumed by taxis.rs and all taxis_cmd submodules.
//! Responsibilities: Context extraction, serialized machine-readable output, flag parsing,
//!   exit-code contract enforcement.
//! Exit Semantics & Design Rationale: Every rejected command terminates with a non-zero
//!   status so that shell automation and hook bridges can distinguish success from refusal.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::fmt::Display;
use std::path::PathBuf;

/// Process exit status reserved for rejected commands and failed side effects.
pub const EXIT_REJECTED: i32 = 1;

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

/// Collects every value attached to a repeatable flag (e.g. `--file a --file b`).
pub fn find_all_arg_values<'a>(args: &'a [String], flags: &[&str]) -> Vec<&'a str> {
    let mut collected = Vec::new();
    for index in 0..args.len().saturating_sub(1) {
        if flags.contains(&args[index].as_str()) {
            collected.push(args[index + 1].as_str());
        }
    }
    collected
}

/// Reports a rejection on stderr and terminates the process with [`EXIT_REJECTED`].
///
/// Centralizing this prevents the historical failure mode where a rejected command
/// printed an error but still returned status 0, hiding the rejection from callers.
pub fn reject(tag: &str, detail: impl Display) -> ! {
    eprintln!("{} {}", tag, detail);
    std::process::exit(EXIT_REJECTED)
}

/// Reports an I/O or side-effect failure on stderr and terminates with [`EXIT_REJECTED`].
pub fn fail_io(action: impl Display, detail: impl Display) -> ! {
    eprintln!("[ERROR] Failed to {}: {}", action, detail);
    std::process::exit(EXIT_REJECTED)
}
