//! Module: fg-transport — Git Pkt-Line Wire Protocol Codec
//! File Path: crates/fg-transport/src/packetline.rs
//! Architecture Role: Encodes and decodes canonical Git packet-line binary stream frames,
//!   supporting flush (0000), delimiter (0001), and standard length-prefixed text/binary lines.
//! Dependencies & Triggers: Consumed by Git Smart Protocol handlers and transport remotes.
//! Responsibilities: Format and parse 4-hex-digit length prefixes, flush packets, and payload boundaries.
//! Exit Semantics & Design Rationale: Complies with Git wire protocol v1 and v2 specifications bit-for-bit.
//!
//! Domain Governance Rules: FGT-TRN-001 (pkt-line framing), FGT-COR-001, FGT-PRF-001.

use fg_core::error::{FractalError, FractalResult};

/// Canonical Git wire protocol flush packet (`0000`).
pub const PKT_FLUSH: &[u8] = b"0000";

/// Canonical Git wire protocol delimiter packet (`0001`).
pub const PKT_DELIM: &[u8] = b"0001";

/// Packet-line encoder and decoder for standard Git wire protocol.
pub struct PacketLine;

impl PacketLine {
    /// Encodes a text line into a 4-hex-prefixed pkt-line byte buffer.
    pub fn encode_line(payload: &str) -> Vec<u8> {
        let total_len = payload.len() + 4;
        format!("{:04x}{}", total_len, payload).into_bytes()
    }

    /// Encodes a binary flush packet (`0000`).
    pub fn flush() -> Vec<u8> {
        PKT_FLUSH.to_vec()
    }

    /// Encodes a binary delimiter packet (`0001`).
    pub fn delim() -> Vec<u8> {
        PKT_DELIM.to_vec()
    }

    /// Decodes a raw byte buffer containing one or more packet-lines.
    pub fn decode(mut bytes: &[u8]) -> FractalResult<Vec<String>> {
        let mut lines = Vec::new();

        while bytes.len() >= 4 {
            let len_str = std::str::from_utf8(&bytes[..4]).map_err(|codec_err| {
                FractalError::ObjectCodec(format!("Invalid pkt-line hex prefix: {}", codec_err))
            })?;

            let len = usize::from_str_radix(len_str, 16).map_err(|codec_err| {
                FractalError::ObjectCodec(format!(
                    "Malformed pkt-line length '{}': {}",
                    len_str, codec_err
                ))
            })?;

            // Control packets carry no payload and must be consumed before the length check,
            // otherwise a length of 1..=3 would drive the payload slice backwards and panic.
            match len {
                0 => {
                    // Flush packet: end of the current section.
                    bytes = &bytes[4..];
                    continue;
                }
                1 | 2 => {
                    // Delimiter (0001) and response-end (0002) packets carry no text.
                    bytes = &bytes[4..];
                    continue;
                }
                3 => {
                    return Err(FractalError::ObjectCodec(
                        "Reserved pkt-line length '0003' has no defined meaning".into(),
                    ));
                }
                _ => {}
            }

            if bytes.len() < len {
                return Err(FractalError::ObjectCodec(format!(
                    "Truncated pkt-line: expected {} bytes, only {} available",
                    len,
                    bytes.len()
                )));
            }

            let payload = std::str::from_utf8(&bytes[4..len])
                .map_err(|codec_err| {
                    FractalError::ObjectCodec(format!("Pkt-line non-UTF8 body: {}", codec_err))
                })?
                .trim_end_matches('\n');

            lines.push(payload.to_string());
            bytes = &bytes[len..];
        }

        Ok(lines)
    }
}
