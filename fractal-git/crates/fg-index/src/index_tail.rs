//! Module: fg-index — Git Index Trailing Section (extensions and checksum)
//! File Path: crates/fg-index/src/index_tail.rs
//! Architecture Role: Owns the bytes Git appends after the staged-entry table: the optional
//!   extension records and the trailing SHA-1. Kept apart from the entry decoder so each half of
//!   the DIRC format stays small enough to read on its own.
//! Dependencies & Triggers: Called by the index loader in crate::index_file for every on-disk
//!   index, and by the index writer when a parsed index is rewritten.
//! Responsibilities: Verify the trailing checksum, recognise the zeroed placeholder used for an
//!   absent index, and parse extension records while preserving each signature and payload.
//! Exit Semantics & Design Rationale:
//!   - A checksum mismatch is an error, never a best-effort parse. Silently accepting altered
//!     bytes would let a truncated or hand-edited index look like a valid staging state.
//!   - Extension payloads are kept verbatim because Git stores its cached tree, untracked cache,
//!     and sparse-directory data there; dropping one rewrites what the next Git command reads.
//!   - The zero checksum is accepted only for the three-word header the status layer synthesizes
//!     for an absent index, and only when it declares no entries.

use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use sha1::{Digest, Sha1};

use crate::index_file::{EXTENSION_HEADER_LEN, HEADER_LEN, OID_LEN};

/// Opaque trailing extension record of an index file.
///
/// Git appends optional extension records between the entry table and the trailing checksum. Taxis
/// does not interpret them, but dropping one silently rewrites the index the next Git command
/// reads: the cached tree, the untracked cache, and sparse-directory data all live there. Keeping
/// the signature and payload verbatim lets a parse and rewrite round-trip preserve them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexExtension {
    /// Four-byte extension signature, for example TREE, UNTR, or FSMN.
    pub signature: [u8; 4],
    /// Raw extension payload; the stored length field is derived from its byte length.
    pub data: Vec<u8>,
}

/// Verifies the trailing SHA-1 and returns the byte length of the checksummed payload.
///
/// Git writes the SHA-1 of everything before the trailing twenty bytes. A mismatched digest means
/// the file was truncated, corrupted, or edited behind Git's back, so the read is refused instead of
/// interpreting whatever bytes spell out a plausible staging state.
pub(crate) fn verify_checksum(bytes: &[u8], path: &Path) -> FractalResult<usize> {
    let minimum = HEADER_LEN + OID_LEN;
    if bytes.len() < minimum {
        return Err(FractalError::CorruptStore(format!(
            "index '{}' is {} bytes, shorter than the {minimum} bytes a header and checksum need",
            path.display(),
            bytes.len()
        )));
    }
    let payload_len = bytes.len() - OID_LEN;
    let stored = &bytes[payload_len..];
    let mut hasher = Sha1::new();
    hasher.update(&bytes[..payload_len]);
    let computed: [u8; OID_LEN] = hasher.finalize().into();
    if stored != &computed[..] {
        if is_absent_index_placeholder(bytes, payload_len, stored) {
            return Ok(payload_len);
        }
        return Err(FractalError::CorruptStore(format!(
            "index '{}' checksum mismatch: stored {}, computed {}",
            path.display(),
            hex_string(stored),
            hex_string(&computed)
        )));
    }
    Ok(payload_len)
}

/// Recognises the zeroed placeholder the status and diff layers use for an absent index.
///
/// Those layers synthesize a twelve-byte header with no entries and a zero checksum instead of
/// reading a missing file. A zero-entry index stages nothing, so the placeholder cannot hide
/// content; every index actually read from disk still has to carry the real digest.
fn is_absent_index_placeholder(bytes: &[u8], payload_len: usize, stored: &[u8]) -> bool {
    payload_len == HEADER_LEN && read_u32(bytes, 8) == 0 && stored.iter().all(|byte| *byte == 0)
}

/// Parses the trailing extension records, preserving each signature and payload verbatim.
pub(crate) fn parse_extensions(
    payload: &[u8],
    mut cursor: usize,
    path: &Path,
) -> FractalResult<Vec<IndexExtension>> {
    let mut extensions = Vec::new();
    while cursor < payload.len() {
        let header_end = cursor + EXTENSION_HEADER_LEN;
        if header_end > payload.len() {
            return Err(FractalError::CorruptStore(format!(
                "index '{}' extension header at byte {cursor} overruns the checksummed payload",
                path.display()
            )));
        }
        let mut signature = [0u8; 4];
        signature.copy_from_slice(&payload[cursor..cursor + 4]);
        let declared = read_u32(payload, cursor + 4) as usize;
        let data_end = header_end
            .checked_add(declared)
            .filter(|end| *end <= payload.len());
        let Some(data_end) = data_end else {
            return Err(FractalError::CorruptStore(format!(
                "index '{}' extension '{}' declares {declared} bytes past the payload end",
                path.display(),
                extension_label(&signature)
            )));
        };
        extensions.push(IndexExtension {
            signature,
            data: payload[header_end..data_end].to_vec(),
        });
        cursor = data_end;
    }
    Ok(extensions)
}

/// Renders a four-byte extension signature for diagnostics.
pub(crate) fn extension_label(signature: &[u8; 4]) -> String {
    String::from_utf8_lossy(signature).into_owned()
}

/// Renders bytes as lowercase hexadecimal for checksum diagnostics.
fn hex_string(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut rendered = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let byte = *byte;
        rendered.push(DIGITS[usize::from(byte >> 4)] as char);
        rendered.push(DIGITS[usize::from(byte & 0x0f)] as char);
    }
    rendered
}

/// Reads a big-endian `u32`, yielding zero when the slice is short.
pub(crate) fn read_u32(bytes: &[u8], start: usize) -> u32 {
    match bytes.get(start..start + 4) {
        Some(slice) => u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]),
        None => 0,
    }
}
