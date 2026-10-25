//! Module: taxis_cmd::submodule — Native Submodule Management Command Dispatcher
//! File Path: src/bin/taxis_cmd/submodule.rs
//! Architecture Role: Implements native submodule lifecycle commands (`status`, `init`, `sync`, `add`),
//!   integrating `.gitmodules` parsing with Gitlink (160000) tree bindings and Path Jail guards.
//! Dependencies & Triggers: Dispatched by `taxis submodule`.
//! Responsibilities: Status discovery, URL synchronization, local registration, and submodule creation.
//! Exit Semantics & Design Rationale:
//!   - Strictly rejects directory traversal (`..`) or absolute paths that violate Path Jail isolation.
//!   - Accurately reports Gitlink OID alignment and dirty working tree status.

use std::collections::BTreeMap;

use fg_core::models::{FileMode, Oid, SubmoduleEntry};
use fg_index::submodules::GitModules;
use fg_topology::submodule::SubmoduleController;
use fractal_git::constants::cli::CliTag;

use super::common::{print_json, reject, CliContext};
use super::config::write_config_entry;
use super::repo_view::RepoView;
use super::tree_view::flatten_tree_for_diff;

/// Dispatches the `taxis submodule` command.
pub fn handle_submodule(ctx: &CliContext) {
    if ctx.args.is_empty() {
        handle_status(ctx, &[]);
        return;
    }

    let subcmd = ctx.args[0].as_str();
    let rest_args = &ctx.args[1..];

    match subcmd {
        "status" => handle_status(ctx, rest_args),
        "init" => handle_init(ctx, rest_args),
        "sync" => handle_sync(ctx, rest_args),
        "add" => handle_add(ctx, rest_args),
        other => reject(
            CliTag::ERROR,
            format!("unknown submodule subcommand '{other}'; supported: status, init, sync, add"),
        ),
    }
}

/// Gathers Gitlink tree entries from the current HEAD commit.
fn collect_head_tree_gitlinks(view: &RepoView) -> BTreeMap<String, (FileMode, Oid)> {
    let mut gitlinks = BTreeMap::new();
    let head_tree_oid = match view.head_commit().ok().flatten().and_then(|c| view.resolve_tree(&c.to_hex()).ok()) {
        Some((_, tree_oid)) => tree_oid,
        None => return gitlinks,
    };

    let mut tree_files = BTreeMap::new();
    if flatten_tree_for_diff(view, &head_tree_oid, "", &mut tree_files).is_ok() {
        for (path, entry) in tree_files {
            if entry.mode == FileMode::Gitlink {
                gitlinks.insert(path, (entry.mode, entry.oid));
            }
        }
    }
    gitlinks
}

fn handle_status(ctx: &CliContext, _args: &[String]) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let gitmodules = match GitModules::load_from_worktree(view.work_root()) {
        Ok(gm) => gm,
        Err(err) => reject(CliTag::ERROR, format!("load .gitmodules: {err}")),
    };

    let gitlinks = collect_head_tree_gitlinks(&view);
    let statuses = SubmoduleController::compute_status(view.work_root(), gitmodules.entries(), &gitlinks);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "operation": "submodule_status",
            "count": statuses.len(),
            "submodules": statuses,
        }));
        return;
    }

    if statuses.is_empty() {
        return;
    }

    for s in &statuses {
        let oid_display = s
            .gitlink_oid
            .as_deref()
            .or(s.head_oid.as_deref())
            .unwrap_or("0000000000000000000000000000000000000000");
        println!("{}{oid_display} {} ({})", s.status_symbol, s.path, s.name);
    }
}

fn handle_init(ctx: &CliContext, args: &[String]) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let gitmodules = match GitModules::load_from_worktree(view.work_root()) {
        Ok(gm) => gm,
        Err(err) => reject(CliTag::ERROR, format!("load .gitmodules: {err}")),
    };

    let config_path = view.git_dir().join("config");
    let mut initialized_names = Vec::new();

    let target_paths: Option<Vec<&str>> = if !args.is_empty() {
        Some(args.iter().map(|s| s.as_str()).collect())
    } else {
        None
    };

    for entry in gitmodules.entries().values() {
        if let Some(ref targets) = target_paths {
            if !targets.contains(&entry.path.as_str()) && !targets.contains(&entry.name.as_str()) {
                continue;
            }
        }

        let section = format!("submodule \"{}\"", entry.name);
        let _ = write_config_entry(&config_path, &section, "url", &entry.url);
        initialized_names.push((entry.name.clone(), entry.path.clone(), entry.url.clone()));
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "operation": "submodule_init",
            "initialized_count": initialized_names.len(),
            "submodules": initialized_names,
        }));
    } else {
        for (name, path, url) in &initialized_names {
            println!("Submodule '{name}' ({url}) registered for path '{path}'");
        }
    }
}

fn handle_sync(ctx: &CliContext, args: &[String]) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let gitmodules = match GitModules::load_from_worktree(view.work_root()) {
        Ok(gm) => gm,
        Err(err) => reject(CliTag::ERROR, format!("load .gitmodules: {err}")),
    };

    let config_path = view.git_dir().join("config");
    let mut synced_names = Vec::new();

    let target_paths: Option<Vec<&str>> = if !args.is_empty() {
        Some(args.iter().map(|s| s.as_str()).collect())
    } else {
        None
    };

    for entry in gitmodules.entries().values() {
        if let Some(ref targets) = target_paths {
            if !targets.contains(&entry.path.as_str()) && !targets.contains(&entry.name.as_str()) {
                continue;
            }
        }

        let section = format!("submodule \"{}\"", entry.name);
        let _ = write_config_entry(&config_path, &section, "url", &entry.url);

        // Also sync origin in nested submodule if present
        let sub_worktree = view.work_root().join(&entry.path);
        if let Some(sub_git) = SubmoduleController::resolve_submodule_git_dir(&sub_worktree) {
            let sub_cfg = sub_git.join("config");
            let _ = write_config_entry(&sub_cfg, "remote \"origin\"", "url", &entry.url);
        }

        synced_names.push((entry.name.clone(), entry.path.clone(), entry.url.clone()));
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "operation": "submodule_sync",
            "synced_count": synced_names.len(),
            "submodules": synced_names,
        }));
    } else {
        for (name, path, _) in &synced_names {
            println!("Synchronizing submodule url for '{name}' at '{path}'");
        }
    }
}

fn handle_add(ctx: &CliContext, args: &[String]) {
    if args.is_empty() {
        reject(CliTag::ERROR, "usage: taxis submodule add <repository> [<path>]");
    }

    let url = &args[0];
    let candidate_path = if args.len() > 1 {
        args[1].clone()
    } else {
        derive_path_from_url(url)
    };

    if let Err(val_err) = SubmoduleEntry::validate_path(&candidate_path) {
        reject(CliTag::ERROR, format!("invalid submodule path: {val_err}"));
    }

    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let mut gitmodules = GitModules::load_from_worktree(view.work_root()).unwrap_or_else(|_| GitModules::new());
    let entry = match SubmoduleEntry::new(candidate_path.clone(), candidate_path.clone(), url.clone()) {
        Ok(e) => e,
        Err(err) => reject(CliTag::ERROR, format!("create submodule entry: {err}")),
    };

    gitmodules.insert(entry);
    if let Err(write_err) = gitmodules.write_to_worktree(view.work_root()) {
        reject(CliTag::ERROR, format!("write .gitmodules: {write_err}"));
    }

    let config_path = view.git_dir().join("config");
    let section = format!("submodule \"{}\"", candidate_path);
    let _ = write_config_entry(&config_path, &section, "url", url);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "operation": "submodule_add",
            "path": candidate_path,
            "url": url,
            "status": "added",
        }));
    } else {
        println!("Added submodule '{candidate_path}' ({url})");
    }
}

fn derive_path_from_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/').trim_end_matches(".git");
    match trimmed.rsplit(['/', '\\']).next() {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => "submodule".to_string(),
    }
}
