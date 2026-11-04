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

use fractal_git::constants::cli::CliTag;

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

/// Process exit status for an operation this edition cannot perform at all.
pub const EXIT_UNAVAILABLE: i32 = 69;

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
/// Under commercial production mode, internal bracket badges (e.g. `[ERROR]`, `[COMMIT_GOVERNANCE_FAIL]`)
/// are normalized to standard porcelain `error:` prefixes, keeping user messages clean and professional.
/// When diagnostic mode is activated, raw engineering tags are preserved for automated triage.
pub fn reject(tag: &str, detail: impl Display) -> ! {
    fg_core::diag_debug!("gate", "rejection tag={} exit={}", tag, EXIT_REJECTED);
    let is_diag = fg_core::diagnostics::is_diagnostic_mode();
    if is_diag {
        eprintln!("{} {}", tag, detail);
    } else {
        let text = detail.to_string();
        let prefix = match tag {
            CliTag::COMMIT_GOVERNANCE_FAIL | CliTag::ERROR | CliTag::FAIL => "error:",
            CliTag::AUTHORITY_BREACH => "error: [AUTHORITY_BREACH]",
            _ => {
                if tag.starts_with('[') && tag.ends_with(']') {
                    "error:"
                } else {
                    tag
                }
            }
        };
        if prefix.is_empty()
            || text.starts_with("error:")
            || text.starts_with("fatal:")
            || text.starts_with("usage:")
        {
            eprintln!("{}", text);
        } else {
            eprintln!("{} {}", prefix, text);
        }
    }
    std::process::exit(EXIT_REJECTED)
}

/// Reports an I/O or side-effect failure on stderr and terminates with [`EXIT_FATAL`].
pub fn fail_io(action: impl Display, detail: impl Display) -> ! {
    eprintln!("fatal: failed to {}: {}", action, detail);
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

/// Reports that this edition cannot perform an operation at all, then terminates.
pub fn fail_unavailable(capability: &str, operation: &str) -> ! {
    let edition = fg_core::constants::Edition::CURRENT;
    fg_core::diag_debug!(
        "capability",
        "refused '{}' because '{}' is disabled in the {} edition",
        operation,
        capability,
        edition.as_str()
    );
    eprintln!(
        "[UNAVAILABLE] '{}' requires the '{}' capability, which the {} edition does not provide.",
        operation,
        capability,
        edition.as_str()
    );
    eprintln!(
        "  This is not a permission denial; repeating the command will not change the outcome."
    );
    eprintln!("  Run `taxis version` to see the full capability set.");
    std::process::exit(EXIT_UNAVAILABLE)
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
