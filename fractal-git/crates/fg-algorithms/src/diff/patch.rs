//! Module: fg-algorithms::diff::patch — Unified Patch Facade
//! File Path: crates/fg-algorithms/src/diff/patch.rs
//! Architecture Role: Turns two texts into the hunks a unified patch is made of, by running the
//!   three stages in order: record preparation, bidirectional alignment, and change-group layout.
//! Dependencies & Triggers: Called by `taxis diff` and `taxis show`; the only public entry point for
//!   text comparison in the workspace.
//! Responsibilities: Split each side into records that keep their line terminator, hand them to the
//!   stages, walk the resulting flags into one aligned stream, and cut that stream into hunks.
//! Exit Semantics & Design Rationale:
//!   - A record includes its newline. That single decision is what makes a missing final newline a
//!     real difference: `"a\nb"` and `"a\nb\n"` produce different records, so the diff reports a
//!     change where a text-only comparison would report none and the renderer can annotate it.
//!   - Hunks are cut from an aligned stream rather than from the flags directly. A patch tool reads a
//!     hunk as replacing one contiguous region, so the old and new line numbers have to be carried
//!     alongside each entry; recomputing them from a single running index gets one side wrong as
//!     soon as the diff contains both deletions and additions.
//!   - Two changes separated by more than twice the context width start a new hunk. Emitting the gap
//!     as context instead would make one hunk claim a region far larger than the edit.
//!   - Nothing here is tuned for a particular input size. The alignment stage carries Git's own
//!     cost-derived limits, so a large rewrite degrades the same way `git diff` degrades instead of
//!     through a threshold invented here — thresholds on line counts were measured producing a
//!     1,300-line patch for an edit Git renders in 87 lines.
//!
//! Domain Governance Rules: FGT-ALG-001 (unified patch generation), FGT-COR-001, FGT-PRF-001.

use crate::diff::compact::{Compaction, Side};
use crate::diff::xdiff::mark_changed;
use crate::diff::xdiff_prepare::prepare;

/// A line in a diff hunk, owning its text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchLine {
    /// A line present on both sides.
    Context(String),
    /// A line only the new side has.
    Addition(String),
    /// A line only the old side has.
    Deletion(String),
}

/// A borrowed line in a diff hunk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatchLineRef<'a> {
    /// A line present on both sides.
    Context(&'a str),
    /// A line only the new side has.
    Addition(&'a str),
    /// A line only the old side has.
    Deletion(&'a str),
}

/// A contiguous hunk of owned line differences.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchHunk {
    /// 1-based first line of the hunk on the old side.
    pub old_start: usize,
    /// Number of old-side lines the hunk covers.
    pub old_count: usize,
    /// 1-based first line of the hunk on the new side.
    pub new_start: usize,
    /// Number of new-side lines the hunk covers.
    pub new_count: usize,
    /// The hunk's lines, in patch order.
    pub lines: Vec<PatchLine>,
}

/// A contiguous hunk of borrowed line differences.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchHunkRef<'a> {
    /// 1-based first line of the hunk on the old side.
    pub old_start: usize,
    /// Number of old-side lines the hunk covers.
    pub old_count: usize,
    /// 1-based first line of the hunk on the new side.
    pub new_start: usize,
    /// Number of new-side lines the hunk covers.
    pub new_count: usize,
    /// The hunk's lines, in patch order.
    pub lines: Vec<PatchLineRef<'a>>,
}

/// A complete unified patch for one file, owning its line text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnifiedPatch {
    /// Path the patch applies to.
    pub file_path: String,
    /// Hunks in file order.
    pub hunks: Vec<PatchHunk>,
}

/// A complete unified patch for one file, borrowing its line text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnifiedPatchRef<'a> {
    /// Path the patch applies to.
    pub file_path: &'a str,
    /// Hunks in file order.
    pub hunks: Vec<PatchHunkRef<'a>>,
}

/// Default number of unchanged lines kept on each side of a change.
///
/// Three is Git's default for `diff -U`, and patch tools assume it when a hunk header omits a count.
pub const DEFAULT_HUNK_CONTEXT: usize = 3;

/// Reports whether a text ends with a line terminator.
///
/// An empty text reports `true`: it has no final line, so there is nothing whose terminator could be
/// missing. Reporting `false` would make the renderer annotate a file that has no lines at all.
pub fn text_ends_with_newline(text: &str) -> bool {
    text.is_empty() || text.ends_with('\n')
}

/// Splits a text into lines the way Git's diff engine does.
///
/// Only `\n` ends a line; a carriage return stays inside the line text. `str::lines` strips a
/// trailing `\r`, which silently rewrites the content of every CRLF payload, so a patch for a path
/// Git treats as binary (`-text`, or a blob that really stores CRLF) would lose the `\r` on each
/// emitted line and no longer reproduce the file it claims to describe.
pub fn split_lines(text: &str) -> Vec<&str> {
    text.split_inclusive('\n')
        .map(|record| record.strip_suffix('\n').unwrap_or(record))
        .collect()
}

/// Trims identical 1024-byte blocks from the end of both buffers, ending on a newline boundary.
///
/// Mirrors Git's `trim_common_tail` in `xdiff-interface.c`. Git invokes this optimization only
/// when context length is 0 (`-U0`), so that unchanged trailing blocks on large files do not
/// skew the line classification counts or waste Myers graph search steps.
fn trim_common_tail<'a>(a: &'a str, b: &'a str) -> (&'a str, &'a str) {
    const BLK: usize = 1024;
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    let smaller = a_bytes.len().min(b_bytes.len());
    let mut trimmed = 0usize;

    while BLK + trimmed <= smaller
        && a_bytes[a_bytes.len() - trimmed - BLK..a_bytes.len() - trimmed]
            == b_bytes[b_bytes.len() - trimmed - BLK..b_bytes.len() - trimmed]
    {
        trimmed += BLK;
    }

    if trimmed == 0 {
        return (a, b);
    }

    let ap = a_bytes.len() - trimmed;
    let mut recovered = 0usize;
    while recovered < trimmed {
        let ch = a_bytes[ap + recovered];
        recovered += 1;
        if ch == b'\n' {
            break;
        }
    }

    let cut = trimmed - recovered;
    (&a[..a.len() - cut], &b[..b.len() - cut])
}

/// One entry of the aligned stream: the line plus the 1-based line numbers it maps to.
///
/// The numbers are recorded while the stream is built rather than derived afterwards, because a
/// deletion advances only the old side and an addition only the new one.
#[derive(Debug, Clone, Copy)]
struct AlignedLine<'a> {
    /// Line as it appears in the patch body.
    line: PatchLineRef<'a>,
    /// 1-based line number in the old file.
    old_line: usize,
    /// 1-based line number in the new file.
    new_line: usize,
}

/// Algorithm entry point for unified diff patches.
pub struct PatchGenerator;

impl PatchGenerator {
    /// Generates a unified patch with the default context width.
    pub fn generate_patch(file_path: &str, old_text: &str, new_text: &str) -> UnifiedPatch {
        Self::owned_from_ref(Self::generate_patch_ref(file_path, old_text, new_text))
    }

    /// Generates a unified patch, borrowing line text from the inputs.
    pub fn generate_patch_ref<'a>(
        file_path: &'a str,
        old_text: &'a str,
        new_text: &'a str,
    ) -> UnifiedPatchRef<'a> {
        Self::generate_patch_ref_with_context(file_path, old_text, new_text, DEFAULT_HUNK_CONTEXT)
    }

    /// Generates a unified patch with an explicit context width.
    ///
    /// `hunk_context` is the number of unchanged lines kept on each side of a change. Two changes
    /// separated by at most twice that many unchanged lines share one hunk; a wider gap starts a new
    /// one, because emitting the in-between lines as context would claim a region far larger than the
    /// edit and waste the reader's attention on text that did not change.
    pub fn generate_patch_ref_with_context<'a>(
        file_path: &'a str,
        old_text: &'a str,
        new_text: &'a str,
        hunk_context: usize,
    ) -> UnifiedPatchRef<'a> {
        // Identical content needs no search, and an empty pair has nothing to align. Both return
        // before allocating the per-record arrays the stages need.
        if old_text == new_text {
            return UnifiedPatchRef {
                file_path,
                hunks: Vec::new(),
            };
        }

        let (effective_old, effective_new) = if hunk_context == 0 {
            trim_common_tail(old_text, new_text)
        } else {
            (old_text, new_text)
        };

        let old_lines: Vec<&'a str> = split_lines(effective_old);
        let new_lines: Vec<&'a str> = split_lines(effective_new);

        let old_records: Vec<&[u8]> = effective_old
            .split_inclusive('\n')
            .map(str::as_bytes)
            .collect();
        let new_records: Vec<&[u8]> = effective_new
            .split_inclusive('\n')
            .map(str::as_bytes)
            .collect();
        let (prepared_old, prepared_new) = prepare(&old_records, &new_records);
        let (mut old_changed, mut new_changed) = mark_changed(&prepared_old, &prepared_new);

        // Both sides' class ids serve as line identity for the layout pass: two lines are the same
        // line exactly when they share a class, which is the same relation the alignment used.
        Compaction::new(
            Side {
                hashes: &prepared_old.classes,
                texts: &old_lines,
            },
            Side {
                hashes: &prepared_new.classes,
                texts: &new_lines,
            },
        )
        .run(&mut old_changed, &mut new_changed);

        let aligned = Self::align_lines(&old_lines, &new_lines, &old_changed, &new_changed);
        UnifiedPatchRef {
            file_path,
            hunks: split_into_hunks(&aligned, hunk_context),
        }
    }

    /// Converts a borrowed patch into an owning one.
    fn owned_from_ref(patch_ref: UnifiedPatchRef<'_>) -> UnifiedPatch {
        UnifiedPatch {
            file_path: patch_ref.file_path.to_string(),
            hunks: patch_ref
                .hunks
                .into_iter()
                .map(|hunk| PatchHunk {
                    old_start: hunk.old_start,
                    old_count: hunk.old_count,
                    new_start: hunk.new_start,
                    new_count: hunk.new_count,
                    lines: hunk
                        .lines
                        .into_iter()
                        .map(|line| match line {
                            PatchLineRef::Context(text) => PatchLine::Context(text.to_string()),
                            PatchLineRef::Addition(text) => PatchLine::Addition(text.to_string()),
                            PatchLineRef::Deletion(text) => PatchLine::Deletion(text.to_string()),
                        })
                        .collect(),
                })
                .collect(),
        }
    }

    /// Walks the two flag arrays in lockstep to produce the aligned stream.
    ///
    /// Deletions are emitted before additions within one run because that is the order Git prints and
    /// the order readers expect: a replacement shown as `+` then `-` reads as an insertion followed by
    /// an unrelated loss.
    fn align_lines<'a>(
        old_lines: &[&'a str],
        new_lines: &[&'a str],
        old_changed: &[bool],
        new_changed: &[bool],
    ) -> Vec<AlignedLine<'a>> {
        let mut aligned = Vec::with_capacity(old_lines.len() + new_lines.len());
        let mut old_cursor = 0usize;
        let mut new_cursor = 0usize;
        while old_cursor < old_lines.len() || new_cursor < new_lines.len() {
            let takes_old = old_cursor < old_lines.len() && old_changed[old_cursor];
            let takes_new = new_cursor < new_lines.len() && new_changed[new_cursor];
            if takes_old {
                aligned.push(AlignedLine {
                    line: PatchLineRef::Deletion(old_lines[old_cursor]),
                    old_line: old_cursor + 1,
                    new_line: new_cursor + 1,
                });
                old_cursor += 1;
            } else if takes_new || old_cursor >= old_lines.len() {
                aligned.push(AlignedLine {
                    line: PatchLineRef::Addition(new_lines[new_cursor]),
                    old_line: old_cursor + 1,
                    new_line: new_cursor + 1,
                });
                new_cursor += 1;
            } else {
                aligned.push(AlignedLine {
                    line: PatchLineRef::Context(old_lines[old_cursor]),
                    old_line: old_cursor + 1,
                    new_line: new_cursor + 1,
                });
                old_cursor += 1;
                new_cursor += 1;
            }
        }
        aligned
    }
}

/// Cuts the aligned stream into hunks carrying `context` unchanged lines per side.
///
/// Two change runs share a hunk when the gap between them, measured on the **old side**, is at most
/// twice the context width — that is `xdl_get_hunk`'s rule in `xdiff/xemit.c`, where
/// `distance = xch->i1 - (xchp->i1 + xchp->chg1)` is compared against `2 * ctxlen`. Measuring the gap
/// in the aligned stream instead counts new-side entries as if they were old-side lines, so a run of
/// insertions sitting next to a deletion looks contiguous and the two get merged. At `-U0` that
/// produces a hunk whose new-line count no longer matches the file: measured on a PowerShell module
/// where Git emits 11 lines from one anchor and a stream-position rule emits 29.
fn split_into_hunks<'a>(aligned: &[AlignedLine<'a>], context: usize) -> Vec<PatchHunkRef<'a>> {
    // One entry per *run* of changed lines, carrying the old-side span it covers. A replacement is a
    // single run even though its deletions and additions are adjacent: Git holds it as one
    // `xdchange` with one `i1` and one `chg1`, and measuring the deletions and additions as
    // separate changes makes the additions look like they start a line later. That produced a
    // spurious gap of one, split a hunk Git keeps whole, and reported 29 new lines where Git reports
    // 11 — visible only at `-U0`, where the gap threshold is zero.
    let mut runs: Vec<(usize, usize, usize, usize)> = Vec::new();
    let mut old_cursor = 0usize;
    let mut index = 0usize;
    while index < aligned.len() {
        if matches!(aligned[index].line, PatchLineRef::Context(_)) {
            old_cursor += 1;
            index += 1;
            continue;
        }
        let run_start = index;
        let old_start = old_cursor;
        while index < aligned.len() && !matches!(aligned[index].line, PatchLineRef::Context(_)) {
            if !matches!(aligned[index].line, PatchLineRef::Addition(_)) {
                old_cursor += 1;
            }
            index += 1;
        }
        runs.push((run_start, index - 1, old_start, old_cursor - old_start));
    }
    if runs.is_empty() {
        return Vec::new();
    }

    let max_common = context.saturating_mul(2);
    let mut hunks: Vec<PatchHunkRef<'a>> = Vec::new();
    let mut first = runs[0];
    let mut last = runs[0];
    for &run in &runs[1..] {
        let distance = run.2.saturating_sub(last.2 + last.3);
        if distance > max_common {
            hunks.push(build_hunk(
                aligned,
                first.0.saturating_sub(context),
                last.1 + context,
            ));
            first = run;
        }
        last = run;
    }
    hunks.push(build_hunk(
        aligned,
        first.0.saturating_sub(context),
        last.1 + context,
    ));
    hunks
}

/// Builds one hunk from `start..=end` of the aligned stream.
fn build_hunk<'a>(aligned: &[AlignedLine<'a>], start: usize, end: usize) -> PatchHunkRef<'a> {
    let end = end.min(aligned.len().saturating_sub(1));
    let slice = &aligned[start..=end];
    let first = &slice[0];
    let old_count = slice
        .iter()
        .filter(|entry| !matches!(entry.line, PatchLineRef::Addition(_)))
        .count();
    let new_count = slice
        .iter()
        .filter(|entry| !matches!(entry.line, PatchLineRef::Deletion(_)))
        .count();
    PatchHunkRef {
        // A hunk with no lines on one side has no first line there, so its start is the line the
        // hunk would be inserted after. Reporting the next line instead would place the hunk one
        // line too far when a patch tool applies it.
        old_start: if old_count == 0 {
            first.old_line.saturating_sub(1)
        } else {
            first.old_line
        },
        old_count,
        new_start: if new_count == 0 {
            first.new_line.saturating_sub(1)
        } else {
            first.new_line
        },
        new_count,
        lines: slice.iter().map(|entry| entry.line).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Renders the patch body the way the CLI does, so expectations read like real output.
    fn body(old_text: &str, new_text: &str) -> Vec<String> {
        let patch = PatchGenerator::generate_patch_ref("f.txt", old_text, new_text);
        let mut rendered = Vec::new();
        for hunk in &patch.hunks {
            rendered.push(format!(
                "@@ -{},{} +{},{} @@",
                hunk.old_start, hunk.old_count, hunk.new_start, hunk.new_count
            ));
            for line in &hunk.lines {
                match line {
                    PatchLineRef::Context(text) => rendered.push(format!(" {text}")),
                    PatchLineRef::Addition(text) => rendered.push(format!("+{text}")),
                    PatchLineRef::Deletion(text) => rendered.push(format!("-{text}")),
                }
            }
        }
        rendered
    }

    #[test]
    fn identical_text_produces_no_hunks() {
        assert!(body("a\nb\n", "a\nb\n").is_empty());
    }

    #[test]
    fn a_replacement_prints_the_deletion_before_the_addition() {
        assert_eq!(
            body("a\nb\nc\n", "a\nz\nc\n"),
            vec!["@@ -1,3 +1,3 @@", " a", "-b", "+z", " c"]
        );
    }

    #[test]
    fn a_deleted_line_next_to_blank_lines_rests_low() {
        // Matches `git diff` on the same input: the deletion is printed after the blank line it can
        // slide across, not before it.
        assert_eq!(
            body("a\n\nx\nb\n", "a\n\nb\n"),
            vec!["@@ -1,4 +1,3 @@", " a", " ", "-x", " b"]
        );
    }

    #[test]
    fn a_hunk_boundary_follows_the_context_width() {
        let old_text = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
        let new_text = "1\nX\n3\n4\n5\n6\n7\n8\n9\nY\n";
        // Nine unchanged lines separate the two changes, more than twice the three-line context, so
        // they must not share a hunk.
        let rendered = body(old_text, new_text);
        let headers: Vec<&String> = rendered
            .iter()
            .filter(|line| line.starts_with("@@"))
            .collect();
        assert_eq!(headers.len(), 2, "{rendered:?}");
    }

    #[test]
    fn a_final_line_without_a_terminator_is_a_change() {
        // `"a\nb"` and `"a\nb\n"` differ in one byte; the records keep that byte apart so the diff
        // reports the difference instead of declaring the files equal.
        let rendered = body("a\nb", "a\nb\n");
        assert!(rendered.iter().any(|line| line == "-b"), "{rendered:?}");
        assert!(rendered.iter().any(|line| line == "+b"), "{rendered:?}");
    }

    #[test]
    fn a_carriage_return_stays_inside_the_line() {
        // `str::lines` strips a trailing `\r`, which would rewrite the payload of a path Git treats
        // as binary (`-text`) and emit a patch that no longer reproduces the file.
        assert_eq!(split_lines("a\r\nb\r\n"), vec!["a\r", "b\r"]);
        assert_eq!(split_lines("a\r\nb"), vec!["a\r", "b"]);
        assert_eq!(split_lines(""), Vec::<&str>::new());
        let rendered = body("a\r\nb\r\n", "a\r\nz\r\n");
        assert!(rendered.iter().any(|line| line == "-b\r"), "{rendered:?}");
        assert!(rendered.iter().any(|line| line == "+z\r"), "{rendered:?}");
    }

    #[test]
    fn a_blank_side_produces_a_pure_addition_hunk() {
        assert_eq!(body("", "a\nb\n"), vec!["@@ -0,0 +1,2 @@", "+a", "+b"]);
    }

    #[test]
    fn an_added_line_at_the_end_keeps_the_leading_context() {
        assert_eq!(
            body("a\nb\n", "a\nb\nc\n"),
            vec!["@@ -1,2 +1,3 @@", " a", " b", "+c"]
        );
    }

    #[test]
    fn the_owned_form_matches_the_borrowed_form() {
        let borrowed = PatchGenerator::generate_patch_ref("f.txt", "a\nb\n", "a\nc\n");
        let owned = PatchGenerator::generate_patch("f.txt", "a\nb\n", "a\nc\n");
        assert_eq!(owned.file_path, borrowed.file_path);
        assert_eq!(owned.hunks.len(), borrowed.hunks.len());
        assert_eq!(owned.hunks[0].lines.len(), borrowed.hunks[0].lines.len());
    }

    #[test]
    fn trim_common_tail_drops_large_trailing_identical_blocks_at_u0() {
        let prefix = "head\nline\n";
        let old_diff = "old_diff\n";
        let new_diff = "new_diff\n";
        let common_tail = "unchanged\n".repeat(200);
        let old = format!("{prefix}{old_diff}{common_tail}");
        let new = format!("{prefix}{new_diff}{common_tail}");

        let patch_u0 = PatchGenerator::generate_patch_ref_with_context("f.txt", &old, &new, 0);
        assert_eq!(patch_u0.hunks.len(), 1);
        let hunk = &patch_u0.hunks[0];
        assert_eq!(hunk.old_start, 3);
        assert_eq!(hunk.old_count, 1);
        assert_eq!(hunk.new_start, 3);
        assert_eq!(hunk.new_count, 1);
        assert_eq!(
            hunk.lines,
            vec![
                PatchLineRef::Deletion("old_diff"),
                PatchLineRef::Addition("new_diff"),
            ]
        );
    }
}
