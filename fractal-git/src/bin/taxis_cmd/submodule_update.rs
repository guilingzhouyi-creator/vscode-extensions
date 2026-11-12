//! Module: taxis_cmd::submodule_update — Offline Submodule Checkout at Recorded Gitlinks
//! File Path: src/bin/taxis_cmd/submodule_update.rs
//! Architecture Role: Implements `taxis submodule update`: resolves each `.gitmodules` entry to a
//!   local source repository, copies its objects, and checks out the exact gitlink commit recorded by
//!   the parent `HEAD` tree or index.
//! Dependencies & Triggers: Dispatched by `taxis_cmd::submodule` for the `update` subcommand.
//! Responsibilities: Option parsing (`--init`, `--recursive`, `--quiet`, path filters), config URL
//!   override resolution, local object transfer, detached checkout, and nested recursion.
//! Exit Semantics & Design Rationale:
//!   - A network URL fails closed with exit 69 and a `fallback_hint` instead of creating an empty
//!     directory and reporting success, because an empty submodule silently breaks every build that
//!     depends on it.
//!   - A missing local source or a gitlink commit absent from the source exits 128 naming the path.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use fg_core::models::{FileMode, Oid, SubmoduleEntry};
use fg_index::config::{read_config, set_value, ConfigKey, ConfigWriteMode};
use fg_index::submodules::GitModules;
use fg_index::GitIndex;
use fg_topology::submodule::SubmoduleController;
use fractal_git::constants::cli::CliTag;
use fractal_git::DiskRefStore;

use super::checkout::{materialize_files, remove_stale_files, update_dirc_index};
use super::common::{fail_fatal, fail_io, fail_usage, print_json, reject, CliContext};
use super::config::write_config_entry;
use super::repo_view::RepoView;
use super::submodule::collect_head_tree_gitlinks;
use super::tree_view::flatten_commit_tree;

/// Updates submodules to match recorded gitlink commits, initializing/cloning offline or failing closed on network URLs.
pub(crate) fn handle_update(ctx: &CliContext, args: &[String]) {
    let mut do_init = false;
    let mut recursive = false;
    let mut quiet = false;
    let mut filter_paths: Vec<&str> = Vec::new();
    let mut after_double_dash = false;

    for arg in args {
        if after_double_dash {
            filter_paths.push(arg.as_str());
            continue;
        }
        match arg.as_str() {
            "--" => after_double_dash = true,
            "--init" => do_init = true,
            "--recursive" => recursive = true,
            "-q" | "--quiet" => quiet = true,
            "--remote" | "--checkout" | "--rebase" | "--merge" | "-f" | "--force" => {}
            other if other.starts_with('-') => {
                fail_usage(format!("unknown option `{other}` for `submodule update`"));
            }
            other => filter_paths.push(other),
        }
    }

    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let updated_paths =
        execute_submodule_update_in_repo(ctx, &view, (do_init, recursive, quiet), &filter_paths);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "operation": "submodule_update",
            "updated_count": updated_paths.len(),
            "submodules": updated_paths,
        }));
    } else if !quiet {
        for (path, short_oid) in &updated_paths {
            println!("Submodule path '{path}': checked out '{short_oid}'");
        }
    }
}

/// Runs `submodule update` inside one repository, optionally recursing into nested submodules.
fn execute_submodule_update_in_repo(
    ctx: &CliContext,
    view: &RepoView,
    flags: (bool, bool, bool),
    filter_paths: &[&str],
) -> Vec<(String, String)> {
    let (do_init, _recursive, quiet) = flags;
    let gitmodules_path = view.work_root().join(".gitmodules");
    if !gitmodules_path.is_file() {
        return Vec::new();
    }
    let gitmodules = match GitModules::load_from_worktree(view.work_root()) {
        Ok(gm) => gm,
        Err(err) => reject(CliTag::ERROR, format!("load .gitmodules: {err}")),
    };

    if do_init {
        register_submodules_in_config(view, &gitmodules, filter_paths, quiet || ctx.json_mode);
    }

    let mut gitlinks = collect_head_tree_gitlinks(view);
    collect_index_gitlinks(view, &mut gitlinks);

    let config_entries = read_config(&view.git_dir().join("config")).unwrap_or_default();
    let mut updated_paths = Vec::new();

    for entry in gitmodules.entries().values() {
        if !filter_paths.is_empty()
            && !filter_paths.contains(&entry.path.as_str())
            && !filter_paths.contains(&entry.name.as_str())
        {
            continue;
        }
        process_single_submodule_entry(
            ctx,
            view,
            entry,
            (&config_entries, &gitlinks),
            flags,
            &mut updated_paths,
        );
    }

    updated_paths
}

/// Validates, checks out, and optionally recurses into one `.gitmodules` entry.
fn process_single_submodule_entry(
    ctx: &CliContext,
    view: &RepoView,
    entry: &SubmoduleEntry,
    repo_state: (
        &[fg_index::config::ConfigEntry],
        &BTreeMap<String, (FileMode, Oid)>,
    ),
    flags: (bool, bool, bool),
    updated_paths: &mut Vec<(String, String)>,
) {
    let (_do_init, recursive, _quiet) = flags;
    let (config_entries, gitlinks) = repo_state;
    if let Err(val_err) = SubmoduleEntry::validate_path(&entry.path) {
        reject(CliTag::ERROR, format!("invalid submodule path: {val_err}"));
    }

    let effective_url =
        lookup_submodule_config_url(config_entries, &entry.name).unwrap_or(entry.url.as_str());
    let gitlink_oid = gitlinks.get(&entry.path).map(|(_, oid)| *oid);
    let checked_oid = update_single_submodule(ctx, view, entry, effective_url, gitlink_oid);
    let hex_full = checked_oid.to_hex();
    updated_paths.push((entry.path.clone(), hex_full[..8].to_string()));

    if recursive {
        let sub_work_root = view.work_root().join(&entry.path);
        let sub_git_dir = SubmoduleController::resolve_submodule_git_dir(&sub_work_root)
            .unwrap_or_else(|| sub_work_root.join(".git"));
        if sub_work_root.join(".gitmodules").is_file() {
            let sub_ctx = CliContext {
                git_dir: sub_git_dir,
                json_mode: ctx.json_mode,
                args: Vec::new(),
            };
            if let Ok(sub_view) = RepoView::open(&sub_ctx) {
                let mut nested = execute_submodule_update_in_repo(ctx, &sub_view, flags, &[]);
                updated_paths.append(&mut nested);
            }
        }
    }
}

/// Registers `.gitmodules` URLs into `.git/config` during `submodule update --init`.
fn register_submodules_in_config(
    view: &RepoView,
    gitmodules: &GitModules,
    filter_paths: &[&str],
    suppress_print: bool,
) {
    let config_path = view.git_dir().join("config");
    for entry in gitmodules.entries().values() {
        if !filter_paths.is_empty()
            && !filter_paths.contains(&entry.path.as_str())
            && !filter_paths.contains(&entry.name.as_str())
        {
            continue;
        }
        register_single_submodule_config(&config_path, entry, suppress_print);
    }
}

/// Persists `submodule.<name>.url` into repository configuration for one `.gitmodules` entry.
fn register_single_submodule_config(
    config_path: &Path,
    entry: &SubmoduleEntry,
    suppress_print: bool,
) {
    let section = format!("submodule \"{}\"", entry.name);
    let _ = write_config_entry(config_path, &section, "url", &entry.url);
    if !suppress_print {
        println!(
            "Submodule '{}' ({}) registered for path '{}'",
            entry.name, entry.url, entry.path
        );
    }
}

/// Collects Stage-0 Gitlink entries from `.git/index` in addition to `HEAD`.
fn collect_index_gitlinks(view: &RepoView, gitlinks: &mut BTreeMap<String, (FileMode, Oid)>) {
    let Ok(index) = GitIndex::load(view.git_dir().join("index")) else {
        return;
    };
    for entry in index.entries() {
        if entry.mode == FileMode::Gitlink {
            gitlinks.insert(entry.path.clone(), (FileMode::Gitlink, entry.oid));
        }
    }
}

/// Looks up `submodule.<name>.url` from loaded repository configuration.
fn lookup_submodule_config_url<'a>(
    entries: &'a [fg_index::config::ConfigEntry],
    name: &str,
) -> Option<&'a str> {
    entries
        .iter()
        .find(|e| {
            e.key().section() == "submodule"
                && e.key().subsection() == Some(name)
                && e.key().name() == "url"
        })
        .and_then(|e| e.value())
}

/// Reports whether `url` requires an external network transport that is unavailable offline.
fn is_network_submodule_url(url: &str) -> bool {
    let trimmed = url.trim();
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.starts_with("https://")
        || lowered.starts_with("http://")
        || lowered.starts_with("ssh://")
        || lowered.starts_with("git://")
    {
        return true;
    }
    super::remote::looks_like_scp_remote(trimmed)
}

/// Resolves a local path or `file://` URL (relative to `work_root` if non-absolute) to its git metadata directory.
fn resolve_local_submodule_source(work_root: &Path, url: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(super::remote::strip_file_url_prefix(url.trim()));
    let abs = if candidate.is_absolute() {
        candidate
    } else {
        work_root.join(candidate)
    };
    let abs_str = abs.to_string_lossy();
    super::remote_sync::resolve_source_git_dir(&abs_str)
}

/// Synchronizes objects for a single submodule and checks out `target_oid` (or source HEAD if unpinned).
fn update_single_submodule(
    ctx: &CliContext,
    parent_view: &RepoView,
    entry: &SubmoduleEntry,
    effective_url: &str,
    gitlink_oid: Option<Oid>,
) -> Oid {
    let sub_work_root = parent_view.work_root().join(&entry.path);
    if is_network_submodule_url(effective_url) {
        if let Some(target_oid) = gitlink_oid {
            if let Some(existing_git_dir) =
                SubmoduleController::resolve_submodule_git_dir(&sub_work_root)
            {
                let sub_ctx = CliContext {
                    git_dir: existing_git_dir.clone(),
                    json_mode: false,
                    args: Vec::new(),
                };
                if let Ok(sub_view) = RepoView::open(&sub_ctx) {
                    if sub_view.object(&target_oid).is_ok() {
                        checkout_submodule_commit(&sub_view, target_oid);
                        return target_oid;
                    }
                }
            }
        }
        super::remote::fail_network_unavailable(
            ctx,
            "submodule update",
            effective_url,
            "Fetch/update this submodule with native `git submodule update --init` when online, or configure `submodule.<name>.url` to a local mirror path.",
        );
    }

    let Some(src_git_dir) = resolve_local_submodule_source(parent_view.work_root(), effective_url)
    else {
        fail_fatal(format!(
            "submodule '{}' local source '{}' does not exist or is not a git repository",
            entry.path, effective_url
        ));
    };

    let sub_git_dir = SubmoduleController::resolve_submodule_git_dir(&sub_work_root)
        .unwrap_or_else(|| sub_work_root.join(".git"));
    ensure_submodule_git_scaffold(&sub_work_root, &sub_git_dir, effective_url);
    super::remote_sync::copy_object_store_contents(
        &src_git_dir.join("objects"),
        &sub_git_dir.join("objects"),
    );

    let target_oid = match gitlink_oid {
        Some(oid) => oid,
        None => resolve_source_head_oid(&src_git_dir).unwrap_or_else(|| {
            fail_fatal(format!(
                "submodule '{}' has no recorded gitlink commit and source HEAD is unborn",
                entry.path
            ))
        }),
    };

    let sub_ctx = CliContext {
        git_dir: sub_git_dir,
        json_mode: false,
        args: Vec::new(),
    };
    let sub_view = match RepoView::open(&sub_ctx) {
        Ok(v) => v,
        Err(err) => fail_fatal(format!("open submodule '{}': {err}", entry.path)),
    };
    if let Err(err) = sub_view.object(&target_oid) {
        fail_fatal(format!(
            "submodule '{}' target commit {} not found in '{}': {err}",
            entry.path,
            target_oid.to_hex(),
            effective_url
        ));
    }
    checkout_submodule_commit(&sub_view, target_oid);
    target_oid
}

/// Initializes a bare `.git` directory scaffold inside the submodule worktree if absent.
fn ensure_submodule_git_scaffold(sub_work_root: &Path, sub_git_dir: &Path, url: &str) {
    if let Err(err) = fs::create_dir_all(sub_work_root) {
        fail_io("create submodule directory", err);
    }
    for subdir in ["objects/pack", "objects/info", "refs/heads", "refs/tags"] {
        if let Err(err) = fs::create_dir_all(sub_git_dir.join(subdir)) {
            fail_io("initialize submodule .git", err);
        }
    }
    let head_path = sub_git_dir.join("HEAD");
    if !head_path.is_file() {
        if let Err(err) = fs::write(&head_path, "ref: refs/heads/main\n") {
            fail_io("initialize submodule HEAD", err);
        }
    }
    let config_path = sub_git_dir.join("config");
    if !config_path.is_file() {
        let base_cfg = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n";
        if let Err(err) = fs::write(&config_path, base_cfg) {
            fail_io("write submodule config", err);
        }
    }
    if let Ok(origin_key) = ConfigKey::new("remote", Some("origin"), "url") {
        let _ = set_value(&config_path, &origin_key, url, ConfigWriteMode::Replace);
    }
}

/// Resolves the HEAD commit OID of a local submodule source repository.
fn resolve_source_head_oid(src_git_dir: &Path) -> Option<Oid> {
    let src_ctx = CliContext {
        git_dir: src_git_dir.to_path_buf(),
        json_mode: false,
        args: Vec::new(),
    };
    let view = RepoView::open(&src_ctx).ok()?;
    view.effective_head_commit()
        .ok()
        .flatten()
        .map(|(_, oid)| oid)
}

/// Checks out detached `HEAD` and materializes files/index at `target_oid` inside a submodule.
fn checkout_submodule_commit(sub_view: &RepoView, target_oid: Oid) {
    let previous_files = sub_view
        .effective_head_commit()
        .ok()
        .flatten()
        .and_then(|(_, oid)| flatten_commit_tree(sub_view, &oid).ok())
        .unwrap_or_default();
    let files = match flatten_commit_tree(sub_view, &target_oid) {
        Ok(f) => f,
        Err(err) => fail_fatal(format!(
            "flatten submodule tree {}: {err}",
            target_oid.to_hex()
        )),
    };
    if !previous_files.is_empty() {
        remove_stale_files(sub_view.work_root(), &previous_files, &files);
    }
    let entries = materialize_files(sub_view, &files);
    update_dirc_index(sub_view.git_dir(), &entries);
    if let Err(err) = DiskRefStore::new(sub_view.git_dir()).update_head_detached(&target_oid) {
        fail_io("update submodule HEAD", err);
    }
}
