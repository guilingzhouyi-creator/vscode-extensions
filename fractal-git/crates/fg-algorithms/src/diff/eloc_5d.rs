//! Module: fg-algorithms::diff::eloc_5d — 5D Riemannian Effective Lines of Code
//! File Path: crates/fg-algorithms/src/diff/eloc_5d.rs
//! Architecture Role: Pure Rust zero-allocation 5D ELOC evaluation and TSPR density metrics.
//! Domain Governance Rules: FGT-ALG-001, FGT-PRF-001 (zero transient heap allocation).

use serde::{Deserialize, Serialize};

/// Classification of a source code line in 5D Riemannian phase space.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineSemanticKind {
    Blank,
    Comment,
    DocComment,
    Trampoline,
    Substantive,
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

/// Classifies a single line slice with zero allocations.
#[inline]
pub fn classify_line(line_slice: &str) -> LineSemanticKind {
    let trimmed_line = line_slice.trim();
    if trimmed_line.is_empty() {
        return LineSemanticKind::Blank;
    }
    if trimmed_line.starts_with("///")
        || trimmed_line.starts_with("//!")
        || trimmed_line.starts_with("/**")
    {
        return LineSemanticKind::DocComment;
    }
    if trimmed_line.starts_with("//")
        || trimmed_line.starts_with("/*")
        || trimmed_line.starts_with('*')
        || trimmed_line.starts_with("*/")
        || trimmed_line.starts_with('#')
    {
        return LineSemanticKind::Comment;
    }
    if is_mechanical_trampoline(trimmed_line) {
        return LineSemanticKind::Trampoline;
    }
    LineSemanticKind::Substantive
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
    pub physical_lines: usize,
    pub blank_lines: usize,
    pub comment_lines: usize,
    pub substantive_lines: usize,
    pub effective_lines_of_code: f64,
    pub substantive_line_ratio: f64,
    pub substance_preservation_ratio: f64,
    /// Backward-compatible alias for `effective_lines_of_code`.
    pub eloc_5d: f64,
    /// Backward-compatible alias for `substance_preservation_ratio`.
    pub tspr: f64,
}

/// Evaluates 5D ELOC metrics over a source code string with zero heap allocations.
pub fn evaluate_file_5d_eloc(source_content: &str) -> File5dElocMetrics {
    let mut physical_lines = 0usize;
    let mut blank_lines = 0usize;
    let mut comment_lines = 0usize;
    let mut substantive_lines = 0usize;
    let mut effective_lines_of_code = 0.0f64;

    for source_line in source_content.lines() {
        physical_lines += 1;
        let semantic_kind = classify_line(source_line);
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
    let substantive_line_ratio = if physical_lines > 0 {
        (physical_lines - blank_lines - comment_lines) as f64 / physical_lines as f64
    } else {
        0.0
    };
    let substance_preservation_ratio = if physical_lines > 0 {
        effective_lines_of_code / physical_lines as f64
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

    for line in added_lines {
        physical_lines_added += 1;
        let semantic_kind = classify_line(line);
        match semantic_kind {
            LineSemanticKind::Blank => blank_lines_added += 1,
            LineSemanticKind::Comment | LineSemanticKind::DocComment => comment_lines_added += 1,
            LineSemanticKind::Trampoline => {}
            LineSemanticKind::Substantive => effective_lines_added += 1.0,
        }
    }

    let mut physical_lines_deleted = 0usize;
    let mut effective_lines_deleted = 0.0f64;
    for line in deleted_lines {
        physical_lines_deleted += 1;
        let semantic_kind = classify_line(line);
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
