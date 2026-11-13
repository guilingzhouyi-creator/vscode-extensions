//! Module: Native Acceleration Kernel — ASCII Delimiter Preflight & Literal Helpers
//! Crate: ops-mask
//! Architecture Role: Houses low-nesting ASCII delimiter probes (`memchr` preflight),
//!   regex literal scanners, and Rust raw-string literal parsers for `ops-mask`.
//! Dependencies & Triggers: Invoked by `ops-mask::lib` and `ops-mask::ascii`.
//! Responsibilities:
//!   1. Check trigger byte presence via `memchr` to enable fast passthrough lines.
//!   2. Mask ASCII regex literals while honoring backslash escapes and character classes.
//!   3. Parse and mask single-line and multi-line Rust raw string literals (`r#"..."#`).

use memchr::memchr;

use crate::{MaskConfig, MaskState, REGEX_PREFIX_CHARS};

/// Checks block-comment, regex, and HTML-comment trigger bytes in an ASCII line.
#[inline]
fn has_comment_or_markup_trigger(bytes: &[u8], config: &MaskConfig) -> bool {
    if let Some((open, _)) = &config.block_comment {
        if let Some(&first_bc) = open.as_bytes().first() {
            if memchr(first_bc, bytes).is_some() {
                return true;
            }
        }
    }
    if config.regex_literals && memchr(b'/', bytes).is_some() {
        return true;
    }
    config.html_comment && memchr(b'<', bytes).is_some()
}

/// Returns `true` if `line` may contain any comment, quote, or literal delimiter.
pub(crate) fn has_trigger_char(line: &str, config: &MaskConfig) -> bool {
    if config.line_comment.is_empty() {
        return true;
    }

    let bytes = line.as_bytes();
    for &quote_byte in config.quote_chars.as_bytes() {
        if memchr(quote_byte, bytes).is_some() {
            return true;
        }
    }

    if let Some(&first_lc) = config.line_comment.as_bytes().first() {
        if memchr(first_lc, bytes).is_some() {
            return true;
        }
    }

    has_comment_or_markup_trigger(bytes, config)
}

/// Checks whether `/` at `index` can open an ECMAScript regex literal based on prior token byte.
pub(crate) fn opens_regex_literal_ascii(line: &[u8], index: usize) -> bool {
    let mut back = index as isize - 1;
    while back >= 0 {
        let byte_val = line[back as usize];
        if byte_val != b' ' && byte_val != b'\t' {
            return REGEX_PREFIX_CHARS.contains(&byte_val);
        }
        back -= 1;
    }
    true
}

/// Masks trailing alphabetic regex flags (e.g. `gi`) following the closing `/`.
#[inline]
fn advance_regex_flags_ascii(line: &[u8], mut cursor: usize, out: &mut [u8]) -> usize {
    let len = line.len();
    while cursor < len && line[cursor].is_ascii_alphabetic() {
        out[cursor] = b' ';
        cursor += 1;
    }
    cursor
}

#[inline]
fn step_regex_escape_ascii(out: &mut [u8], cursor: usize, len: usize) -> usize {
    if cursor + 1 < len {
        out[cursor + 1] = b' ';
    }
    cursor + 2
}

/// Masks an ASCII regex literal starting at `index` and returns the next scan cursor.
pub(crate) fn mask_regex_body_ascii(line: &[u8], index: usize, out: &mut [u8]) -> usize {
    out[index] = b' ';
    let mut cursor = index + 1;
    let mut in_class = false;
    let len = line.len();

    while cursor < len {
        let byte_val = line[cursor];
        out[cursor] = b' ';
        if byte_val == b'\\' {
            cursor = step_regex_escape_ascii(out, cursor, len);
            continue;
        }
        if byte_val == b'[' {
            in_class = true;
        } else if byte_val == b']' {
            in_class = false;
        } else if byte_val == b'/' && !in_class {
            return advance_regex_flags_ascii(line, cursor + 1, out);
        }
        cursor += 1;
    }
    cursor
}

/// Parses a Rust raw-string opening prefix (`r#"`, `br#"`, `cr#"`) at `start`.
fn parse_raw_string_open_ascii(line: &[u8], start: usize) -> Option<(usize, usize)> {
    if start > 0 {
        let prev = line[start - 1];
        if prev.is_ascii_alphanumeric() || prev == b'_' {
            return None;
        }
    }
    let r_pos = if line[start] == b'r' {
        start
    } else {
        start + 1
    };
    let mut pos = r_pos + 1;
    let mut hashes = 0usize;
    while pos < line.len() && line[pos] == b'#' {
        hashes += 1;
        pos += 1;
    }
    if pos >= line.len() || line[pos] != b'"' {
        return None;
    }
    Some((pos, hashes))
}

/// Scans forward from `start` for a matching `"` followed by `hashes` `#` bytes.
fn find_raw_string_close_ascii(
    line: &[u8],
    start: usize,
    hashes: usize,
    out: &mut [u8],
) -> Option<usize> {
    let len = line.len();
    let mut cursor = start;
    while cursor < len {
        out[cursor] = b' ';
        let close_end = cursor + 1 + hashes;
        if line[cursor] == b'"'
            && close_end <= len
            && line[cursor + 1..close_end].iter().all(|&ch| ch == b'#')
        {
            out[cursor + 1..close_end].fill(b' ');
            return Some(close_end);
        }
        cursor += 1;
    }
    None
}

/// Scans and masks a Rust raw string literal starting at `start`, updating `state` if unclosed.
pub(crate) fn scan_raw_string_ascii(
    line: &[u8],
    start: usize,
    out: &mut [u8],
    state: &mut MaskState,
) -> Option<usize> {
    let (quote_pos, hashes) = parse_raw_string_open_ascii(line, start)?;
    out[start..=quote_pos].fill(b' ');

    if let Some(close_end) = find_raw_string_close_ascii(line, quote_pos + 1, hashes, out) {
        state.raw_string = None;
        return Some(close_end);
    }

    state.raw_string = Some(hashes);
    Some(line.len())
}

#[inline]
pub(crate) fn step_raw_string_continuation_ascii(
    line: &[u8],
    out: &mut [u8],
    state: &mut MaskState,
    hashes: usize,
    index: usize,
    len: usize,
) -> usize {
    out[index] = b' ';
    let closes_raw = line[index] == b'"'
        && index + 1 + hashes <= len
        && line[index + 1..index + 1 + hashes]
            .iter()
            .all(|&c| c == b'#');
    if closes_raw {
        out[index + 1..=index + hashes].fill(b' ');
        state.raw_string = None;
        return index + 1 + hashes;
    }
    index + 1
}

#[inline]
pub(crate) fn is_raw_string_candidate_ascii(line: &[u8], index: usize, len: usize) -> bool {
    let b = line[index];
    b == b'r' || ((b == b'b' || b == b'c') && index + 1 < len && line[index + 1] == b'r')
}

#[inline]
pub(crate) fn step_active_quote_ascii(
    line: &[u8],
    out: &mut [u8],
    state: &mut MaskState,
    active_quote: char,
    index: usize,
    len: usize,
) -> usize {
    out[index] = b' ';
    let b = line[index];
    if b == b'\\' {
        if index + 1 < len {
            out[index + 1] = b' ';
        }
        return index + 2;
    }
    if b == active_quote as u8 {
        state.quote = None;
    }
    index + 1
}

#[inline]
pub(crate) fn step_block_comment_ascii(
    line: &[u8],
    out: &mut [u8],
    state: &mut MaskState,
    bc_close_bytes: Option<&[u8]>,
    index: usize,
) -> usize {
    if let Some(close) = bc_close_bytes {
        if !close.is_empty() && line[index..].starts_with(close) {
            out[index..index + close.len()].fill(b' ');
            state.in_block_comment = false;
            return index + close.len();
        }
    }
    out[index] = b' ';
    index + 1
}

#[inline]
pub(crate) fn step_html_comment_ascii(
    line: &[u8],
    out: &mut [u8],
    state: &mut MaskState,
    index: usize,
) -> usize {
    if line[index..].starts_with(b"-->") {
        out[index..index + 3].fill(b' ');
        state.in_html_comment = false;
        return index + 3;
    }
    out[index] = b' ';
    index + 1
}

#[inline]
pub(crate) fn step_open_quote_ascii(
    out: &mut [u8],
    state: &mut MaskState,
    b: u8,
    multiline_templates: bool,
    index: usize,
) -> usize {
    let quote_char = b as char;
    state.quote = if quote_char == '`' && !multiline_templates {
        None
    } else {
        Some(quote_char)
    };
    out[index] = b' ';
    index + 1
}
