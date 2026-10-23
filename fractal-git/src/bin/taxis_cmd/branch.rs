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

use std::fs;

use fg_native::sections::refs::RefRecord;
use fg_native::RepoDocument;
use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, FractalRef, RefStore, TopologyVerifier};

use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Options for branch subcommands.
#[derive(Debug, Default)]
struct BranchOptions {
    list: bool,
    delete: Option<String>,
    force_delete: bool,
    rename: Option<(Option<String>, String)>,
    create: Option<(String, Option<String>)>,
    verify: Option<(String, String)>,
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
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };

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

    list_branches(&view, ctx);
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

    let mut cursor = 0;
    let mut positional = Vec::new();

    while cursor < args.len() {
        let arg = &args[cursor];
        match arg.as_str() {
            "-d" if cursor + 1 < args.len() => {
                opts.delete = Some(args[cursor + 1].clone());
                cursor += 1;
            }
            "-D" if cursor + 1 < args.len() => {
                opts.delete = Some(args[cursor + 1].clone());
                opts.force_delete = true;
                cursor += 1;
            }
            "-m" if cursor + 2 < args.len() => {
                opts.rename = Some((Some(args[cursor + 1].clone()), args[cursor + 2].clone()));
                cursor += 2;
            }
            "-m" if cursor + 1 < args.len() => {
                opts.rename = Some((None, args[cursor + 1].clone()));
                cursor += 1;
            }
            "-a" | "--all" | "-l" | "--list" => {
                opts.list = true;
            }
            other if !other.starts_with('-') => {
                positional.push(other.to_string());
            }
            _ => {}
        }
        cursor += 1;
    }

    if opts.delete.is_none() && opts.rename.is_none() && !positional.is_empty() {
        let branch_name = positional[0].clone();
        let start_point = positional.get(1).cloned();
        opts.create = Some((branch_name, start_point));
    }

    opts
}

/// Verifies whether a merge between two fractal references satisfies topological constraints.
fn verify_branch_merge(src: &str, dst: &str) {
    let src_ref = FractalRef::parse(src);
    let dst_ref = FractalRef::parse(dst);

    match (src_ref, dst_ref) {
        (Some(source_ref), Some(dest_ref)) => {
            match TopologyVerifier::assert_legal_merge(&source_ref, &dest_ref) {
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
fn create_branch(view: &RepoView, name: &str, start_point: Option<&str>, ctx: &CliContext) {
    if name.is_empty() || name.contains(' ') || name.contains('~') || name.contains('^') {
        reject(
            CliTag::ERROR,
            format!("fatal: '{name}' is not a valid branch name."),
        );
    }

    let target_oid = match start_point {
        Some(rev) => match view.resolve(rev) {
            Ok(oid) => oid,
            Err(err) => reject(
                CliTag::ERROR,
                format!("fatal: Cannot resolve '{rev}': {err}"),
            ),
        },
        None => match view.head_commit() {
            Ok(Some(oid)) => oid,
            _ => reject(CliTag::ERROR, "fatal: Not a valid object name: 'HEAD'."),
        },
    };

    let git_dir = view.git_dir();
    let ref_store = DiskRefStore::new(git_dir);
    let full_ref = format!("refs/heads/{name}");

    if let Ok(Some(_)) = ref_store.get_ref(&full_ref) {
        reject(
            CliTag::ERROR,
            format!("fatal: A branch named '{name}' already exists."),
        );
    }

    if let Err(write_err) = ref_store.update_ref(&full_ref, &target_oid, None) {
        reject(
            CliTag::ERROR,
            format!("failed to write branch ref: {write_err}"),
        );
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

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "branch_create",
            "branch": name,
            "target": target_oid.to_hex(),
        }));
    } else {
        println!("Created branch '{}' at {}", name, &target_oid.to_hex()[..8]);
    }
}

/// Deletes a local branch.
fn delete_branch(view: &RepoView, name: &str, _force: bool, ctx: &CliContext) {
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

    let git_dir = view.git_dir();
    let full_ref = format!("refs/heads/{name}");
    let ref_store = DiskRefStore::new(git_dir);

    let existing_oid = match ref_store.get_ref(&full_ref) {
        Ok(Some(oid)) => oid,
        _ => reject(CliTag::ERROR, format!("error: branch '{name}' not found.")),
    };

    // Remove loose ref file
    let loose_ref_path = git_dir.join("refs").join("heads").join(name);
    let _ = fs::remove_file(loose_ref_path);

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
            &existing_oid.to_hex()[..8]
        );
    }
}

/// Renames a branch reference.
fn rename_branch(view: &RepoView, old_name: Option<&str>, new_name: &str, ctx: &CliContext) {
    let effective_old = match old_name {
        Some(name) => name.to_string(),
        None => match view.head_branch() {
            Ok(Some((curr, _))) => curr,
            _ => reject(CliTag::ERROR, "fatal: No current branch to rename."),
        },
    };

    let git_dir = view.git_dir();
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

    let _ = ref_store.update_ref(&new_full_ref, &oid, None);
    let _ = fs::remove_file(git_dir.join("refs").join("heads").join(&effective_old));

    // If active branch was renamed, update HEAD
    if let Ok(Some((curr, _))) = view.head_branch() {
        if curr == effective_old {
            let head_file = git_dir.join("HEAD");
            let _ = fs::write(head_file, format!("ref: refs/heads/{new_name}\n"));
        }
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "branch_rename",
            "old": effective_old,
            "new": new_name,
        }));
    } else {
        println!("Renamed branch '{}' to '{}'.", effective_old, new_name);
    }
}

/// Prints local branches, marking HEAD with `*` and linked worktrees with `+`.
pub fn list_branches(view: &RepoView, ctx: &CliContext) {
    let current = match view.head_branch() {
        Ok(state) => state,
        Err(head_err) => reject(CliTag::ERROR, head_err),
    };
    let unborn = current
        .as_ref()
        .filter(|(_, target)| target.is_none())
        .map(|(name, _)| name.clone());
    let listed = match view.branches() {
        Ok(branches) => branches,
        Err(list_err) => reject(CliTag::ERROR, list_err),
    };
    let elsewhere: Vec<String> = view.linked_worktree_branches();

    if ctx.json_mode {
        let rendered: Vec<serde_json::Value> = listed
            .iter()
            .map(|(name, oid)| {
                serde_json::json!({
                    "name": name,
                    "oid": oid.to_hex(),
                    "current": current.as_ref().is_some_and(|(head, _)| head == name),
                })
            })
            .collect();
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "branch",
            "branch_count": rendered.len(),
            "branches": rendered,
        }));
        return;
    }

    let mut names: Vec<(String, char)> = listed
        .iter()
        .map(|(name, _)| {
            let marker = if current.as_ref().is_some_and(|(head, _)| head == name) {
                '*'
            } else if elsewhere.contains(name) {
                '+'
            } else {
                ' '
            };
            (name.clone(), marker)
        })
        .collect();
    if let Some(name) = unborn {
        names.push((name, '*'));
        names.sort_by(|left, right| left.0.cmp(&right.0));
    }
    for (name, marker) in names {
        println!("{marker} {name}");
    }
}
