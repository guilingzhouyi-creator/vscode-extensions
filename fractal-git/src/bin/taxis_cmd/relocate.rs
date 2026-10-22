//! Module: taxis_cmd::relocate — Repository Layout Migration
//! File Path: src/bin/taxis_cmd/relocate.rs
//! Architecture Role: Moves one repository between the two physical layouts the format defines:
//!   a real directory inside the workspace, and a link to a store under the home root.
//! Dependencies & Triggers: Dispatched by `taxis relocate`; reads the container to learn the
//!   repository id, and drives `fg-native`'s layout and junction primitives.
//! Responsibilities: Resolve the current layout, verify the move is possible, move the bytes, and
//!   replace the workspace entry with the opposite kind.
//! Exit Semantics & Design Rationale:
//!   - The move happens before the link is created, and the reverse order is never used. Creating
//!     the link first would leave two reachable copies of the same repository for the duration of
//!     the copy, and a crash in that window would make the store and the workspace disagree about
//!     which one is authoritative.
//!   - A failure after the bytes have moved is rolled back by moving them back. The one outcome
//!     this must never produce is a workspace with neither a directory nor a working link, because
//!     that state reads as "repository deleted" to every other command.
//!   - The destination is refused when it already holds a container. Overwriting would discard an
//!     unrelated repository's identity, and the store path is derived from an id the caller did not
//!     necessarily intend to reuse.
//!   - Relocation is refused while the workspace entry is an orphaned link. The bytes are gone, so
//!     there is nothing to move; reporting that plainly is more useful than recreating an empty
//!     store that would silently replace the lost data.

use std::path::{Path, PathBuf};

use fg_native::{LayoutMode, PhysicalLayout, RepoDocument};

use super::common::{print_json, reject, CliContext};
use fractal_git::constants::cli::CliTag;

/// Which layout the caller asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Target {
    /// Move the bytes into a store under the home root and leave a link behind.
    Store,
    /// Move the bytes back into the workspace and remove the link.
    Workspace,
}

/// Parsed arguments for one `relocate` invocation.
struct RelocateRequest {
    workspace_root: PathBuf,
    target: Target,
    home_root: Option<PathBuf>,
}

/// Dispatches `taxis relocate`.
pub fn handle_relocate(ctx: &CliContext) {
    let request = match parse_request(ctx) {
        Ok(parsed) => parsed,
        Err(reason) => reject(CliTag::ERROR, reason),
    };

    let outcome = match request.target {
        Target::Store => move_to_store(&request),
        Target::Workspace => move_to_workspace(&request),
    };
    let outcome = match outcome {
        Ok(report) => report,
        Err(reason) => reject(CliTag::ERROR, reason),
    };

    report(ctx, &request, &outcome);
}

/// Parses and validates the `relocate` argument list.
fn parse_request(ctx: &CliContext) -> Result<RelocateRequest, String> {
    let mut to_store = false;
    let mut to_workspace = false;
    let mut workspace_root: Option<PathBuf> = None;
    let mut home_root: Option<PathBuf> = None;

    let mut argument_cursor = 0;
    while argument_cursor < ctx.args.len() {
        let argument = ctx.args[argument_cursor].as_str();
        match argument {
            "--to-store" => to_store = true,
            "--to-workspace" => to_workspace = true,
            "--workspace" => {
                let value = ctx
                    .args
                    .get(argument_cursor + 1)
                    .ok_or_else(|| "--workspace requires a directory path".to_owned())?;
                workspace_root = Some(PathBuf::from(value));
                argument_cursor += 1;
            }
            "--home" => {
                let value = ctx
                    .args
                    .get(argument_cursor + 1)
                    .ok_or_else(|| "--home requires a directory path".to_owned())?;
                home_root = Some(PathBuf::from(value));
                argument_cursor += 1;
            }
            other if other.starts_with('-') => {
                return Err(format!("unknown relocate flag '{other}'"));
            }
            _ => {}
        }
        argument_cursor += 1;
    }

    if to_store == to_workspace {
        return Err("relocate requires exactly one of --to-store or --to-workspace".to_owned());
    }

    let resolved_root = match workspace_root {
        Some(explicit) => explicit,
        None => std::env::current_dir()
            .map_err(|cwd_err| format!("resolve the current directory: {cwd_err}"))?,
    };

    Ok(RelocateRequest {
        workspace_root: resolved_root,
        target: if to_store {
            Target::Store
        } else {
            Target::Workspace
        },
        home_root,
    })
}

/// What one relocation actually did.
struct RelocateOutcome {
    from: LayoutMode,
    to: LayoutMode,
    repository_dir: PathBuf,
    repo_id_hex: String,
    moved_bytes: bool,
}

/// Moves a workspace-directory repository into a store and leaves a link behind.
fn move_to_store(request: &RelocateRequest) -> Result<RelocateOutcome, String> {
    let current = fg_native::classify_workspace_entry(&request.workspace_root)
        .map_err(|classify_err| format!("classify the workspace entry: {classify_err}"))?;

    let source_dir = match &current {
        PhysicalLayout::Directory => request.workspace_root.join(fg_native::WORKSPACE_DIR_NAME),
        PhysicalLayout::Absent => {
            return Err("no repository in this workspace: .taxis is absent".to_owned())
        }
        PhysicalLayout::Linked { target } => {
            return Err(format!(
                "already linked to '{}'; nothing to move",
                target.display()
            ))
        }
        PhysicalLayout::OrphanedLink { target } => {
            return Err(format!(
                "the workspace link points at '{}', which no longer exists; \
                 the repository bytes are gone and cannot be relocated",
                target.display()
            ))
        }
    };

    let document = RepoDocument::load(&fg_native::container_path(&source_dir))
        .map_err(|load_err| format!("read the container before moving it: {load_err}"))?;

    let home_root = resolve_home_root(request)?;
    let store_dir = fg_native::store_path(&home_root, &document.meta.repo_id);

    if fg_native::container_path(&store_dir).exists() {
        return Err(format!(
            "the destination store '{}' already holds a repository; refusing to overwrite it",
            store_dir.display()
        ));
    }

    if let Some(parent) = store_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|create_err| {
            format!("create the store root '{}': {create_err}", parent.display())
        })?;
    }

    // Move first: until the bytes land, the workspace still holds the only copy.
    std::fs::rename(&source_dir, &store_dir).map_err(|move_err| {
        format!(
            "move '{}' to '{}': {move_err}",
            source_dir.display(),
            store_dir.display()
        )
    })?;

    // From here the bytes live in the store. Any failure must put them back, because a workspace
    // with neither a directory nor a working link reads as a deleted repository.
    let link_result = create_link(&request.workspace_root, &store_dir);
    if let Err(link_err) = link_result {
        let restored = std::fs::rename(&store_dir, &source_dir);
        let recovery = match restored {
            Ok(()) => "the repository was moved back into the workspace".to_owned(),
            Err(restore_err) => format!(
                "moving it back also failed ({restore_err}); the bytes are intact at '{}'",
                store_dir.display()
            ),
        };
        return Err(format!("create the workspace link: {link_err}; {recovery}"));
    }

    Ok(RelocateOutcome {
        from: LayoutMode::Dev,
        to: LayoutMode::Release,
        repository_dir: store_dir,
        repo_id_hex: document.meta.repo_id_hex(),
        moved_bytes: true,
    })
}

/// Moves a store-backed repository back into the workspace and removes the link.
fn move_to_workspace(request: &RelocateRequest) -> Result<RelocateOutcome, String> {
    let current = fg_native::classify_workspace_entry(&request.workspace_root)
        .map_err(|classify_err| format!("classify the workspace entry: {classify_err}"))?;

    let store_dir = match &current {
        PhysicalLayout::Linked { target } => target.clone(),
        PhysicalLayout::Directory => {
            return Err("already a directory in the workspace; nothing to move".to_owned())
        }
        PhysicalLayout::Absent => {
            return Err("no repository in this workspace: .taxis is absent".to_owned())
        }
        PhysicalLayout::OrphanedLink { target } => {
            return Err(format!(
                "the workspace link points at '{}', which no longer exists; \
                 there are no bytes to move back",
                target.display()
            ))
        }
    };

    let document = RepoDocument::load(&fg_native::container_path(&store_dir))
        .map_err(|load_err| format!("read the container in the store: {load_err}"))?;

    let entry_path = request.workspace_root.join(fg_native::WORKSPACE_DIR_NAME);
    let staging_dir = request.workspace_root.join(format!(
        "{}.relocate-staging",
        fg_native::WORKSPACE_DIR_NAME
    ));

    // The link is removed before the bytes land, because the destination path must be free. The
    // store keeps the only copy until the rename completes, so this window is safe.
    remove_link(&entry_path)?;

    // Copy rather than rename across volumes: a store under the home root is frequently on a
    // different drive than the workspace, where rename fails with a cross-device error.
    if let Err(copy_err) = copy_tree(&store_dir, &staging_dir) {
        let recovery = recreate_link(&request.workspace_root, &store_dir);
        return Err(format!(
            "copy the repository back into the workspace: {copy_err}; {recovery}"
        ));
    }

    if let Err(rename_err) = std::fs::rename(&staging_dir, &entry_path) {
        let _ = std::fs::remove_dir_all(&staging_dir);
        let recovery = recreate_link(&request.workspace_root, &store_dir);
        return Err(format!(
            "publish the copied repository: {rename_err}; {recovery}"
        ));
    }

    // The workspace now holds a complete copy. Removing the store is the last step, and a failure
    // here leaves a redundant copy rather than a missing repository.
    let store_removed = std::fs::remove_dir_all(&store_dir).is_ok();

    Ok(RelocateOutcome {
        from: LayoutMode::Release,
        to: LayoutMode::Dev,
        repository_dir: entry_path,
        repo_id_hex: document.meta.repo_id_hex(),
        moved_bytes: store_removed,
    })
}

/// Resolves the home root the store lives under.
fn resolve_home_root(request: &RelocateRequest) -> Result<PathBuf, String> {
    if let Some(explicit) = request.home_root.clone() {
        return Ok(explicit);
    }
    if let Some(home) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(home));
    }
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| "cannot resolve the home directory; pass --home".to_owned())
}

/// Creates the workspace entry pointing at `store_dir`.
#[cfg(windows)]
fn create_link(workspace_root: &Path, store_dir: &Path) -> Result<(), String> {
    fg_native::create_junction(
        &workspace_root.join(fg_native::WORKSPACE_DIR_NAME),
        store_dir,
    )
    .map_err(|link_err| link_err.to_string())
}

/// Creates the workspace entry pointing at `store_dir`.
#[cfg(unix)]
fn create_link(workspace_root: &Path, store_dir: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(
        store_dir,
        workspace_root.join(fg_native::WORKSPACE_DIR_NAME),
    )
    .map_err(|link_err| link_err.to_string())
}

/// Removes the workspace entry, which is a link in the release layout.
///
/// On Windows a junction is removed with `remove_dir`; `remove_file` fails because the filesystem
/// reports the entry as a directory.
fn remove_link(entry_path: &Path) -> Result<(), String> {
    std::fs::remove_dir(entry_path).map_err(|remove_err| {
        format!(
            "remove the workspace link '{}': {remove_err}",
            entry_path.display()
        )
    })
}

/// Recreates the workspace link after a failed move, reporting what happened either way.
fn recreate_link(workspace_root: &Path, store_dir: &Path) -> String {
    match create_link(workspace_root, store_dir) {
        Ok(()) => "the workspace link was restored".to_owned(),
        Err(link_err) => format!(
            "restoring the workspace link also failed ({link_err}); the repository is intact at '{}'",
            store_dir.display()
        ),
    }
}

/// Copies a directory tree, preserving the files a repository consists of.
///
/// A recursive copy is used rather than a rename because the store and the workspace are frequently
/// on different volumes, where rename fails with a cross-device error.
fn copy_tree(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let entry_path = entry.path();
        let target_path = destination.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_tree(&entry_path, &target_path)?;
        } else {
            std::fs::copy(&entry_path, &target_path)?;
        }
    }
    Ok(())
}

/// Prints the outcome of a successful relocation.
fn report(ctx: &CliContext, request: &RelocateRequest, outcome: &RelocateOutcome) {
    let from_class = layout_class(outcome.from);
    let to_class = layout_class(outcome.to);

    if ctx.json_mode {
        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "relocate",
            "from": from_class,
            "to": to_class,
            "workspace_root": request.workspace_root.display().to_string(),
            "repository_dir": outcome.repository_dir.display().to_string(),
            "repo_id": outcome.repo_id_hex,
            "bytes_moved": outcome.moved_bytes,
        });
        print_json(&payload);
        return;
    }

    println!("=== Taxis Repository Relocated ===");
    println!("  From           : {from_class}");
    println!("  To             : {to_class}");
    println!("  Workspace      : {}", request.workspace_root.display());
    println!("  Repository dir : {}", outcome.repository_dir.display());
    println!("  Repository id  : {}", outcome.repo_id_hex);
    if !outcome.moved_bytes {
        println!("  Note           : the source copy could not be removed; both copies are intact");
    }
}

/// Renders a layout mode as the spelling the CLI uses elsewhere.
const fn layout_class(mode: LayoutMode) -> &'static str {
    match mode {
        LayoutMode::Dev => "dev",
        LayoutMode::Release => "release",
    }
}
