//! Module: fg-algorithms::diff::eloc_manifold — 5D Riemann Effective Lines of Code
//! File Path: crates/fg-algorithms/src/diff/eloc_manifold.rs
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
            Self::Blank | Self::Comment | Self::DocComment | Self::Trampoline => 0.0,
            Self::Substantive => 1.0,
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
pub fn classify_line(line: &str) -> LineSemanticKind {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return LineSemanticKind::Blank;
    }
    if trimmed.starts_with("///") || trimmed.starts_with("//!") || trimmed.starts_with("/**") {
        return LineSemanticKind::DocComment;
    }
    if trimmed.starts_with("//")
        || trimmed.starts_with("/*")
        || trimmed.starts_with('*')
        || trimmed.starts_with("*/")
        || trimmed.starts_with('#')
    {
        return LineSemanticKind::Comment;
    }
    if is_mechanical_trampoline(trimmed) {
        return LineSemanticKind::Trampoline;
    }
    LineSemanticKind::Substantive
}

#[inline]
fn is_mechanical_trampoline(trimmed: &str) -> bool {
    let is_short_forward = (trimmed.starts_with("return ")
        || trimmed.starts_with("self.")
        || trimmed.starts_with("this."))
        && trimmed.ends_with(';')
        && trimmed.contains('(')
        && trimmed.len() <= 45;
    let is_trivial_wrapper = trimmed == "{}" || trimmed == "};";
    is_short_forward || is_trivial_wrapper
}

/// 5D ELOC and density metrics evaluated over a single file.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct File5dElocMetrics {
    pub physical_lines: usize,
    pub blank_lines: usize,
    pub comment_lines: usize,
    pub substantive_lines: usize,
    pub eloc_5d: f64,
    pub substantive_line_ratio: f64,
    pub tspr: f64,
}

/// Evaluates 5D ELOC metrics over a source code string with zero heap allocations.
pub fn evaluate_file_5d_eloc(source: &str) -> File5dElocMetrics {
    let mut physical_lines = 0usize;
    let mut blank_lines = 0usize;
    let mut comment_lines = 0usize;
    let mut substantive_lines = 0usize;
    let mut eloc_5d = 0.0f64;

    for line in source.lines() {
        physical_lines += 1;
        let kind = classify_line(line);
        match kind {
            LineSemanticKind::Blank => blank_lines += 1,
            LineSemanticKind::Comment | LineSemanticKind::DocComment => comment_lines += 1,
            LineSemanticKind::Trampoline => {}
            LineSemanticKind::Substantive => {
                substantive_lines += 1;
                eloc_5d += kind.weight();
            }
        }
    }
    let substantive_line_ratio = if physical_lines > 0 {
        (physical_lines - blank_lines - comment_lines) as f64 / physical_lines as f64
    } else {
        0.0
    };
    let tspr = if physical_lines > 0 {
        eloc_5d / physical_lines as f64
    } else {
        0.0
    };
    File5dElocMetrics {
        physical_lines,
        blank_lines,
        comment_lines,
        substantive_lines,
        eloc_5d,
        substantive_line_ratio,
        tspr,
    }
}

/// 5D ELOC differential delta between old and new texts.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Diff5dElocDelta {
    pub phys_add: usize,
    pub phys_del: usize,
    pub eloc_5d_add: f64,
    pub eloc_5d_del: f64,
    pub net_5d_turnover: f64,
    pub tspr_add: f64,
    pub substantive_ratio_add: f64,
}

/// Evaluates 5D ELOC delta over slices of added and deleted lines.
pub fn evaluate_diff_5d_eloc<'a>(
    additions: impl IntoIterator<Item = &'a str>,
    deletions: impl IntoIterator<Item = &'a str>,
) -> Diff5dElocDelta {
    let mut phys_add = 0usize;
    let mut blank_add = 0usize;
    let mut comment_add = 0usize;
    let mut eloc_5d_add = 0.0f64;

    for line in additions {
        phys_add += 1;
        let kind = classify_line(line);
        match kind {
            LineSemanticKind::Blank => blank_add += 1,
            LineSemanticKind::Comment | LineSemanticKind::DocComment => comment_add += 1,
            LineSemanticKind::Trampoline => {}
            LineSemanticKind::Substantive => eloc_5d_add += 1.0,
        }
    }

    let mut phys_del = 0usize;
    let mut eloc_5d_del = 0.0f64;
    for line in deletions {
        phys_del += 1;
        let kind = classify_line(line);
        if kind.is_substantive() {
            eloc_5d_del += 1.0;
        }
    }

    let substantive_ratio_add = if phys_add > 0 {
        (phys_add - blank_add - comment_add) as f64 / phys_add as f64
    } else {
        0.0
    };
    let tspr_add = if phys_add > 0 {
        eloc_5d_add / phys_add as f64
    } else {
        0.0
    };
    let net_5d_turnover = (eloc_5d_add + eloc_5d_del * 0.8).round_to(2);

    Diff5dElocDelta {
        phys_add,
        phys_del,
        eloc_5d_add,
        eloc_5d_del,
        net_5d_turnover,
        tspr_add,
        substantive_ratio_add,
    }
}

trait RoundHelper {
    fn round_to(self, decimals: u32) -> f64;
}

impl RoundHelper for f64 {
    #[inline]
    fn round_to(self, decimals: u32) -> f64 {
        let factor = 10f64.powi(decimals as i32);
        (self * factor).round() / factor
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pure_comments_produce_zero_eloc() {
        let code = "// Comment 1\n/* Block comment */\n/// Rustdoc line\n   \n";
        let m = evaluate_file_5d_eloc(code);
        assert_eq!(m.eloc_5d, 0.0);
        assert_eq!(m.tspr, 0.0);
        assert_eq!(m.comment_lines, 3);
        assert_eq!(m.blank_lines, 1);
    }

    #[test]
    fn test_substantive_code_metrics() {
        let code = "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n";
        let m = evaluate_file_5d_eloc(code);
        assert_eq!(m.substantive_lines, 3);
        assert_eq!(m.eloc_5d, 3.0);
        assert!(m.tspr >= 0.75);
    }

    #[test]
    fn test_diff_5d_turnover() {
        let added = ["pub fn calculate() -> u32 {", "    42", "}"];
        let deleted = ["// old comment", "pub fn old() {}"];
        let delta = evaluate_diff_5d_eloc(added.iter().copied(), deleted.iter().copied());
        assert_eq!(delta.phys_add, 3);
        assert_eq!(delta.eloc_5d_add, 3.0);
        assert_eq!(delta.eloc_5d_del, 1.0);
        assert!(delta.net_5d_turnover >= 3.8);
    }
}
