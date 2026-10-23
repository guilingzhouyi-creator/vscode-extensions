//! Module: taxis_cmd::projection — Git Projection Import and Export Dispatchers
//! File Path: src/bin/taxis_cmd/projection.rs
//! Architecture Role: Dispatches `taxis git-export` and `taxis git-import`, bridging native
//!   TAXC repositories and Git `.git` repositories without calling the Git binary.
//! Dependencies & Triggers: Dispatched by `taxis git-export` and `taxis git-import`.
//! Responsibilities: CLI option parsing, repository path discovery, and delegation to
//!   `fg_storage::projection`.
//! Exit Semantics & Design Rationale:
//!   - CLI arguments explicitly control overwrite (`--force`).
//!   - Native and Git paths are resolved from the CLI context, `--git-dir`, `--from`, or `--to`.
//!   - Clear human/JSON reports with exact object, ref, and index counts.

use std::path::{Path, PathBuf};

use fg_native::LayoutMode;
use fg_storage::projection::{export_native_to_git, import_git_to_native};
use fractal_git::constants::cli::CliTag;

use super::common::{find_arg_value, print_json, reject, CliContext};

/// Dispatches `taxis git-export`.
pub fn handle_git_export(ctx: &CliContext) {
    let force = ctx.args.iter().any(|arg| arg == "--force");
    let explicit_to = find_arg_value(&ctx.args, &["--to", "--git-dir-target"]).map(PathBuf::from);

    let native_dir = match resolve_native_source(ctx) {
        Ok(dir) => dir,
        Err(reason) => reject(CliTag::ERROR, reason),
    };

    let target_git = match explicit_to {
        Some(explicit) => explicit,
        None => {
            let work_root = resolve_target_work_root(&native_dir);
            work_root.join(".git")
        }
    };

    let report = match export_native_to_git(&native_dir, &target_git, force) {
        Ok(rep) => rep,
        Err(export_err) => reject(
            CliTag::ERROR,
            format!("export native repository to git: {export_err}"),
        ),
    };

    #[cfg(windows)]
    let _ = fg_native::attempt_hide(&target_git);

    if ctx.json_mode {
        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "git-export",
            "native_dir": native_dir.display().to_string(),
            "git_dir": target_git.display().to_string(),
            "objects_exported": report.objects_exported,
            "refs_exported": report.refs_exported,
            "index_entries_exported": report.index_entries_exported,
            "head": report.head,
        });
        print_json(&payload);
    } else {
        println!("=== Taxis Git Projection Export ===");
        println!("  Native repository : {}", native_dir.display());
        println!("  Target .git       : {}", target_git.display());
        println!("  Objects exported  : {}", report.objects_exported);
        println!("  Refs exported     : {}", report.refs_exported);
        println!("  Index entries     : {}", report.index_entries_exported);
        println!("  HEAD              : {}", report.head);
    }
}

/// Dispatches `taxis git-import`.
pub fn handle_git_import(ctx: &CliContext) {
    let force = ctx.args.iter().any(|arg| arg == "--force");
    let release = ctx.args.iter().any(|arg| arg == "--release");
    let dev = ctx.args.iter().any(|arg| arg == "--dev");

    if dev && release {
        reject(
            CliTag::ERROR,
            "--dev and --release are mutually exclusive".to_string(),
        );
    }

    let layout_mode = if release {
        LayoutMode::Release
    } else {
        LayoutMode::Dev
    };

    let source_git = match resolve_source_git_dir(ctx) {
        Ok(dir) => dir,
        Err(reason) => reject(CliTag::ERROR, reason),
    };

    let workspace_root = match find_arg_value(&ctx.args, &["--workspace"]).map(PathBuf::from) {
        Some(explicit) => explicit,
        None => match std::env::current_dir() {
            Ok(cwd) => cwd,
            Err(cwd_err) => reject(
                CliTag::ERROR,
                format!("resolve current directory: {cwd_err}"),
            ),
        },
    };

    let target_native = workspace_root.join(".taxis");

    let report = match import_git_to_native(&source_git, &target_native, layout_mode, force) {
        Ok(rep) => rep,
        Err(import_err) => reject(
            CliTag::ERROR,
            format!("import git repository to native: {import_err}"),
        ),
    };

    if ctx.json_mode {
        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "git-import",
            "source_git": source_git.display().to_string(),
            "target_native": target_native.display().to_string(),
            "repo_id": report.repo_id,
            "objects_imported": report.objects_imported,
            "refs_imported": report.refs_imported,
            "index_entries_imported": report.index_entries_imported,
            "head": report.head,
        });
        print_json(&payload);
    } else {
        println!("=== Taxis Native Repository Imported ===");
        println!("  Source .git       : {}", source_git.display());
        println!("  Target native     : {}", target_native.display());
        println!("  Repository ID     : {}", report.repo_id);
        println!("  Objects imported  : {}", report.objects_imported);
        println!("  Refs imported     : {}", report.refs_imported);
        println!("  Index entries     : {}", report.index_entries_imported);
        println!("  HEAD              : {}", report.head);
    }
}

/// Resolves the native repository directory from `--git-dir` or current directory.
fn resolve_native_source(ctx: &CliContext) -> Result<PathBuf, String> {
    if ctx.git_dir != Path::new(".git") && fg_native::container_path(&ctx.git_dir).is_file() {
        return Ok(ctx.git_dir.clone());
    }

    let cwd = std::env::current_dir()
        .map_err(|cwd_err| format!("resolve current directory: {cwd_err}"))?;

    let candidate_taxis = cwd.join(".taxis");
    if fg_native::container_path(&candidate_taxis).is_file() {
        return Ok(candidate_taxis);
    }

    if fg_native::container_path(&ctx.git_dir).is_file() {
        return Ok(ctx.git_dir.clone());
    }

    Err(format!(
        "could not find a native Taxis repository at '{}' or '{}'",
        candidate_taxis.display(),
        ctx.git_dir.display()
    ))
}

/// Resolves the source `.git` directory from `--from`, `--git-dir`, or current directory.
fn resolve_source_git_dir(ctx: &CliContext) -> Result<PathBuf, String> {
    if let Some(explicit) = find_arg_value(&ctx.args, &["--from", "--source"]) {
        let path = PathBuf::from(explicit);
        if path.is_dir() {
            return Ok(path);
        }
        return Err(format!(
            "specified source '{}' is not a directory",
            explicit
        ));
    }

    if ctx.git_dir.is_dir() && ctx.git_dir.join("objects").is_dir() {
        return Ok(ctx.git_dir.clone());
    }

    let cwd = std::env::current_dir()
        .map_err(|cwd_err| format!("resolve current directory: {cwd_err}"))?;

    let candidate_git = cwd.join(".git");
    if candidate_git.is_dir() {
        return Ok(candidate_git);
    }

    Err(format!(
        "could not find a source Git repository at '{}' or '{}'",
        candidate_git.display(),
        ctx.git_dir.display()
    ))
}

/// Derives the worktree root directory from a repository directory path.
fn resolve_target_work_root(repo_dir: &Path) -> PathBuf {
    if let Some(parent) = repo_dir.parent() {
        parent.to_path_buf()
    } else {
        PathBuf::from(".")
    }
}
