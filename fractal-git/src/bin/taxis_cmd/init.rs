//! Module: taxis_cmd::init — Native Repository Initialization
//! File Path: src/bin/taxis_cmd/init.rs
//! Architecture Role: Creates a Taxis-native repository (TAXC container plus object and journal
//!   directories) without invoking any Git binary.
//! Dependencies & Triggers: Dispatched by `taxis init`; shares the CLI context and rejection helpers.
//! Responsibilities: Parse `--dev` / `--release` / `--no-hide`, build the matching layout, initialize
//!   it, and report the resolved paths and mode.
//! Exit Semantics & Design Rationale:
//!   - `--dev` and `--release` are mutually exclusive. Accepting both would leave the physical layout
//!     decided by argument order, which is not a decision a caller can be expected to remember.
//!   - The document is created before the layout is chosen, because a release store is named after
//!     the repository id. Generating the id first means the store path is known before anything is
//!     written, so a failure cannot leave a half-created store under an unknown name.
//!   - A link that cannot be created is reported with the store path that already holds the data.
//!     The repository is not rolled back, because deleting a successfully written store to make the
//!     exit status tidy destroys the only copy of the repository.

use std::path::{Path, PathBuf};

use fg_core::models::ConflictPresentationMode;
use fg_native::{LayoutMode, RepoDocument, RepoLayout};

use super::common::{print_json, reject, CliContext};
use fractal_git::constants::cli::CliTag;

/// Parsed arguments for one `init` invocation.
struct InitRequest {
    workspace_root: PathBuf,
    release: bool,
    git_compat: bool,
    conflict_mode: ConflictPresentationMode,
    home_root: Option<PathBuf>,
}

/// Dispatches `taxis init`.
pub fn handle_init(ctx: &CliContext) {
    let request = match parse_request(ctx) {
        Ok(parsed) => parsed,
        Err(reason) => reject(CliTag::ERROR, reason),
    };

    let layout_mode = if request.release {
        LayoutMode::Release
    } else {
        LayoutMode::Dev
    };

    let mut document = match RepoDocument::for_new_repository(layout_mode) {
        Ok(built) => built,
        Err(create_err) => reject(
            CliTag::ERROR,
            format!("build repository identity: {create_err}"),
        ),
    };
    document.meta.conflict_mode = request.conflict_mode;

    let layout = if request.release {
        match release_layout(&request, &document) {
            Ok(built) => built,
            Err(reason) => reject(CliTag::ERROR, reason),
        }
    } else {
        RepoLayout::dev(&request.workspace_root)
    };

    let created = match layout.initialize_with(&document) {
        Ok(initialized) => initialized,
        Err(init_err) => reject(CliTag::ERROR, format!("initialize repository: {init_err}")),
    };

    let config_path = created.repo_dir.join("config");
    let _ = super::config::write_config_entry(
        &config_path,
        "conflict",
        "mode",
        request.conflict_mode.as_str(),
    );

    if request.release {
        if let Err(link_err) = link_workspace_entry(&request.workspace_root, layout.repo_dir()) {
            reject(
                CliTag::ERROR,
                format!(
                    "repository written to '{}' but the workspace link could not be created: {}; \
                     the store is intact and can be linked manually",
                    layout.repo_dir().display(),
                    link_err
                ),
            );
        }
    }

    if request.git_compat {
        let git_dir = request.workspace_root.join(".git");
        if let Err(export_err) =
            fg_storage::export_native_to_git(layout.repo_dir(), &git_dir, false)
        {
            reject(
                CliTag::ERROR,
                format!("failed to generate --git-compat projection: {export_err}"),
            );
        }
    }

    report(ctx, &request, &document, &created);
}

/// Parses and validates the `init` argument list.
fn parse_request(ctx: &CliContext) -> Result<InitRequest, String> {
    let mut release = false;
    let mut dev = false;
    let mut git_compat = false;
    let mut conflict_mode: Option<ConflictPresentationMode> = None;
    let mut workspace_root: Option<PathBuf> = None;
    let mut home_root: Option<PathBuf> = None;

    let mut argument_cursor = 0;
    while argument_cursor < ctx.args.len() {
        let argument = ctx.args[argument_cursor].as_str();
        match argument {
            "--dev" => dev = true,
            "--release" => release = true,
            "--git-compat" => git_compat = true,
            "--no-hide" => {}
            "--conflict-mode" | "--conflict.mode" => {
                let value = ctx.args.get(argument_cursor + 1).ok_or_else(|| {
                    "--conflict-mode requires a mode (agent-algebraic, git-compat, diff3)"
                        .to_owned()
                })?;
                conflict_mode = Some(ConflictPresentationMode::parse_str(value).ok_or_else(|| {
                    format!("invalid conflict mode '{value}'; expected agent-algebraic, git-compat, or diff3")
                })?);
                argument_cursor += 1;
            }
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
                return Err(format!("unknown init flag '{other}'"));
            }
            _ => {}
        }
        argument_cursor += 1;
    }

    if dev && release {
        return Err("--dev and --release are mutually exclusive".to_owned());
    }

    let resolved_root = match workspace_root {
        Some(explicit) => explicit,
        None => std::env::current_dir()
            .map_err(|cwd_err| format!("resolve the current directory: {cwd_err}"))?,
    };

    let resolved_conflict_mode = conflict_mode.unwrap_or(if git_compat {
        ConflictPresentationMode::GitCompat
    } else {
        ConflictPresentationMode::AgentAlgebraic
    });

    Ok(InitRequest {
        workspace_root: resolved_root,
        release,
        git_compat,
        conflict_mode: resolved_conflict_mode,
        home_root,
    })
}

/// Builds the release layout, placing the store under the repository id's directory.
fn release_layout(request: &InitRequest, document: &RepoDocument) -> Result<RepoLayout, String> {
    let home_root = match request.home_root.clone() {
        Some(explicit) => explicit,
        None => home_root().ok_or_else(|| {
            "cannot resolve the home directory for the release store; pass --dev or --home"
                .to_owned()
        })?,
    };
    let store_dir = fg_native::store_path(&home_root, &document.meta.repo_id);
    Ok(RepoLayout::release(&request.workspace_root, store_dir))
}

/// Resolves the home directory the release store lives under.
fn home_root() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("HOME") {
        return Some(PathBuf::from(explicit));
    }
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

/// Creates the workspace entry that points at the store directory.
///
/// On Windows this is a junction, not a symbolic link: a symbolic link requires
/// `SeCreateSymbolicLinkPrivilege`, which a normal user token does not hold, so the first release-mode
/// initialization failed with `os error 1314` until the link kind was changed.
#[cfg(windows)]
fn link_workspace_entry(workspace_root: &Path, store_dir: &Path) -> std::io::Result<()> {
    fg_native::create_junction(&workspace_root.join(".taxis"), store_dir)
        .map_err(|link_err| std::io::Error::other(link_err.to_string()))
}

/// Creates the workspace link that points at the store directory.
#[cfg(unix)]
fn link_workspace_entry(workspace_root: &Path, store_dir: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(store_dir, workspace_root.join(".taxis"))
}

/// Prints the outcome of a successful initialization.
fn report(
    ctx: &CliContext,
    request: &InitRequest,
    document: &RepoDocument,
    created: &fg_native::InitializedRepository,
) {
    let layout_class = if request.release { "release" } else { "dev" };
    let guard_present = fg_native::read_guard_file(&created.repo_dir)
        .ok()
        .flatten()
        .is_some();

    if ctx.json_mode {
        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "init",
            "layout_mode": layout_class,
            "git_compat": request.git_compat,
            "conflict_mode": request.conflict_mode.as_str(),
            "workspace_root": request.workspace_root.display().to_string(),
            "repository_dir": created.repo_dir.display().to_string(),
            "container": created.container_path.display().to_string(),
            "repo_id": document.meta.repo_id_hex(),
            "hidden": created.hidden,
            "guard_present": guard_present,
        });
        print_json(&payload);
        return;
    }

    println!("=== Taxis Native Repository Initialized ===");
    println!("  Mode           : {layout_class}");
    println!("  Workspace      : {}", request.workspace_root.display());
    println!("  Repository dir : {}", created.repo_dir.display());
    println!("  Container      : {}", created.container_path.display());
    println!("  Repository id  : {}", document.meta.repo_id_hex());
    println!("  Conflict mode  : {}", request.conflict_mode.as_str());
    if request.git_compat {
        println!(
            "  Git compat     : projected at {}",
            request.workspace_root.join(".git").display()
        );
    }
    if let Some(hidden) = created.hidden {
        println!("  Hidden         : {}", if hidden { "yes" } else { "no" });
    }
    println!(
        "  Guard file     : {}",
        if guard_present { "present" } else { "MISSING" }
    );

    if request.release {
        println!("  Store          : {}", created.repo_dir.display());
    } else {
        println!(
            "\n  Development layout: the repository is a real directory inside the workspace.\n  \
             `git clean -xdff` removes it. Use `taxis init --release` for a store-backed repository."
        );
    }
}
