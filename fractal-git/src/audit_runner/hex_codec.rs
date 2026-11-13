//! Module: Fractal Git — Dependency-Free Lowercase Hex Codec
//! File Path: src/audit_runner/hex_codec.rs
//! Architecture Role: Converts raw byte digests and HMAC signatures to/from lowercase hex.
//! Dependencies & Triggers: Used internally across `audit_runner`.
//! Responsibilities: Provide panic-free encode and constant-structure decode helpers.
//! Exit Semantics & Design Rationale: Eliminates an extra external hex crate dependency.

const TABLE: &[u8; 16] = b"0123456789abcdef";

pub(super) fn encode(bytes: impl AsRef<[u8]>) -> String {
    let slice = bytes.as_ref();
    let mut out = String::with_capacity(slice.len() * 2);
    for &byte in slice {
        out.push(TABLE[(byte >> 4) as usize] as char);
        out.push(TABLE[(byte & 0x0f) as usize] as char);
    }
    out
}

pub(super) fn decode(hex_str: &str) -> Result<Vec<u8>, ()> {
    let bytes = hex_str.as_bytes();
    if !bytes.len().is_multiple_of(2) {
        return Err(());
    }
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.as_chunks::<2>().0 {
        let high = from_nibble(chunk[0])?;
        let low = from_nibble(chunk[1])?;
        out.push((high << 4) | low);
    }
    Ok(out)
}

const fn from_nibble(byte: u8) -> Result<u8, ()> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(()),
    }
}
