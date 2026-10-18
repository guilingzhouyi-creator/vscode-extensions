//! Module: fg-algorithms — Unified Diff & Patch Generator
//! File Path: crates/fg-algorithms/src/diff/patch.rs
//! Architecture Role: Computes unified diff patches between file versions,
//!   enabling Agents and Gates to review precise line-level alterations.

/// A line in a diff hunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchLine {
    Context(String),
    Addition(String),
    Deletion(String),
}

/// A contiguous hunk of line differences.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchHunk {
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
    pub lines: Vec<PatchLine>,
}

/// A complete unified diff patch for a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnifiedPatch {
    pub file_path: String,
    pub hunks: Vec<PatchHunk>,
}

/// Algorithm generator for unified diff patches.
pub struct PatchGenerator;

impl PatchGenerator {
    /// Generates a simple unified patch comparing old and new line arrays.
    pub fn generate_patch(file_path: &str, old_text: &str, new_text: &str) -> UnifiedPatch {
        let old_lines: Vec<&str> = old_text.lines().collect();
        let new_lines: Vec<&str> = new_text.lines().collect();

        let mut hunk_lines = Vec::new();
        let mut old_idx = 0;
        let mut new_idx = 0;

        while old_idx < old_lines.len() || new_idx < new_lines.len() {
            if old_idx < old_lines.len() && new_idx < new_lines.len() && old_lines[old_idx] == new_lines[new_idx] {
                hunk_lines.push(PatchLine::Context(old_lines[old_idx].to_string()));
                old_idx += 1;
                new_idx += 1;
            } else {
                if old_idx < old_lines.len() {
                    hunk_lines.push(PatchLine::Deletion(old_lines[old_idx].to_string()));
                    old_idx += 1;
                }
                if new_idx < new_lines.len() {
                    hunk_lines.push(PatchLine::Addition(new_lines[new_idx].to_string()));
                    new_idx += 1;
                }
            }
        }

        let hunk = PatchHunk {
            old_start: 1,
            old_count: old_lines.len(),
            new_start: 1,
            new_count: new_lines.len(),
            lines: hunk_lines,
        };

        UnifiedPatch {
            file_path: file_path.to_string(),
            hunks: vec![hunk],
        }
    }
}
