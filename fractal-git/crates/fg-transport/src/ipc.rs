//! Module: fg-transport — Local Agent High-Speed IPC
//! File Path: crates/fg-transport/src/ipc.rs
//! Architecture Role: Length-prefixed binary frame codec for local autonomous agent loop IPC,
//!   enabling zero-network-overhead coordination between Praxis and Fractal Git engine.

use fg_core::error::FractalResult;
use serde::{Deserialize, Serialize};

/// High-speed local IPC command envelope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "payload")]
pub enum IpcMessage {
    Ping { timestamp_ms: i64 },
    Pong { timestamp_ms: i64 },
    RequestRefOid { git_ref: String },
    ResponseRefOid { git_ref: String, oid: Option<String> },
    TriggerReclamation { workspace_id: String, git_ref: String },
    ReclamationDone { workspace_id: String, success: bool },
}

/// Length-prefixed binary frame encoder/decoder.
pub struct IpcCodec;

impl IpcCodec {
    /// Encodes an IPC message into a 4-byte length-prefixed JSON byte stream.
    pub fn encode(msg: &IpcMessage) -> FractalResult<Vec<u8>> {
        let json_bytes = serde_json::to_vec(msg)?;
        let len = (json_bytes.len() as u32).to_be_bytes();
        let mut frame = Vec::with_capacity(4 + json_bytes.len());
        frame.extend_from_slice(&len);
        frame.extend_from_slice(&json_bytes);
        Ok(frame)
    }

    /// Decodes a length-prefixed frame from raw bytes.
    pub fn decode(bytes: &[u8]) -> FractalResult<Option<(IpcMessage, usize)>> {
        if bytes.len() < 4 {
            return Ok(None);
        }

        let mut len_bytes = [0u8; 4];
        len_bytes.copy_from_slice(&bytes[..4]);
        let payload_len = u32::from_be_bytes(len_bytes) as usize;

        if bytes.len() < 4 + payload_len {
            return Ok(None); // Waiting for complete frame
        }

        let msg: IpcMessage = serde_json::from_slice(&bytes[4..4 + payload_len])?;
        Ok(Some((msg, 4 + payload_len)))
    }
}
