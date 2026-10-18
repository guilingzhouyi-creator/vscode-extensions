//! Module: fg-transport — Git Smart Protocol Engine
//! File Path: crates/fg-transport/src/smart_protocol.rs
//! Architecture Role: Implements Git protocol capability advertisement and command negotiation,
//!   enabling standard Git CLI (`git clone`, `git fetch`) to interoperate with Fractal Git.

use crate::packetline::PacketLine;

/// Git Smart Protocol v2 capability advertisement and request parser.
pub struct ProtocolV2Handler;

impl ProtocolV2Handler {
    /// Builds standard Git wire protocol v2 initial capability advertisement.
    pub fn build_advertisement() -> Vec<u8> {
        let mut response = Vec::new();
        response.extend_from_slice(&PacketLine::encode_line("version 2\n"));
        response.extend_from_slice(&PacketLine::encode_line("agent=fractal-git/0.1.0\n"));
        response.extend_from_slice(&PacketLine::encode_line("ls-refs\n"));
        response.extend_from_slice(&PacketLine::encode_line("fetch=shallow\n"));
        response.extend_from_slice(&PacketLine::flush());
        response
    }

    /// Formats an `ls-refs` response line: `<40-hex-oid> <ref_name>\n`.
    pub fn format_ref_line(ref_name: &str, oid_hex: &str) -> Vec<u8> {
        let line = format!("{} {}\n", oid_hex, ref_name);
        PacketLine::encode_line(&line)
    }
}
