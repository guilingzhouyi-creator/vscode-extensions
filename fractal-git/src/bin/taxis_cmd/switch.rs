//! Module: taxis_cmd::switch — Branch Switching Options and Orphan/Detach Transitions
//! File Path: src/bin/taxis_cmd/switch.rs
//! Architecture Role: Parses `taxis switch` / `taxis sw` (`-c`, `-C`, `-d`/`--detach`,
//!   `--orphan`, `-`) and owns the HEAD transitions that `checkout` shares with it: orphan branch
//!   creation, previous-branch resolution, and `PREV_HEAD` bookkeeping.
//! Dependencies & Triggers: Dispatched by the `switch`/`sw` registry entry; `checkout` reuses the
//!   orphan, branch-name validation, and flag-value helpers.
//! Responsibilities: Reject unknown switch options and conflicting mode combinations, refuse a bare
//!   commit without `--detach` the way Git does, and hand validated options to the shared
//!   materialization path in `taxis_cmd::checkout`.
//! Exit Semantics & Design Rationale:
//!   - `switch -c <name>` creates the branch instead of treating `-c` as a branch name; invalid
//!     combinations exit with a usage error before any file is touched.
//!   - `PREV_HEAD` is written only when the target differs from the current branch or commit, so
//!     `switch -` keeps returning to the branch the user actually came from.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use fg_core::models::Oid;
use fg_native::sections::head::HeadState as NativeHeadState;
use fg_native::RepoDocument;
use fractal_git::constants::cli::CliTag;
use fractal_git::fractal::refs::validate_ref_name;
use fractal_git::DiskRefStore;

use super::checkout::{
    check_switch_conflicts, execute_checkout_or_switch, remove_stale_files, update_dirc_index,
    CheckoutOptions,
};
use super::common::{fail_fatal, fail_io, fail_usage, reject, CliContext};
use super::repo_view::RepoView;
use super::tree_view::flatten_commit_tree;

/// Dispatches the `switch` command (`taxis switch` / `taxis sw`).
pub fn handle_switch(ctx: &CliContext) {
    if ctx.args.is_empty() {
        fail_usage("git switch [<options>] <branch>");
    }
    let opts = parse_switch_options(&ctx.args);
    execute_checkout_or_switch(ctx, opts);
}

/// Resolves `-` / `@{-1}` via `.git/PREV_HEAD`, failing cleanly when no previous branch exists.
pub(crate) fn resolve_previous_head_target(view: &RepoView, opts: &mut CheckoutOptions) {
    let prev_path = view.git_dir().join("PREV_HEAD");
    if let Ok(prev_str) = fs::read_to_string(&prev_path) {
        let trimmed = prev_str.trim();
        if !trimmed.is_empty() {
            opts.target = trimmed.to_string();
            return;
        }
    }
    if opts.is_switch {
        fail_fatal("invalid reference: @{-1}");
    }
}

/// Validates that `new_branch` is a legal branch name.
pub(crate) fn validate_new_branch_name(new_branch: &str) {
    let full_ref = format!("refs/heads/{new_branch}");
    if new_branch == "HEAD" || validate_ref_name(&full_ref).is_err() {
        fail_fatal(format!("'{new_branch}' is not a valid branch name"));
    }
}

/// Verifies bare `switch <target>` names an existing branch rather than a bare commit OID.
pub(crate) fn assert_switch_branch_target(view: &RepoView, target: &str) {
    if view
        .branches()
        .is_ok_and(|list| list.iter().any(|(name, _)| name == target))
    {
        return;
    }
    if view.resolve(target).is_ok() {
        fail_fatal(format!(
            "a branch is expected, got commit '{target}'\nIf you want to detach HEAD at the commit, try again with --detach."
        ));
    }
    reject(CliTag::ERROR, format!("invalid reference: {target}"));
}

/// Switches HEAD to an unborn orphan branch; `switch --orphan` clears tracked files while `checkout --orphan` keeps them.
pub(crate) fn execute_orphan_branch(view: &RepoView, opts: &CheckoutOptions, branch: &str) {
    validate_new_branch_name(branch);
    if view
        .branches()
        .is_ok_and(|list| list.iter().any(|(name, _)| name == branch))
    {
        reject(
            CliTag::ERROR,
            format!("fatal: a branch named '{branch}' already exists"),
        );
    }

    if opts.is_switch {
        let head_oid_opt = view
            .head_commit()
            .ok()
            .flatten()
            .or_else(|| view.resolve("HEAD").ok());
        let current_files = head_oid_opt
            .as_ref()
            .and_then(|head_oid| flatten_commit_tree(view, head_oid).ok())
            .unwrap_or_default();
        let empty = BTreeMap::new();
        let _ = check_switch_conflicts(view, &current_files, &empty, opts.force);
        remove_stale_files(view.work_root(), &current_files, &empty);
        update_dirc_index(view.git_dir(), &[]);
    }

    let ref_store = DiskRefStore::new(view.git_dir());
    record_prev_head(view.git_dir(), &ref_store, Some(branch), None);
    let sym_target = format!("refs/heads/{branch}");
    if let Err(err) = ref_store.update_head_symbolic(&sym_target) {
        fail_io("update symbolic HEAD for orphan branch", err);
    }
    let container_path = fg_native::container_path(view.git_dir());
    if container_path.is_file() {
        if let Ok(mut doc) = RepoDocument::load(&container_path) {
            doc.head = NativeHeadState::Symbolic { target: sym_target };
            let _ = doc.save_atomic(&container_path);
        }
    }
    if !opts.quiet {
        eprintln!("Switched to a new branch '{branch}'");
    }
}

/// Records the active branch or OID into `PREV_HEAD` when switching to a different branch or commit.
pub(crate) fn record_prev_head(
    git_dir: &Path,
    ref_store: &DiskRefStore,
    next_branch: Option<&str>,
    next_oid: Option<Oid>,
) {
    if let Ok(head_state) = ref_store.head() {
        let (prev_name, is_same_target) = match head_state {
            fg_topology::refs::HeadState::Symbolic { name, .. } => {
                let short = name
                    .strip_prefix("refs/heads/")
                    .unwrap_or(&name)
                    .to_string();
                let next_short = next_branch.map(|b| b.strip_prefix("refs/heads/").unwrap_or(b));
                let same = next_short == Some(short.as_str());
                (short, same)
            }
            fg_topology::refs::HeadState::Detached(oid) => {
                let same = next_branch.is_none() && next_oid == Some(oid);
                (oid.to_hex(), same)
            }
            fg_topology::refs::HeadState::Absent => (String::new(), true),
        };
        if !prev_name.is_empty() && !is_same_target {
            let _ = fs::write(git_dir.join("PREV_HEAD"), format!("{prev_name}\n"));
        }
    }
}

/// Consumes a required flag argument, calling `fail_usage` if none follows.
pub(crate) fn take_flag_value<'a>(args: &'a [String], cursor: &mut usize, flag: &str) -> &'a str {
    let Some(val) = args.get(*cursor + 1) else {
        fail_usage(format!("option `{flag}` requires a value"));
    };
    *cursor += 2;
    val.as_str()
}

/// Parses command-line arguments for `taxis switch`.
pub(crate) fn parse_switch_options(args: &[String]) -> CheckoutOptions {
    let mut new_branch: Option<&str> = None;
    let mut orphan: Option<&str> = None;
    let mut force_create = false;
    let mut detach = false;
    let mut force = false;
    let mut quiet = false;
    let mut target: Option<&str> = None;
    let mut after_double_dash = false;
    let mut cursor = 0;

    while cursor < args.len() {
        let arg = args[cursor].as_str();
        if after_double_dash {
            assign_switch_positional(&mut target, arg);
            cursor += 1;
            continue;
        }
        match arg {
            "--" => {
                after_double_dash = true;
                cursor += 1;
            }
            "-f" | "--force" | "--discard-changes" => {
                force = true;
                cursor += 1;
            }
            "-q" | "--quiet" => {
                quiet = true;
                cursor += 1;
            }
            "-d" | "--detach" => {
                detach = true;
                cursor += 1;
            }
            "-m"
            | "--merge"
            | "--guess"
            | "--no-guess"
            | "--track"
            | "--no-track"
            | "--progress"
            | "--no-progress"
            | "--ignore-other-worktrees" => {
                cursor += 1;
            }
            "-c" | "--create" => {
                new_branch = Some(take_flag_value(args, &mut cursor, arg));
            }
            "-C" | "--force-create" => {
                new_branch = Some(take_flag_value(args, &mut cursor, arg));
                force_create = true;
            }
            "--orphan" => {
                orphan = Some(take_flag_value(args, &mut cursor, arg));
            }
            _ if arg.starts_with("--create=") => {
                new_branch = Some(&arg["--create=".len()..]);
                cursor += 1;
            }
            _ if arg.starts_with("--force-create=") => {
                new_branch = Some(&arg["--force-create=".len()..]);
                force_create = true;
                cursor += 1;
            }
            _ if arg.starts_with("--orphan=") => {
                orphan = Some(&arg["--orphan=".len()..]);
                cursor += 1;
            }
            _ if arg.starts_with('-') && arg != "-" => {
                fail_usage(format!("unknown option `{arg}` for `switch`"));
            }
            _ => {
                assign_switch_positional(&mut target, arg);
                cursor += 1;
            }
        }
    }

    validate_switch_mode_combination(new_branch, detach, orphan, target);
    let resolved_target = target.unwrap_or("HEAD").to_string();
    CheckoutOptions {
        target: resolved_target,
        new_branch: new_branch.map(str::to_string),
        force_create,
        detach,
        orphan: orphan.map(str::to_string),
        force,
        quiet,
        is_switch: true,
        was_reset: false,
    }
}

/// Records the single allowed positional operand for `taxis switch`.
fn assign_switch_positional<'a>(target: &mut Option<&'a str>, value: &'a str) {
    if target.is_some() {
        fail_usage("git switch takes at most one branch or commit argument");
    }
    *target = Some(value);
}

/// Validates mutually exclusive mode combinations for `taxis switch`.
fn validate_switch_mode_combination(
    new_branch: Option<&str>,
    detach: bool,
    orphan: Option<&str>,
    target: Option<&str>,
) {
    let mode_count =
        usize::from(new_branch.is_some()) + usize::from(detach) + usize::from(orphan.is_some());
    if mode_count > 1 {
        fail_usage("options '-c/-C', '-d/--detach', and '--orphan' cannot be used together");
    }
    if orphan.is_some() && target.is_some() {
        fail_usage("option '--orphan' cannot be combined with a start-point");
    }
    if mode_count == 0 && target.is_none() {
        fail_usage("missing branch name to switch to");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_switch_create_force_detach_and_orphan() {
        let s1 = parse_switch_options(&["-c".to_string(), "feat".to_string()]);
        assert_eq!(s1.new_branch.as_deref(), Some("feat"));
        assert_eq!(s1.target, "HEAD");
        assert!(!s1.force_create);
        assert!(s1.is_switch);

        let s2 = parse_switch_options(&["-C".to_string(), "feat".to_string(), "main".to_string()]);
        assert_eq!(s2.new_branch.as_deref(), Some("feat"));
        assert_eq!(s2.target, "main");
        assert!(s2.force_create);

        let s3 = parse_switch_options(&["--detach".to_string(), "HEAD~1".to_string()]);
        assert!(s3.detach);
        assert_eq!(s3.target, "HEAD~1");

        let s4 = parse_switch_options(&["--orphan".to_string(), "gh-pages".to_string()]);
        assert_eq!(s4.orphan.as_deref(), Some("gh-pages"));
    }
}
