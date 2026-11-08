//! Module: taxis_cmd::registry_late — Worktree, Remote, and Maintenance Commands
//! File Path: src/bin/taxis_cmd/registry_late.rs
//! Architecture Role: One contiguous range of the native subcommand table.
//! Dependencies & Triggers: Concatenated by `registry` into the single authoritative table.
//! Responsibilities: Declare the commands in this range with their aliases and handlers.
//! Exit Semantics & Design Rationale:
//!   - The split is positional on purpose. Grouping by theme invites disagreement about which
//!     theme a command belongs to, and a misfiled command is invisible; a positional split has no
//!     judgement to get wrong, and the assembled table is identical either way.
//!   - No lookup happens inside a range: only the assembled table is searched, so a command
//!     cannot be found in one place and missed in another.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use super::{
    archive, bisect, blame, bundle, clone, config, daemon, diagnostics_tool, maintenance,
    maintenance_ops, notes_replace, pack_plumbing, project, quality, quarantine, reclaim, remote,
    repack, submodule, unarchive,
};

use super::registry::{cmd, CommandSpec};
use crate::{handle_help, handle_version};

/// Commands in this range of the authoritative table.
pub(crate) const TABLE: &[CommandSpec] = &[
    cmd("reclaim", &["reclaim"], reclaim::handle_reclaim),
    cmd("gc", &["gc"], maintenance::handle_gc),
    cmd("clean", &["clean"], maintenance::handle_clean),
    cmd("prune", &["prune"], maintenance::handle_prune),
    cmd("fsck", &["fsck"], maintenance::handle_fsck),
    cmd("clone", &["clone"], clone::handle_clone),
    cmd("repack", &["repack", "pack-objects"], repack::handle_repack),
    cmd("remote", &["remote"], remote::handle_remote),
    cmd("fetch", &["fetch"], remote::handle_fetch),
    cmd("push", &["push"], remote::handle_push),
    cmd("pull", &["pull"], remote::handle_pull),
    cmd("config", &["config", "cfg"], config::handle_config),
    cmd(
        "submodule",
        &["submodule", "sub"],
        submodule::handle_submodule,
    ),
    cmd("project", &["project", "pj"], project::handle_project),
    cmd("quality", &["quality", "trace"], quality::handle_quality),
    cmd(
        "quarantine",
        &["quarantine", "quar"],
        quarantine::handle_quarantine,
    ),
    cmd("archive", &["archive"], archive::handle_archive),
    cmd(
        "unarchive",
        &["unarchive", "extract"],
        unarchive::handle_unarchive,
    ),
    cmd("bundle", &["bundle"], bundle::handle_bundle),
    cmd("blame", &["blame"], blame::handle_blame),
    cmd("bisect", &["bisect"], bisect::handle_bisect),
    cmd("daemon", &["serve", "daemon"], daemon::handle_daemon),
    cmd("notes", &["notes"], notes_replace::handle_notes),
    cmd("replace", &["replace"], notes_replace::handle_replace),
    cmd(
        "commit-graph",
        &["commit-graph"],
        maintenance_ops::handle_commit_graph,
    ),
    cmd(
        "sparse-checkout",
        &["sparse-checkout"],
        maintenance_ops::handle_sparse_checkout,
    ),
    cmd(
        "maintenance",
        &["maintenance"],
        maintenance_ops::handle_maintenance,
    ),
    cmd("rerere", &["rerere"], maintenance_ops::handle_rerere),
    cmd(
        "unpack-objects",
        &["unpack-objects"],
        pack_plumbing::handle_unpack_objects,
    ),
    cmd(
        "index-pack",
        &["index-pack"],
        pack_plumbing::handle_index_pack,
    ),
    cmd(
        "multi-pack-index",
        &["multi-pack-index", "midx"],
        pack_plumbing::handle_multi_pack_index,
    ),
    cmd(
        "diagnostics",
        &["diagnostics", "diag"],
        diagnostics_tool::handle_diagnostics,
    ),
    cmd("version", &["version", "-v", "--version"], handle_version),
    cmd("help", &["help", "-h", "--help"], handle_help),
];
