//! Module: taxis_cmd::unarchive_options — `taxis unarchive` Option Parsing
//! File Path: src/bin/taxis_cmd/unarchive_options.rs
//! Architecture Role: Owns the option surface of `taxis unarchive` so the command module keeps
//!   only preflight and execution flow: destination resolution, in-place toggles, ODB projection,
//!   and the byte-size grammar shared by `--headroom` and `--batch-window`.
//! Dependencies & Triggers: Called by `super::unarchive::handle_unarchive`.
//! Responsibilities: Validate CLI arguments and byte sizes; reject malformed input with usage errors.
//! Exit Semantics & Design Rationale:
//!   - Every malformed size is a usage error (exit 129); a silent fallback would hide a typo that
//!     changes the preflight headroom without telling the caller.
//!   - Help text renders DEFAULT_SAFETY_HEADROOM_BYTES from its single source of truth.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core error contract guard

use std::path::PathBuf;

use fg_algorithms::space_plan::DEFAULT_SAFETY_HEADROOM_BYTES;

use super::common::fail_usage;

/// Options for `taxis unarchive`.
#[derive(Debug, Clone)]
pub struct UnarchiveOptions {
    /// Path to the archive file (.zip, .tar, .tar.gz, .tgz, .bundle).
    pub archive_path: PathBuf,
    /// Destination directory.
    pub dest_dir: PathBuf,
    /// Whether to perform in-place tail truncation / hole punching (default: true).
    pub in_place: bool,
    /// Only simulate and display water-level projection without modifying disk.
    pub dry_run: bool,
    /// Safety headroom threshold in bytes.
    pub safety_headroom_bytes: u64,
    /// Batch window size in bytes.
    pub batch_window_bytes: Option<u64>,
    /// Direct ingestion to CAS ODB without worktree materialization.
    pub to_odb: bool,
    /// Target branch name for `--to-odb` mode.
    pub branch: Option<String>,
    /// Only construct and output the root tree OID (no commit or ref update).
    pub tree_only: bool,
    /// Explicit commit message for `--to-odb` mode.
    pub message: Option<String>,
}

/// Prints usage and options help for `taxis unarchive`.
pub fn print_unarchive_help() {
    println!(
        "Usage: taxis unarchive <archive-path> [options]\n\n\
         In-place, memory-efficient archive extractor with preflight disk headroom verification.\n\n\
         Arguments:\n\
           <archive-path>              Path to archive file (.zip, .tar, .tar.gz, .tgz, .bundle)\n\n\
         Options:\n\
           -C, --dest, --target <dir>  Destination directory (default: current directory)\n\
           --in-place                  Extract in-place (reverse tail-truncation for .zip/.tar;\n\
                                       forward hole punching for .tar.gz, default)\n\
           --no-in-place               Standard extraction without modifying source archive\n\
           --dry-run                   Simulate SpacePlan discrete trough curve without modifying disk\n\
           --headroom <size>           Safety headroom threshold (default: {DEFAULT_SAFETY_HEADROOM_BYTES} bytes;\n\
                                       binary suffixes K/M/G/T, e.g. \"256M\", \"1T\")\n\
           --batch-window <size>       Batch window size for staged truncation (e.g. \"64M\"; binary K/M/G/T)\n\
           --to-odb                    Ingest directly into CAS ODB without worktree materialization\n\
           --branch, --ref <name>      Target branch to advance in --to-odb mode (default: refs/heads/import-<timestamp>)\n\
           -m, --message <msg>         Commit message for --to-odb mode (default: compliant structured format)\n\
           --tree-only                 Only construct and output root tree OID in --to-odb mode\n\
           -h, --help                  Show this help message"
    );
}

/// Parses a human-readable byte quantity with binary multipliers or bare bytes.
///
/// Unlike a silent fallback, every malformed form is rejected with a reason so the CLI can surface
/// a usage error: accepting `--headroom 1X` and quietly keeping the built-in default would hide a
/// typo that silently changes the preflight headroom. Accepted suffixes are `K`, `M`, `G`, and
/// `T` (case-insensitive, powers of 1024) or no suffix for a raw byte count.
fn parse_size_bytes_with_units(raw: &str) -> Result<u64, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty size value".to_string());
    }
    let split_at = trimmed
        .find(|ch: char| ch.is_ascii_alphabetic())
        .unwrap_or(trimmed.len());
    let (digits, suffix) = trimmed.split_at(split_at);
    let multiplier: u64 = match suffix.to_ascii_lowercase().as_str() {
        "" => 1,
        "k" => 1024,
        "m" => 1024 * 1024,
        "g" => 1024 * 1024 * 1024,
        "t" => 1024 * 1024 * 1024 * 1024,
        _ => {
            return Err(format!(
                "unsupported size unit '{suffix}' (use K, M, G, T, or a raw byte count)"
            ))
        }
    };
    let number: u64 = digits
        .parse()
        .map_err(|_| format!("'{digits}' is not a non-negative integer"))?;
    number
        .checked_mul(multiplier)
        .ok_or_else(|| format!("size '{trimmed}' overflows u64"))
}

/// Mutable builder state while parsing `taxis unarchive` CLI tokens.
struct UnarchiveOptionBuilder {
    archive_path: Option<PathBuf>,
    dest_dir: Option<PathBuf>,
    in_place: bool,
    dry_run: bool,
    safety_headroom_bytes: u64,
    batch_window_bytes: Option<u64>,
    to_odb: bool,
    branch: Option<String>,
    tree_only: bool,
    message: Option<String>,
}

/// Parses CLI options for `taxis unarchive`.
pub(super) fn parse_unarchive_options(args: &[String]) -> UnarchiveOptions {
    if args.is_empty() {
        fail_usage(
            "taxis unarchive <archive-path> [-C <dest-dir>] [--dry-run] [--in-place] [--to-odb]",
        );
    }

    let mut builder = UnarchiveOptionBuilder {
        archive_path: None,
        dest_dir: None,
        in_place: true,
        dry_run: false,
        safety_headroom_bytes: DEFAULT_SAFETY_HEADROOM_BYTES,
        batch_window_bytes: None,
        to_odb: false,
        branch: None,
        tree_only: false,
        message: None,
    };

    let mut cursor = 0;
    while cursor < args.len() {
        cursor += apply_unarchive_option_token(args, cursor, &mut builder);
    }

    let archive = builder.archive_path.unwrap_or_else(|| {
        fail_usage("missing archive file operand");
    });
    let dest = builder.dest_dir.unwrap_or_else(|| PathBuf::from("."));

    UnarchiveOptions {
        archive_path: archive,
        dest_dir: dest,
        in_place: builder.in_place,
        dry_run: builder.dry_run,
        safety_headroom_bytes: builder.safety_headroom_bytes,
        batch_window_bytes: builder.batch_window_bytes,
        to_odb: builder.to_odb,
        branch: builder.branch,
        tree_only: builder.tree_only,
        message: builder.message,
    }
}

/// Applies one CLI token for `taxis unarchive`, returning the number of tokens consumed.
fn apply_unarchive_option_token(
    args: &[String],
    cursor: usize,
    builder: &mut UnarchiveOptionBuilder,
) -> usize {
    match args[cursor].as_str() {
        "-h" | "--help" | "help" => {
            print_unarchive_help();
            std::process::exit(0);
        }
        "--dry-run" => {
            builder.dry_run = true;
            1
        }
        "--in-place" => {
            builder.in_place = true;
            1
        }
        "--no-in-place" => {
            builder.in_place = false;
            1
        }
        "--to-odb" => {
            builder.to_odb = true;
            1
        }
        "--tree-only" => {
            builder.tree_only = true;
            builder.to_odb = true;
            1
        }
        other => apply_unarchive_value_token(args, cursor, builder, other),
    }
}

/// Applies value-carrying flags or positional archive operand for `taxis unarchive`.
fn apply_unarchive_value_token(
    args: &[String],
    cursor: usize,
    builder: &mut UnarchiveOptionBuilder,
    token: &str,
) -> usize {
    let next = args.get(cursor + 1);
    match (token, next) {
        ("-C" | "--dest" | "--target", Some(val)) => {
            builder.dest_dir = Some(PathBuf::from(val));
            2
        }
        ("-m" | "--message", Some(val)) => {
            builder.message = Some(val.clone());
            2
        }
        ("-m" | "--message", None) => fail_usage("--message requires a commit message text"),
        ("--branch" | "--ref", Some(val)) => {
            builder.branch = Some(val.clone());
            builder.to_odb = true;
            2
        }
        ("--headroom", Some(val)) => {
            builder.safety_headroom_bytes = parse_unarchive_size_flag("--headroom", val);
            2
        }
        ("--headroom", None) => {
            fail_usage("--headroom requires a size value (e.g. --headroom 256M)")
        }
        ("--batch-window", Some(val)) => {
            builder.batch_window_bytes = Some(parse_unarchive_size_flag("--batch-window", val));
            2
        }
        ("--batch-window", None) => {
            fail_usage("--batch-window requires a size value (e.g. --batch-window 64M)")
        }
        (arg, _) if !arg.starts_with('-') && builder.archive_path.is_none() => {
            builder.archive_path = Some(PathBuf::from(arg));
            1
        }
        (other, _) => fail_usage(format!("unknown option or unexpected argument: '{other}'")),
    }
}

/// Parses a byte-size flag value (`--headroom` or `--batch-window`) or exits with usage error.
fn parse_unarchive_size_flag(flag_name: &str, raw_value: &str) -> u64 {
    match parse_size_bytes_with_units(raw_value) {
        Ok(bytes) => bytes,
        Err(reason) => fail_usage(format!("{flag_name} {raw_value}: {reason}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_size_bytes_with_units_accepts_binary_suffixes() {
        assert_eq!(parse_size_bytes_with_units("0").expect("zero"), 0);
        assert_eq!(
            parse_size_bytes_with_units("104857600").expect("bare bytes"),
            104_857_600
        );
        assert_eq!(parse_size_bytes_with_units("1K").expect("kilo"), 1024);
        assert_eq!(
            parse_size_bytes_with_units("64m").expect("mega lowercase"),
            64 * 1024 * 1024
        );
        assert_eq!(
            parse_size_bytes_with_units("1G").expect("giga"),
            1024 * 1024 * 1024
        );
        assert_eq!(
            parse_size_bytes_with_units("2T").expect("tera"),
            2 * 1024u64 * 1024 * 1024 * 1024
        );
    }

    #[test]
    fn test_parse_size_bytes_with_units_rejects_malformed_values() {
        for raw in [
            "",
            "   ",
            "M",
            "1X",
            "1.5G",
            "-1",
            "1MB",
            "12KB",
            "abc",
            "18446744073709551616",
            "16777216T",
        ] {
            assert!(
                parse_size_bytes_with_units(raw).is_err(),
                "value {raw:?} must be rejected instead of silently falling back"
            );
        }
    }
}
