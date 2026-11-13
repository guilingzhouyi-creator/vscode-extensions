//! Module: fg-transport — Wire Transport and Agent IPC Facade
//! File Path: crates/fg-transport/src/lib.rs
//! Architecture Role: Communication transport subsystem for Fractal Git, containing
//!   standard Git pkt-line wire protocol, Smart Protocol v2 handler, and local Agent IPC.
//! Dependencies & Triggers: Consumed by Taxis CLI daemon and local Agent IPC runners.
//! Responsibilities: Wire packet-line codecs, Git Smart Protocol v2 framing, IPC messages,
//!   and protocol version / frame length boundary validation guards.
//! Exit Semantics & Design Rationale: Stream-based framing with deterministic error boundaries
//!   and substantive facade validation (`FGT-FAC-001`).
//!
//! Domain Governance Rules: FGT-TRN-001 (transport subsystem facade), FGT-COR-001, FGT-FAC-001.

use fg_core::error::{FractalError, FractalResult};

pub mod ipc;
pub mod packetline;
pub mod protocol_request;
pub mod remote;
pub mod smart_protocol;

pub use ipc::{IpcCodec, IpcDaemonReceipt, IpcMessage, IpcStageEntry};
pub use packetline::{PacketLine, PKT_DELIM, PKT_FLUSH};
pub use remote::{LoopbackTransport, MockTransport, RemoteRef, RemoteTransport};
pub use smart_protocol::{ProtocolV2Handler, SmartV2Command, SmartV2Request};

/// Canonical wire version for the local Agent IPC framing protocol.
pub const IPC_PROTOCOL_VERSION: u16 = 1;

/// Supported Git Smart Protocol wire versions (`v1` and `v2`).
pub const MAX_SMART_PROTOCOL_VERSION: u16 = 2;

/// Fixed byte width of the big-endian length header preceding every IPC frame.
pub const IPC_FRAME_HEADER_LEN: usize = 4;

/// Hard upper bound (16 MiB) on a single IPC payload frame to prevent memory exhaustion.
pub const MAX_IPC_FRAME_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;

/// Canonical Git pkt-line maximum frame length in bytes (`65520`).
pub const MAX_PKT_LINE_BYTES: usize = 65520;

/// Reserved Git pkt-line length marker (`0003`) forbidden by the wire specification.
const RESERVED_PKT_LINE_LEN: usize = 3;

/// Validates that an IPC frame payload length sits within `(0, MAX_IPC_FRAME_PAYLOAD_BYTES]`.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] when the frame payload is empty or exceeds the
/// 16 MiB transport safety ceiling (`FGT-TRN-001`).
#[must_use = "IPC frame bound check result must be inspected before allocation"]
pub fn validate_ipc_frame_bounds(payload_len: usize) -> FractalResult<usize> {
    if payload_len == 0 {
        return Err(FractalError::ObjectCodec(
            "IPC frame payload must be non-empty".to_owned(),
        ));
    }
    if payload_len > MAX_IPC_FRAME_PAYLOAD_BYTES {
        return Err(FractalError::ObjectCodec(format!(
            "IPC frame payload {payload_len} exceeds ceiling {MAX_IPC_FRAME_PAYLOAD_BYTES}"
        )));
    }
    Ok(payload_len)
}

/// Validates that a negotiated transport protocol version is supported by this kernel build.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] if `version` is zero or exceeds
/// [`MAX_SMART_PROTOCOL_VERSION`].
#[must_use = "protocol version validation result must be inspected"]
pub fn validate_protocol_version(version: u16) -> FractalResult<u16> {
    if version == 0 || version > MAX_SMART_PROTOCOL_VERSION {
        return Err(FractalError::ObjectCodec(format!(
            "Unsupported transport protocol version {version}; expected 1..={MAX_SMART_PROTOCOL_VERSION}"
        )));
    }
    Ok(version)
}

/// Validates a Git packet-line total frame length against the wire protocol specification.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] when `frame_len` is the reserved `0003` marker or
/// exceeds [`MAX_PKT_LINE_BYTES`].
#[must_use = "packet-line bound check result must be inspected"]
pub fn validate_packetline_bounds(frame_len: usize) -> FractalResult<usize> {
    if frame_len == RESERVED_PKT_LINE_LEN {
        return Err(FractalError::ObjectCodec(
            "Reserved packet-line length 0003 is invalid on the wire".to_owned(),
        ));
    }
    if frame_len > MAX_PKT_LINE_BYTES {
        return Err(FractalError::ObjectCodec(format!(
            "Packet-line length {frame_len} exceeds maximum {MAX_PKT_LINE_BYTES}"
        )));
    }
    Ok(frame_len)
}
