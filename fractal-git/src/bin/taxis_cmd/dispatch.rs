//! Module: taxis_cmd::dispatch — Command Resolution and Routing
//! File Path: src/bin/taxis_cmd/dispatch.rs
//! Architecture Role: Turns the name the user typed into the handler that serves it, and refuses
//!   names the table does not cover.
//! Dependencies & Triggers: Reads `registry::COMMAND_TABLE`; called once per process from `main`.
//! Responsibilities: Resolve an alias to its canonical name, route a canonical name to its handler,
//!   and report the implemented set when refusing an unknown one.
//! Exit Semantics & Design Rationale:
//!   - Resolution happens before dispatch and never inside a handler, so a command cannot behave
//!     differently depending on how it was spelled.
//!   - An unknown name is refused by the name the user typed rather than mapped to a nearest match.
//!     A CLI that silently forwards a typo to a similar command is a CLI whose failures look like
//!     successes.
//!   - The refusal message derives the implemented set from the table instead of restating it. The
//!     restated list had already drifted, omitting the newest commands, and any restated list will
//!     drift again because it requires remembering a second place.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use super::common::CliContext;
use super::registry::COMMAND_TABLE;
/// Resolves an alias to its canonical name, leaving an unknown name untouched.
///
/// Unknown names are returned unchanged rather than mapped to a nearest match. The dispatcher then
/// refuses them by the name the user typed, so a typo is reported as a typo instead of silently
/// running a different command.
pub(crate) fn resolve_canonical_subcommand(raw: &str) -> &str {
    for spec in COMMAND_TABLE {
        if spec.canonical == raw || spec.aliases.contains(&raw) {
            return spec.canonical;
        }
    }
    raw
}

/// Routes a canonical subcommand to its handler, or refuses it.
///
/// The refusal is part of the dispatch rather than a fallback the caller must remember, because a
/// command that fell through here without a handler would otherwise return success having done
/// nothing.
pub(crate) fn dispatch_command(effective_subcommand: &str, ctx: &CliContext) {
    for spec in COMMAND_TABLE {
        if spec.canonical == effective_subcommand {
            (spec.handler)(ctx);
            return;
        }
    }
    reject_unimplemented(effective_subcommand);
}

/// Refuses a subcommand that has no native implementation.
///
/// The implemented set is derived from [`COMMAND_TABLE`] rather than restated. The previous
/// hand-written list had already drifted — it omitted `install` and `uninstall`, the two commands
/// this build gained most recently — and a restated list will always drift, because adding a command
/// requires remembering a second place.
fn reject_unimplemented(subcommand: &str) -> ! {
    let mut implemented: Vec<&str> = COMMAND_TABLE.iter().map(|spec| spec.canonical).collect();
    implemented.sort_unstable();
    super::common::reject(
        crate::CliTag::ERROR,
        format!(
            "'{subcommand}' has no native implementation in this build.\nImplemented ({}): {}",
            implemented.len(),
            implemented.join(", ")
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn no_command_name_is_declared_twice() {
        // A duplicate would shadow the earlier entry at dispatch time: the second one becomes
        // unreachable while both appear in `--help`, which is the shape of a command that "exists"
        // and silently does nothing.
        let mut seen = HashMap::new();
        for spec in COMMAND_TABLE {
            if let Some(first) = seen.insert(spec.canonical, spec.canonical) {
                panic!("command {first} is declared more than once");
            }
        }
    }

    #[test]
    fn no_alias_is_shared_between_commands() {
        // Aliases resolve to one canonical name before dispatch, so a shared alias would make the
        // result depend on table order rather than on what the user typed.
        let mut owner: HashMap<&str, &str> = HashMap::new();
        for spec in COMMAND_TABLE {
            for alias in spec.aliases {
                if let Some(previous) = owner.insert(alias, spec.canonical) {
                    panic!("alias {alias} is claimed by {previous} and {}", spec.canonical);
                }
            }
        }
    }

    #[test]
    fn every_canonical_name_resolves_to_itself() {
        for spec in COMMAND_TABLE {
            assert_eq!(
                resolve_canonical_subcommand(spec.canonical),
                spec.canonical,
                "a command must be reachable by its own name"
            );
        }
    }

    #[test]
    fn every_alias_resolves_to_its_declared_command() {
        for spec in COMMAND_TABLE {
            for alias in spec.aliases {
                assert_eq!(
                    resolve_canonical_subcommand(alias),
                    spec.canonical,
                    "alias {alias} must resolve to {}",
                    spec.canonical
                );
            }
        }
    }

    #[test]
    fn an_unknown_name_is_returned_unchanged_rather_than_guessed() {
        assert_eq!(resolve_canonical_subcommand("no-such-command"), "no-such-command");
        assert_eq!(resolve_canonical_subcommand(""), "");
    }
}
