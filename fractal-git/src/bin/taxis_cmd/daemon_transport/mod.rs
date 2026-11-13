//! Module: taxis_cmd::daemon_transport — Discovery Metadata, Pause & Cleanup Guards
//! File Path: src/bin/taxis_cmd/daemon_transport/mod.rs
//! Architecture Role: Manages `.taxis/daemon.json` discovery metadata, pause/stop sentinels,
//!   stale artifact cleanup, and runtime path resolution across Token-TCP and UDS transports.
//! Dependencies & Triggers: Consumed by `taxis daemon`, `taxis audit`, and background scheduler.
//! Responsibilities: Advertise daemon ownership (`manages_async_audit: true`) and guard cleanup.
//! Exit Semantics & Design Rationale: Sentinel files allow lock-free pause/stop polling.

mod auth;
mod client_probe;
mod listener;

#[cfg(test)]
mod unit_tests;

use std::path::{Path, PathBuf};

use fg_core::error::FractalResult;
use serde::{Deserialize, Serialize};

pub use auth::read_authenticated_request;
pub use client_probe::{
    notify_daemon_async_audit, probe_daemon_alive, send_daemon_ipc_request,
};
pub use listener::{bind_persistent_listener, write_daemon_meta_atomic, PlatformListener};

/// Discovery filename written under `<repo>/.taxis/` while Taxis daemon owns async auditing.
pub const DAEMON_META_FILENAME: &str = "daemon.json";

/// Stop-signal sentinel filename triggering clean daemon loop exit.
pub const DAEMON_STOP_FILENAME: &str = "daemon.stop";

/// Pause sentinel filename disabling automatic background audits without killing daemon IPC.
pub const AUDIT_PAUSE_FILENAME: &str = "audit.paused";

/// Unix domain socket filename inside `.taxis/` when running on POSIX platforms.
pub const DAEMON_SOCK_FILENAME: &str = "daemon.sock";

/// Runtime metadata persisted to `.taxis/daemon.json` for discovery by VSCode tasks & CLI tools.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DaemonRuntimeMeta {
    /// OS process ID of the live Taxis daemon.
    pub pid: u32,
    /// Transport flavor: `"unix"` on POSIX UDS or `"tcp"` on Windows loopback.
    pub transport: String,
    /// Socket path or `127.0.0.1:<port>` bind address.
    pub endpoint: String,
    /// Hex-encoded 32-byte per-instance authentication token verified via `HelloAuth`.
    pub token_hex: String,
    /// Declares official Taxis kernel ownership of scheduled background audits.
    pub manages_async_audit: bool,
    /// Daemon start timestamp in UNIX milliseconds.
    pub started_at_ms: u64,
}

/// Resolves the canonical `.taxis/` runtime directory associated with `git_dir`.
#[must_use]
pub fn resolve_taxis_runtime_dir(git_dir: &Path) -> PathBuf {
    let is_dot_git = git_dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == ".git");
    if is_dot_git {
        return git_dir.parent().unwrap_or(git_dir).join(".taxis");
    }
    git_dir.to_path_buf()
}

/// Reads `.taxis/daemon.json` if present and parses runtime metadata cleanly.
#[must_use]
pub fn read_daemon_meta(git_dir: &Path) -> Option<DaemonRuntimeMeta> {
    let meta_path = resolve_taxis_runtime_dir(git_dir).join(DAEMON_META_FILENAME);
    let raw = std::fs::read(&meta_path).ok()?;
    serde_json::from_slice::<DaemonRuntimeMeta>(&raw).ok()
}

/// Checks whether `.taxis/audit.paused` currently pauses scheduled audits.
#[must_use]
pub fn is_audit_paused(git_dir: &Path) -> bool {
    resolve_taxis_runtime_dir(git_dir)
        .join(AUDIT_PAUSE_FILENAME)
        .exists()
}

/// Persists or removes `.taxis/audit.paused` to control scheduled background reviews cleanly.
///
/// # Errors
///
/// Propagates runtime directory creation or sentinel write/remove failures.
pub fn set_audit_paused(git_dir: &Path, paused: bool) -> FractalResult<()> {
    let runtime_dir = resolve_taxis_runtime_dir(git_dir);
    let pause_path = runtime_dir.join(AUDIT_PAUSE_FILENAME);
    if paused {
        std::fs::create_dir_all(&runtime_dir)?;
        std::fs::write(&pause_path, b"paused\n")?;
    } else if pause_path.exists() {
        std::fs::remove_file(&pause_path)?;
    }
    Ok(())
}

/// Removes stale daemon discovery/stop/socket files left behind by an ungraceful exit.
pub fn cleanup_stale_daemon_files(git_dir: &Path) {
    let runtime_dir = resolve_taxis_runtime_dir(git_dir);
    for file_name in [DAEMON_META_FILENAME, DAEMON_STOP_FILENAME, DAEMON_SOCK_FILENAME] {
        let candidate = runtime_dir.join(file_name);
        if candidate.exists() {
            let _ = std::fs::remove_file(&candidate);
        }
    }
}

/// Checks whether `.taxis/daemon.stop` requests clean listener termination.
#[must_use]
pub fn is_stop_requested(git_dir: &Path) -> bool {
    resolve_taxis_runtime_dir(git_dir)
        .join(DAEMON_STOP_FILENAME)
        .exists()
}
