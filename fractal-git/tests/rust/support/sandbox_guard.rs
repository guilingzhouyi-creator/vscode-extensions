//! Module: support::sandbox_guard — RAII Test Scratch Reclamation & Stale Purge
//! File Path: tests/rust/support/sandbox_guard.rs
//! Architecture Role: Provides RAII drop cleanup for integration test temporary directories
//!   under `target/test_tmp` and lazily reaps stale fixtures from aborted prior test processes.
//! Dependencies & Triggers: Included via `#[path = "sandbox_guard.rs"]` from `cli_harness.rs`.
//! Responsibilities: Clear Windows read-only attributes during cleanup and preserve failed runs.
//! Exit Semantics & Design Rationale: Removes directory on normal drop; retains on unwind panic.

use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const STALE_SCRATCH_AGE: Duration = Duration::from_secs(3600);

/// RAII handle for an isolated integration test directory under `target/test_tmp`.
///
/// Automatically reclaims the scratch directory when the test finishes without panicking,
/// retaining failed workspaces for post-mortem inspection.
pub struct ScratchDirGuard {
    path: PathBuf,
}

impl ScratchDirGuard {
    /// Wraps an existing scratch directory path under automatic drop reclamation.
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Borrows the underlying filesystem path.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Deref for ScratchDirGuard {
    type Target = Path;

    fn deref(&self) -> &Self::Target {
        &self.path
    }
}

impl AsRef<Path> for ScratchDirGuard {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

#[cfg(windows)]
fn clear_readonly_tree(path: &Path) {
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let child = entry.path();
        if let Ok(meta) = entry.metadata() {
            if meta.is_dir() {
                clear_readonly_tree(&child);
            } else if meta.permissions().readonly() {
                let mut perms = meta.permissions();
                perms.set_readonly(false);
                let _ = std::fs::set_permissions(&child, perms);
            }
        }
    }
}

fn remove_dir_reclaim(path: &Path) {
    #[cfg(windows)]
    if std::fs::remove_dir_all(path).is_err() {
        clear_readonly_tree(path);
        let _ = std::fs::remove_dir_all(path);
    }
    #[cfg(not(windows))]
    {
        let _ = std::fs::remove_dir_all(path);
    }
}

impl Drop for ScratchDirGuard {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            remove_dir_reclaim(&self.path);
        }
    }
}

/// Removes abandoned scratch trees left by previous test runs older than [`STALE_SCRATCH_AGE`].
pub fn purge_stale_scratch(base: &Path) {
    let own_pid = std::process::id().to_string();
    let own_prefix_underscore = format!("{own_pid}_");
    let own_prefix_dash = format!("{own_pid}-");
    let own_template_suffix = format!("_{own_pid}");
    let own_bare_template = format!("_{own_pid}.git");
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with(&own_prefix_underscore)
            || name.starts_with(&own_prefix_dash)
            || name.ends_with(&own_template_suffix)
            || name.ends_with(&own_bare_template)
        {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let is_stale = meta
            .modified()
            .ok()
            .and_then(|mtime| now.duration_since(mtime).ok())
            .is_some_and(|age| age >= STALE_SCRATCH_AGE);
        if is_stale {
            if meta.is_dir() {
                remove_dir_reclaim(&entry.path());
            } else {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}
