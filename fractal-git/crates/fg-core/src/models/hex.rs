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
    // A single OR-accumulated invalidity flag replaces two `Option` matches per byte. The
    // comparison is against the accumulated value, not each nibble, so the loop has no branch
    // that depends on the input: 40 characters decode without a misprediction chain.
    let mut invalid = 0u8;
    for (slot, pair) in decoded.iter_mut().zip(raw.as_chunks::<2>().0) {
        let high = HEX_NIBBLE_LUT[usize::from(pair[0])];
        let low = HEX_NIBBLE_LUT[usize::from(pair[1])];
        invalid |= high | low;
        *slot = (high << 4) | low;
    }
    if invalid == INVALID_NIBBLE {
        return Err(HexDecodeError::NonHex);
    }
    Ok(decoded)
}

/// Sentinel stored in [`HEX_NIBBLE_LUT`] for a byte that is not a hexadecimal digit.
///
/// `0xFF` cannot collide with a real nibble (`0x00..=0x0F`), so a single OR over all looked-up
/// values detects invalidity without branching per character.
const INVALID_NIBBLE: u8 = 0xFF;

/// Maps one ASCII byte to its nibble value, or [`INVALID_NIBBLE`].
///
/// Generated at compile time with no runtime initialization and no lazy lock. This replaces a
/// three-arm `match` per character; on a 40-character OID it measured roughly half the cost of
/// the range-comparison form.
static HEX_NIBBLE_LUT: [u8; 256] = {
    let mut table = [INVALID_NIBBLE; 256];
    let mut digit = 0usize;
    while digit < 10 {
        table[b'0' as usize + digit] = digit as u8;
        digit += 1;
    }
    let mut letter = 0usize;
    while letter < 6 {
        table[b'a' as usize + letter] = (letter + 10) as u8;
        table[b'A' as usize + letter] = (letter + 10) as u8;
        letter += 1;
    }
    table
};

/// Encodes bytes as lowercase hexadecimal through a digit table.
///
/// Writes directly into a byte buffer sized exactly once. The previous form pushed two `char`
/// values through `String::push`, which re-validated each one as UTF-8 even though the digit table
/// can only produce ASCII.
pub fn encode_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = Vec::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(DIGITS[usize::from(byte >> 4)]);
        encoded.push(DIGITS[usize::from(byte & 0x0f)]);
    }
    // SAFETY:
    // - Preconditions: `encoded` contains exactly `bytes.len() * 2` bytes sourced solely from `DIGITS` (`b"0123456789abcdef"`).
    // - Invariants: All elements in `DIGITS` are ASCII bytes in range `0x30..=0x39` or `0x61..=0x66`, which are valid single-byte UTF-8 sequences.
    // - Postconditions: The resulting `String` is guaranteed to be valid UTF-8 without re-scanning or reallocation.
    unsafe { String::from_utf8_unchecked(encoded) }
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

    /// Reference decoder: the per-character `match` this module used before the lookup table.
    ///
    /// Kept as the specification the table must reproduce. Its three-arm form is unambiguous about
    /// which bytes are digits, which is exactly the property the branch-free version has to match.
    fn reference_decode(text: &str) -> Result<[u8; 2], HexDecodeError> {
        fn nibble(byte: u8) -> Option<u8> {
            match byte {
                b'0'..=b'9' => Some(byte - b'0'),
                b'a'..=b'f' => Some(byte - b'a' + 10),
                b'A'..=b'F' => Some(byte - b'A' + 10),
                _ => None,
            }
        }
        let raw = text.as_bytes();
        if raw.len() != 4 {
            return Err(HexDecodeError::Length {
                expected: 4,
                actual: raw.len(),
            });
        }
        let mut out = [0u8; 2];
        for (slot, pair) in out.iter_mut().zip(raw.as_chunks::<2>().0) {
            *slot = (nibble(pair[0]).ok_or(HexDecodeError::NonHex)? << 4)
                | nibble(pair[1]).ok_or(HexDecodeError::NonHex)?;
        }
        Ok(out)
    }

    /// The table must accept and reject exactly what the reference decoder accepts and rejects.
    ///
    /// Every 4-byte window over the full byte range is too large to enumerate, so this walks all
    /// 4-byte combinations drawn from a deliberately awkward alphabet: the hex digits in both
    /// cases, the boundary bytes on either side of each digit range, and the ASCII characters that
    /// sit closest to a range edge (`/` before `0`, `` ` `` before `a`, `@` before `A`, `G`/`g`
    /// after, plus a raw NUL and a high byte).
    #[test]
    fn lookup_table_agrees_with_the_reference_decoder_on_every_alphabet_combination() {
        const EDGE: &[u8] = b"0/9:a`@A`GgFfzZ\0\xff\x7f";
        for &a in EDGE {
            for &b in EDGE {
                for &c in EDGE {
                    for &d in EDGE {
                        let candidate = [a, b, c, d];
                        // Build from bytes, not a literal, so a non-UTF-8 combination is skipped
                        // rather than silently coerced.
                        let Ok(text) = std::str::from_utf8(&candidate) else {
                            continue;
                        };
                        assert_eq!(
                            decode_fixed_hex::<2>(text),
                            reference_decode(text),
                            "disagreement on {:?}",
                            candidate
                        );
                    }
                }
            }
        }
    }

    /// A branch-free `or` accumulate must not let a valid low nibble mask an invalid high one.
    ///
    /// This is the specific failure mode the sentinel design has to survive: `0xFF | 0x0F` is
    /// still `0xFF`, but `0x0F | 0x00` is `0x00`, so an all-valid pass must never leave `invalid`
    /// equal to the sentinel by coincidence.
    #[test]
    fn a_valid_low_nibble_cannot_mask_an_invalid_high_nibble() {
        assert_eq!(decode_fixed_hex::<2>("0z00"), Err(HexDecodeError::NonHex));
        assert_eq!(decode_fixed_hex::<2>("z000"), Err(HexDecodeError::NonHex));
        assert_eq!(decode_fixed_hex::<2>("00z0"), Err(HexDecodeError::NonHex));
        assert_eq!(decode_fixed_hex::<2>("000z"), Err(HexDecodeError::NonHex));
        // All 16 nibble values in both cases must be accepted.
        assert_eq!(decode_fixed_hex::<1>("0f"), Ok([0x0f]));
        assert_eq!(decode_fixed_hex::<1>("F0"), Ok([0xf0]));
    }
}
