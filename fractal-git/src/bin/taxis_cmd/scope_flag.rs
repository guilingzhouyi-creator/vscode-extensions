//! Module: taxis_cmd::scope_flag — Shared `--scope` / `--tier` Parsing
//! File Path: src/bin/taxis_cmd/scope_flag.rs
//! Architecture Role: One implementation of the path-slice flags, used by every command that can
//!   be restricted to a slice.
//! Dependencies & Triggers: Called by `log`, `diff`, and `show`.
//! Responsibilities: Recognise the flags, validate their values, and build a [`ProjectionScope`].
//! Exit Semantics & Design Rationale:
//!   - The flags are parsed in one place because three commands accepting the same spelling with
//!     three subtly different meanings is how a CLI stops being learnable. `log` keeps commits and
//!     labels them; `diff` and `show` drop hunks. Both are "what this node can see", so both take
//!     the same flags, and the difference is documented where each is applied.
//!   - A value that cannot be understood is refused, never guessed. A mistyped slice silently shows
//!     the wrong part of the tree, and the reader has no way to tell it apart from the right part.
//!   - Absence is not an empty scope. No `--scope` yields `None`, which callers use to take the
//!     unmodified path; an empty scope would filter everything out.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use fg_core::models::{ProjectionScope, ProjectionTier};

/// Removes the slice flags from `args`, returning what remains plus the parsed slice.
///
/// A command whose parser treats every unrecognised token as a positional argument must strip the
/// flags first. `diff` reads a trailing token as a revision, so leaving `--scope` in place would
/// have it resolve the scope's value as a branch name — the flag word is skipped, but its value is
/// not, and nothing downstream can tell the two apart.
///
/// # Errors
///
/// Returns a human-readable reason when a flag is missing its value or names an unknown tier.
pub(crate) fn strip_scope(
    args: &[String],
) -> Result<(Vec<String>, Option<ProjectionScope>), String> {
    let mut remainder: Vec<String> = Vec::with_capacity(args.len());
    let mut scope_args: Vec<String> = Vec::new();
    let mut cursor = 0usize;
    while cursor < args.len() {
        let argument = args[cursor].as_str();
        cursor += 1;
        match argument {
            "--scope" | "--tier" => {
                scope_args.push(argument.to_string());
                // The value moves with the flag. A missing value is reported by `take_scope_from`,
                // so it is copied as-is rather than diagnosed twice.
                if let Some(value) = args.get(cursor) {
                    scope_args.push(value.clone());
                    cursor += 1;
                }
            }
            other if other.starts_with("--scope=") || other.starts_with("--tier=") => {
                scope_args.push(other.to_string());
            }
            _ => remainder.push(argument.to_string()),
        }
    }
    let scope = take_scope_from(&scope_args)?;
    Ok((remainder, scope))
}

/// Extracts the slice flags from a ready argument slice.
///
/// `log` splits its arguments once and parses the option list, so it has an argument slice rather
/// than a context. Sharing the implementation is what keeps the two paths identical.
///
/// # Errors
///
/// Returns a human-readable reason when a flag is missing its value or names an unknown tier.
pub(crate) fn take_scope_from(args: &[String]) -> Result<Option<ProjectionScope>, String> {
    let mut tier = ProjectionTier::AgentCard;
    let mut include: Vec<String> = Vec::new();
    let mut exclude: Vec<String> = Vec::new();
    let mut saw_tier = false;

    let mut cursor = 0usize;
    while cursor < args.len() {
        let argument = args[cursor].as_str();
        cursor += 1;
        match argument {
            "--scope" => {
                let value = args
                    .get(cursor)
                    .ok_or("--scope requires a path prefix or glob")?;
                push_pattern(&mut include, &mut exclude, value);
                cursor += 1;
            }
            "--tier" => {
                let value = args.get(cursor).ok_or("--tier requires a tier name")?;
                tier = parse_tier(value)?;
                saw_tier = true;
                cursor += 1;
            }
            other if other.starts_with("--scope=") => {
                push_pattern(&mut include, &mut exclude, &other["--scope=".len()..]);
            }
            other if other.starts_with("--tier=") => {
                tier = parse_tier(&other["--tier=".len()..])?;
                saw_tier = true;
            }
            _ => {}
        }
    }

    if include.is_empty() && exclude.is_empty() {
        // A bare `--tier` with no paths still means "the whole tree at this tier", which is a
        // meaningful slice: it selects which tier's view is being reported, not what it contains.
        return if saw_tier {
            Ok(Some(ProjectionScope::whole(tier)))
        } else {
            Ok(None)
        };
    }

    ProjectionScope::restricted(tier, include, exclude)
        .map(Some)
        .map_err(|scope_err| scope_err.to_string())
}

/// Records one pattern, treating a leading `!` as a subtraction.
fn push_pattern(include: &mut Vec<String>, exclude: &mut Vec<String>, pattern: &str) {
    match pattern.strip_prefix('!') {
        Some(negated) => exclude.push(negated.to_string()),
        None => include.push(pattern.to_string()),
    }
}

/// Parses a `--tier` value.
fn parse_tier(value: &str) -> Result<ProjectionTier, String> {
    match value.trim() {
        "system-trunk" | "trunk" => Ok(ProjectionTier::SystemTrunk),
        "integration-cell" | "cell" => Ok(ProjectionTier::IntegrationCell),
        "agent-card" | "card" => Ok(ProjectionTier::AgentCard),
        "sub-agent" | "sub" => Ok(ProjectionTier::SubAgent),
        other => Err(format!(
            "--tier accepts system-trunk, integration-cell, agent-card, or sub-agent, got '{other}'"
        )),
    }
}
