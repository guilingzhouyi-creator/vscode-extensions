//! Module: Native Acceleration Kernel — Source Masking & Spectrum Extractor
//! Crate: ops-mask
//! Architecture Role: Byte-level scanner for multilang string/comment masking
//!   and line statistics, providing 100% byte-parity with ECMAScript UTF-16 AST rules.
//! Dependencies & Triggers: Invoked by `auto-refactor-core` N-API bindings and engine scanners.
//! Responsibilities:
//!   1. Dispatch per-line masking across ASCII fast-path and UTF-16 surrogate-safe path.
//!   2. Track multi-line comment, quote, and raw-string state across sequential lines.
//!   3. Preserve exact line/column offsets by overwriting masked spans with ASCII spaces.

mod ascii;
mod ascii_helpers;
mod utf16;
mod utf16_helpers;

use ascii::mask_line_ascii_into;
use ascii_helpers::has_trigger_char;
use utf16::mask_line_utf16;

/// Configuration flags for source code comment and literal masking.
/// All delimiters remain immutable per scan and match caller language profiles.
#[derive(Debug, Clone, Default)]
pub struct MaskConfig {
    pub line_comment: String,
    pub block_comment: Option<(String, String)>,
    pub quote_chars: String,
    pub multiline_templates: bool,
    pub regex_literals: bool,
    pub html_comment: bool,
}

/// Result of source code masking containing raw/masked line buffers and metrics.
/// Guarantees `raw.len() == masked.len() == lines as usize` across all scans.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaskResult {
    pub raw: Vec<String>,
    pub masked: Vec<String>,
    pub lines: u32,
    pub non_blank_lines: u32,
}

/// Cross-line lexical state carried between consecutive source lines.
#[derive(Debug, Clone, Default)]
pub(crate) struct MaskState {
    pub(crate) in_block_comment: bool,
    pub(crate) in_html_comment: bool,
    pub(crate) quote: Option<char>,
    pub(crate) raw_string: Option<usize>,
}

/// Token characters whose presence immediately before `/` permits opening a regex literal.
pub(crate) const REGEX_PREFIX_CHARS: &[u8] = b"([{,=:!&|?;+-*%<>";

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

/// Masks comments and string literals in source code according to the language profile.
/// Returns the entire masked text as a single compact String with lines separated by `\n`.
/// This avoids per-line string allocation across the FFI/N-API boundary.
#[must_use]
pub fn mask_source_code_compact(content: &str, config: &MaskConfig) -> String {
    let mut output = String::with_capacity(content.len());
    let mut buf = Vec::with_capacity(256);
    let mut state = MaskState::default();
    let mut first = true;

    for raw_slice in content.split('\n') {
        if !first {
            output.push('\n');
        }
        first = false;
        let line = raw_slice.strip_suffix('\r').unwrap_or(raw_slice);
        let mut target = MaskTarget::new(&mut buf, &mut output);
        mask_line_into(line, &mut state, config, &mut target);
    }

    output
}

/// Mutable working scratch buffer and final destination string for line masking.
pub(crate) struct MaskTarget<'a> {
    pub(crate) scratch: &'a mut Vec<u8>,
    pub(crate) output: &'a mut String,
}

impl<'a> MaskTarget<'a> {
    #[inline]
    fn new(scratch: &'a mut Vec<u8>, output: &'a mut String) -> Self {
        Self { scratch, output }
    }
}

#[inline]
fn push_masked_spaces(line: &str, output: &mut String) {
    let space_count = if line.is_ascii() {
        line.len()
    } else {
        line.encode_utf16().count()
    };
    for _ in 0..space_count {
        output.push(' ');
    }
}

#[inline]
fn is_plain_passthrough(line: &str, state: &MaskState, config: &MaskConfig) -> bool {
    let no_state = state.quote.is_none()
        && !state.in_block_comment
        && !state.in_html_comment
        && state.raw_string.is_none();
    no_state && !has_trigger_char(line, config)
}

#[inline]
fn is_unclosed_comment_line(line: &str, state: &MaskState, config: &MaskConfig) -> bool {
    if state.quote.is_some() || state.raw_string.is_some() {
        return false;
    }
    if config.html_comment && state.in_html_comment && !line.contains("-->") {
        return true;
    }
    let Some((_, close)) = &config.block_comment else {
        return false;
    };
    state.in_block_comment && !close.is_empty() && !line.contains(close)
}

fn mask_line_into(
    line: &str,
    state: &mut MaskState,
    config: &MaskConfig,
    target: &mut MaskTarget<'_>,
) {
    if is_plain_passthrough(line, state, config) {
        target.output.push_str(line);
        return;
    }

    let wholly_unclosed_raw = state.raw_string.is_some() && !line.contains('"');
    if wholly_unclosed_raw || is_unclosed_comment_line(line, state, config) {
        push_masked_spaces(line, target.output);
        return;
    }

    if line.is_ascii() {
        mask_line_ascii_into(line.as_bytes(), state, config, target);
    } else {
        let masked = mask_line_utf16(line, state, config);
        target.output.push_str(&masked);
    }
}

/// Masks a single source line into an allocated `String` using reusable scratch space.
fn mask_line(line: &str, state: &mut MaskState, config: &MaskConfig) -> String {
    let mut out = String::with_capacity(line.len());
    let mut buf = Vec::with_capacity(256);
    let mut target = MaskTarget::new(&mut buf, &mut out);
    mask_line_into(line, state, config, &mut target);
    out
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
            html_comment: true,
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
            html_comment: false,
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
            html_comment: false,
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
            html_comment: false,
        }
    }

    #[test]
    fn test_rust_raw_string_literals_single_line() {
        let code = concat!(
            "let s = r#\"hello try!()\"#; let next = 10;\n",
            "let s2 = r\"hello\"; let s3 = r##\"nested \"quote\" and \"# hash\"##;"
        );
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

    #[test]
    fn test_mask_source_code_compact_equivalence() {
        let code = "const msg = \"hello\";\n// comment line\nconst x = 42; /* block */\n";
        let config = c_family_config();
        let res = mask_source_code(code, &config);
        let compact = mask_source_code_compact(code, &config);
        assert_eq!(compact, res.masked.join("\n"));
    }

    #[test]
    fn test_html_comment_masking() {
        let code = "const a = 1; <!-- METRICS:BEGIN -->\ninner <!-- comment\nend --> const b = 2;";
        let config = c_family_config();
        let res = mask_source_code(code, &config);
        assert_eq!(res.lines, 3);
        assert_eq!(res.masked[0], "const a = 1;                       ");
        assert_eq!(res.masked[1], "inner             ");
        assert_eq!(res.masked[2], "        const b = 2;");
    }

    #[test]
    fn test_utf16_regex_and_raw_string_parity() {
        let code = "const p = '中'; const r = /a\\/b/u; const t = r#\"字\"#;";
        let res = mask_source_code(code, &c_family_config());
        assert_eq!(
            res.masked[0].encode_utf16().count(),
            code.encode_utf16().count()
        );
        assert!(res.masked[0].starts_with("const p =    ; const r =        ;"));
    }
}
