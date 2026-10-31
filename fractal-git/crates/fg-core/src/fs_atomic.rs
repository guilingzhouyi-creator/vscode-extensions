//! Module: fg-core — Crash-Safe Atomic File Persistence
//! File Path: crates/fg-core/src/fs_atomic.rs
//! Architecture Role: Single-source temporary-staging-plus-rename atomic file writer shared across
//!   all Taxis kernel subsystems (`fg-core`, `fg-native`, `fg-index`, `fg-storage`, `fg-topology`, `fg-gate`).
//! Dependencies & Triggers: Invoked whenever a container, index, ref, ledger, or metadata snapshot
//!   must replace an on-disk file without partial-write tearing or concurrent staging collisions.
//! Responsibilities: Create parent directories, generate process- and thread-unique `.tmp` staging
//!   files, optionally flush OS file buffers (`sync_all`), retry transient Windows renames, and
//!   reclaim orphaned staging files on failure via an RAII drop guard.
//! Exit Semantics & Design Rationale:
//!   - Returns `std::io::Result<()>` so both `FractalError` and `NativeError` callers propagate `?`
//!     without intermediate error conversion wrappers.
//!   - Closes the staging file handle strictly before `fs::rename` so Windows sharing modes never
//!     self-deadlock the rename step.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

static STAGING_SEQ: AtomicU64 = AtomicU64::new(1);

struct StagingCleanupGuard<'a> {
    path: &'a Path,
    committed: bool,
}

impl Drop for StagingCleanupGuard<'_> {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(self.path);
        }
    }
}

/// Builds a collision-free temporary sibling path inside `target`'s parent directory.
fn build_staging_path(target: &Path) -> PathBuf {
    let parent = match target.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => dir,
        _ => Path::new("."),
    };
    let stem = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("atomic");
    let pid = std::process::id();
    let seq = STAGING_SEQ.fetch_add(1, Ordering::Relaxed);
    parent.join(format!(".{stem}.{pid}.{seq}.tmp"))
}

/// Atomically writes `bytes` to `target` via a unique sibling staging file and `fs::rename`.
///
/// When `sync` is `true`, invokes `File::sync_all()` before closing the staging descriptor so the
/// payload is durable prior to directory-entry replacement. Retries `fs::rename` up to 3 times on
/// transient OS sharing contention (common with Windows Defender / search indexers).
///
/// # Errors
/// Propagates `io::Error` if directory creation, staging write, `sync_all`, or all rename attempts fail.
pub fn write_file_atomic(target: &Path, bytes: &[u8], sync: bool) -> io::Result<()> {
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let staging_path = build_staging_path(target);
    let mut cleanup = StagingCleanupGuard {
        path: &staging_path,
        committed: false,
    };

    {
        let mut staging_file = File::create(&staging_path)?;
        staging_file.write_all(bytes)?;
        if sync {
            staging_file.sync_all()?;
        }
    }

    let mut rename_result = fs::rename(&staging_path, target);
    if rename_result.is_err() {
        for attempt in 0..3u64 {
            std::thread::sleep(Duration::from_millis(5 * (attempt + 1)));
            rename_result = fs::rename(&staging_path, target);
            if rename_result.is_ok() {
                break;
            }
        }
    }

    rename_result?;
    cleanup.committed = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::write_file_atomic;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    fn test_temp_dir(prefix: &str) -> PathBuf {
        let base = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = fs::create_dir_all(&base);
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        base.join(format!("{prefix}_{}_{id}", std::process::id()))
    }

    #[test]
    fn atomic_write_creates_and_overwrites_cleanly() {
        let dir = test_temp_dir("fg_core_atomic");
        let _ = fs::remove_dir_all(&dir);
        let target = dir.join("nested").join("state.json");

        write_file_atomic(&target, b"first-payload", false).expect("initial write");
        assert_eq!(fs::read(&target).expect("read first"), b"first-payload");

        write_file_atomic(&target, b"second-synced-payload", true).expect("overwrite synced");
        assert_eq!(
            fs::read(&target).expect("read second"),
            b"second-synced-payload"
        );

        let entries: Vec<_> = fs::read_dir(target.parent().expect("parent"))
            .expect("read_dir")
            .filter_map(Result::ok)
            .collect();
        assert_eq!(entries.len(), 1, "no leftover .tmp files may remain");

        let _ = fs::remove_dir_all(&dir);
    }
}
