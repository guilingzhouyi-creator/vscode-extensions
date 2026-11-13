//! Module: UTF-16 Fallback Masking Scanner
//! Crate: ops-mask
//! Architecture Role: Surrogate-safe UTF-16 code-unit line masking ensuring byte-for-byte
//!   semantic parity with JavaScript AST string indices on non-ASCII source lines.

use crate::utf16_helpers::{
    is_raw_string_candidate_u16, mask_regex_body_u16, opens_regex_literal_u16, scan_raw_string_u16,
    step_active_quote_u16, step_block_comment_u16, step_html_comment_u16, step_open_quote_u16,
    step_raw_string_continuation_u16,
};
use crate::{MaskConfig, MaskState};

struct Utf16ScanProfile {
    lc_units: Vec<u16>,
    bc_open_units: Option<Vec<u16>>,
    bc_close_units: Option<Vec<u16>>,
    quote_units: Vec<u16>,
    has_double_quote: bool,
    multiline_templates: bool,
    regex_literals: bool,
    html_comment: bool,
}

impl Utf16ScanProfile {
    fn from_config(config: &MaskConfig) -> Self {
        let quote_units: Vec<u16> = config.quote_chars.encode_utf16().collect();
        Self {
            lc_units: config.line_comment.encode_utf16().collect(),
            bc_open_units: config
                .block_comment
                .as_ref()
                .map(|(o, _)| o.encode_utf16().collect()),
            bc_close_units: config
                .block_comment
                .as_ref()
                .map(|(_, c)| c.encode_utf16().collect()),
            has_double_quote: quote_units.contains(&(b'"' as u16)),
            quote_units,
            multiline_templates: config.multiline_templates,
            regex_literals: config.regex_literals,
            html_comment: config.html_comment,
        }
    }
}

#[inline]
fn step_utf16_active_state(
    units: &[u16],
    out: &mut [u16],
    state: &mut MaskState,
    profile: &Utf16ScanProfile,
    index: usize,
) -> Option<usize> {
    let len = units.len();
    if let Some(active_quote) = state.quote {
        return Some(step_active_quote_u16(
            units,
            out,
            state,
            active_quote,
            index,
            len,
        ));
    }
    if let Some(hashes) = state.raw_string {
        return Some(step_raw_string_continuation_u16(
            units, out, state, hashes, index, len,
        ));
    }
    if state.in_block_comment {
        return Some(step_block_comment_u16(
            units,
            out,
            state,
            profile.bc_close_units.as_deref(),
            index,
        ));
    }
    if state.in_html_comment {
        return Some(step_html_comment_u16(units, out, state, index));
    }
    None
}

#[inline]
fn step_utf16_comment_open(
    units: &[u16],
    out: &mut [u16],
    state: &mut MaskState,
    profile: &Utf16ScanProfile,
    index: usize,
) -> Option<usize> {
    if !profile.lc_units.is_empty() && units[index..].starts_with(&profile.lc_units) {
        out[index..units.len()].fill(0x20);
        return Some(units.len());
    }
    if let Some(open) = profile.bc_open_units.as_deref().filter(|o| !o.is_empty()) {
        if units[index..].starts_with(open) {
            out[index..index + open.len()].fill(0x20);
            state.in_block_comment = true;
            return Some(index + open.len());
        }
    }
    if profile.html_comment
        && units[index..].starts_with(&[b'<' as u16, b'!' as u16, b'-' as u16, b'-' as u16])
    {
        out[index..index + 4].fill(0x20);
        state.in_html_comment = true;
        return Some(index + 4);
    }
    None
}

#[inline]
fn step_utf16_code_literal(
    units: &[u16],
    out: &mut [u16],
    state: &mut MaskState,
    profile: &Utf16ScanProfile,
    index: usize,
) -> usize {
    let u = units[index];
    if profile.regex_literals && u == b'/' as u16 && opens_regex_literal_u16(units, index) {
        return mask_regex_body_u16(units, index, out);
    }
    if profile.has_double_quote && is_raw_string_candidate_u16(units, index, units.len()) {
        if let Some(end_idx) = scan_raw_string_u16(units, index, out, state) {
            return end_idx;
        }
    }
    if profile.quote_units.contains(&u) {
        return step_open_quote_u16(out, state, u, profile.multiline_templates, index);
    }
    index + 1
}

/// Masks comments and literals on a line containing non-ASCII characters via UTF-16 indexing.
pub(crate) fn mask_line_utf16(line: &str, state: &mut MaskState, config: &MaskConfig) -> String {
    let units: Vec<u16> = line.encode_utf16().collect();
    let len = units.len();
    let mut out = units.clone();
    let profile = Utf16ScanProfile::from_config(config);
    let mut index = 0;

    while index < len {
        if let Some(next) = step_utf16_active_state(&units, &mut out, state, &profile, index) {
            index = next;
            continue;
        }
        if let Some(next) = step_utf16_comment_open(&units, &mut out, state, &profile, index) {
            index = next;
            continue;
        }
        index = step_utf16_code_literal(&units, &mut out, state, &profile, index);
    }

    String::from_utf16_lossy(&out)
}
