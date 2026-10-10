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
    raw_string: Option<usize>,
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
    let initial_capacity = content.lines().count().max(16);
    let mut raw = Vec::with_capacity(initial_capacity);
    let mut masked = Vec::with_capacity(initial_capacity);
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
    // Fast path: no open quote or block comment, no raw string, and no trigger chars present
    if state.quote.is_none()
        && !state.in_block_comment
        && state.raw_string.is_none()
        && !has_trigger_char(line, config)
    {
        return line.to_string();
    }

    // Fast path: wholly inside a block comment and contains no closing delimiter
    if let Some((_, close)) = &config.block_comment {
        if state.in_block_comment
            && state.quote.is_none()
            && state.raw_string.is_none()
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

    // Fast path: wholly inside a raw string and contains no quote delimiter
    if state.raw_string.is_some() && !line.contains('"') {
        let space_count = if line.is_ascii() {
            line.len()
        } else {
            line.encode_utf16().count()
        };
        return " ".repeat(space_count);
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

fn scan_raw_string_ascii(
    line: &[u8],
    start: usize,
    out: &mut [u8],
    state: &mut MaskState,
) -> Option<usize> {
    let len = line.len();
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
    let mut hashes = 0;
    while pos < len && line[pos] == b'#' {
        hashes += 1;
        pos += 1;
    }

    if pos >= len || line[pos] != b'"' {
        return None;
    }

    out[start..=pos].fill(b' ');

    let mut cursor = pos + 1;
    while cursor < len {
        out[cursor] = b' ';
        if line[cursor] == b'"'
            && cursor + 1 + hashes <= len
            && line[cursor + 1..cursor + 1 + hashes]
                .iter()
                .all(|&c| c == b'#')
        {
            for offset in 1..=hashes {
                out[cursor + offset] = b' ';
            }
            state.raw_string = None;
            return Some(cursor + 1 + hashes);
        }
        cursor += 1;
    }

    state.raw_string = Some(hashes);
    Some(len)
}

#[inline]
fn step_raw_string_continuation_ascii(
    line: &[u8],
    out: &mut [u8],
    state: &mut MaskState,
    hashes: usize,
    index: usize,
    len: usize,
) -> usize {
    out[index] = b' ';
    if line[index] == b'"'
        && index + 1 + hashes <= len
        && line[index + 1..index + 1 + hashes]
            .iter()
            .all(|&c| c == b'#')
    {
        for offset in 1..=hashes {
            out[index + offset] = b' ';
        }
        state.raw_string = None;
        return index + 1 + hashes;
    }
    index + 1
}

#[inline]
fn is_raw_string_candidate_ascii(line: &[u8], index: usize, len: usize) -> bool {
    let b = line[index];
    b == b'r' || ((b == b'b' || b == b'c') && index + 1 < len && line[index + 1] == b'r')
}

#[inline]
fn step_active_quote_ascii(
    line: &[u8],
    out: &mut [u8],
    state: &mut MaskState,
    active_quote: char,
    index: usize,
    len: usize,
) -> usize {
    let q_byte = active_quote as u8;
    out[index] = b' ';
    let b = line[index];
    if b == b'\\' {
        if index + 1 < len {
            out[index + 1] = b' ';
        }
        return index + 2;
    }
    if b == q_byte {
        state.quote = None;
    }
    index + 1
}

#[inline]
fn step_block_comment_ascii(
    line: &[u8],
    out: &mut [u8],
    state: &mut MaskState,
    bc_close_bytes: Option<&[u8]>,
    index: usize,
) -> usize {
    if let Some(close) = bc_close_bytes {
        if !close.is_empty() && line[index..].starts_with(close) {
            for offset in 0..close.len() {
                out[index + offset] = b' ';
            }
            state.in_block_comment = false;
            return index + close.len();
        }
    }
    out[index] = b' ';
    index + 1
}

#[inline]
fn step_open_quote_ascii(
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

fn mask_line_ascii(line: &[u8], state: &mut MaskState, config: &MaskConfig) -> String {
    let len = line.len();
    let mut out = line.to_vec();
    let mut index = 0;

    let lc_bytes = config.line_comment.as_bytes();
    let bc_open_bytes = config.block_comment.as_ref().map(|(o, _)| o.as_bytes());
    let bc_close_bytes = config.block_comment.as_ref().map(|(_, c)| c.as_bytes());
    let quote_bytes = config.quote_chars.as_bytes();
    let has_double_quote = quote_bytes.contains(&b'"');

    while index < len {
        if let Some(active_quote) = state.quote {
            index = step_active_quote_ascii(line, &mut out, state, active_quote, index, len);
            continue;
        }

        if let Some(hashes) = state.raw_string {
            index = step_raw_string_continuation_ascii(line, &mut out, state, hashes, index, len);
            continue;
        }

        if state.in_block_comment {
            index = step_block_comment_ascii(line, &mut out, state, bc_close_bytes, index);
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

        if has_double_quote && is_raw_string_candidate_ascii(line, index, len) {
            if let Some(end_idx) = scan_raw_string_ascii(line, index, &mut out, state) {
                index = end_idx;
                continue;
            }
        }

        if quote_bytes.contains(&b) {
            index = step_open_quote_ascii(&mut out, state, b, config.multiline_templates, index);
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

fn scan_raw_string_u16(
    units: &[u16],
    start: usize,
    out: &mut [u16],
    state: &mut MaskState,
) -> Option<usize> {
    let len = units.len();
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
    let mut hashes = 0;
    while pos < len && units[pos] == b'#' as u16 {
        hashes += 1;
        pos += 1;
    }

    if pos >= len || units[pos] != b'"' as u16 {
        return None;
    }

    out[start..=pos].fill(0x20);

    let mut cursor = pos + 1;
    while cursor < len {
        out[cursor] = 0x20;
        if units[cursor] == b'"' as u16
            && cursor + 1 + hashes <= len
            && units[cursor + 1..cursor + 1 + hashes]
                .iter()
                .all(|&c| c == b'#' as u16)
        {
            for offset in 1..=hashes {
                out[cursor + offset] = 0x20;
            }
            state.raw_string = None;
            return Some(cursor + 1 + hashes);
        }
        cursor += 1;
    }

    state.raw_string = Some(hashes);
    Some(len)
}

#[inline]
fn step_raw_string_continuation_u16(
    units: &[u16],
    out: &mut [u16],
    state: &mut MaskState,
    hashes: usize,
    index: usize,
    len: usize,
) -> usize {
    out[index] = 0x20;
    if units[index] == b'"' as u16
        && index + 1 + hashes <= len
        && units[index + 1..index + 1 + hashes]
            .iter()
            .all(|&c| c == b'#' as u16)
    {
        for offset in 1..=hashes {
            out[index + offset] = 0x20;
        }
        state.raw_string = None;
        return index + 1 + hashes;
    }
    index + 1
}

#[inline]
fn is_raw_string_candidate_u16(units: &[u16], index: usize, len: usize) -> bool {
    let u = units[index];
    u == b'r' as u16
        || ((u == b'b' as u16 || u == b'c' as u16)
            && index + 1 < len
            && units[index + 1] == b'r' as u16)
}

#[inline]
fn step_active_quote_u16(
    units: &[u16],
    out: &mut [u16],
    state: &mut MaskState,
    active_quote: char,
    index: usize,
    len: usize,
) -> usize {
    let q_u16 = active_quote as u16;
    out[index] = 0x20;
    let u = units[index];
    if u == b'\\' as u16 {
        if index + 1 < len {
            out[index + 1] = 0x20;
        }
        return index + 2;
    }
    if u == q_u16 {
        state.quote = None;
    }
    index + 1
}

#[inline]
fn step_block_comment_u16(
    units: &[u16],
    out: &mut [u16],
    state: &mut MaskState,
    bc_close_units: Option<&Vec<u16>>,
    index: usize,
) -> usize {
    if let Some(close) = bc_close_units {
        if !close.is_empty() && units[index..].starts_with(close) {
            for offset in 0..close.len() {
                out[index + offset] = 0x20;
            }
            state.in_block_comment = false;
            return index + close.len();
        }
    }
    out[index] = 0x20;
    index + 1
}

#[inline]
fn step_open_quote_u16(
    out: &mut [u16],
    state: &mut MaskState,
    u: u16,
    multiline_templates: bool,
    index: usize,
) -> usize {
    let quote_char = (u as u8) as char;
    state.quote = if quote_char == '`' && !multiline_templates {
        None
    } else {
        Some(quote_char)
    };
    out[index] = 0x20;
    index + 1
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
    let has_double_quote = quote_units.contains(&(b'"' as u16));

    while index < len {
        if let Some(active_quote) = state.quote {
            index = step_active_quote_u16(&units, &mut out, state, active_quote, index, len);
            continue;
        }

        if let Some(hashes) = state.raw_string {
            index = step_raw_string_continuation_u16(&units, &mut out, state, hashes, index, len);
            continue;
        }

        if state.in_block_comment {
            index = step_block_comment_u16(&units, &mut out, state, bc_close_units.as_ref(), index);
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

        if has_double_quote && is_raw_string_candidate_u16(&units, index, len) {
            if let Some(end_idx) = scan_raw_string_u16(&units, index, &mut out, state) {
                index = end_idx;
                continue;
            }
        }

        if quote_units.contains(&u) {
            index = step_open_quote_u16(&mut out, state, u, config.multiline_templates, index);
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

    #[test]
    fn test_empty_and_whitespace() {
        let res = mask_source_code("", &c_family_config());
        assert_eq!(res.lines, 1);
        assert_eq!(res.non_blank_lines, 0);

        let res_ws = mask_source_code("   \n\t\n", &c_family_config());
        assert_eq!(res_ws.lines, 3);
        assert_eq!(res_ws.non_blank_lines, 0);
    }

    #[test]
    fn test_python_hash_and_docstrings() {
        let py_config = MaskConfig {
            line_comment: "#".to_string(),
            block_comment: Some(("\"\"\"".to_string(), "\"\"\"".to_string())),
            quote_chars: "'\"".to_string(),
            multiline_templates: false,
            regex_literals: false,
        };
        let code =
            "# Header\ndef foo():\n    \"\"\"Docstring\n    line 2\"\"\"\n    return 42 # end";
        let res = mask_source_code(code, &py_config);
        assert_eq!(res.lines, 5);
        assert!(res.masked[0].trim().is_empty());
        assert!(res.masked[4].ends_with("      "));
    }

    #[test]
    fn test_powershell_block_comments() {
        let ps_config = MaskConfig {
            line_comment: "#".to_string(),
            block_comment: Some(("<#".to_string(), "#>".to_string())),
            quote_chars: "'\"".to_string(),
            multiline_templates: false,
            regex_literals: false,
        };
        let code = "<# Block comment\n multi-line #>\nWrite-Host 'Hello'";
        let res = mask_source_code(code, &ps_config);
        assert_eq!(res.lines, 3);
        assert!(res.masked[0].trim().is_empty());
        assert!(res.masked[1].trim().is_empty());
        assert!(res.masked[2].starts_with("Write-Host "));
    }

    #[test]
    fn test_escaped_quotes_inside_strings() {
        let code = "const s = \"escaped \\\"quote\\\" inside\"; const next = 10;";
        let res = mask_source_code(code, &c_family_config());
        assert!(res.masked[0].ends_with("const next = 10;"));
        assert!(res.masked[0].starts_with("const s = "));
    }

    #[test]
    fn test_multiline_template_literals() {
        let code = "const t = `line 1\nline 2 ${val}\nline 3`; const done = true;";
        let res = mask_source_code(code, &c_family_config());
        assert_eq!(res.lines, 3);
        assert!(res.masked[2].ends_with("const done = true;"));
    }

    #[test]
    fn test_unclosed_block_comment() {
        let code = "const a = 1;\n/* unclosed comment start\nline 3";
        let res = mask_source_code(code, &c_family_config());
        assert_eq!(res.lines, 3);
        assert!(res.masked[1].trim().is_empty());
        assert!(res.masked[2].trim().is_empty());
    }

    #[test]
    fn test_mixed_single_and_double_quotes() {
        let code = "const msg1 = \"double 'with' single\"; const msg2 = 'single \"with\" double';";
        let res = mask_source_code(code, &c_family_config());
        assert_eq!(res.lines, 1);
        assert!(res.masked[0].contains("const msg1 = "));
        assert!(res.masked[0].contains("; const msg2 = "));
    }

    fn rust_config() -> MaskConfig {
        MaskConfig {
            line_comment: "//".to_string(),
            block_comment: Some(("/*".to_string(), "*/".to_string())),
            quote_chars: "\"".to_string(),
            multiline_templates: false,
            regex_literals: false,
        }
    }

    #[test]
    fn test_rust_raw_string_literals_single_line() {
        let code = "let s = r#\"hello try!()\"#; let next = 10;\nlet s2 = r\"hello\"; let s3 = r##\"nested \"quote\" and \"# hash\"##;";
        let res = mask_source_code(code, &rust_config());
        assert_eq!(res.lines, 2);
        assert_eq!(res.masked[0], "let s =                  ; let next = 10;");
        assert_eq!(
            res.masked[1],
            "let s2 =         ; let s3 =                                  ;"
        );
    }

    #[test]
    fn test_rust_raw_string_multiline() {
        let code = "let s = r#\"start\nmiddle line with \"nested\"\nend\"#; let done = true;";
        let res = mask_source_code(code, &rust_config());
        assert_eq!(res.lines, 3);
        assert_eq!(res.masked[0], "let s =         ");
        assert_eq!(res.masked[1], "                         ");
        assert_eq!(res.masked[2], "     ; let done = true;");
    }

    #[test]
    fn test_rust_raw_string_lifetimes_and_raw_idents() {
        let code = "fn foo<'a>(r#type: &'a str) -> &str { r#\"try!()\"# }";
        let res = mask_source_code(code, &rust_config());
        assert_eq!(
            res.masked[0],
            "fn foo<'a>(r#type: &'a str) -> &str {             }"
        );
    }

    #[test]
    fn test_rust_byte_raw_string() {
        let code = "let b = br#\"hello\"#; let c = cr\"cstr\";";
        let res = mask_source_code(code, &rust_config());
        assert_eq!(res.masked[0], "let b =            ; let c =         ;");
    }
}
