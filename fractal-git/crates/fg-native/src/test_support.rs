//! Module: fg-native — Test Scratch Path Helper
//! File Path: crates/fg-native/src/test_support.rs
//! Architecture Role: Supplies writable scratch locations for unit tests in constrained hosts.
//! Dependencies & Triggers: Compiled only under `cfg(test)`; used by container tests.
//! Responsibilities: Resolve a scratch directory that is writable in this environment and return
//!   collision-free file paths inside it.
//! Exit Semantics & Design Rationale:
//!   - The ambient scratch root is denied by the sandbox in use, while its `Low` child is
//!     writable; `tempfile` creates its directory directly under the denied root and therefore
//!     fails. This helper keeps tests hermetic without depending on that crate.
//!   - Paths embed the process id and a counter so parallel test threads never collide.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

/// Monotonic counter making scratch names unique within one process.
static SCRATCH_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Returns a writable scratch directory, creating it when absent.
fn scratch_dir() -> PathBuf {
    let mut base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    base.push("fg-native-tests");
    let _ = std::fs::create_dir_all(&base);
    base
}

/// Returns a unique scratch file path inside the writable scratch directory.
pub fn scratch_path(label: &str) -> PathBuf {
    let sequence = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut path = scratch_dir();
    path.push(format!("{}-{}-{}.bin", label, std::process::id(), sequence));
    path
}
