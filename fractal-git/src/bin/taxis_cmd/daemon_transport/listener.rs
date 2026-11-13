//! Module: taxis_cmd::daemon_transport — Persistent Platform Listeners & Discovery Guard
//! File Path: src/bin/taxis_cmd/daemon_transport/listener.rs
//! Architecture Role: Binds non-blocking Token-TCP or POSIX UDS listeners, writes atomic
//!   `.taxis/daemon.json` metadata, and removes runtime sentinels via RAII on shutdown.
//! Dependencies & Triggers: Invoked by `daemon_persistent::run_persistent_daemon`.
//! Responsibilities: Ensure discovery files match active listener addresses cleanly.
//! Exit Semantics & Design Rationale: RAII Drop cleans socket/meta files across panic or stop.

use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use fg_core::error::FractalResult;
use fractal_git::{IpcCodec, IpcMessage};

use super::auth::generate_session_token_hex;
use super::{
    resolve_taxis_runtime_dir, DaemonRuntimeMeta, DAEMON_META_FILENAME, DAEMON_SOCK_FILENAME,
    DAEMON_STOP_FILENAME,
};

/// RAII guard removing `.taxis/daemon.json` and Unix socket file when the listener shuts down.
pub struct DaemonDiscoveryGuard {
    meta_path: PathBuf,
    sock_path: PathBuf,
    stop_path: PathBuf,
}

impl Drop for DaemonDiscoveryGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.meta_path);
        let _ = std::fs::remove_file(&self.stop_path);
        if self.sock_path.exists() {
            let _ = std::fs::remove_file(&self.sock_path);
        }
    }
}

/// Writes `.taxis/daemon.json` atomically and returns the lifecycle cleanup guard.
///
/// # Errors
///
/// Propagates directory creation or filesystem serialization failures.
pub fn write_daemon_meta_atomic(
    git_dir: &Path,
    meta: &DaemonRuntimeMeta,
) -> FractalResult<DaemonDiscoveryGuard> {
    let runtime_dir = resolve_taxis_runtime_dir(git_dir);
    std::fs::create_dir_all(&runtime_dir)?;
    let meta_path = runtime_dir.join(DAEMON_META_FILENAME);
    let stop_path = runtime_dir.join(DAEMON_STOP_FILENAME);
    let sock_path = runtime_dir.join(DAEMON_SOCK_FILENAME);
    let _ = std::fs::remove_file(&stop_path);

    let staged_path = runtime_dir.join(format!("daemon.{}.staged", std::process::id()));
    let encoded = serde_json::to_vec_pretty(meta)?;
    std::fs::write(&staged_path, &encoded)?;
    std::fs::rename(&staged_path, &meta_path)?;
    Ok(DaemonDiscoveryGuard {
        meta_path,
        sock_path,
        stop_path,
    })
}

/// Binds a non-blocking platform listener and constructs its corresponding `DaemonRuntimeMeta`.
///
/// # Errors
///
/// Propagates socket bind errors or metadata serialization errors.
pub fn bind_persistent_listener(
    #[cfg_attr(not(unix), allow(unused_variables))] git_dir: &Path,
    explicit_addr: Option<&str>,
) -> FractalResult<(PlatformListener, DaemonRuntimeMeta)> {
    let token_hex = generate_session_token_hex();
    let started_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|dur| u64::try_from(dur.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0);

    #[cfg(unix)]
    if explicit_addr.is_none() {
        let runtime_dir = resolve_taxis_runtime_dir(git_dir);
        std::fs::create_dir_all(&runtime_dir)?;
        let sock_path = runtime_dir.join(DAEMON_SOCK_FILENAME);
        if sock_path.exists() {
            let _ = std::fs::remove_file(&sock_path);
        }
        let unix_listener = std::os::unix::net::UnixListener::bind(&sock_path)?;
        unix_listener.set_nonblocking(true)?;
        let meta = DaemonRuntimeMeta {
            pid: std::process::id(),
            transport: String::from("unix"),
            endpoint: sock_path.to_string_lossy().into_owned(),
            token_hex,
            manages_async_audit: true,
            started_at_ms,
        };
        return Ok((PlatformListener::Unix(unix_listener), meta));
    }

    let addr = explicit_addr.unwrap_or("127.0.0.1:0");
    let tcp_listener = TcpListener::bind(addr)?;
    tcp_listener.set_nonblocking(true)?;
    let bound_addr = tcp_listener.local_addr()?;
    let meta = DaemonRuntimeMeta {
        pid: std::process::id(),
        transport: String::from("tcp"),
        endpoint: bound_addr.to_string(),
        token_hex,
        manages_async_audit: true,
        started_at_ms,
    };
    Ok((PlatformListener::Tcp(tcp_listener), meta))
}

/// Non-blocking platform listener wrapper unifying Windows Token-TCP and Unix UDS.
pub enum PlatformListener {
    /// Loopback IPv4 TCP socket paired with `HelloAuth` session token.
    Tcp(TcpListener),
    /// POSIX local filesystem domain socket.
    #[cfg(unix)]
    Unix(std::os::unix::net::UnixListener),
}

impl PlatformListener {
    /// Writes a length-prefixed IPC response frame onto any `Write` stream cleanly.
    ///
    /// # Errors
    ///
    /// Propagates frame encoding or stream write failures.
    pub fn write_response<W: Write>(stream: &mut W, msg: &IpcMessage) -> FractalResult<()> {
        let encoded = IpcCodec::encode(msg)?;
        stream.write_all(&encoded)?;
        stream.flush()?;
        Ok(())
    }
}
