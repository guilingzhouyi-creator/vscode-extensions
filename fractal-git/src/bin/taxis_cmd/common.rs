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

/// Process exit status reserved for policy refusals that are not repository failures.
pub const EXIT_REJECTED: i32 = 1;

/// Process exit status for fatal repository or side-effect failures.
///
/// Git reserves 128 for fatal errors (missing repository, missing object, unreadable index) and
/// automation depends on telling those apart from a refusal that left the repository intact.
pub const EXIT_FATAL: i32 = 128;

/// Process exit status for a command line Git rejects as malformed.
///
/// Git uses 129 for the usage class (unknown option, missing required argument). It is distinct from
/// both a refusal (1) and a repository failure (128), and wrapper scripts branch on it.
pub const EXIT_USAGE: i32 = 129;

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

/// Parses a human readable byte quantity such as `64M`, `1G`, or a bare byte count.
///
/// Multipliers are binary (1K = 1024 bytes) because every caller sizes filesystem effects, where
/// Git and the Windows APIs both count in 1024-byte units. Malformed or empty input returns `None`
/// so each command can decide between a usage error and a fallback default.
pub fn parse_byte_size(input_size_str: &str) -> Option<u64> {
    let trimmed = input_size_str.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (num_str, multiplier) = if trimmed.ends_with(['g', 'G']) {
        (&trimmed[..trimmed.len() - 1], 1024 * 1024 * 1024)
    } else if trimmed.ends_with(['m', 'M']) {
        (&trimmed[..trimmed.len() - 1], 1024 * 1024)
    } else if trimmed.ends_with(['k', 'K']) {
        (&trimmed[..trimmed.len() - 1], 1024)
    } else {
        (trimmed, 1)
    };

    let num: u64 = num_str.parse().ok()?;
    Some(num.saturating_mul(multiplier))
}

/// Reports a rejection on stderr and terminates the process with [`EXIT_REJECTED`].
///
/// Centralizing this prevents the historical failure mode where a rejected command
/// printed an error but still returned status 0, hiding the rejection from callers.
pub fn reject(tag: &str, detail: impl Display) -> ! {
    eprintln!("{} {}", tag, detail);
    std::process::exit(EXIT_REJECTED)
}

/// Reports an I/O or side-effect failure on stderr and terminates with [`EXIT_FATAL`].
pub fn fail_io(action: impl Display, detail: impl Display) -> ! {
    eprintln!("[ERROR] Failed to {}: {}", action, detail);
    std::process::exit(EXIT_FATAL)
}

/// Reports a fatal repository-level failure on stderr and terminates with [`EXIT_FATAL`].
///
/// Opening a repository that does not exist, or reading an object that is missing, is fatal in
/// Git rather than a policy refusal; callers rely on the 128 status to separate the two.
pub fn fail_fatal(detail: impl Display) -> ! {
    eprintln!("fatal: {}", detail);
    std::process::exit(EXIT_FATAL)
}

/// Reports a malformed command line on stderr and terminates with [`EXIT_USAGE`].
///
/// The message is a usage line, matching the shape Git prints, because a caller that asked for an
/// option the command does not implement needs the accepted surface spelled out instead of a
/// listing that silently ignored the restriction.
pub fn fail_usage(detail: impl Display) -> ! {
    eprintln!("usage: {}", detail);
    std::process::exit(EXIT_USAGE)
}

/// Reports Git's "ambiguous argument" fatal for a revision that does not resolve.
///
/// Git prints this three-line block whenever a revision cannot be turned into an object id and the
/// argument could also be a path; scripts match on the 128 status, and the `--` hint is the only
/// guidance the user gets for disambiguating. Emitting the whole block here keeps the wording in
/// one place instead of repeating it in every command that resolves revisions.
pub fn fatal_ambiguous_argument(revision: impl Display) -> ! {
    eprintln!(
        "fatal: ambiguous argument '{revision}': unknown revision or path not in the working tree."
    );
    eprintln!("Use '--' to separate paths from revisions, like this:");
    eprintln!("'git <command> [<revision>...] -- [<file>...]'");
    std::process::exit(EXIT_FATAL)
}
