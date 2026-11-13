//! Module: taxis_cmd::branch — Native Branch Hierarchy & Lifecycle Manager
//! File Path: src/bin/taxis_cmd/branch.rs
//! Architecture Role: Dispatches branch creation, listing, deletion, renaming, and topological
//!   verification across native and git backends.
//! Dependencies & Triggers: Dispatched by `taxis branch` / `taxis br`.
//! Responsibilities: Branch CRUD lifecycle, current branch detection, linked worktree markers,
//!   and multi-agent fractal ref hierarchy verification.
//! Exit Semantics & Design Rationale:
//!   - Exits 0 on successful query or mutation; exits non-zero on illegal topology or missing ref.
//!   - Synchronizes ref changes across both native TAXC container and `.git/refs/heads/`.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-TOP-001`: DAG topology traversal guard

use fg_algorithms::traverse::DagWalker;
use fg_native::sections::refs::RefRecord;
use fg_native::RepoDocument;
use fg_topology::lineage::LineageEventKind;
use fractal_git::constants::cli::CliTag;
use fractal_git::fractal::refs::validate_ref_name;
use fractal_git::{DiskRefStore, FractalRef, Oid, RefStore};

use super::branch_migrate::{
    migrate_card_branch, sync_container_ref_move, CardMigrationTarget, ContainerRefMove,
};
use super::branch_ops::{
    assert_branch_vault_healthy, create_cascade_branch, guard_branch_creation,
    guard_branch_delete, guard_branch_rename, record_branch_lineage, BranchCascadeRequest,
    BranchCreateSpec, BranchLineageEntry,
};
use super::commit_walk::parse_commit_record;
use super::common::{fail_fatal, fail_usage, print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Options for branch subcommands.
#[derive(Debug, Default)]
struct BranchOptions {
    list: bool,
    all: bool,
    remotes: bool,
    tree: bool,
    verbosity: u8,
    delete: Option<String>,
    force_delete: bool,
    rename: Option<(Option<String>, String)>,
    create: Option<(String, Option<String>)>,
    verify: Option<(String, String)>,
    cascade: Option<String>,
    facade: Option<String>,
    base: Option<String>,
    migrate: Option<(String, Option<String>)>,
}

/// Dispatches fractal branch topology verification, listing, creation, and deletion.
pub fn handle_branch(ctx: &CliContext) {
    let opts = parse_branch_options(&ctx.args);

    if let Some((src, dst)) = opts.verify {
        verify_branch_merge(&src, &dst);
        return;
    }

    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };

    if let Some((old_card, new_card)) = opts.migrate {
        migrate_card_branch(
            &view,
            CardMigrationTarget {
                old_name: &old_card,
                explicit_new: new_card.as_deref(),
            },
            ctx,
        );
        return;
    }

    if let Some(ref slug) = opts.cascade {
        let base_override = opts
            .base
            .as_deref()
            .or_else(|| opts.create.as_ref().map(|(pos, _)| pos.as_str()));
        create_cascade_branch(
            &view,
            &BranchCascadeRequest {
                slug,
                base_override,
                facade: opts.facade.as_deref(),
            },
            ctx,
        );
        return;
    }

    if let Some((old_name, new_name)) = opts.rename {
        rename_branch(&view, old_name.as_deref(), &new_name, ctx);
        return;
    }

    if let Some(target) = opts.delete {
        delete_branch(&view, &target, opts.force_delete, ctx);
        return;
    }

    if let Some((new_branch, start_point)) = opts.create {
        create_branch(&view, &new_branch, start_point.as_deref(), ctx);
        return;
    }

    let listing = super::branch_list::ListingOptions {
        all: opts.all,
        remotes: opts.remotes,
        tree: opts.tree,
        verbosity: opts.verbosity,
    };
    super::branch_list::list_branches_with_options(&view, &listing, ctx);
}

/// Parses CLI arguments into structured branch command options.
fn parse_branch_options(args: &[String]) -> BranchOptions {
    let mut opts = BranchOptions::default();

    if args.is_empty() {
        opts.list = true;
        return opts;
    }

    if args.len() >= 3 && args[0] == "verify" {
        opts.verify = Some((args[1].clone(), args[2].clone()));
        return opts;
    }

    if args[0] == "migrate" {
        if args.len() < 2 {
            fail_usage(
                "usage: taxis branch migrate <legacy-card-branch> [<canonical-card-branch>]",
            );
        }
        opts.migrate = Some((args[1].clone(), args.get(2).cloned()));
        return opts;
    }

    let mut cursor = 0;
    let mut positional: Vec<&str> = Vec::new();

    while cursor < args.len() {
        let arg = args[cursor].as_str();
        match arg {
            "-d" if cursor + 1 < args.len() => {
                opts.delete = Some(args[cursor + 1].clone());
                cursor += 1;
            }
            "-D" if cursor + 1 < args.len() => {
                opts.delete = Some(args[cursor + 1].clone());
                opts.force_delete = true;
                cursor += 1;
            }
            "-d" | "-D" => fail_usage("branch name required for delete"),
            "-m" if cursor + 2 < args.len() && !args[cursor + 1].starts_with('-') => {
                opts.rename = Some((Some(args[cursor + 1].clone()), args[cursor + 2].clone()));
                cursor += 2;
            }
            "-m" if cursor + 1 < args.len() => {
                opts.rename = Some((None, args[cursor + 1].clone()));
                cursor += 1;
            }
            "-m" => fail_usage("branch name required for rename"),
            "-a" | "--all" => {
                opts.all = true;
                opts.list = true;
            }
            "-r" | "--remotes" => {
                opts.remotes = true;
                opts.list = true;
            }
            "--tree" => {
                opts.tree = true;
                opts.list = true;
            }
            "-l" | "--list" => {
                opts.list = true;
            }
            "-v" | "--verbose" => {
                opts.verbosity = opts.verbosity.saturating_add(1).min(2);
            }
            "-vv" => {
                opts.verbosity = 2;
            }
            "--cascade" if cursor + 1 < args.len() => {
                opts.cascade = Some(args[cursor + 1].clone());
                cursor += 1;
            }
            "--cascade" => fail_usage("slug required for --cascade"),
            "--facade" if cursor + 1 < args.len() => {
                opts.facade = Some(args[cursor + 1].clone());
                cursor += 1;
            }
            "--facade" => fail_usage("facade type required for --facade"),
            "--base" if cursor + 1 < args.len() => {
                opts.base = Some(args[cursor + 1].clone());
                cursor += 1;
            }
            "--base" => fail_usage("base branch required for --base"),
            "--bypass-branch-guard" => {}
            "--bypass-reason" | "--reason" if cursor + 1 < args.len() => {
                cursor += 1;
            }
            other if !other.starts_with('-') => {
                positional.push(other);
            }
            other => fail_usage(format!("unknown option `{other}` for `branch`")),
        }
        cursor += 1;
    }

    if opts.delete.is_none()
        && opts.rename.is_none()
        && opts.cascade.is_none()
        && !positional.is_empty()
    {
        let branch_name = positional[0].to_string();
        let start_point = positional.get(1).map(|val| (*val).to_string());
        opts.create = Some((branch_name, start_point));
    } else if opts.cascade.is_some() && !positional.is_empty() && opts.base.is_none() {
        opts.base = Some(positional[0].to_string());
    } else if !opts.list && opts.delete.is_none() && opts.rename.is_none() {
        opts.list = true;
    }

    opts
}

/// Verifies whether a merge between two fractal references satisfies topological constraints.
fn verify_branch_merge(src: &str, dst: &str) {
    let src_ref = FractalRef::parse(src);
    let dst_ref = FractalRef::parse(dst);

    match (src_ref, dst_ref) {
        (Some(source_ref), Some(dest_ref)) => {
            match fg_topology::verifier::TopologyVerifier::assert_legal_merge(
                &source_ref,
                &dest_ref,
            ) {
                Ok(_) => println!(
                    "{} Merge from '{}' into '{}' is strictly legal.",
                    CliTag::VERIFY_PASS,
                    src,
                    dst
                ),
                Err(merge_err) => reject(
                    CliTag::VERIFY_FAIL,
                    format!("Merge rejected by TopologyVerifier: {}", merge_err),
                ),
            }
        }
        _ => reject(
            CliTag::ERROR,
            "Invalid fractal ref format. Expected refs/fractal/{cell}/{card}/...",
        ),
    }
}

/// Creates a new branch reference pointing to the specified start point (or HEAD).
pub(super) fn create_branch(
    view: &RepoView,
    name: &str,
    start_point: Option<&str>,
    ctx: &CliContext,
) {
    if name == "HEAD" || validate_ref_name(&format!("refs/heads/{name}")).is_err() {
        fail_fatal(format!("'{name}' is not a valid branch name"));
    }

    let target_oid = match start_point {
        Some(rev) => match view.resolve(rev) {
            Ok(oid) => oid,
            Err(err) => reject(
                CliTag::ERROR,
                format!("fatal: Cannot resolve '{rev}': {err}"),
            ),
        },
        None => match view
            .head_commit()
            .ok()
            .flatten()
            .or_else(|| view.resolve("HEAD").ok())
        {
            Some(oid) => oid,
            None => reject(CliTag::ERROR, "fatal: Not a valid object name: 'HEAD'."),
        },
    };

    let git_dir = view.git_dir();
    let parent_name = guard_branch_creation(
        view,
        &BranchCreateSpec { name, start_point },
        ctx,
    );

    let ref_store = DiskRefStore::new(git_dir);
    let full_ref = format!("refs/heads/{name}");

    if let Ok(Some(_)) = ref_store.get_ref(&full_ref) {
        reject(
            CliTag::ERROR,
            format!("fatal: A branch named '{name}' already exists."),
        );
    }

    let hook_runner = super::git_hooks::discover(git_dir, view.work_root());
    let update = super::git_hooks::ReferenceUpdate {
        previous: None,
        next: target_oid.to_hex(),
        name: full_ref.clone(),
    };
    if let Err(err_msg) =
        super::git_hooks::execute_reference_transaction(&hook_runner, &[update], || {
            ref_store
                .update_ref(&full_ref, &target_oid, None)
                .map_err(|write_err| format!("failed to write branch ref: {write_err}"))
        })
    {
        reject(CliTag::ERROR, err_msg);
    }

    // Also persist into native container if present
    let container_path = fg_native::container_path(git_dir);
    if let Ok(mut doc) = RepoDocument::load(&container_path) {
        let _ = doc.refs.upsert(RefRecord {
            name: full_ref.clone(),
            oid: target_oid,
            peeled: None,
        });
        let _ = doc.save_atomic(&container_path);
    }

    record_branch_lineage(
        git_dir,
        BranchLineageEntry {
            event_kind: LineageEventKind::Fork,
            source_ref: parent_name.as_deref().unwrap_or(""),
            target_ref: name,
            oid: target_oid,
        },
    );

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "branch_create",
            "branch": name,
            "target": target_oid.to_hex(),
        }));
    }
}

/// Deletes a local branch.
fn delete_branch(view: &RepoView, name: &str, force: bool, ctx: &CliContext) {
    let git_dir = view.git_dir();
    assert_branch_vault_healthy(git_dir);

    let current_branch = view.head_branch().ok().flatten();
    if let Some((curr, _)) = current_branch {
        if curr == name {
            reject(
                CliTag::ERROR,
                format!(
                    "error: Cannot delete branch '{name}' checked out at '{}'",
                    view.work_root().display()
                ),
            );
        }
    }

    let full_ref = format!("refs/heads/{name}");
    let ref_store = DiskRefStore::new(git_dir);

    let existing_oid = match ref_store.get_ref(&full_ref) {
        Ok(Some(oid)) => oid,
        _ => reject(CliTag::ERROR, format!("error: branch '{name}' not found")),
    };

    guard_branch_delete(git_dir, name, force);

    // Git refuses to drop a branch whose commits no other reference reaches unless it is forced.
    if !force && !is_branch_merged_into_head(view, &existing_oid) {
        reject(
            CliTag::ERROR,
            format!(
                "error: the branch '{name}' is not fully merged\nhint: If you are sure you want to delete it, run 'git branch -D {name}'\nhint: Disable this message with \"git config set advice.forceDeleteBranch false\""
            ),
        );
    }

    // Remove the loose file, the packed entry, and the branch reflog in one step under reference-transaction.
    let hook_runner = super::git_hooks::discover(git_dir, view.work_root());
    let update = super::git_hooks::ReferenceUpdate {
        previous: Some(existing_oid),
        next: "0".repeat(40),
        name: full_ref.clone(),
    };
    if let Err(err_msg) =
        super::git_hooks::execute_reference_transaction(&hook_runner, &[update], || match ref_store
            .delete_ref(&full_ref)
        {
            Ok(true) => Ok(()),
            Ok(false) => Err(format!("error: branch '{name}' not found")),
            Err(delete_err) => Err(format!("delete branch '{name}': {delete_err}")),
        })
    {
        reject(CliTag::ERROR, err_msg);
    }

    // Remove from native container if present
    let container_path = fg_native::container_path(git_dir);
    if let Ok(mut doc) = RepoDocument::load(&container_path) {
        let mut new_refs = fg_native::sections::refs::RefsSection::new();
        for r in doc.refs.records() {
            if r.name != full_ref {
                let _ = new_refs.upsert(r.clone());
            }
        }
        doc.refs = new_refs;
        let _ = doc.save_atomic(&container_path);
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "branch_delete",
            "branch": name,
            "deleted_oid": existing_oid.to_hex(),
        }));
    } else {
        println!(
            "Deleted branch {} (was {}).",
            name,
            &existing_oid.to_hex()[..7]
        );
    }
}

/// Reports whether `branch_oid` is reachable from HEAD, matching `git branch -d`'s check.
///
/// A branch that is already reachable from HEAD only removes worktree rows that can be rebuilt
/// from the surviving history, so Git deletes it without `-D`; every other branch is refused.
fn is_branch_merged_into_head(view: &RepoView, branch_oid: &Oid) -> bool {
    let Some((_, head_oid)) = view.effective_head_commit().ok().flatten() else {
        return false;
    };
    let mut parents_of = |oid: &Oid| -> Vec<Oid> {
        view.object(oid)
            .ok()
            .and_then(|object| parse_commit_record(*oid, &object.payload).ok())
            .map(|record| record.parents)
            .unwrap_or_default()
    };
    DagWalker::is_ancestor(branch_oid, &head_oid, &mut parents_of)
}

/// Renames a branch reference.
fn rename_branch(view: &RepoView, old_name: Option<&str>, new_name: &str, ctx: &CliContext) {
    let git_dir = view.git_dir();
    assert_branch_vault_healthy(git_dir);
    if new_name == "HEAD" || validate_ref_name(&format!("refs/heads/{new_name}")).is_err() {
        fail_fatal(format!("'{new_name}' is not a valid branch name"));
    }

    let effective_old = match old_name {
        Some(name) => name.to_string(),
        None => match view.head_branch() {
            Ok(Some((curr, _))) => curr,
            _ => reject(CliTag::ERROR, "fatal: No current branch to rename."),
        },
    };

    guard_branch_rename(git_dir, &effective_old, new_name);

    let ref_store = DiskRefStore::new(git_dir);
    let old_full_ref = format!("refs/heads/{effective_old}");
    let new_full_ref = format!("refs/heads/{new_name}");

    let oid = match ref_store.get_ref(&old_full_ref) {
        Ok(Some(oid)) => oid,
        _ => reject(
            CliTag::ERROR,
            format!("error: branch '{effective_old}' not found."),
        ),
    };

    if let Ok(Some(_)) = ref_store.get_ref(&new_full_ref) {
        reject(
            CliTag::ERROR,
            format!("fatal: A branch named '{new_name}' already exists."),
        );
    }

    let hook_runner = super::git_hooks::discover(git_dir, view.work_root());
    let delete_update = super::git_hooks::ReferenceUpdate {
        previous: Some(oid),
        next: "0".repeat(40),
        name: old_full_ref.clone(),
    };
    let create_update = super::git_hooks::ReferenceUpdate {
        previous: None,
        next: oid.to_hex(),
        name: new_full_ref.clone(),
    };
    let updates = [delete_update, create_update];
    if let Err(err_msg) =
        super::git_hooks::execute_reference_transaction(&hook_runner, &updates, || {
            let rename_message = format!("Branch: renamed {old_full_ref} to {new_full_ref}");
            if let Err(write_err) =
                ref_store.update_ref_with_message(&new_full_ref, &oid, None, &rename_message)
            {
                return Err(format!("rename branch '{new_name}': {write_err}"));
            }
            if let Err(delete_err) = ref_store.delete_ref(&old_full_ref) {
                return Err(format!("rename branch '{effective_old}': {delete_err}"));
            }
            Ok(())
        })
    {
        reject(CliTag::ERROR, err_msg);
    }

    let is_active = view
        .head_branch()
        .ok()
        .flatten()
        .is_some_and(|(curr, _)| curr == effective_old);
    if is_active {
        if let Err(err) = ref_store.update_head_symbolic(&new_full_ref) {
            reject(CliTag::ERROR, format!("write symbolic HEAD: {err}"));
        }
    }
    sync_container_ref_move(
        git_dir,
        &ContainerRefMove {
            old_full_ref: &old_full_ref,
            new_full_ref: &new_full_ref,
            oid,
            update_head: is_active,
        },
    );

    record_branch_lineage(
        git_dir,
        BranchLineageEntry {
            event_kind: LineageEventKind::Rename,
            source_ref: &effective_old,
            target_ref: new_name,
            oid,
        },
    );

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "branch_rename",
            "old": effective_old,
            "new": new_name,
        }));
    }
}
