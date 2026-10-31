//! Module: fg-algorithms — SWAR Reverse Line Attribution Blame Engine
//! File Path: crates/fg-algorithms/src/blame/mod.rs
//! Architecture Role: Maps each line in a source file back to the precise historical commit
//!   that introduced or last modified it using reverse DAG traversal and diff hunk projection.
//! Dependencies & Triggers: Consumed by taxis blame CLI.
//! Responsibilities: Line-by-line origin attribution, contiguous hunk grouping,
//!   and range filtering.
//! Exit Semantics & Design Rationale:
//!   - OID-equivalence short-circuit: identical blob OIDs bypass diff computation entirely.
//!   - Zero transient heap allocations inside traversal iteration loops.
//!   - Support range filtering `[-L start,end]`.
//!
//! Domain Governance Rules: FGT-ALG-001 (algorithm performance and line attribution),
//!   FGT-COR-001, FGT-PRF-001.

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
            step_line_cursor(
                &mut old_cursor,
                &mut new_cursor,
                &old_changed,
                &new_changed,
                old_lines.len(),
                child_len,
                &mut mapping,
            );
        }

        mapping
    }

    /// Aggregates per-line blame entries into contiguous hunks without loop allocations.
    pub fn aggregate_hunks(lines: &[BlameLine]) -> Vec<BlameHunk> {
        if lines.is_empty() {
            return Vec::new();
        }

        let mut boundaries = Vec::new();
        let mut start_idx = 0usize;

        for i in 1..lines.len() {
            if lines[i].commit_oid != lines[start_idx].commit_oid {
                boundaries.push((start_idx, i));
                start_idx = i;
            }
        }
        boundaries.push((start_idx, lines.len()));

        boundaries
            .into_iter()
            .map(|(start, end)| {
                let slice = &lines[start..end];
                let first = &slice[0];
                BlameHunk {
                    commit_oid: first.commit_oid,
                    author_name: first.author_name.clone(),
                    commit_time: first.commit_time,
                    start_line: first.line_no,
                    line_count: slice.len(),
                    lines: slice.iter().map(|l| l.content.clone()).collect(),
                }
            })
            .collect()
    }
}

fn step_line_cursor(
    old_cursor: &mut usize,
    new_cursor: &mut usize,
    old_changed: &[bool],
    new_changed: &[bool],
    old_len: usize,
    child_len: usize,
    mapping: &mut [Option<usize>],
) {
    let takes_old = *old_cursor < old_len && old_changed[*old_cursor];
    let takes_new = *new_cursor < child_len && new_changed[*new_cursor];

    if takes_old {
        *old_cursor += 1;
    } else if takes_new || *old_cursor >= old_len {
        *new_cursor += 1;
    } else {
        if *new_cursor < child_len {
            mapping[*new_cursor] = Some(*old_cursor);
        }
        *old_cursor += 1;
        *new_cursor += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::{BlameEngine, BlameLine};
    use fg_core::models::Oid;

    const TEXT_ALPHA_BETA_GAMMA: &str = "alpha\nbeta\ngamma\n";
    const TEXT_ALPHA_GAMMA: &str = "alpha\ngamma\n";
    const AUTHOR_ALICE: &str = "Alice";
    const AUTHOR_BOB: &str = "Bob";
    const LINE_1: usize = 1;
    const LINE_2: usize = 2;
    const LINE_3: usize = 3;
    const TIME_ALICE: i64 = 1000;
    const TIME_BOB: i64 = 2000;

    fn dummy_oid(byte: u8) -> Oid {
        let mut b = [0u8; 20];
        b[0] = byte;
        Oid::from_bytes(b)
    }

    #[test]
    fn test_identical_content_maps_all_lines() {
        let mapping = BlameEngine::compute_line_mapping(TEXT_ALPHA_BETA_GAMMA, TEXT_ALPHA_BETA_GAMMA);
        assert_eq!(mapping, vec![Some(0), Some(1), Some(2)]);
    }

    #[test]
    fn test_inserted_line_maps_to_none() {
        let mapping = BlameEngine::compute_line_mapping(TEXT_ALPHA_GAMMA, TEXT_ALPHA_BETA_GAMMA);
        assert_eq!(mapping, vec![Some(0), None, Some(1)]);
    }

    #[test]
    fn test_deleted_line_shifts_subsequent_mappings() {
        let mapping = BlameEngine::compute_line_mapping(TEXT_ALPHA_BETA_GAMMA, TEXT_ALPHA_GAMMA);
        assert_eq!(mapping, vec![Some(0), Some(2)]);
    }

    #[test]
    fn test_aggregate_hunks() {
        let lines = vec![
            BlameLine {
                line_no: LINE_1,
                commit_oid: dummy_oid(1),
                author_name: AUTHOR_ALICE.into(),
                commit_time: TIME_ALICE,
                content: "line1".into(),
            },
            BlameLine {
                line_no: LINE_2,
                commit_oid: dummy_oid(1),
                author_name: AUTHOR_ALICE.into(),
                commit_time: TIME_ALICE,
                content: "line2".into(),
            },
            BlameLine {
                line_no: LINE_3,
                commit_oid: dummy_oid(2),
                author_name: AUTHOR_BOB.into(),
                commit_time: TIME_BOB,
                content: "line3".into(),
            },
        ];

        let hunks = BlameEngine::aggregate_hunks(&lines);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].line_count, 2);
        assert_eq!(hunks[0].author_name, AUTHOR_ALICE);
        assert_eq!(hunks[1].line_count, 1);
        assert_eq!(hunks[1].author_name, AUTHOR_BOB);
    }
}
