//! Module: taxis_cmd::daemon_transport — IPC Client Requests & Daemon Liveness Probes
//! File Path: src/bin/taxis_cmd/daemon_transport/client_probe.rs
//! Architecture Role: Connects to active Token-TCP/UDS daemon instances, authenticates frames,
//!   probes liveness, and dispatches non-blocking async audit wakeups after stage/commit events.
//! Dependencies & Triggers: Called by `taxis audit`, `taxis daemon start`, `commit`, and `stage`.
//! Responsibilities: Enforce connect/read timeouts and handle stale daemon discovery gracefully.
//! Exit Semantics & Design Rationale: Best-effort wakeup never blocks interactive Git operations.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

use fg_core::error::{FractalError, FractalResult};
use fractal_git::{IpcCodec, IpcMessage};

use super::{read_daemon_meta, DaemonRuntimeMeta};

const IO_TIMEOUT_SECS: u64 = 15;
const PROBE_TIMEOUT_MS: u64 = 250;

/// Sends a single authenticated IPC request to the active daemon advertised in `.taxis/daemon.json`.
///
/// # Errors
///
/// Returns an error if no daemon is running, authentication fails, or transport framing fails.
pub fn send_daemon_ipc_request(git_dir: &Path, request: &IpcMessage) -> FractalResult<IpcMessage> {
    send_daemon_ipc_request_with_timeout(git_dir, request, Duration::from_secs(IO_TIMEOUT_SECS))
}

/// Sends a single authenticated IPC request using an explicit connect and socket I/O timeout.
///
/// # Errors
///
/// Returns an error if `.taxis/daemon.json` is missing, unreachable, or authentication fails.
pub fn send_daemon_ipc_request_with_timeout(
    git_dir: &Path,
    request: &IpcMessage,
    timeout: Duration,
) -> FractalResult<IpcMessage> {
    let Some(meta) = read_daemon_meta(git_dir) else {
        return Err(FractalError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "active Taxis daemon metadata (.taxis/daemon.json) not found",
        )));
    };
    #[cfg(unix)]
    if meta.transport == "unix" {
        return send_unix_request(&meta.endpoint, request, timeout);
    }
    send_tcp_request(&meta.endpoint, &meta.token_hex, request, timeout)
}

/// Probes whether the daemon described by `.taxis/daemon.json` is actively accepting IPC requests.
#[must_use]
pub fn probe_daemon_alive(git_dir: &Path) -> Option<DaemonRuntimeMeta> {
    let meta = read_daemon_meta(git_dir)?;
    let probe_timeout = Duration::from_millis(PROBE_TIMEOUT_MS);
    let reply =
        send_daemon_ipc_request_with_timeout(git_dir, &IpcMessage::QueryAuditStatus, probe_timeout);
    match reply {
        Ok(IpcMessage::AuditStatus { .. }) => Some(meta),
        _ => None,
    }
}

/// Sends a short-timeout best-effort async audit wakeup notification to a running daemon.
pub fn notify_daemon_async_audit(git_dir: &Path, target_ref: Option<&str>) {
    if read_daemon_meta(git_dir).is_none() {
        return;
    }
    let request = IpcMessage::ScheduleAudit {
        target_ref: target_ref.map(str::to_owned),
        force: false,
    };
    let _ = send_daemon_ipc_request_with_timeout(
        git_dir,
        &request,
        Duration::from_millis(PROBE_TIMEOUT_MS),
    );
}

#[cfg(unix)]
fn send_unix_request(
    sock_path: &str,
    request: &IpcMessage,
    timeout: Duration,
) -> FractalResult<IpcMessage> {
    let mut stream = std::os::unix::net::UnixStream::connect(sock_path)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let frame = IpcCodec::encode(request)?;
    stream.write_all(&frame)?;
    stream.flush()?;
    read_single_response_frame(&mut stream)
}

fn send_tcp_request(
    endpoint: &str,
    token_hex: &str,
    request: &IpcMessage,
    timeout: Duration,
) -> FractalResult<IpcMessage> {
    let mut stream = if let Ok(sock_addr) = endpoint.parse::<std::net::SocketAddr>() {
        TcpStream::connect_timeout(&sock_addr, timeout)?
    } else {
        TcpStream::connect(endpoint)?
    };
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let hello_frame = IpcCodec::encode(&IpcMessage::HelloAuth {
        token: token_hex.to_owned(),
    })?;
    let req_frame = IpcCodec::encode(request)?;
    stream.write_all(&hello_frame)?;
    stream.write_all(&req_frame)?;
    stream.flush()?;
    read_single_response_frame(&mut stream)
}

fn read_single_response_frame<S: Read>(stream: &mut S) -> FractalResult<IpcMessage> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 4096];
    loop {
        if let Ok(Some((msg, _))) = IpcCodec::decode(&buffer) {
            return Ok(msg);
        }
        let read_count = stream.read(&mut chunk)?;
        if read_count == 0 {
            return Err(FractalError::ObjectCodec(String::from(
                "daemon closed IPC connection before returning full response frame",
            )));
        }
        buffer.extend_from_slice(&chunk[..read_count]);
    }
}
