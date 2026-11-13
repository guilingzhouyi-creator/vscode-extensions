//! Module: taxis_cmd::daemon_transport — Token Auth & Authenticated IPC Frame Reader
//! File Path: src/bin/taxis_cmd/daemon_transport/auth.rs
//! Architecture Role: Generates per-session loopback tokens and validates `HelloAuth` handshakes
//!   in constant time before dispatching length-prefixed IPC frames.
//! Dependencies & Triggers: Used by `listener.rs`, `daemon_ipc_dispatch`, and transport tests.
//! Responsibilities: Reject unauthenticated or tampered IPC frames and oversized (>8 MiB) payloads.
//! Exit Semantics & Design Rationale: Constant-time equality blocks timing side channels.

use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};

use fg_core::crypto::sm3_hash;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::authority::ct_eq_bytes;
use fractal_git::{IpcCodec, IpcMessage};

pub(super) fn generate_session_token_hex() -> String {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|dur| dur.as_nanos())
        .unwrap_or(0);
    let stack_probe: u64 = 0x9E37_79B9_7F4A_7C15;
    let addr = (&stack_probe as *const u64) as usize;
    let seed = format!("taxis:{}:{now_nanos}:{addr}", std::process::id());
    let digest = sm3_hash(seed.as_bytes());
    let mut out = String::with_capacity(64);
    for &byte in &digest {
        out.push(hex_nibble(byte >> 4));
        out.push(hex_nibble(byte & 0x0f));
    }
    out
}

const fn hex_nibble(nibble: u8) -> char {
    match nibble {
        0..=9 => (b'0' + nibble) as char,
        10..=15 => (b'a' + (nibble - 10)) as char,
        _ => '0',
    }
}

/// Reads length-prefixed IPC frames from a connected stream (expecting `HelloAuth` first on TCP).
///
/// # Errors
///
/// Propagates socket read errors or malformed IPC framing errors.
pub fn read_authenticated_request<S: Read>(
    stream: &mut S,
    expected_token_hex: &str,
    require_hello_auth: bool,
) -> FractalResult<Option<IpcMessage>> {
    let mut buffer = Vec::with_capacity(512);
    let mut chunk = [0u8; 4096];
    let mut auth_verified = !require_hello_auth;

    loop {
        if let Ok((frames, consumed)) = IpcCodec::decode_stream(&buffer) {
            if !frames.is_empty() {
                if let Some(found) =
                    process_decoded_auth_frames(&frames, expected_token_hex, &mut auth_verified)?
                {
                    return Ok(Some(found));
                }
                buffer.drain(..consumed);
            }
        }
        let read_count = match stream.read(&mut chunk) {
            Ok(0) => return Ok(None),
            Ok(count) => count,
            Err(io_err)
                if matches!(
                    io_err.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                return Ok(None)
            }
            Err(io_err) => return Err(FractalError::Io(io_err)),
        };
        buffer.extend_from_slice(&chunk[..read_count]);
        if buffer.len() > 8 * 1024 * 1024 {
            return Err(FractalError::ObjectCodec(String::from(
                "IPC request exceeded 8 MiB frame limit",
            )));
        }
    }
}

fn process_decoded_auth_frames(
    frames: &[IpcMessage],
    expected_token_hex: &str,
    auth_verified: &mut bool,
) -> FractalResult<Option<IpcMessage>> {
    for frame in frames {
        match frame {
            IpcMessage::HelloAuth { token } => {
                if !ct_eq_bytes(token.as_bytes(), expected_token_hex.as_bytes()) {
                    return Err(FractalError::AccessDenied(String::from(
                        "invalid loopback daemon authentication token",
                    )));
                }
                *auth_verified = true;
            }
            other => {
                if !*auth_verified {
                    return Err(FractalError::AccessDenied(String::from(
                        "unauthenticated IPC command rejected prior to HelloAuth",
                    )));
                }
                return Ok(Some(other.clone()));
            }
        }
    }
    Ok(None)
}
