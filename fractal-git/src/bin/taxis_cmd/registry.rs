//! Module: taxis_cmd::registry — Command Table
//! File Path: src/bin/taxis_cmd/registry.rs
//! Architecture Role: The single authoritative declaration of every native subcommand, assembled
//!   from three contiguous ranges so no single file has to hold all of them.
//! Dependencies & Triggers: Read by the dispatcher, the help renderer, and the rejection message.
//! Responsibilities: Hold the assembled table and the spec type its ranges are declared with.
//! Exit Semantics & Design Rationale:
//!   - Three separate places must agree on the command set: dispatch, `--help`, and the
//!     "unimplemented" refusal. When the list was restated by hand in the refusal message it
//!     drifted, silently omitting the newest commands, so all three now read this table.
//!   - The ranges are contiguous slices of one ordering, not themes. A command filed under the
//!     wrong theme would be found by nobody; a positional split has no judgement to get wrong.
//!   - Every range is `&'static`, so assembly is a compile-time concern and lookup allocates
//!     nothing.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use super::common::CliContext;
use super::registry_early::TABLE as EARLY;
use super::registry_late::TABLE as LATE;
use super::registry_middle::TABLE as MIDDLE;

/// Builds a spec whose canonical name is also its only spelling.
///
/// Exported to the range modules so each entry stays one line. The shorthand belongs beside the
/// type it constructs rather than beside any particular range.
pub(crate) const fn cmd(
    canonical: &'static str,
    aliases: &'static [&'static str],
    handler: fn(&CliContext),
) -> CommandSpec {
    CommandSpec {
        canonical,
        aliases,
        handler,
    }
}

/// Specification for one Taxis CLI subcommand and its accepted shorthand aliases.
///
/// `Copy` because the assembled table is built by copying each range into a fixed-size array at
/// compile time; a move-only type would force a heap allocation on the dispatch path.
#[derive(Clone, Copy)]
pub(crate) struct CommandSpec {
    pub(crate) canonical: &'static str,
    pub(crate) aliases: &'static [&'static str],
    pub(crate) handler: fn(&CliContext),
}

/// Every native subcommand, in the order the ranges were written.
pub(crate) const COMMAND_TABLE: &[CommandSpec] = &concat_tables();

/// Concatenates the three ranges at compile time.
///
/// Written as a const function rather than a lazily-built `Vec` so lookup is an index into a
/// static slice: the dispatcher runs on every invocation, and a heap-allocated table would add an
/// allocation to the most frequent path in the binary.
const fn concat_tables() -> [CommandSpec; TOTAL_COMMANDS] {
    let mut out: [CommandSpec; TOTAL_COMMANDS] = [CommandSpec {
        canonical: "",
        aliases: &[],
        handler: placeholder_handler,
    }; TOTAL_COMMANDS];
    let mut i = 0;
    while i < EARLY.len() {
        let spec = CommandSpec {
            canonical: EARLY[i].canonical,
            aliases: EARLY[i].aliases,
            handler: EARLY[i].handler,
        };
        out[i] = spec;
        i += 1;
    }
    i = 0;
    while i < MIDDLE.len() {
        let spec = CommandSpec {
            canonical: MIDDLE[i].canonical,
            aliases: MIDDLE[i].aliases,
            handler: MIDDLE[i].handler,
        };
        out[EARLY.len() + i] = spec;
        i += 1;
    }
    i = 0;
    while i < LATE.len() {
        let spec = CommandSpec {
            canonical: LATE[i].canonical,
            aliases: LATE[i].aliases,
            handler: LATE[i].handler,
        };
        out[EARLY.len() + MIDDLE.len() + i] = spec;
        i += 1;
    }
    out
}

/// Number of commands across all ranges.
const TOTAL_COMMANDS: usize = EARLY.len() + MIDDLE.len() + LATE.len();

/// Handler used only to fill the placeholder slots the const concatenation overwrites.
fn placeholder_handler(ctx: &CliContext) {
    let _ = ctx;
}
