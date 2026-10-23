//! Module: fg-algorithms — Three-Way Text Merge Operator
//! File Path: crates/fg-algorithms/src/merge/text_merge.rs
//! Architecture Role: Pure algorithmic line-level three-way text merge operator (xdl_merge equivalent)
//!   reconciling independent non-overlapping line edits, detecting concurrent modifications,
//!   and formatting localized standard diff3 conflict markers without corrupting file integrity.
//! Dependencies & Triggers: Consumed by Taxis CLI merge, rebase, and cherry-pick porcelain commands.
//! Responsibilities: Evaluates line-level differences against a common ancestor base, merges disjoint
//!   hunks, recognizes identical edits from both sides as clean, and emits standard conflict delimiters
//!   only on genuinely conflicting regions.
//! Exit Semantics & Design Rationale:
//!   - Returns `TextMergeResult` with `is_clean: bool`, `conflict_count: usize`, and merged bytes.
//!   - Identical modifications on both branches are recognized as clean merges, matching Git behavior.
//!   - Non-overlapping edits separated by at least one common base line merge cleanly.
//!   - Binary or non-UTF8 buffers safely fall back to whole-file conflict delimiters without panicking.
//!   - Zero transient heap allocations inside loops (FGT-PRF-001) using preallocated byte buffers and slices.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-OBJ-001`: Git plumbing byte parity and merge reproducibility guard
//! - `FGT-PRF-001`: Pure algorithmic computation with minimal allocation

use crate::diff::compact::{Compaction, Side};
use crate::diff::xdiff::mark_changed;
use crate::diff::xdiff_prepare::prepare;
use crate::diff::{split_lines, text_ends_with_newline};

/// Result of a 3-way text merge operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextMergeResult {
    /// True if all differences were resolved cleanly without conflicts.
    pub is_clean: bool,
    /// Number of conflict chunks encountered.
    pub conflict_count: usize,
    /// Merged payload bytes (including conflict markers if conflicted).
    pub content: Vec<u8>,
}

/// A contiguous line edit relative to the common base text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LineEdit<'a> {
    /// 0-based start line index in base (inclusive).
    base_start: usize,
    /// 0-based end line index in base (exclusive).
    base_end: usize,
    /// Borrowed replacement lines introduced by the target side.
    new_lines: &'a [&'a str],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EditSide {
    Ours,
    Theirs,
}

#[derive(Debug, Clone, Copy)]
struct TaggedEdit<'a> {
    side: EditSide,
    edit: LineEdit<'a>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ClusterRange {
    start_idx: usize,
    end_idx: usize,
    base_start: usize,
    base_end: usize,
}

/// Appends a line followed by a newline byte into the buffer.
fn write_line(content: &mut Vec<u8>, line: &str) {
    content.extend_from_slice(line.as_bytes());
    content.push(b'\n');
}

/// Appends standard Git conflict boundary header into the buffer.
fn write_conflict_marker(content: &mut Vec<u8>, marker: &str, label: &str) {
    content.extend_from_slice(marker.as_bytes());
    content.push(b' ');
    content.extend_from_slice(label.as_bytes());
    content.push(b'\n');
}

/// Three-way line-level text merge operator.
pub struct TextThreeWayMerge;

impl TextThreeWayMerge {
    /// Merges `ours` and `theirs` against a common ancestor `base`.
    ///
    /// If both sides make non-overlapping modifications or identical edits, the merge
    /// is resolved cleanly (`is_clean: true`). If conflicting modifications overlap,
    /// standard Git-style conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) are inserted
    /// strictly around the conflicting hunks.
    pub fn merge(
        base: &[u8],
        ours: &[u8],
        theirs: &[u8],
        ours_label: &str,
        theirs_label: &str,
    ) -> TextMergeResult {
        // Fast paths: identical sides or one-sided changes
        if ours == theirs {
            return TextMergeResult {
                is_clean: true,
                conflict_count: 0,
                content: ours.to_vec(),
            };
        }
        if base == ours {
            return TextMergeResult {
                is_clean: true,
                conflict_count: 0,
                content: theirs.to_vec(),
            };
        }
        if base == theirs {
            return TextMergeResult {
                is_clean: true,
                conflict_count: 0,
                content: ours.to_vec(),
            };
        }

        // Binary check: NUL bytes or invalid UTF-8 force full-file conflict markers
        if base.contains(&0) || ours.contains(&0) || theirs.contains(&0) {
            return Self::binary_conflict_fallback(ours, theirs, ours_label, theirs_label);
        }

        let (base_str, ours_str, theirs_str) = match (
            std::str::from_utf8(base),
            std::str::from_utf8(ours),
            std::str::from_utf8(theirs),
        ) {
            (Ok(b), Ok(o), Ok(t)) => (b, o, t),
            _ => return Self::binary_conflict_fallback(ours, theirs, ours_label, theirs_label),
        };

        Self::merge_utf8(base_str, ours_str, theirs_str, ours_label, theirs_label)
    }

    /// Performs line-level 3-way merge on valid UTF-8 text strings.
    fn merge_utf8(
        base_str: &str,
        ours_str: &str,
        theirs_str: &str,
        ours_label: &str,
        theirs_label: &str,
    ) -> TextMergeResult {
        let base_lines = split_lines(base_str);
        let ours_lines = split_lines(ours_str);
        let theirs_lines = split_lines(theirs_str);

        let ours_edits = Self::extract_edits(&base_lines, &ours_lines, base_str, ours_str);
        let theirs_edits = Self::extract_edits(&base_lines, &theirs_lines, base_str, theirs_str);

        // If either side has no edits, the other side wins cleanly
        if ours_edits.is_empty() {
            return TextMergeResult {
                is_clean: true,
                conflict_count: 0,
                content: theirs_str.as_bytes().to_vec(),
            };
        }
        if theirs_edits.is_empty() {
            return TextMergeResult {
                is_clean: true,
                conflict_count: 0,
                content: ours_str.as_bytes().to_vec(),
            };
        }

        let mut all_edits: Vec<TaggedEdit<'_>> =
            Vec::with_capacity(ours_edits.len() + theirs_edits.len());
        for &edit in &ours_edits {
            all_edits.push(TaggedEdit {
                side: EditSide::Ours,
                edit,
            });
        }
        for &edit in &theirs_edits {
            all_edits.push(TaggedEdit {
                side: EditSide::Theirs,
                edit,
            });
        }

        // Sort edits primarily by base_start, then by base_end
        all_edits.sort_by(|a, b| {
            a.edit
                .base_start
                .cmp(&b.edit.base_start)
                .then_with(|| a.edit.base_end.cmp(&b.edit.base_end))
        });

        // Cluster overlapping or adjacent edits (touching without intervening unchanged base lines)
        let mut cluster_ranges: Vec<ClusterRange> = Vec::new();
        let mut cluster_start_idx = 0usize;
        let mut cluster_base_start = 0usize;
        let mut cluster_base_end = 0usize;
        let mut has_cluster = false;

        for (idx, tagged) in all_edits.iter().enumerate() {
            if !has_cluster {
                cluster_start_idx = idx;
                cluster_base_start = tagged.edit.base_start;
                cluster_base_end = tagged.edit.base_end;
                has_cluster = true;
            } else if tagged.edit.base_start <= cluster_base_end {
                // Overlaps or adjacent: group into same cluster
                cluster_base_end = cluster_base_end.max(tagged.edit.base_end);
            } else {
                // Separated by at least one unchanged base line
                cluster_ranges.push(ClusterRange {
                    start_idx: cluster_start_idx,
                    end_idx: idx,
                    base_start: cluster_base_start,
                    base_end: cluster_base_end,
                });
                cluster_start_idx = idx;
                cluster_base_start = tagged.edit.base_start;
                cluster_base_end = tagged.edit.base_end;
            }
        }
        if has_cluster {
            cluster_ranges.push(ClusterRange {
                start_idx: cluster_start_idx,
                end_idx: all_edits.len(),
                base_start: cluster_base_start,
                base_end: cluster_base_end,
            });
        }

        let estimated_cap = base_str.len() + ours_str.len() + theirs_str.len() + 256;
        let mut content: Vec<u8> = Vec::with_capacity(estimated_cap);
        let mut base_cursor = 0usize;
        let mut conflict_count = 0usize;

        let mut ours_reconstructed: Vec<&str> = Vec::with_capacity(64);
        let mut theirs_reconstructed: Vec<&str> = Vec::with_capacity(64);

        for range in &cluster_ranges {
            let cluster_start = range.base_start;
            let cluster_end = range.base_end;
            let cluster_edits = &all_edits[range.start_idx..range.end_idx];

            // Emit unchanged base lines before this cluster
            if cluster_start > base_cursor {
                for line in &base_lines[base_cursor..cluster_start] {
                    write_line(&mut content, line);
                }
            }

            ours_reconstructed.clear();
            theirs_reconstructed.clear();

            let mut has_ours = false;
            let mut has_theirs = false;

            for e in cluster_edits {
                if e.side == EditSide::Ours {
                    has_ours = true;
                } else {
                    has_theirs = true;
                }
            }

            Self::reconstruct_cluster_slice(
                &base_lines,
                cluster_start,
                cluster_end,
                cluster_edits,
                EditSide::Ours,
                &mut ours_reconstructed,
            );
            Self::reconstruct_cluster_slice(
                &base_lines,
                cluster_start,
                cluster_end,
                cluster_edits,
                EditSide::Theirs,
                &mut theirs_reconstructed,
            );

            if ours_reconstructed == theirs_reconstructed {
                // Both made the exact same modification: clean merge
                for line in &ours_reconstructed {
                    write_line(&mut content, line);
                }
            } else if !has_theirs {
                // Only ours modified this region
                for line in &ours_reconstructed {
                    write_line(&mut content, line);
                }
            } else if !has_ours {
                // Only theirs modified this region
                for line in &theirs_reconstructed {
                    write_line(&mut content, line);
                }
            } else {
                // Real conflict: emit localized conflict markers
                conflict_count += 1;
                write_conflict_marker(&mut content, "<<<<<<<", ours_label);
                for line in &ours_reconstructed {
                    write_line(&mut content, line);
                }
                content.extend_from_slice(b"=======\n");
                for line in &theirs_reconstructed {
                    write_line(&mut content, line);
                }
                write_conflict_marker(&mut content, ">>>>>>>", theirs_label);
            }

            base_cursor = cluster_end;
        }

        // Emit any trailing unchanged base lines
        if base_cursor < base_lines.len() {
            for line in &base_lines[base_cursor..] {
                write_line(&mut content, line);
            }
        }

        // Format result text preserving newline expectations
        let needs_trailing_newline = text_ends_with_newline(ours_str)
            || text_ends_with_newline(theirs_str)
            || text_ends_with_newline(base_str)
            || conflict_count > 0;

        if !needs_trailing_newline && content.ends_with(b"\n") {
            content.pop();
        }

        TextMergeResult {
            is_clean: conflict_count == 0,
            conflict_count,
            content,
        }
    }

    /// Reconstructs the lines produced by one side over a cluster region into reusable buffer.
    fn reconstruct_cluster_slice<'a>(
        base_lines: &'a [&'a str],
        cluster_start: usize,
        cluster_end: usize,
        cluster: &[TaggedEdit<'a>],
        side: EditSide,
        out: &mut Vec<&'a str>,
    ) {
        let mut cursor = cluster_start;
        for tagged in cluster {
            if tagged.side != side {
                continue;
            }
            let edit = &tagged.edit;
            if edit.base_start > cursor && cursor < base_lines.len() {
                let end = edit.base_start.min(base_lines.len());
                out.extend_from_slice(&base_lines[cursor..end]);
            }
            out.extend_from_slice(edit.new_lines);
            cursor = edit.base_end;
        }
        if cursor < cluster_end && cursor < base_lines.len() {
            let end = cluster_end.min(base_lines.len());
            out.extend_from_slice(&base_lines[cursor..end]);
        }
    }

    /// Extracts line edits transforming `base` into `target` with zero transient allocations in loop.
    fn extract_edits<'a>(
        base_lines: &'a [&'a str],
        target_lines: &'a [&'a str],
        base_str: &'a str,
        target_str: &'a str,
    ) -> Vec<LineEdit<'a>> {
        if base_str == target_str {
            return Vec::new();
        }

        let old_records: Vec<&[u8]> = base_str.split_inclusive('\n').map(str::as_bytes).collect();
        let new_records: Vec<&[u8]> = target_str
            .split_inclusive('\n')
            .map(str::as_bytes)
            .collect();
        let (prepared_old, prepared_new) = prepare(&old_records, &new_records);
        let (mut old_changed, mut new_changed) = mark_changed(&prepared_old, &prepared_new);

        Compaction::new(
            Side {
                hashes: &prepared_old.classes,
                texts: base_lines,
            },
            Side {
                hashes: &prepared_new.classes,
                texts: target_lines,
            },
        )
        .run(&mut old_changed, &mut new_changed);

        let mut edits = Vec::new();
        let mut old_cursor = 0usize;
        let mut new_cursor = 0usize;

        while old_cursor < base_lines.len() || new_cursor < target_lines.len() {
            let takes_old = old_cursor < base_lines.len() && old_changed[old_cursor];
            let takes_new = new_cursor < target_lines.len() && new_changed[new_cursor];
            if takes_old || takes_new {
                let base_start = old_cursor;
                let target_start = new_cursor;
                while old_cursor < base_lines.len() && old_changed[old_cursor] {
                    old_cursor += 1;
                }
                while new_cursor < target_lines.len() && new_changed[new_cursor] {
                    new_cursor += 1;
                }
                let base_end = old_cursor;
                let target_end = new_cursor;
                edits.push(LineEdit {
                    base_start,
                    base_end,
                    new_lines: &target_lines[target_start..target_end],
                });
            } else {
                old_cursor += 1;
                new_cursor += 1;
            }
        }

        edits
    }

    /// Emits whole-file conflict markers for binary or invalid UTF-8 payloads.
    fn binary_conflict_fallback(
        ours: &[u8],
        theirs: &[u8],
        ours_label: &str,
        theirs_label: &str,
    ) -> TextMergeResult {
        let mut content = Vec::new();
        write_conflict_marker(&mut content, "<<<<<<<", ours_label);
        content.extend_from_slice(ours);
        if !content.ends_with(b"\n") {
            content.push(b'\n');
        }
        content.extend_from_slice(b"=======\n");
        content.extend_from_slice(theirs);
        if !content.ends_with(b"\n") {
            content.push(b'\n');
        }
        write_conflict_marker(&mut content, ">>>>>>>", theirs_label);

        TextMergeResult {
            is_clean: false,
            conflict_count: 1,
            content,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_clean_non_overlapping() {
        let base = b"line1\nline2\nline3\nline4\nline5\n";
        let ours = b"line1\nOURS_LINE2\nline3\nline4\nline5\n";
        let theirs = b"line1\nline2\nline3\nTHEIRS_LINE4\nline5\n";

        let result = TextThreeWayMerge::merge(base, ours, theirs, "HEAD", "target");
        assert!(result.is_clean);
        assert_eq!(result.conflict_count, 0);

        let merged_str = std::str::from_utf8(&result.content).unwrap();
        assert_eq!(
            merged_str,
            "line1\nOURS_LINE2\nline3\nTHEIRS_LINE4\nline5\n"
        );
    }

    #[test]
    fn test_merge_clean_identical_modifications() {
        let base = b"line1\nline2\nline3\n";
        let ours = b"line1\nSAME_CHANGE\nline3\n";
        let theirs = b"line1\nSAME_CHANGE\nline3\n";

        let result = TextThreeWayMerge::merge(base, ours, theirs, "HEAD", "target");
        assert!(result.is_clean);
        assert_eq!(result.conflict_count, 0);

        let merged_str = std::str::from_utf8(&result.content).unwrap();
        assert_eq!(merged_str, "line1\nSAME_CHANGE\nline3\n");
    }

    #[test]
    fn test_merge_clean_both_delete_same_line() {
        let base = b"line1\nline2\nline3\n";
        let ours = b"line1\nline3\n";
        let theirs = b"line1\nline3\n";

        let result = TextThreeWayMerge::merge(base, ours, theirs, "HEAD", "target");
        assert!(result.is_clean);
        assert_eq!(result.conflict_count, 0);

        let merged_str = std::str::from_utf8(&result.content).unwrap();
        assert_eq!(merged_str, "line1\nline3\n");
    }

    #[test]
    fn test_merge_conflict_same_line_divergent() {
        let base = b"line1\nline2\nline3\n";
        let ours = b"line1\nOURS_VAL\nline3\n";
        let theirs = b"line1\nTHEIRS_VAL\nline3\n";

        let result = TextThreeWayMerge::merge(base, ours, theirs, "HEAD", "feature");
        assert!(!result.is_clean);
        assert_eq!(result.conflict_count, 1);

        let merged_str = std::str::from_utf8(&result.content).unwrap();
        let expected =
            "line1\n<<<<<<< HEAD\nOURS_VAL\n=======\nTHEIRS_VAL\n>>>>>>> feature\nline3\n";
        assert_eq!(merged_str, expected);
    }

    #[test]
    fn test_merge_conflict_adjacent_lines() {
        let base = b"line1\nline2\nline3\nline4\n";
        let ours = b"line1\nOURS_2\nline3\nline4\n";
        let theirs = b"line1\nline2\nTHEIRS_3\nline4\n";

        let result = TextThreeWayMerge::merge(base, ours, theirs, "HEAD", "feature");
        assert!(!result.is_clean);
        assert_eq!(result.conflict_count, 1);

        let merged_str = std::str::from_utf8(&result.content).unwrap();
        let expected = "line1\n<<<<<<< HEAD\nOURS_2\nline3\n=======\nline2\nTHEIRS_3\n>>>>>>> feature\nline4\n";
        assert_eq!(merged_str, expected);
    }

    #[test]
    fn test_merge_binary_fallback() {
        let base = b"bin\0ary\n";
        let ours = b"bin\0ary_ours\n";
        let theirs = b"bin\0ary_theirs\n";

        let result = TextThreeWayMerge::merge(base, ours, theirs, "HEAD", "feature");
        assert!(!result.is_clean);
        assert_eq!(result.conflict_count, 1);
        assert!(result.content.starts_with(b"<<<<<<< HEAD\n"));
    }
}
