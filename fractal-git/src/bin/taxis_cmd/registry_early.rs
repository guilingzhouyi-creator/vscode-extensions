//! Module: taxis_cmd::registry_early — Startup, Projection, and Staging Commands
//! File Path: src/bin/taxis_cmd/registry_early.rs
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
    branch, commit, diff, doctor, hash_object, index_plumbing, init, inspect, install, list_files,
    policy, projection, read, refs, relocate, stage, status, uninstall,
};

use super::registry::{cmd, CommandSpec};

/// Commands in this range of the authoritative table.
pub(crate) const TABLE: &[CommandSpec] = &[
    cmd("init", &[], init::handle_init),
    cmd("policy", &[], policy::handle_policy),
    cmd("install", &[], install::handle_install),
    cmd("uninstall", &[], uninstall::handle_uninstall),
    cmd("doctor", &[], doctor::handle_doctor),
    cmd("relocate", &[], relocate::handle_relocate),
    cmd("git-export", &["export"], projection::handle_git_export),
    cmd("git-import", &["import"], projection::handle_git_import),
    cmd("status", &["st"], status::handle_status),
    cmd("add", &[], stage::handle_add),
    cmd("rm", &[], stage::handle_rm),
    cmd("mv", &[], stage::handle_mv),
    cmd("restore", &[], stage::handle_restore),
    cmd("branch", &["br"], branch::handle_branch),
    cmd("commit", &["ci"], commit::handle_commit),
    cmd("diff", &["di"], diff::handle_diff),
    cmd("hash-object", &[], hash_object::handle_hash_object),
    cmd("write-tree", &[], index_plumbing::handle_write_tree),
    cmd("commit-tree", &[], index_plumbing::handle_commit_tree),
    cmd("update-index", &[], index_plumbing::handle_update_index),
    cmd(
        "rev-parse",
        &["rev-parse"],
        index_plumbing::handle_rev_parse,
    ),
    cmd("cat-file", &["cat-file"], read::handle_cat_file),
    cmd("ls-tree", &["ls-tree"], read::handle_ls_tree),
    cmd("ls-files", &["ls-files"], list_files::handle_ls_files),
    cmd("show-ref", &["show-ref"], read::handle_show_ref),
    cmd("for-each-ref", &["for-each-ref"], read::handle_for_each_ref),
    cmd("update-ref", &["update-ref"], refs::handle_update_ref),
    cmd("symbolic-ref", &["symbolic-ref"], refs::handle_symbolic_ref),
    cmd("merge-base", &["merge-base"], refs::handle_merge_base),
    cmd("reflog", &["reflog"], refs::handle_reflog),
    cmd("grep", &["grep"], inspect::handle_grep),
    cmd("shortlog", &["shortlog"], inspect::handle_shortlog),
    cmd("describe", &["describe"], inspect::handle_describe),
    cmd(
        "count-objects",
        &["count-objects"],
        inspect::handle_count_objects,
    ),
    cmd("check-attr", &["check-attr"], inspect::handle_check_attr),
    cmd("var", &["var"], inspect::handle_var),
];
