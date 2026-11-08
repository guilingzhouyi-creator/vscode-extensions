//! Module: taxis_cmd::registry_middle — Object, Reference, and History Commands
//! File Path: src/bin/taxis_cmd/registry_middle.rs
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
    am, apply, bench, blackboard, checkout, cherry_pick, format_patch, gate_slice, inspect,
    lineage, log, merge, operation, plumbing_tree, promotion, read, rebase, reset, rev_list,
    revert, stash, tag, undo, verify, worktree,
};

use super::registry::{cmd, CommandSpec};
use crate::handle_authority;

/// Commands in this range of the authoritative table.
pub(crate) const TABLE: &[CommandSpec] = &[
    cmd("stripspace", &["stripspace"], inspect::handle_stripspace),
    cmd("check-ignore", &["check-ignore"], read::handle_check_ignore),
    cmd("log", &["lg", "log"], log::handle_log),
    cmd("show", &["sh", "show"], log::handle_show),
    cmd(
        "checkout",
        &["co", "checkout", "sw", "switch"],
        checkout::handle_checkout,
    ),
    cmd("merge", &["mg", "merge"], merge::handle_merge),
    cmd("reset", &["reset"], reset::handle_reset),
    cmd("tag", &["tag"], tag::handle_tag),
    cmd(
        "cherry-pick",
        &["cp", "cherry-pick"],
        cherry_pick::handle_cherry_pick,
    ),
    cmd("revert", &["revert"], revert::handle_revert),
    cmd(
        "format-patch",
        &["format-patch"],
        format_patch::handle_format_patch,
    ),
    cmd("apply", &["apply"], apply::handle_apply),
    cmd("am", &["am"], am::handle_am),
    cmd("range-diff", &["range-diff"], lineage::handle_range_diff),
    cmd("cherry", &["cherry"], lineage::handle_cherry),
    cmd("patch-id", &["patch-id"], lineage::handle_patch_id),
    cmd(
        "merge-tree",
        &["merge-tree"],
        plumbing_tree::handle_merge_tree,
    ),
    cmd("mktree", &["mktree"], plumbing_tree::handle_mktree),
    cmd("read-tree", &["read-tree"], plumbing_tree::handle_read_tree),
    cmd("mktag", &["mktag"], plumbing_tree::handle_mktag),
    cmd("name-rev", &["name-rev"], plumbing_tree::handle_name_rev),
    cmd(
        "verify-commit",
        &["verify-commit"],
        plumbing_tree::handle_verify_commit,
    ),
    cmd(
        "verify-tag",
        &["verify-tag"],
        plumbing_tree::handle_verify_tag,
    ),
    cmd("stash", &["stash"], stash::handle_stash),
    cmd("rebase", &["rb", "rebase"], rebase::handle_rebase),
    cmd("worktree", &["wt", "worktree"], worktree::handle_worktree),
    cmd(
        "blackboard",
        &["bb", "blackboard"],
        blackboard::handle_blackboard,
    ),
    cmd(
        "promotion",
        &["pm", "promo", "promotion"],
        promotion::handle_promotion,
    ),
    cmd("bench", &["bench", "benchmark"], bench::handle_bench),
    cmd("undo", &["undo"], undo::handle_undo),
    cmd(
        "operation",
        &["op", "operation"],
        operation::handle_operation,
    ),
    cmd("rev-list", &["rev-list"], rev_list::handle_rev_list),
    cmd(
        "verify",
        &["gate", "check", "verify"],
        verify::handle_verify,
    ),
    cmd(
        "gate-slice",
        &["gate-slice", "slice-gate"],
        gate_slice::handle_gate_slice,
    ),
    cmd("authority", &["authority", "auth"], handle_authority),
];
