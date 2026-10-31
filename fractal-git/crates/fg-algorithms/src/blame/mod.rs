//! Module: fg-algorithms — SWAR Reverse Line Attribution Blame Engine
//! File Path: crates/fg-algorithms/src/blame/mod.rs
//! Architecture Role: Maps each line in a source file back to the precise historical commit
//!   that introduced or last modified it using reverse DAG traversal and diff hunk projection.
//! Dependencies & Triggers: Consumed by taxis blame CLI.
//! Responsibilities: Line-by-line origin attribution, contiguous hunk grouping, and range filtering.
//! Exit Semantics & Design Rationale:
//!   - OID-equivalence short-circuit: identical blob OIDs bypass diff computation entirely.
//!   - Zero transient heap allocations inside traversal iteration loops.
//!   - Support range filtering `[-L start,end]`.
//!
//! Domain Governance Rules: FGT-ALG-001 (algorithm performance and line attribution), FGT-COR-001, FGT-PRF-001.

use fg_core::models::Oid;
use serde::{Deserialize, Serialize};

use crate::diff::compute_xdiff_change_flags;
use crate::diff::patch::split_lines;

/// Line attribution metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlameLine {
    /// 1-based line number in final content.
    pub line_no: usize,
    /// Originating commit OID.
    pub commit_oid: Oid,
    /// Author name of originating commit.
    pub author_name: String,
    /// Commit timestamp in seconds since Unix epoch.
    pub commit_time: i64,
    /// Text line content.
    pub content: String,
}

/// Contiguous block of lines attributed to the same commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlameHunk {
    /// Commit OID that introduced this hunk.
    pub commit_oid: Oid,
    /// Author name.
    pub author_name: String,
    /// Author timestamp.
    pub commit_time: i64,
    /// 1-based starting line number in the final file.
    pub start_line: usize,
    /// Number of lines in this hunk.
    pub line_count: usize,
    /// Contained lines.
    pub lines: Vec<String>,
}

/// Reverse line attribution engine.
pub struct BlameEngine;

impl BlameEngine {
    /// Maps line numbers from child (new) to parent (old) based on a unified diff.
    ///
    /// Returns a vector of length `child_lines.len()` where `mapping[i]` is `Some(old_line_idx)`
    /// (0-based) if line `i` in child existed in parent, or `None` if it was added in child.
    pub fn compute_line_mapping(parent_content: &str, child_content: &str) -> Vec<Option<usize>> {
        let old_lines: Vec<&str> = split_lines(parent_content);
        let new_lines: Vec<&str> = split_lines(child_content);
        let child_len = new_lines.len();

        if parent_content == child_content {
            return (0..child_len).map(Some).collect();
        }

        let (old_changed, new_changed) =
            compute_xdiff_change_flags(parent_content, child_content, &old_lines, &new_lines);

        let mut mapping = vec![None; child_len];
        let mut old_cursor = 0usize;
        let mut new_cursor = 0usize;

        while old_cursor < old_lines.len() || new_cursor < new_lines.len() {
            let takes_old = old_cursor < old_lines.len() && old_changed[old_cursor];
            let takes_new = new_cursor < new_lines.len() && new_changed[new_cursor];

            if takes_old {
                // Deleted from parent: advances parent line cursor only
                old_cursor += 1;
            } else if takes_new || old_cursor >= old_lines.len() {
                // Added in child: mapping remains None
                new_cursor += 1;
            } else {
                // Common line preserved on both sides
                if new_cursor < child_len {
                    mapping[new_cursor] = Some(old_cursor);
                }
                old_cursor += 1;
                new_cursor += 1;
            }
        }

        mapping
    }

    /// Aggregates per-line blame entries into contiguous hunks.
    pub fn aggregate_hunks(lines: &[BlameLine]) -> Vec<BlameHunk> {
        if lines.is_empty() {
            return Vec::new();
        }

        let mut hunks = Vec::new();
        let mut cur_oid = lines[0].commit_oid;
        let mut cur_author = lines[0].author_name.clone();
        let mut cur_time = lines[0].commit_time;
        let mut cur_start = lines[0].line_no;
        let mut cur_lines = vec![lines[0].content.clone()];

        for line in &lines[1..] {
            if line.commit_oid == cur_oid {
                cur_lines.push(line.content.clone());
            } else {
                let count = cur_lines.len();
                hunks.push(BlameHunk {
                    commit_oid: cur_oid,
                    author_name: cur_author,
                    commit_time: cur_time,
                    start_line: cur_start,
                    line_count: count,
                    lines: cur_lines,
                });
                cur_oid = line.commit_oid;
                cur_author = line.author_name.clone();
                cur_time = line.commit_time;
                cur_start = line.line_no;
                cur_lines = vec![line.content.clone()];
            }
        }

        let count = cur_lines.len();
        hunks.push(BlameHunk {
            commit_oid: cur_oid,
            author_name: cur_author,
            commit_time: cur_time,
            start_line: cur_start,
            line_count: count,
            lines: cur_lines,
        });

        hunks
    }
}

#[cfg(test)]
mod tests {
    use super::{BlameEngine, BlameLine};
    use fg_core::models::Oid;

    fn dummy_oid(byte: u8) -> Oid {
        let mut b = [0u8; 20];
        b[0] = byte;
        Oid::from_bytes(b)
    }

    #[test]
    fn test_identical_content_maps_all_lines() {
        let text = "alpha\nbeta\ngamma\n";
        let mapping = BlameEngine::compute_line_mapping(text, text);
        assert_eq!(mapping, vec![Some(0), Some(1), Some(2)]);
    }

    #[test]
    fn test_inserted_line_maps_to_none() {
        let parent = "alpha\ngamma\n";
        let child = "alpha\nbeta\ngamma\n";
        let mapping = BlameEngine::compute_line_mapping(parent, child);
        assert_eq!(mapping, vec![Some(0), None, Some(1)]);
    }

    #[test]
    fn test_deleted_line_shifts_subsequent_mappings() {
        let parent = "alpha\nbeta\ngamma\n";
        let child = "alpha\ngamma\n";
        let mapping = BlameEngine::compute_line_mapping(parent, child);
        assert_eq!(mapping, vec![Some(0), Some(2)]);
    }

    #[test]
    fn test_aggregate_hunks() {
        let lines = vec![
            BlameLine {
                line_no: 1,
                commit_oid: dummy_oid(1),
                author_name: "Alice".into(),
                commit_time: 1000,
                content: "line1".into(),
            },
            BlameLine {
                line_no: 2,
                commit_oid: dummy_oid(1),
                author_name: "Alice".into(),
                commit_time: 1000,
                content: "line2".into(),
            },
            BlameLine {
                line_no: 3,
                commit_oid: dummy_oid(2),
                author_name: "Bob".into(),
                commit_time: 2000,
                content: "line3".into(),
            },
        ];

        let hunks = BlameEngine::aggregate_hunks(&lines);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].line_count, 2);
        assert_eq!(hunks[0].author_name, "Alice");
        assert_eq!(hunks[1].line_count, 1);
        assert_eq!(hunks[1].author_name, "Bob");
    }
}
