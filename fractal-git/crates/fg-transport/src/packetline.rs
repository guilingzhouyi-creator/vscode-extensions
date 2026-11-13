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

    /// Encodes a raw binary payload into a pkt-line frame.
    pub fn encode_binary(payload: &[u8]) -> Vec<u8> {
        let total_len = payload.len() + 4;
        let mut out = format!("{:04x}", total_len).into_bytes();
        out.extend_from_slice(payload);
        out
    }

    /// Encodes a sideband binary payload (channel 1=data, 2=progress, 3=error).
    pub fn encode_sideband(channel: u8, payload: &[u8]) -> Vec<u8> {
        let total_len = payload.len() + 5;
        let mut out = format!("{:04x}", total_len).into_bytes();
        out.push(channel);
        out.extend_from_slice(payload);
        out
    }

    /// Decodes a raw byte buffer containing one or more packet-lines into binary slices.
    pub fn decode_binary(mut bytes: &[u8]) -> FractalResult<Vec<Vec<u8>>> {
        let mut frames = Vec::new();

        while bytes.len() >= 4 {
            let len_str = std::str::from_utf8(&bytes[..4]).map_err(|codec_err| {
                FractalError::ObjectCodec(format!("Invalid pkt-line hex prefix: {codec_err}"))
            })?;

            let len = usize::from_str_radix(len_str, 16).map_err(|codec_err| {
                FractalError::ObjectCodec(format!(
                    "Malformed pkt-line length '{len_str}': {codec_err}"
                ))
            })?;

            match len {
                0..=2 => {
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
                    "Truncated pkt-line: expected {len} bytes, only {} available",
                    bytes.len()
                )));
            }

            frames.push(bytes[4..len].to_vec());
            bytes = &bytes[len..];
        }

        Ok(frames)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_packetline_encode_decode_roundtrip() {
        let text = "command=ls-refs";
        let encoded = PacketLine::encode_line(text);
        assert_eq!(&encoded[..4], b"0013"); // 15 + 4 = 19 (0x0013)
        let decoded = PacketLine::decode(&encoded).expect("decode text");
        assert_eq!(decoded, vec![text]);
    }

    #[test]
    fn test_packetline_binary_and_sideband() {
        let binary_payload = vec![0x00, 0xff, 0xfe, 0x12, 0x34];
        let frame = PacketLine::encode_binary(&binary_payload);
        let decoded = PacketLine::decode_binary(&frame).expect("decode binary");
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0], binary_payload);

        let sideband = PacketLine::encode_sideband(1, &binary_payload);
        let decoded_sideband = PacketLine::decode_binary(&sideband).expect("decode sideband");
        assert_eq!(decoded_sideband[0][0], 1);
        assert_eq!(&decoded_sideband[0][1..], &binary_payload[..]);
    }

    #[test]
    fn test_packetline_control_and_error_handling() {
        let mut stream = Vec::new();
        stream.extend_from_slice(PKT_FLUSH);
        stream.extend_from_slice(PKT_DELIM);
        stream.extend_from_slice(&PacketLine::encode_line("hello\n"));
        let lines = PacketLine::decode(&stream).expect("decode with control");
        assert_eq!(lines, vec!["hello"]);

        // Reserved 0003
        assert!(PacketLine::decode(b"0003").is_err());
        assert!(PacketLine::decode_binary(b"0003").is_err());

        // Truncated length
        assert!(PacketLine::decode(b"000a12").is_err());
    }
}
