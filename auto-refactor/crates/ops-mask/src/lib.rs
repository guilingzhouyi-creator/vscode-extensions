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
mod tests;

#[cfg(test)]
mod utf16_edge_tests {
    use super::*;

    #[test]
    fn test_utf16_regex_and_raw_string_parity() {
        let cfg = MaskConfig {
            line_comment: "//".to_string(),
            block_comment: Some(("/*".to_string(), "*/".to_string())),
            quote_chars: "'\"`".to_string(),
            multiline_templates: true,
            regex_literals: true,
            html_comment: true,
        };
        let code = "const p = '中'; const r = /a\\/b/u; const t = r#\"字\"#;";
        let res = mask_source_code(code, &cfg);
        assert_eq!(
            res.masked[0].encode_utf16().count(),
            code.encode_utf16().count()
        );
        assert!(res.masked[0].starts_with("const p =    ; const r =        ;"));
    }
}
