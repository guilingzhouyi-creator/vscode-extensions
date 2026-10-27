//! Module: fg-core — Fixed-Width Hexadecimal Codec
//! File Path: crates/fg-core/src/models/hex.rs
//! Architecture Role: Single decoder for every fixed-width hexadecimal identifier in the domain
//!   (object OID, change identifier, file UID, authority secret, token MAC segment).
//! Dependencies & Triggers: Consumed by models::{oid, change_id, file_uid, authority}.
//! Responsibilities:
//!   1. Decode a fixed-width hex string into a byte array sized by the caller;
//!   2. Separate length failures from character failures so each caller keeps its own wording;
//!   3. Encode bytes to lowercase hex through a digit table, without per-byte formatting.
//!
//! Exit Semantics & Design Rationale: Slicing a `&str` by byte offset panics whenever a multi-byte
//!   character straddles the boundary, and separate copies of that slice-based decoder had
//!   accumulated across the domain models. Decoding therefore works on `as_bytes()` and never
//!   builds a substring: the length is compared before any indexing, and the loop walks byte pairs
//!   through fixed-width chunks, so no index can escape the caller-declared width and the panic
//!   path does not exist.

/// Why a fixed-width hexadecimal decode failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HexDecodeError {
    /// The input held a different number of bytes than the width requires.
    Length {
        /// Byte count the width demands (twice the decoded byte count).
        expected: usize,
        /// Byte count actually present.
        actual: usize,
    },
    /// The input held a byte outside `0-9`, `a-f` or `A-F`.
    NonHex,
}

/// Decodes exactly `N * 2` hexadecimal characters into `N` bytes.
///
/// # Examples
///
/// ```
/// use fg_core::models::hex::decode_fixed_hex;
///
/// assert_eq!(decode_fixed_hex::<2>("0aff"), Ok([0x0a, 0xff]));
/// assert!(decode_fixed_hex::<2>("0af").is_err());
/// ```
///
/// # Errors
///
/// Returns `HexDecodeError::Length` when the byte length differs from `N * 2`, and
/// `HexDecodeError::NonHex` when any byte is not a hexadecimal digit. A multi-byte character
/// yields `NonHex` rather than a panic, because its constituent bytes are never valid digits.
pub fn decode_fixed_hex<const N: usize>(text: &str) -> Result<[u8; N], HexDecodeError> {
    let raw = text.as_bytes();
    if raw.len() != N * 2 {
        return Err(HexDecodeError::Length {
            expected: N * 2,
            actual: raw.len(),
        });
    }

    let mut decoded = [0u8; N];
    for (slot, pair) in decoded.iter_mut().zip(raw.as_chunks::<2>().0) {
        let high = hex_nibble(pair[0]).ok_or(HexDecodeError::NonHex)?;
        let low = hex_nibble(pair[1]).ok_or(HexDecodeError::NonHex)?;
        *slot = (high << 4) | low;
    }
    Ok(decoded)
}

/// Encodes bytes as lowercase hexadecimal through a digit table.
pub fn encode_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(DIGITS[usize::from(byte >> 4)]));
        encoded.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    encoded
}

/// Maps one ASCII byte to its nibble value.
fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_upper_and_lower_digits() {
        assert_eq!(
            decode_fixed_hex::<4>("DEADbeef"),
            Ok([0xde, 0xad, 0xbe, 0xef])
        );
    }

    #[test]
    fn rejects_wrong_length_without_panicking() {
        assert_eq!(
            decode_fixed_hex::<20>("ab"),
            Err(HexDecodeError::Length {
                expected: 40,
                actual: 2
            })
        );
    }

    /// A multi-byte character makes the byte count reach the expected width while the character
    /// count falls short, which is exactly the shape that used to drive the slice decoder past a
    /// character boundary.
    #[test]
    fn rejects_multibyte_input_instead_of_slicing_it() {
        let craft = format!("{}é{}", "a".repeat(37), "a");
        assert_eq!(craft.len(), 40);
        assert_eq!(craft.chars().count(), 39);
        assert_eq!(decode_fixed_hex::<20>(&craft), Err(HexDecodeError::NonHex));
    }

    #[test]
    fn encode_roundtrips_through_decode() {
        let bytes = [0x00u8, 0x7f, 0x80, 0xff];
        let encoded = encode_hex(&bytes);
        assert_eq!(encoded, "007f80ff");
        assert_eq!(decode_fixed_hex::<4>(&encoded), Ok(bytes));
    }
}
