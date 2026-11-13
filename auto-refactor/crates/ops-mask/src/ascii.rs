//! Module: ASCII Fast-Path Masking Scanner
//! Crate: ops-mask
//! Architecture Role: Stateful single-line ASCII byte-slice masking with zero per-line
//! heap allocation, flattened state transitions, and verified UTF-8 safety invariants.

use crate::ascii_helpers::{
    is_raw_string_candidate_ascii, mask_regex_body_ascii, opens_regex_literal_ascii,
    scan_raw_string_ascii, step_active_quote_ascii, step_block_comment_ascii,
    step_html_comment_ascii, step_open_quote_ascii, step_raw_string_continuation_ascii,
};
use crate::{MaskConfig, MaskState, MaskTarget};

struct AsciiScanProfile<'a> {
    lc_bytes: &'a [u8],
    bc_open_bytes: Option<&'a [u8]>,
    bc_close_bytes: Option<&'a [u8]>,
    quote_bytes: &'a [u8],
    has_double_quote: bool,
    multiline_templates: bool,
    regex_literals: bool,
    html_comment: bool,
}

impl<'a> AsciiScanProfile<'a> {
    #[inline]
    fn from_config(config: &'a MaskConfig) -> Self {
        let quote_bytes = config.quote_chars.as_bytes();
        Self {
            lc_bytes: config.line_comment.as_bytes(),
            bc_open_bytes: config.block_comment.as_ref().map(|(o, _)| o.as_bytes()),
            bc_close_bytes: config.block_comment.as_ref().map(|(_, c)| c.as_bytes()),
            quote_bytes,
            has_double_quote: quote_bytes.contains(&b'"'),
            multiline_templates: config.multiline_templates,
            regex_literals: config.regex_literals,
            html_comment: config.html_comment,
        }
    }
}

#[inline]
fn step_ascii_active_state(
    line: &[u8],
    out: &mut [u8],
    state: &mut MaskState,
    profile: &AsciiScanProfile<'_>,
    index: usize,
) -> Option<usize> {
    let len = line.len();
    if let Some(active_quote) = state.quote {
        return Some(step_active_quote_ascii(
            line,
            out,
            state,
            active_quote,
            index,
            len,
        ));
    }
    if let Some(hashes) = state.raw_string {
        return Some(step_raw_string_continuation_ascii(
            line, out, state, hashes, index, len,
        ));
    }
    if state.in_block_comment {
        return Some(step_block_comment_ascii(
            line,
            out,
            state,
            profile.bc_close_bytes,
            index,
        ));
    }
    if state.in_html_comment {
        return Some(step_html_comment_ascii(line, out, state, index));
    }
    None
}

#[inline]
fn step_ascii_comment_open(
    line: &[u8],
    out: &mut [u8],
    state: &mut MaskState,
    profile: &AsciiScanProfile<'_>,
    index: usize,
) -> Option<usize> {
    if !profile.lc_bytes.is_empty() && line[index..].starts_with(profile.lc_bytes) {
        out[index..line.len()].fill(b' ');
        return Some(line.len());
    }
    if let Some(open) = profile.bc_open_bytes.filter(|o| !o.is_empty()) {
        if line[index..].starts_with(open) {
            out[index..index + open.len()].fill(b' ');
            state.in_block_comment = true;
            return Some(index + open.len());
        }
    }
    if profile.html_comment && line[index..].starts_with(b"<!--") {
        out[index..index + 4].fill(b' ');
        state.in_html_comment = true;
        return Some(index + 4);
    }
    None
}

#[inline]
fn step_ascii_code_literal(
    line: &[u8],
    out: &mut [u8],
    state: &mut MaskState,
    profile: &AsciiScanProfile<'_>,
    index: usize,
) -> usize {
    let b = line[index];
    if profile.regex_literals && b == b'/' && opens_regex_literal_ascii(line, index) {
        return mask_regex_body_ascii(line, index, out);
    }
    if profile.has_double_quote && is_raw_string_candidate_ascii(line, index, line.len()) {
        if let Some(end_idx) = scan_raw_string_ascii(line, index, out, state) {
            return end_idx;
        }
    }
    if profile.quote_bytes.contains(&b) {
        return step_open_quote_ascii(out, state, b, profile.multiline_templates, index);
    }
    index + 1
}

/// Masks a single verified-ASCII line directly into `target.output` using `target.scratch`.
pub(crate) fn mask_line_ascii_into(
    line: &[u8],
    state: &mut MaskState,
    config: &MaskConfig,
    target: &mut MaskTarget<'_>,
) {
    let len = line.len();
    let out = &mut *target.scratch;
    out.clear();
    out.extend_from_slice(line);
    let profile = AsciiScanProfile::from_config(config);
    let mut index = 0;

    while index < len {
        if let Some(next) = step_ascii_active_state(line, out, state, &profile, index) {
            index = next;
            continue;
        }
        if let Some(next) = step_ascii_comment_open(line, out, state, &profile, index) {
            index = next;
            continue;
        }
        index = step_ascii_code_literal(line, out, state, &profile, index);
    }

    // SAFETY:
    // Preconditions: `line` was verified `is_ascii()` before dispatch, so every initial byte in `target.scratch` is <= 0x7F.
    // Invariants: All state/comment/literal masking passes only overwrite bytes in `target.scratch` with `0x20` (ASCII space).
    // Postconditions: Every byte in `target.scratch` remains valid 7-bit ASCII (<= 0x7F), making `from_utf8_unchecked` sound.
    let s = unsafe { std::str::from_utf8_unchecked(target.scratch) };
    target.output.push_str(s);
}
