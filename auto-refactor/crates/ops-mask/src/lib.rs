//! Module: Native Acceleration Kernel — Source Masking & Spectrum Extractor
//! Crate: ops-mask
//! Architecture Role: SIMD byte-level scanner for multilang string/comment masking
//! and line statistics, providing 100% byte-parity with ECMAScript UTF-16 AST rules.

use memchr::memchr;

/// Configuration flags for source code comment and literal masking.
#[derive(Debug, Clone)]
pub struct MaskConfig {
    pub line_comment: String,
    pub block_comment: Option<(String, String)>,
    pub quote_chars: String,
    pub multiline_templates: bool,
    pub regex_literals: bool,
}

/// Result of source code masking containing raw/masked line buffers and metrics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaskResult {
    pub raw: Vec<String>,
    pub masked: Vec<String>,
    pub lines: u32,
    pub non_blank_lines: u32,
}

#[derive(Debug, Clone, Default)]
struct MaskState {
    in_block_comment: bool,
    quote: Option<char>,
}

const REGEX_PREFIX_CHARS: &[u8] = b"([{,=:!&|?;+-*%<>";

/// Tests if Unicode code point is ECMAScript whitespace or line terminator.
#[inline]
pub fn is_ecma_whitespace(ch: u32) -> bool {
    matches!(
        ch,
        0x0009..=0x000d
            | 0x0020
            | 0x00a0
            | 0x1680
            | 0x2000..=0x200a
            | 0x2028
            | 0x2029
            | 0x202f
            | 0x205f
            | 0x3000
            | 0xfeff
    )
}

/// Masks comments and string literals in source code according to the language profile.
/// Returns both raw and masked line buffers alongside non-blank line counts.
pub fn mask_source_code(content: &str, config: &MaskConfig) -> MaskResult {
    let mut raw = Vec::new();
    let mut masked = Vec::new();
    let mut non_blank_lines = 0u32;
    let mut state = MaskState::default();

    // Split content by '\n', stripping trailing '\r' if present.
    // Note: empty content yields one empty line in JS ("".split('\n') -> [""])
    for raw_slice in content.split('\n') {
        let line = raw_slice.strip_suffix('\r').unwrap_or(raw_slice);

        // Check if line is non-blank according to ECMAScript trim()
        let is_non_blank = line.chars().any(|c| !is_ecma_whitespace(c as u32));
        if is_non_blank {
            non_blank_lines += 1;
        }

        let masked_line = mask_line(line, &mut state, config);
        raw.push(line.to_string());
        masked.push(masked_line);
    }

    let total_lines = raw.len() as u32;

    MaskResult {
        raw,
        masked,
        lines: total_lines,
        non_blank_lines,
    }
}

fn has_trigger_char(line: &str, config: &MaskConfig) -> bool {
    if config.line_comment.is_empty() {
        return true;
    }

    let b = line.as_bytes();
    for q in config.quote_chars.as_bytes() {
        if memchr(*q, b).is_some() {
            return true;
        }
    }

    if let Some(&first_lc) = config.line_comment.as_bytes().first() {
        if memchr(first_lc, b).is_some() {
            return true;
        }
    }

    if let Some((open, _)) = &config.block_comment {
        if let Some(&first_bc) = open.as_bytes().first() {
            if memchr(first_bc, b).is_some() {
                return true;
            }
        }
    }

    if config.regex_literals && memchr(b'/', b).is_some() {
        return true;
    }

    false
}

fn mask_line(line: &str, state: &mut MaskState, config: &MaskConfig) -> String {
    // Fast path: no open quote or block comment, and no trigger chars present
    if state.quote.is_none() && !state.in_block_comment && !has_trigger_char(line, config) {
        return line.to_string();
    }

    // Fast path: wholly inside a block comment and contains no closing delimiter
    if let Some((_, close)) = &config.block_comment {
        if state.in_block_comment
            && state.quote.is_none()
            && !close.is_empty()
            && !line.contains(close)
        {
            let space_count = if line.is_ascii() {
                line.len()
            } else {
                line.encode_utf16().count()
            };
            return " ".repeat(space_count);
        }
    }

    if line.is_ascii() {
        mask_line_ascii(line.as_bytes(), state, config)
    } else {
        mask_line_utf16(line, state, config)
    }
}

fn opens_regex_literal_ascii(line: &[u8], index: usize) -> bool {
    let mut back = index as isize - 1;
    while back >= 0 {
        let b = line[back as usize];
        if b != b' ' && b != b'\t' {
            return REGEX_PREFIX_CHARS.contains(&b);
        }
        back -= 1;
    }
    true
}

fn mask_regex_body_ascii(line: &[u8], index: usize, out: &mut [u8]) -> usize {
    out[index] = b' ';
    let mut cursor = index + 1;
    let mut in_class = false;
    let len = line.len();

    while cursor < len {
        let b = line[cursor];
        out[cursor] = b' ';
        if b == b'\\' {
            if cursor + 1 < len {
                out[cursor + 1] = b' ';
            }
            cursor += 2;
            continue;
        }
        if b == b'[' {
            in_class = true;
        } else if b == b']' {
            in_class = false;
        } else if b == b'/' && !in_class {
            cursor += 1;
            while cursor < len && line[cursor].is_ascii_alphabetic() {
                out[cursor] = b' ';
                cursor += 1;
            }
            return cursor;
        }
        cursor += 1;
    }
    cursor
}

fn mask_line_ascii(line: &[u8], state: &mut MaskState, config: &MaskConfig) -> String {
    let len = line.len();
    let mut out = line.to_vec();
    let mut index = 0;

    let lc_bytes = config.line_comment.as_bytes();
    let bc_open_bytes = config.block_comment.as_ref().map(|(o, _)| o.as_bytes());
    let bc_close_bytes = config.block_comment.as_ref().map(|(_, c)| c.as_bytes());
    let quote_bytes = config.quote_chars.as_bytes();

    while index < len {
        if let Some(active_quote) = state.quote {
            let q_byte = active_quote as u8;
            out[index] = b' ';
            let b = line[index];
            if b == b'\\' {
                if index + 1 < len {
                    out[index + 1] = b' ';
                }
                index += 2;
                continue;
            }
            if b == q_byte {
                state.quote = None;
            }
            index += 1;
            continue;
        }

        if state.in_block_comment {
            if let Some(close) = bc_close_bytes {
                if !close.is_empty() && line[index..].starts_with(close) {
                    for offset in 0..close.len() {
                        out[index + offset] = b' ';
                    }
                    state.in_block_comment = false;
                    index += close.len();
                    continue;
                }
            }
            out[index] = b' ';
            index += 1;
            continue;
        }

        // Code mode: check comments
        if !lc_bytes.is_empty() && line[index..].starts_with(lc_bytes) {
            out[index..len].fill(b' ');
            return String::from_utf8(out).unwrap_or_default();
        }

        if let Some(open) = bc_open_bytes {
            if !open.is_empty() && line[index..].starts_with(open) {
                for offset in 0..open.len() {
                    out[index + offset] = b' ';
                }
                state.in_block_comment = true;
                index += open.len();
                continue;
            }
        }

        let b = line[index];
        if config.regex_literals && b == b'/' && opens_regex_literal_ascii(line, index) {
            index = mask_regex_body_ascii(line, index, &mut out);
            continue;
        }

        if quote_bytes.contains(&b) {
            let quote_char = b as char;
            state.quote = if quote_char == '`' && !config.multiline_templates {
                None
            } else {
                Some(quote_char)
            };
            out[index] = b' ';
            index += 1;
            continue;
        }

        index += 1;
    }

    String::from_utf8(out).unwrap_or_default()
}

fn opens_regex_literal_u16(units: &[u16], index: usize) -> bool {
    let mut back = index as isize - 1;
    while back >= 0 {
        let u = units[back as usize];
        if u != 0x20 && u != 0x09 {
            return u <= 127 && REGEX_PREFIX_CHARS.contains(&(u as u8));
        }
        back -= 1;
    }
    true
}

fn mask_regex_body_u16(units: &[u16], index: usize, out: &mut [u16]) -> usize {
    out[index] = 0x20;
    let mut cursor = index + 1;
    let mut in_class = false;
    let len = units.len();

    while cursor < len {
        let u = units[cursor];
        out[cursor] = 0x20;
        if u == b'\\' as u16 {
            if cursor + 1 < len {
                out[cursor + 1] = 0x20;
            }
            cursor += 2;
            continue;
        }
        if u == b'[' as u16 {
            in_class = true;
        } else if u == b']' as u16 {
            in_class = false;
        } else if u == b'/' as u16 && !in_class {
            cursor += 1;
            while cursor < len
                && (units[cursor] <= 127 && (units[cursor] as u8).is_ascii_alphabetic())
            {
                out[cursor] = 0x20;
                cursor += 1;
            }
            return cursor;
        }
        cursor += 1;
    }
    cursor
}

fn mask_line_utf16(line: &str, state: &mut MaskState, config: &MaskConfig) -> String {
    let units: Vec<u16> = line.encode_utf16().collect();
    let len = units.len();
    let mut out = units.clone();
    let mut index = 0;

    let lc_units: Vec<u16> = config.line_comment.encode_utf16().collect();
    let bc_open_units: Option<Vec<u16>> = config
        .block_comment
        .as_ref()
        .map(|(o, _)| o.encode_utf16().collect());
    let bc_close_units: Option<Vec<u16>> = config
        .block_comment
        .as_ref()
        .map(|(_, c)| c.encode_utf16().collect());
    let quote_units: Vec<u16> = config.quote_chars.encode_utf16().collect();

    while index < len {
        if let Some(active_quote) = state.quote {
            let q_u16 = active_quote as u16;
            out[index] = 0x20;
            let u = units[index];
            if u == b'\\' as u16 {
                if index + 1 < len {
                    out[index + 1] = 0x20;
                }
                index += 2;
                continue;
            }
            if u == q_u16 {
                state.quote = None;
            }
            index += 1;
            continue;
        }

        if state.in_block_comment {
            if let Some(close) = &bc_close_units {
                if !close.is_empty() && units[index..].starts_with(close) {
                    for offset in 0..close.len() {
                        out[index + offset] = 0x20;
                    }
                    state.in_block_comment = false;
                    index += close.len();
                    continue;
                }
            }
            out[index] = 0x20;
            index += 1;
            continue;
        }

        if !lc_units.is_empty() && units[index..].starts_with(&lc_units) {
            out[index..len].fill(0x20);
            return String::from_utf16_lossy(&out);
        }

        if let Some(open) = &bc_open_units {
            if !open.is_empty() && units[index..].starts_with(open) {
                for offset in 0..open.len() {
                    out[index + offset] = 0x20;
                }
                state.in_block_comment = true;
                index += open.len();
                continue;
            }
        }

        let u = units[index];
        if config.regex_literals && u == b'/' as u16 && opens_regex_literal_u16(&units, index) {
            index = mask_regex_body_u16(&units, index, &mut out);
            continue;
        }

        if quote_units.contains(&u) {
            let quote_char = (u as u8) as char;
            state.quote = if quote_char == '`' && !config.multiline_templates {
                None
            } else {
                Some(quote_char)
            };
            out[index] = 0x20;
            index += 1;
            continue;
        }

        index += 1;
    }

    String::from_utf16_lossy(&out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c_family_config() -> MaskConfig {
        MaskConfig {
            line_comment: "//".to_string(),
            block_comment: Some(("/*".to_string(), "*/".to_string())),
            quote_chars: "'\"`".to_string(),
            multiline_templates: true,
            regex_literals: true,
        }
    }

    #[test]
    fn test_mask_comments_and_strings() {
        let code = "const a = 'hello'; // comment\nconst b = 10; /* block */ const c = 20;";
        let res = mask_source_code(code, &c_family_config());
        assert_eq!(res.lines, 2);
        assert_eq!(res.non_blank_lines, 2);
        assert_eq!(res.masked[0], "const a =        ;           ");
        assert_eq!(res.masked[1], "const b = 10;             const c = 20;");
    }

    #[test]
    fn test_multiline_block_comment() {
        let code = "/* start\n middle\n end */ code";
        let res = mask_source_code(code, &c_family_config());
        assert_eq!(res.lines, 3);
        assert_eq!(res.masked[0], "        ");
        assert_eq!(res.masked[1], "       ");
        assert_eq!(res.masked[2], "        code");
    }

    #[test]
    fn test_regex_masking() {
        let code = "const re = /abc[0-9]\\//gi; const div = a / b / c;";
        let res = mask_source_code(code, &c_family_config());
        assert_eq!(
            res.masked[0],
            "const re =               ; const div = a / b / c;"
        );
    }

    #[test]
    fn test_chinese_and_unicode_char_count() {
        let code = "const msg = '你好世界'; // 这是注释";
        let res = mask_source_code(code, &c_family_config());
        assert_eq!(
            res.raw[0].encode_utf16().count(),
            res.masked[0].encode_utf16().count()
        );
        assert!(res.masked[0].starts_with("const msg = "));
    }
}
