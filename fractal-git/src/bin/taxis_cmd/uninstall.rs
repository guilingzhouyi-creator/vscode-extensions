//! Module: taxis_cmd::uninstall — Remove the Binary from PATH
//! File Path: src/bin/taxis_cmd/uninstall.rs
//! Architecture Role: Implements `taxis uninstall`, the inverse of `taxis install`.
//! Dependencies & Triggers: Dispatched by `taxis uninstall`.
//! Responsibilities: Locate the installed binary on `PATH`, remove it, and report what was removed.
//! Exit Semantics & Design Rationale:
//!   - Only a file this tool would have installed is removed. The target name is the same one
//!     `install` uses, inside a directory that is on `PATH` or was named with `--dir`, so an
//!     unrelated executable that happens to share the directory is never touched.
//!   - The running binary is refused. On Windows a running image cannot be deleted and on Unix the
//!     delete would succeed while leaving the process alive, so the two platforms would report
//!     different outcomes for the same command. Refusing keeps the answer the same everywhere.
//!   - Nothing is reported as removed unless it is gone afterwards. A failed delete that printed
//!     "removed" would leave the user believing the command is uninstalled while it still works.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use std::path::{Path, PathBuf};

use fractal_git::constants::cli::CliTag;

use super::common::{find_arg_value, print_json, reject, CliContext};

/// Name the binary is installed under.
const BINARY_NAME: &str = if cfg!(windows) { "taxis.exe" } else { "taxis" };

/// Outcome of one removal attempt.
#[derive(Debug, serde::Serialize)]
struct UninstallReport {
    /// Path that was examined.
    target: String,
    /// Whether the file existed and is now gone.
    removed: bool,
}

/// Dispatches `taxis uninstall`.
pub fn handle_uninstall(ctx: &CliContext) {
    let dry_run = ctx.args.iter().any(|arg| arg == "--dry-run");
    let explicit_dir = find_arg_value(&ctx.args, &["--dir"]).map(PathBuf::from);

    let running = std::env::current_exe().ok();
    let candidates = match explicit_dir {
        Some(dir) => vec![dir],
        None => search_directories(),
    };

    let target = candidates
        .iter()
        .map(|dir| dir.join(BINARY_NAME))
        .find(|path| path.is_file());

    let Some(target) = target else {
        // Not finding the binary is the desired end state, so this is reported as such rather than
        // as a failure. A caller scripting `uninstall || die` should not die on an already-clean box.
        report(
            ctx,
            &UninstallReport {
                target: String::new(),
                removed: false,
            },
        );
        return;
    };

    if let Some(running) = running {
        if same_file(&running, &target) {
            reject(
                CliTag::ERROR,
                "refusing to remove the running binary; run `taxis uninstall` from an installed copy",
            );
        }
    }

    if dry_run {
        report(
            ctx,
            &UninstallReport {
                target: target.display().to_string(),
                removed: false,
            },
        );
        return;
    }

    if let Err(remove_err) = std::fs::remove_file(&target) {
        reject(
            CliTag::ERROR,
            format!("cannot remove {}: {remove_err}", target.display()),
        );
    }

    // The file must actually be gone before success is claimed. A delete that returned Ok but left
    // the file behind would make the next `taxis` invocation work and contradict the report.
    if target.exists() {
        reject(
            CliTag::ERROR,
            format!("{} still exists after removal", target.display()),
        );
    }

    report(
        ctx,
        &UninstallReport {
            target: target.display().to_string(),
            removed: true,
        },
    );
}

/// Prints the report in the mode the caller asked for.
fn report(ctx: &CliContext, report: &UninstallReport) {
    if ctx.json_mode {
        print_json(report);
        return;
    }
    if report.removed {
        println!("removed {}", report.target);
    } else if report.target.is_empty() {
        println!("nothing to remove: no installed taxis found on PATH");
    } else {
        println!("would remove {}", report.target);
    }
}

/// Returns the directories the shell searches, in PATH order.
fn search_directories() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default()
}

/// Reports whether two paths name the same file on disk.
///
/// Canonicalization is what makes this reliable: the running executable's path and a `PATH` entry
/// reach the same file through different spellings, and comparing the strings would miss it.
fn same_file(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}
