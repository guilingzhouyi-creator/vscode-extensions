//! Integration Test Support: Token-TCP/UDS IPC Helpers & CLI Polling Utilities
//! File Path: tests/rust/async_audit_e2e/harness.rs
//! Architecture Role: Provides authenticated daemon IPC frame transport, `taxis` CLI process
//!   execution, persistent daemon spawning, and bounded polling helpers for async audit E2E tests.
//! Dependencies & Triggers: Used by `lifecycle_test`, `pause_cell_test`, and `recovery_test`.
//! Responsibilities: Handle `HelloAuth` handshakes and poll runtime discovery and audit status.
//! Exit Semantics & Design Rationale: Fails fast with clear timeout diagnostics when assertions stall.

use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use fg_core::models::authority::AUTHORITY_SECRET_ENV;
use fractal_git::server::{IpcCodec, IpcMessage};
use serde_json::Value;

use super::{ChildGuard, TEST_AUTHORITY_HEX};

pub(super) fn send_ipc_with_auth(meta: &Value, request: &IpcMessage) -> IpcMessage {
    let transport = meta["transport"].as_str().expect("transport field");
    let endpoint = meta["endpoint"].as_str().expect("endpoint field");
    let token_hex = meta["token_hex"].as_str().expect("token_hex field");

    #[cfg(unix)]
    if transport == "unix" {
        let mut stream =
            std::os::unix::net::UnixStream::connect(endpoint).expect("connect daemon unix sock");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("read timeout");
        let frame = IpcCodec::encode(request).expect("encode frame");
        stream.write_all(&frame).expect("write frame");
        stream.flush().expect("flush frame");
        return read_single_frame(&mut stream);
    }

    assert_eq!(transport, "tcp");
    let mut stream = TcpStream::connect(endpoint).expect("connect daemon tcp loopback");
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("read timeout");
    let hello = IpcCodec::encode(&IpcMessage::HelloAuth {
        token: token_hex.to_owned(),
    })
    .expect("encode hello");
    let frame = IpcCodec::encode(request).expect("encode req");
    stream.write_all(&hello).expect("write hello");
    stream.write_all(&frame).expect("write req");
    stream.flush().expect("flush");
    read_single_frame(&mut stream)
}

pub(super) fn expect_commit_oid(meta: &Value, request: &IpcMessage, label: &str) -> String {
    match send_ipc_with_auth(meta, request) {
        IpcMessage::DaemonReceipt { receipt } => {
            assert!(receipt.ok, "{label} receipt failed: {}", receipt.detail);
            receipt.commit_oid.expect("commit oid")
        }
        other => panic!("unexpected IPC {label} response: {other:?}"),
    }
}

fn read_single_frame<R: Read>(stream: &mut R) -> IpcMessage {
    let mut buf = Vec::with_capacity(512);
    let mut chunk = [0u8; 4096];
    loop {
        if let Ok(Some((msg, _))) = IpcCodec::decode(&buf) {
            return msg;
        }
        let read_n = stream.read(&mut chunk).expect("read response");
        assert!(read_n > 0, "daemon closed IPC connection prematurely");
        buf.extend_from_slice(&chunk[..read_n]);
    }
}

pub(super) fn run_taxis_cli(
    repo_dir: &Path,
    args: &[&str],
    secret_hex: &str,
) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(repo_dir)
        .env(AUTHORITY_SECRET_ENV, secret_hex)
        .output()
        .expect("invoke taxis cli")
}

pub(super) fn spawn_persistent_daemon(
    repo_dir: &Path,
    quiet_ms: &str,
    heartbeat_ms: &str,
) -> ChildGuard {
    let child = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args([
            "daemon",
            "start",
            "--quiet-ms",
            quiet_ms,
            "--heartbeat-ms",
            heartbeat_ms,
            "--archetype",
            "systems-runtime",
            "--json",
        ])
        .current_dir(repo_dir)
        .env(AUTHORITY_SECRET_ENV, TEST_AUTHORITY_HEX)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn taxis daemon");
    ChildGuard::new(child)
}

pub(super) fn wait_for_daemon_meta(meta_path: &Path) -> Value {
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if meta_path.is_file() {
            if let Ok(bytes) = fs::read(meta_path) {
                if let Ok(val) = serde_json::from_slice::<Value>(&bytes) {
                    return val;
                }
            }
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {}",
            meta_path.display()
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

pub(super) fn wait_for_audit_status<F>(repo_dir: &Path, predicate: F) -> Value
where
    F: Fn(&Value) -> bool,
{
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let out = run_taxis_cli(repo_dir, &["--json", "audit", "status"], TEST_AUTHORITY_HEX);
        if out.status.success() {
            if let Ok(val) = serde_json::from_slice::<Value>(&out.stdout) {
                if predicate(&val) {
                    return val;
                }
            }
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for expected daemon audit status"
        );
        std::thread::sleep(Duration::from_millis(40));
    }
}
