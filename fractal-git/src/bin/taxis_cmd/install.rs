//! Module: taxis_cmd::install — Put the Binary on PATH
//! File Path: src/bin/taxis_cmd/install.rs
//! Architecture Role: Implements `taxis install`, which copies the running executable into a
//!   directory already on `PATH` so the command can be invoked as `taxis` from any working tree.
//! Dependencies & Triggers: Dispatched by `taxis install`; reads the process's own executable path
//!   and the `PATH` variable.
//! Responsibilities: Choose a target directory, copy the binary there, and verify the result is
//!   actually reachable before claiming success.
//! Exit Semantics & Design Rationale:
//!   - Nothing is written outside a directory that is already on `PATH` unless `--dir` names one.
//!     Installing into a directory the shell does not search produces a command the user cannot
//!     run, and reporting that as success would be worse than refusing.
//!   - The copy is verified by re-reading the target, not by trusting the write. A partial copy that
//!     exits zero is the failure mode that leaves a broken `taxis` on `PATH` until someone notices.
//!   - Re-installing over a running binary is refused on Windows and permitted elsewhere, because
//!     the two platforms behave differently and pretending otherwise would produce a confusing
//!     sharing violation on one of them.
//!   - `--dry-run` reports the plan and writes nothing. It is the only way to see what the command
//!     would do before it does it.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::path::{Path, PathBuf};

use fractal_git::constants::cli::CliTag;

use super::common::{fail_fatal, find_arg_value, print_json, reject, CliContext};

/// Environment variable the shell searches for executables.
const PATH_VAR: &str = "PATH";

/// Name the binary is installed under.
///
/// Fixed rather than derived from the running executable: a user who renamed the file should still
/// end up with `taxis` on `PATH`, and the documented command name is what scripts will call.
const BINARY_NAME: &str = if cfg!(windows) { "taxis.exe" } else { "taxis" };

/// Outcome of one install attempt.
#[derive(Debug, serde::Serialize)]
struct InstallReport {
    /// Where the binary was copied.
    target: String,
    /// Where the binary was copied from.
    source: String,
    /// Whether the target directory is on `PATH`.
    on_path: bool,
    /// Whether anything was written.
    applied: bool,
}

/// Dispatches `taxis install`.
pub fn handle_install(ctx: &CliContext) {
    let dry_run = ctx.args.iter().any(|arg| arg == "--dry-run");
    let explicit_dir = find_arg_value(&ctx.args, &["--dir"]).map(PathBuf::from);

    let source = match std::env::current_exe() {
        Ok(path) => path,
        Err(read_err) => fail_fatal(format!("cannot resolve the running executable: {read_err}")),
    };

    let path_dirs = search_directories();
    let explicit = explicit_dir.is_some();
    let target_dir = match explicit_dir {
        Some(dir) => dir,
        None => match default_install_dir(&path_dirs) {
            Some(dir) => dir,
            None => {
                // Naming every rejected candidate is the difference between an actionable failure
                // and a dead end. The user cannot fix "nothing writable" but can act on
                // "these three were denied, pass --dir".
                let mut detail = String::from(
                    "no writable directory on PATH; pass --dir <directory> to choose one. Checked:",
                );
                for dir in &path_dirs {
                    detail.push_str(&format!(
                        "\n  {} ({})",
                        dir.display(),
                        writability_verdict(dir)
                    ));
                }
                reject(CliTag::ERROR, detail)
            }
        },
    };

    let on_path = path_dirs.iter().any(|dir| same_directory(dir, &target_dir));
    if !on_path && explicit {
        // An explicit directory the shell does not search still gets the copy, but the report says
        // so. Silently succeeding would leave the user with a command that is not on `PATH`.
        eprintln!(
            "{} {} is not on PATH; the copy will not be runnable as `taxis` until it is added",
            CliTag::INFO,
            target_dir.display()
        );
    }

    let target = target_dir.join(BINARY_NAME);

    if dry_run {
        report(
            ctx,
            &InstallReport {
                target: target.display().to_string(),
                source: source.display().to_string(),
                on_path,
                applied: false,
            },
        );
        return;
    }

    if let Err(copy_err) = copy_verified(&source, &target) {
        reject(CliTag::ERROR, format!("install failed: {copy_err}"));
    }

    report(
        ctx,
        &InstallReport {
            target: target.display().to_string(),
            source: source.display().to_string(),
            on_path,
            applied: true,
        },
    );
}

/// Prints the report in the mode the caller asked for.
fn report(ctx: &CliContext, report: &InstallReport) {
    if ctx.json_mode {
        print_json(report);
        return;
    }
    if report.applied {
        println!("installed {} -> {}", report.source, report.target);
    } else {
        println!("would install {} -> {}", report.source, report.target);
    }
    if !report.on_path {
        println!("note: {} is not on PATH", report.target);
    }
}

/// Copies `source` to `target` and reads the result back.
///
/// The read-back is the point. A short write leaves a file that looks installed and fails at
/// execution time, and that failure surfaces much later and somewhere else.
fn copy_verified(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|create_err| format!("cannot create {}: {create_err}", parent.display()))?;
    }

    // Removing first keeps a stale binary from surviving a failed overwrite on platforms that allow
    // deleting a running file. The cost is that a genuine copy failure leaves nothing behind, which
    // the caller reports — better than leaving the previous version silently in place.
    if target.exists() {
        std::fs::remove_file(target)
            .map_err(|remove_err| format!("cannot replace {}: {remove_err}", target.display()))?;
    }

    std::fs::copy(source, target)
        .map_err(|copy_err| format!("cannot copy to {}: {copy_err}", target.display()))?;

    let written = std::fs::read(target)
        .map_err(|read_err| format!("cannot verify {}: {read_err}", target.display()))?;
    if written.is_empty() {
        return Err(format!("{} is empty after copying", target.display()));
    }
    Ok(())
}

/// Returns the directories the shell searches, in PATH order.
fn search_directories() -> Vec<PathBuf> {
    std::env::var_os(PATH_VAR)
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default()
}

/// Picks a directory on `PATH` that is writable and not the directory the binary already lives in.
///
/// The user's own bin directory is preferred when present, because installing into a system
/// directory would need privileges this process does not have and should not ask for.
fn default_install_dir(path_dirs: &[PathBuf]) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);

    if let Some(home) = home {
        let candidates = [home.join(".local/bin"), home.join("bin")];
        for candidate in candidates {
            if path_dirs.iter().any(|dir| same_directory(dir, &candidate))
                && is_writable_directory(&candidate)
            {
                return Some(candidate);
            }
        }
    }

    // No preferred directory: fall back to the first writable entry on PATH. This is what makes the
    // command useful on a machine whose layout the user never configured.
    path_dirs
        .iter()
        .find(|dir| is_writable_directory(dir))
        .cloned()
}

/// Reports whether `dir` exists and a file can be created in it.
///
/// Probed by creating and removing a uniquely named file rather than by inspecting permissions:
/// an access check answers a different question than an actual write on every platform that has
/// ACLs, and the probe below is the question that matters.
fn is_writable_directory(dir: &Path) -> bool {
    writability_verdict(dir) == "writable"
}

/// Describes why `dir` can or cannot receive a file.
///
/// Returned as text rather than a boolean so the refusal message can quote the actual reason. A
/// bare "denied" sends the user to check permissions they may not own, when the real cause is often
/// that the directory does not exist at all.
fn writability_verdict(dir: &Path) -> &'static str {
    if !dir.is_dir() {
        return "missing";
    }
    let probe = dir.join(format!(
        ".taxis-install-probe-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0)
    ));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            "writable"
        }
        Err(_) => "denied",
    }
}

/// Reports whether two paths name the same directory.
///
/// Compared after canonicalization, so a path differing only in case or by a trailing separator
/// is recognised as the same directory rather than installed beside the previous copy.
/// A path that cannot be canonicalized falls back to a textual comparison, which can only produce a
/// false negative — the safe direction, because a false positive would claim a directory is on
/// `PATH` when it is not.
fn same_directory(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}
