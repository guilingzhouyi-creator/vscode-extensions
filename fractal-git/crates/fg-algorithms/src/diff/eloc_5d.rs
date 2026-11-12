//! Module: fg-algorithms::diff::eloc_5d — 5D Riemannian Effective Lines of Code
//! File Path: crates/fg-algorithms/src/diff/eloc_5d.rs
//! Architecture Role: Pure Rust zero-allocation 5D ELOC evaluation and TSPR density metrics.
//! Domain Governance Rules: FGT-ALG-001, FGT-PRF-001 (zero transient heap allocation).

use serde::{Deserialize, Serialize};

/// Classification of a source code line in 5D Riemannian phase space.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineSemanticKind {
    /// Empty or whitespace-only line.
    Blank,
    /// Single-line or block comment interior/closing line.
    Comment,
    /// Documentation comment line (`///`, `//!`, `/** ... */`).
    DocComment,
    /// Trivial forwarding call or empty brace stub.
    Trampoline,
    /// Non-trivial executable or declarative code line.
    Substantive,
}

/// Tracks multi-line block comment state across consecutive source lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CommentBlockState {
    /// Whether scanning is currently inside an unclosed `/* ... */` block comment.
    pub in_block_comment: bool,
    /// Whether the active block comment started with a doc prefix (`/**`).
    pub in_doc_comment: bool,
}

impl LineSemanticKind {
    /// Returns the 5D Riemannian effective line weight for this semantic kind.
    #[inline(always)]
    pub const fn weight(&self) -> f64 {
        match self {
            Self::Substantive => 1.0,
            _ => 0.0,
        }
    }

    /// Returns true if this line contains substantive code payload.
    #[inline(always)]
    pub const fn is_substantive(&self) -> bool {
        matches!(self, Self::Substantive)
    }
}

/// Returns whether a trimmed single line is a single-line comment prefix across supported syntaxes.
#[inline]
fn is_single_line_comment(trimmed: &str) -> bool {
    trimmed.starts_with("//")
        || trimmed.starts_with('#')
        || trimmed.starts_with("--")
        || trimmed.starts_with(';')
}

/// Updates multi-line block comment state for an unclosed `/*` opening after code on a line.
fn scan_trailing_block_comment(code_slice: &str, state: &mut CommentBlockState) {
    let bytes = code_slice.as_bytes();
    let mut index = 0usize;
    let mut in_double_quote = false;

    while index < bytes.len() {
        let byte = bytes[index];
        if in_double_quote {
            if byte == b'\\' && index + 1 < bytes.len() {
                index += 2;
                continue;
            }
            if byte == b'"' {
                in_double_quote = false;
            }
            index += 1;
            continue;
        }
        if byte == b'"' {
            in_double_quote = true;
            index += 1;
            continue;
        }
        if bytes[index..].starts_with(b"//") {
            break;
        }
        if bytes[index..].starts_with(b"/*") {
            let is_doc = bytes[index..].starts_with(b"/**") && !bytes[index..].starts_with(b"/**/");
            if let Some(close_rel) = code_slice[index + 2..].find("*/") {
                index += 2 + close_rel + 2;
                continue;
            }
            state.in_block_comment = true;
            state.in_doc_comment = is_doc;
            break;
        }
        index += 1;
    }
}

/// Classifies code starting outside any active block comment, updating `state` cleanly.
fn classify_uncommented_segment(trimmed: &str, state: &mut CommentBlockState) -> LineSemanticKind {
    let mut current = trimmed;
    loop {
        if current.is_empty() {
            return LineSemanticKind::Blank;
        }
        if current.starts_with("///") || current.starts_with("//!") {
            return LineSemanticKind::DocComment;
        }
        if is_single_line_comment(current) {
            return LineSemanticKind::Comment;
        }
        if let Some(after_open) = current.strip_prefix("/*") {
            let is_doc = current.starts_with("/**") && !current.starts_with("/**/");
            let Some(close_pos) = after_open.find("*/") else {
                state.in_block_comment = true;
                state.in_doc_comment = is_doc;
                return if is_doc {
                    LineSemanticKind::DocComment
                } else {
                    LineSemanticKind::Comment
                };
            };
            let after_close = after_open[close_pos + 2..].trim();
            if after_close.is_empty() || is_single_line_comment(after_close) {
                return if is_doc {
                    LineSemanticKind::DocComment
                } else {
                    LineSemanticKind::Comment
                };
            }
            current = after_close;
            continue;
        }
        scan_trailing_block_comment(current, state);
        if is_mechanical_trampoline(current) {
            return LineSemanticKind::Trampoline;
        }
        return LineSemanticKind::Substantive;
    }
}

/// Classifies one line using and mutating multi-line block comment `state` without heap allocations.
#[inline]
pub fn classify_line_with_state(
    line_slice: &str,
    state: &mut CommentBlockState,
) -> LineSemanticKind {
    let trimmed_line = line_slice.trim();
    if trimmed_line.is_empty() {
        return LineSemanticKind::Blank;
    }
    if state.in_block_comment {
        let was_doc = state.in_doc_comment;
        let Some(close_pos) = trimmed_line.find("*/") else {
            return if was_doc {
                LineSemanticKind::DocComment
            } else {
                LineSemanticKind::Comment
            };
        };
        state.in_block_comment = false;
        state.in_doc_comment = false;
        let remainder = trimmed_line[close_pos + 2..].trim();
        if remainder.is_empty() || is_single_line_comment(remainder) {
            return if was_doc {
                LineSemanticKind::DocComment
            } else {
                LineSemanticKind::Comment
            };
        }
        return classify_uncommented_segment(remainder, state);
    }
    classify_uncommented_segment(trimmed_line, state)
}

/// Classifies a single isolated line slice with zero heap allocations.
#[inline]
pub fn classify_line(line_slice: &str) -> LineSemanticKind {
    let mut initial_state = CommentBlockState::default();
    classify_line_with_state(line_slice, &mut initial_state)
}

#[inline]
fn is_mechanical_trampoline(trimmed_line: &str) -> bool {
    let is_short_forwarding_call = (trimmed_line.starts_with("return ")
        || trimmed_line.starts_with("self.")
        || trimmed_line.starts_with("this."))
        && trimmed_line.ends_with(';')
        && trimmed_line.contains('(')
        && trimmed_line.len() <= 45;
    is_short_forwarding_call || trimmed_line == "{}" || trimmed_line == "};"
}

/// 5D ELOC and density metrics evaluated over a single file.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct File5dElocMetrics {
    /// Total physical lines in the file.
    pub physical_lines: usize,
    /// Total blank lines.
    pub blank_lines: usize,
    /// Total comment and doc-comment lines.
    pub comment_lines: usize,
    /// Total substantive non-trampoline code lines.
    pub substantive_lines: usize,
    /// Weighted effective lines of code (5D ELOC).
    pub effective_lines_of_code: f64,
    /// Ratio of non-comment, non-blank lines to physical lines.
    pub substantive_line_ratio: f64,
    /// Technical Substance Preservation Ratio over non-comment, non-blank lines.
    pub substance_preservation_ratio: f64,
    /// Backward-compatible alias for `effective_lines_of_code`.
    pub eloc_5d: f64,
    /// Backward-compatible alias for `substance_preservation_ratio`.
    pub tspr: f64,
}

/// Evaluates 5D ELOC metrics over a source code string with stateful block comment tracking.
pub fn evaluate_file_5d_eloc(source_content: &str) -> File5dElocMetrics {
    let mut physical_lines = 0usize;
    let mut blank_lines = 0usize;
    let mut comment_lines = 0usize;
    let mut substantive_lines = 0usize;
    let mut effective_lines_of_code = 0.0f64;
    let mut comment_state = CommentBlockState::default();

    for source_line in source_content.lines() {
        physical_lines += 1;
        let semantic_kind = classify_line_with_state(source_line, &mut comment_state);
        match semantic_kind {
            LineSemanticKind::Blank => blank_lines += 1,
            LineSemanticKind::Comment | LineSemanticKind::DocComment => comment_lines += 1,
            LineSemanticKind::Trampoline => {}
            LineSemanticKind::Substantive => {
                substantive_lines += 1;
                effective_lines_of_code += semantic_kind.weight();
            }
        }
    }
    let non_comment_non_blank = physical_lines.saturating_sub(blank_lines + comment_lines);
    let substantive_line_ratio = if physical_lines > 0 {
        non_comment_non_blank as f64 / physical_lines as f64
    } else {
        0.0
    };
    let substance_preservation_ratio = if non_comment_non_blank > 0 {
        effective_lines_of_code / non_comment_non_blank as f64
    } else {
        0.0
    };
    File5dElocMetrics {
        physical_lines,
        blank_lines,
        comment_lines,
        substantive_lines,
        effective_lines_of_code,
        substantive_line_ratio,
        substance_preservation_ratio,
        eloc_5d: effective_lines_of_code,
        tspr: substance_preservation_ratio,
    }
}

/// 5D ELOC differential delta between old and new texts.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Diff5dElocDelta {
    pub physical_lines_added: usize,
    pub physical_lines_deleted: usize,
    pub effective_lines_added: f64,
    pub effective_lines_deleted: f64,
    pub net_turnover_weighted: f64,
    pub preservation_ratio_added: f64,
    pub substantive_ratio_added: f64,
    /// Backward-compatible aliases:
    pub phys_add: usize,
    pub phys_del: usize,
    pub eloc_5d_add: f64,
    pub eloc_5d_del: f64,
    pub net_5d_turnover: f64,
    pub tspr_add: f64,
    pub substantive_ratio_add: f64,
}

/// Extension trait providing deterministic decimal rounding.
pub trait FloatPrecisionExt: Sized {
    /// Rounds the float to the given number of decimal digits.
    fn round_to_precision(self, decimals: u32) -> f64;
    /// Backward-compatible alias for `round_to_precision`.
    fn round_to(self, decimals: u32) -> f64 {
        self.round_to_precision(decimals)
    }
}

impl FloatPrecisionExt for f64 {
    #[inline]
    fn round_to_precision(self, decimals: u32) -> f64 {
        let scaling_factor = 10f64.powi(decimals as i32);
        (self * scaling_factor).round() / scaling_factor
    }
}

/// Evaluates 5D ELOC delta over slices of added and deleted lines.
pub fn evaluate_diff_5d_eloc<'a>(
    added_lines: impl IntoIterator<Item = &'a str>,
    deleted_lines: impl IntoIterator<Item = &'a str>,
) -> Diff5dElocDelta {
    let mut physical_lines_added = 0usize;
    let mut blank_lines_added = 0usize;
    let mut comment_lines_added = 0usize;
    let mut effective_lines_added = 0.0f64;
    let mut add_state = CommentBlockState::default();

    for line in added_lines {
        physical_lines_added += 1;
        let semantic_kind = classify_line_with_state(line, &mut add_state);
        match semantic_kind {
            LineSemanticKind::Blank => blank_lines_added += 1,
            LineSemanticKind::Comment | LineSemanticKind::DocComment => comment_lines_added += 1,
            LineSemanticKind::Trampoline => {}
            LineSemanticKind::Substantive => effective_lines_added += 1.0,
        }
    }

    let mut physical_lines_deleted = 0usize;
    let mut effective_lines_deleted = 0.0f64;
    let mut del_state = CommentBlockState::default();
    for line in deleted_lines {
        physical_lines_deleted += 1;
        let semantic_kind = classify_line_with_state(line, &mut del_state);
        if semantic_kind.is_substantive() {
            effective_lines_deleted += 1.0;
        }
    }

    let substantive_ratio_added = if physical_lines_added > 0 {
        (physical_lines_added - blank_lines_added - comment_lines_added) as f64
            / physical_lines_added as f64
    } else {
        0.0
    };
    let preservation_ratio_added = if physical_lines_added > 0 {
        effective_lines_added / physical_lines_added as f64
    } else {
        0.0
    };
    let net_turnover_weighted =
        (effective_lines_added + effective_lines_deleted * 0.8).round_to_precision(2);

    Diff5dElocDelta {
        physical_lines_added,
        physical_lines_deleted,
        effective_lines_added,
        effective_lines_deleted,
        net_turnover_weighted,
        preservation_ratio_added,
        substantive_ratio_added,
        phys_add: physical_lines_added,
        phys_del: physical_lines_deleted,
        eloc_5d_add: effective_lines_added,
        eloc_5d_del: effective_lines_deleted,
        net_5d_turnover: net_turnover_weighted,
        tspr_add: preservation_ratio_added,
        substantive_ratio_add: substantive_ratio_added,
    }
}
