//! Module: Native Acceleration Kernel — UTF-16 Literal & Regex Helpers
//! Crate: ops-mask
//! Architecture Role: Houses low-nesting UTF-16 regex literal scanners and Rust raw-string
//!   parsers preserving 100% surrogate-unit parity with ECMAScript UTF-16 indexing.
//! Dependencies & Triggers: Invoked by `ops-mask::lib` and `ops-mask::utf16`.
//! Responsibilities:
//!   1. Check preceding token unit for UTF-16 regex literal disambiguation.
//!   2. Mask UTF-16 regex literals while honoring escapes and character classes.
//!   3. Parse and mask single-line and multi-line Rust raw strings on UTF-16 units.

use crate::{MaskState, REGEX_PREFIX_CHARS};

/// Checks whether `/` at `index` can open an ECMAScript regex literal on UTF-16 units.
pub(crate) fn opens_regex_literal_u16(units: &[u16], index: usize) -> bool {
    let mut back = index as isize - 1;
    while back >= 0 {
        let unit = units[back as usize];
        if unit != 0x20 && unit != 0x09 {
            return unit <= 127 && REGEX_PREFIX_CHARS.contains(&(unit as u8));
        }
        back -= 1;
    }
    true
}

/// Masks trailing alphabetic regex flags (e.g. `gi`) following the closing `/` on UTF-16 units.
#[inline]
fn advance_regex_flags_u16(units: &[u16], mut cursor: usize, out: &mut [u16]) -> usize {
    let len = units.len();
    while cursor < len && units[cursor] <= 127 && (units[cursor] as u8).is_ascii_alphabetic() {
        out[cursor] = 0x20;
        cursor += 1;
    }
    cursor
}

/// Masks a UTF-16 regex literal starting at `index` and returns the next scan cursor.
pub(crate) fn mask_regex_body_u16(units: &[u16], index: usize, out: &mut [u16]) -> usize {
    out[index] = 0x20;
    let mut cursor = index + 1;
    let mut in_class = false;
    let len = units.len();

    while cursor < len {
        let unit = units[cursor];
        out[cursor] = 0x20;
        if unit == b'\\' as u16 {
            if cursor + 1 < len {
                out[cursor + 1] = 0x20;
            }
            cursor += 2;
            continue;
        }
        if unit == b'[' as u16 {
            in_class = true;
        } else if unit == b']' as u16 {
            in_class = false;
        } else if unit == b'/' as u16 && !in_class {
            return advance_regex_flags_u16(units, cursor + 1, out);
        }
        cursor += 1;
    }
    cursor
}

/// Parses a Rust raw-string opening prefix (`r#"`, `br#"`, `cr#"`) on UTF-16 units.
fn parse_raw_string_open_u16(units: &[u16], start: usize) -> Option<(usize, usize)> {
    if start > 0 {
        let prev = units[start - 1];
        if (prev <= 127 && (prev as u8).is_ascii_alphanumeric()) || prev == b'_' as u16 {
            return None;
        }
    }
    let r_pos = if units[start] == b'r' as u16 {
        start
    } else {
        start + 1
    };
    let mut pos = r_pos + 1;
    let mut hashes = 0usize;
    while pos < units.len() && units[pos] == b'#' as u16 {
        hashes += 1;
        pos += 1;
    }
    if pos >= units.len() || units[pos] != b'"' as u16 {
        return None;
    }
    Some((pos, hashes))
}

/// Scans forward from `start` for a matching `"` followed by `hashes` `#` UTF-16 units.
fn find_raw_string_close_u16(
    units: &[u16],
    start: usize,
    hashes: usize,
    out: &mut [u16],
) -> Option<usize> {
    let len = units.len();
    let mut cursor = start;
    while cursor < len {
        out[cursor] = 0x20;
        let close_end = cursor + 1 + hashes;
        if units[cursor] == b'"' as u16
            && close_end <= len
            && units[cursor + 1..close_end]
                .iter()
                .all(|&c| c == b'#' as u16)
        {
            out[cursor + 1..close_end].fill(0x20);
            return Some(close_end);
        }
        cursor += 1;
    }
    None
}

/// Scans and masks a Rust raw string literal on UTF-16 units, updating `state` if unclosed.
pub(crate) fn scan_raw_string_u16(
    units: &[u16],
    start: usize,
    out: &mut [u16],
    state: &mut MaskState,
) -> Option<usize> {
    let (quote_pos, hashes) = parse_raw_string_open_u16(units, start)?;
    out[start..=quote_pos].fill(0x20);

    if let Some(close_end) = find_raw_string_close_u16(units, quote_pos + 1, hashes, out) {
        state.raw_string = None;
        return Some(close_end);
    }

    state.raw_string = Some(hashes);
    Some(units.len())
}
