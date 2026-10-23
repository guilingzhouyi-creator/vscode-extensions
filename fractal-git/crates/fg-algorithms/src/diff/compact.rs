//! Module: fg-algorithms::diff::compact — Change-Group Compaction
//! File Path: crates/fg-algorithms/src/diff/compact.rs
//! Architecture Role: Port of the pass `xdiff` runs after its shortest-edit-script search and
//!   before it builds hunks. It is what makes a minimal script render the way `git diff` renders it.
//! Dependencies & Triggers: Called by `PatchGenerator` once every changed line has been marked on
//!   both sides of a file comparison.
//! Responsibilities: Slide each run of changed lines as far as it will go in both directions, pull
//!   it back to the position that lines up with the corresponding run on the other side, and when
//!   there is no such counterpart choose the resting position with the lowest indent penalty.
//! Exit Semantics & Design Rationale:
//!   - Compaction never invents or removes a change: a run only slides across lines that are
//!     *identical* to the run's own edge lines, so the two sides keep pairing up and the patch
//!     still applies. That invariant is why choosing where a run rests is a rendering decision
//!     rather than a semantic one.
//!   - Two different minimal scripts describe the same edit. Which one Git prints is decided by
//!     this pass alone, so without it a correct Myers result still disagrees with `git diff` on the
//!     hunk boundaries — measured as thirteen of thirty sampled commits.
//!   - The indent heuristic is unconditional because Git enables it by default
//!     (`diff.indentHeuristic`, since 2.14). A switch nobody can reach through `taxis diff` would be
//!     a second rendering mode with no caller.
//!   - A broken group invariant aborts compaction and reports `false` instead of panicking. The
//!     changed flags still describe a valid diff, just a less pretty one, so the caller can proceed;
//!     a repository read has no business crashing over hunk aesthetics.

/// Indentation width at which measuring stops.
///
/// Mirrors Git's `MAX_INDENT`. Long runs of leading whitespace come from generated or minified data,
/// and the score only compares indents against each other, so clamping loses nothing and keeps the
/// arithmetic far inside `i32`.
const MAX_INDENT: i32 = 200;

/// Consecutive blank lines at which blank counting stops.
///
/// Mirrors Git's `MAX_BLANKS`: without a ceiling, a file of blank lines makes the score quadratic.
const MAX_BLANKS: i32 = 20;

/// Penalty for a split with nothing but blank lines above it.
const START_OF_FILE_PENALTY: i32 = 1;

/// Penalty for a split at the end of the file.
const END_OF_FILE_PENALTY: i32 = 21;

/// Weight per blank line on either side of the split.
const TOTAL_BLANK_WEIGHT: i32 = -30;

/// Extra weight per blank line below the split.
const POST_BLANK_WEIGHT: i32 = 6;

/// Penalty when the split line is indented deeper than the line above it.
const RELATIVE_INDENT_PENALTY: i32 = -4;

/// The same, when blank lines are involved.
const RELATIVE_INDENT_WITH_BLANK_PENALTY: i32 = 10;

/// Penalty when the split line is indented less than both neighbours, which reads as a block start.
const RELATIVE_OUTDENT_PENALTY: i32 = 24;

/// The same, when blank lines are involved.
const RELATIVE_OUTDENT_WITH_BLANK_PENALTY: i32 = 17;

/// Penalty when the split line is indented less than the line above only, which reads as a block end.
const RELATIVE_DEDENT_PENALTY: i32 = 23;

/// The same, when blank lines are involved.
const RELATIVE_DEDENT_WITH_BLANK_PENALTY: i32 = 17;

/// Weight applied to the sign of the summed effective indent difference.
///
/// The indent difference collapses to `-1`, `0`, or `1` before weighting, so a position one level
/// outdented is favoured over one three levels outdented by the same amount: the scale is ordinal,
/// not linear, and the penalty terms break ties within a level.
const INDENT_WEIGHT: i32 = 60;

/// Largest distance, in lines, the indent heuristic may move a run.
const INDENT_HEURISTIC_MAX_SLIDING: isize = 100;

/// One side of a comparison as compaction sees it: a hash per line for identity, and the text per
/// line for indentation.
///
/// Identity comes from the hash rather than the text because the hash also encodes whether the
/// file's final line carries a terminator. Comparing text alone would let a run slide onto a line
/// that only looks equal, and the resulting patch would put the missing-terminator annotation on
/// the wrong line.
#[derive(Debug, Clone, Copy)]
pub struct Side<'a, Id = u32> {
    /// Line identity, as produced by the alignment stage's record classification.
    pub hashes: &'a [Id],
    /// Line text, without its terminator.
    pub texts: &'a [&'a str],
}

impl<'a, Id: Copy + PartialEq> Side<'a, Id> {
    /// Number of lines on this side, taken as the shorter of the two views.
    fn len(&self) -> usize {
        self.hashes.len().min(self.texts.len())
    }

    /// Reports whether two of this side's lines are the same line.
    fn matches(&self, first: usize, second: usize) -> bool {
        self.hashes[first] == self.hashes[second]
    }
}

/// A run of changed lines on one side, as `[start, end)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ChangeGroup {
    start: usize,
    end: usize,
}

impl ChangeGroup {
    /// Reports whether the run covers no lines, which is the case between any two unchanged lines.
    fn is_empty(&self) -> bool {
        self.end == self.start
    }

    /// Number of lines the run covers.
    fn len(&self) -> usize {
        self.end - self.start
    }
}

/// Indentation of one line, in columns, with `-1` for a blank line.
///
/// Tabs advance to the next multiple of eight, matching Git's `get_indent`. Reporting a blank line
/// as `-1` rather than `0` is what lets the scorer tell "no indentation" apart from "nothing here".
fn line_indent(line: &str) -> i32 {
    let mut width = 0i32;
    for byte in line.bytes() {
        if !byte.is_ascii_whitespace() {
            return width;
        }
        if byte == b' ' {
            width += 1;
        } else if byte == b'\t' {
            width += 8 - width % 8;
        }
        if width >= MAX_INDENT {
            return MAX_INDENT;
        }
    }
    -1
}

/// Characteristics of a hypothetical split above line `split`.
#[derive(Debug, Clone, Copy)]
struct SplitMeasurement {
    /// Whether the split sits at the end of the file, blank lines aside.
    end_of_file: bool,
    /// Indentation of the line just below the split, `-1` when that line is blank.
    indent: i32,
    /// Number of blank lines directly above the split.
    pre_blank: i32,
    /// Indentation of the nearest non-blank line above, `-1` when there is none.
    pre_indent: i32,
    /// Number of blank lines after the line just below the split.
    post_blank: i32,
    /// Indentation of the nearest non-blank line below that one, `-1` when there is none.
    post_indent: i32,
}

/// Badness of one candidate position: both of its splits contribute.
#[derive(Debug, Clone, Copy, Default)]
struct SplitScore {
    /// Sum of the effective indents of the two splits.
    effective_indent: i32,
    /// Sum of the penalties of the two splits.
    penalty: i32,
}

/// Measures the context around `split` on one side of the comparison.
///
/// `split` may point one past the last line, which is how a position at the end of the file is
/// represented. A negative position is clamped to the start: the only way to produce one is a run
/// that begins on the first line, and clamping keeps the index arithmetic total.
fn measure_split(texts: &[&str], split: isize) -> SplitMeasurement {
    let count = texts.len() as isize;
    let mut measurement = SplitMeasurement {
        end_of_file: split >= count,
        indent: -1,
        pre_blank: 0,
        pre_indent: -1,
        post_blank: 0,
        post_indent: -1,
    };
    if split < count {
        measurement.indent = line_indent(texts[split.max(0) as usize]);
    }

    let mut cursor = split - 1;
    while cursor >= 0 {
        measurement.pre_indent = line_indent(texts[cursor as usize]);
        if measurement.pre_indent != -1 {
            break;
        }
        measurement.pre_blank += 1;
        if measurement.pre_blank == MAX_BLANKS {
            measurement.pre_indent = 0;
            break;
        }
        cursor -= 1;
    }

    let mut cursor = split + 1;
    while cursor < count {
        measurement.post_indent = line_indent(texts[cursor as usize]);
        if measurement.post_indent != -1 {
            break;
        }
        measurement.post_blank += 1;
        if measurement.post_blank == MAX_BLANKS {
            measurement.post_indent = 0;
            break;
        }
        cursor += 1;
    }

    measurement
}

impl SplitScore {
    /// Folds one split's measurements into the running score of a candidate position.
    ///
    /// A position implies two splits — one above the run and one below it — so the caller adds each
    /// in turn. Rewards are negative and penalties positive: a split next to blank lines is
    /// favoured, which is what keeps a change from being printed flush against an unrelated block.
    fn add_split(&mut self, measurement: &SplitMeasurement) {
        if measurement.pre_indent == -1 && measurement.pre_blank == 0 {
            self.penalty += START_OF_FILE_PENALTY;
        }
        if measurement.end_of_file {
            self.penalty += END_OF_FILE_PENALTY;
        }

        let post_blank = if measurement.indent == -1 {
            1 + measurement.post_blank
        } else {
            0
        };
        let total_blank = measurement.pre_blank + post_blank;
        self.penalty += TOTAL_BLANK_WEIGHT * total_blank;
        self.penalty += POST_BLANK_WEIGHT * post_blank;

        let indent = if measurement.indent != -1 {
            measurement.indent
        } else {
            measurement.post_indent
        };
        let any_blanks = total_blank != 0;
        self.effective_indent += indent;

        if indent == -1 || measurement.pre_indent == -1 {
            return;
        }
        // The four cases are mutually exclusive, and each adds at most one penalty. Written as
        // guards rather than one `if`/`else if` chain because the equal-indent case contributes
        // nothing at all: it is an early exit, not an empty branch.
        if indent == measurement.pre_indent {
            return;
        }
        if indent > measurement.pre_indent {
            self.penalty += if any_blanks {
                RELATIVE_INDENT_WITH_BLANK_PENALTY
            } else {
                RELATIVE_INDENT_PENALTY
            };
            return;
        }
        if measurement.post_indent != -1 && measurement.post_indent > indent {
            self.penalty += if any_blanks {
                RELATIVE_OUTDENT_WITH_BLANK_PENALTY
            } else {
                RELATIVE_OUTDENT_PENALTY
            };
            return;
        }
        self.penalty += if any_blanks {
            RELATIVE_DEDENT_WITH_BLANK_PENALTY
        } else {
            RELATIVE_DEDENT_PENALTY
        };
    }

    /// Orders two candidate positions: negative means `self` is the better place to rest.
    fn compare(&self, other: &Self) -> i32 {
        let indent_order = (self.effective_indent > other.effective_indent) as i32
            - (self.effective_indent < other.effective_indent) as i32;
        INDENT_WEIGHT * indent_order + (self.penalty - other.penalty)
    }
}

/// Positions the first run, which may be empty when the file starts with an unchanged line.
fn first_group(changed: &[bool]) -> ChangeGroup {
    let mut end = 0usize;
    while end < changed.len() && changed[end] {
        end += 1;
    }
    ChangeGroup { start: 0, end }
}

/// Positions the run after `group`, or `None` when `group` already reaches the end.
fn next_group(changed: &[bool], group: ChangeGroup) -> Option<ChangeGroup> {
    if group.end >= changed.len() {
        return None;
    }
    let start = group.end + 1;
    let mut end = start;
    while end < changed.len() && changed[end] {
        end += 1;
    }
    Some(ChangeGroup { start, end })
}

/// Positions the run before `group`, or `None` when `group` already starts the file.
fn previous_group(changed: &[bool], group: ChangeGroup) -> Option<ChangeGroup> {
    if group.start == 0 {
        return None;
    }
    let end = group.start - 1;
    let mut start = end;
    while start > 0 && changed[start - 1] {
        start -= 1;
    }
    Some(ChangeGroup { start, end })
}

/// Moves `group` down one line when the line below it repeats its first line.
///
/// Sliding absorbs any run it bumps into: the result is still one contiguous block of changed
/// lines, and treating the two as separate would print a hunk boundary the file does not show.
fn slide_down<Id: Copy + PartialEq>(
    side: &Side<'_, Id>,
    changed: &mut [bool],
    group: &mut ChangeGroup,
) -> Option<()> {
    if group.is_empty() || group.end >= side.len() {
        return None;
    }
    if !side.matches(group.start, group.end) {
        return None;
    }
    changed[group.start] = false;
    changed[group.end] = true;
    group.start += 1;
    group.end += 1;
    while group.end < changed.len() && changed[group.end] {
        group.end += 1;
    }
    Some(())
}

/// Moves `group` up one line when the line above it repeats its last line.
fn slide_up<Id: Copy + PartialEq>(
    side: &Side<'_, Id>,
    changed: &mut [bool],
    group: &mut ChangeGroup,
) -> Option<()> {
    if group.is_empty() || group.start == 0 {
        return None;
    }
    if !side.matches(group.start - 1, group.end - 1) {
        return None;
    }
    group.start -= 1;
    changed[group.start] = true;
    group.end -= 1;
    changed[group.end] = false;
    while group.start > 0 && changed[group.start - 1] {
        group.start -= 1;
    }
    Some(())
}

/// Chooses where a run should rest, given that it currently sits as far down as it will go.
///
/// Returns the `end` index the run should move back to.
fn penalized_position(
    texts: &[&str],
    group: ChangeGroup,
    group_size: usize,
    earliest_end: isize,
) -> isize {
    let mut shift = earliest_end;
    let merged = group.end as isize - group_size as isize - 1;
    if merged > shift {
        shift = merged;
    }
    let reachable = group.end as isize - INDENT_HEURISTIC_MAX_SLIDING;
    if reachable > shift {
        shift = reachable;
    }

    let mut best_shift = -1isize;
    let mut best_score = SplitScore::default();
    while shift <= group.end as isize {
        let mut score = SplitScore::default();
        score.add_split(&measure_split(texts, shift));
        score.add_split(&measure_split(texts, shift - group_size as isize));
        // `<=` rather than `<` deliberately: the last candidate wins a tie, so a run that can rest
        // anywhere with equal badness settles as low as it can. Choosing the first would undo the
        // downward slide the caller has just performed.
        if best_shift == -1 || score.compare(&best_score) <= 0 {
            best_score = score;
            best_shift = shift;
        }
        shift += 1;
    }
    best_shift
}

/// Compacts the changed flags of one side against the other side's flags.
///
/// Returns `false` if the two sides' run sequences fall out of step, which indicates the flags no
/// longer describe a diff. The flags are left untouched in that case.
fn compact_side<Id: Copy + PartialEq>(
    side: &Side<'_, Id>,
    changed: &mut [bool],
    other: &[bool],
) -> bool {
    if changed.len() != side.len() {
        return false;
    }
    let mut group = first_group(changed);
    let mut other_group = first_group(other);

    loop {
        if !group.is_empty() {
            let mut group_size = group.len();
            let mut earliest_end;
            let mut matching_other;
            loop {
                matching_other = -1;
                while slide_up(side, changed, &mut group).is_some() {
                    match previous_group(other, other_group) {
                        Some(step) => other_group = step,
                        None => return false,
                    }
                }
                earliest_end = group.end as isize;
                if !other_group.is_empty() {
                    matching_other = group.end as isize;
                }
                loop {
                    if slide_down(side, changed, &mut group).is_none() {
                        break;
                    }
                    match next_group(other, other_group) {
                        Some(step) => other_group = step,
                        None => return false,
                    }
                    if !other_group.is_empty() {
                        matching_other = group.end as isize;
                    }
                }
                if group_size == group.len() {
                    break;
                }
                group_size = group.len();
            }

            if (group.end as isize) == earliest_end {
                // The run could not move at all, so there is no position to choose between.
            } else if matching_other != -1 {
                // A run on the other side can be met line for line; splitting a change into an
                // unrelated deletion and addition reads as two edits and hides that they pair up.
                while other_group.is_empty() {
                    if slide_up(side, changed, &mut group).is_none() {
                        return false;
                    }
                    match previous_group(other, other_group) {
                        Some(step) => other_group = step,
                        None => return false,
                    }
                }
            } else {
                let best = penalized_position(side.texts, group, group_size, earliest_end);
                while (group.end as isize) > best {
                    if slide_up(side, changed, &mut group).is_none() {
                        return false;
                    }
                    match previous_group(other, other_group) {
                        Some(step) => other_group = step,
                        None => return false,
                    }
                }
            }
        }

        match next_group(changed, group) {
            Some(step) => group = step,
            None => return true,
        }
        match next_group(other, other_group) {
            Some(step) => other_group = step,
            None => return false,
        }
    }
}

/// Compacts both sides of a comparison so a minimal edit script renders as Git renders it.
#[derive(Debug, Clone, Copy)]
pub struct Compaction<'a, Id = u32> {
    old: Side<'a, Id>,
    new: Side<'a, Id>,
}

impl<'a, Id: Copy + PartialEq> Compaction<'a, Id> {
    /// Builds a compaction over the two sides of one file comparison.
    pub fn new(old: Side<'a, Id>, new: Side<'a, Id>) -> Self {
        Self { old, new }
    }

    /// Compacts the two sides in place, old side first.
    ///
    /// Returns `false` when either direction had to abort; the flags remain a valid diff either
    /// way, so a caller that ignores the result still emits a patch that applies.
    pub fn run(&self, old_changed: &mut [bool], new_changed: &mut [bool]) -> bool {
        if !compact_side(&self.old, old_changed, new_changed) {
            return false;
        }
        compact_side(&self.new, new_changed, old_changed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Content-addressed stand-in for the diff's line hashing: identical text must collide, and
    /// different text must not, which is all compaction observes.
    fn hash_of(line: &str) -> u64 {
        let mut hash = 0xcbf2_9ce4_8422_2325u64;
        for byte in line.bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash
    }

    fn compact_alone(lines: &[&str], changed: &[usize]) -> Vec<bool> {
        let hashes: Vec<u64> = lines.iter().map(|line| hash_of(line)).collect();
        let side = Side {
            hashes: &hashes,
            texts: lines,
        };
        let mut flags = vec![false; lines.len()];
        for index in changed {
            flags[*index] = true;
        }
        let other = vec![false; lines.len()];
        compact_side(&side, &mut flags, &other);
        flags
    }

    fn flag_positions(flags: &[bool]) -> Vec<usize> {
        flags
            .iter()
            .enumerate()
            .filter(|(_, flagged)| **flagged)
            .map(|(index, _)| index)
            .collect()
    }

    #[test]
    fn indent_measurement_matches_tabs_and_blanks() {
        assert_eq!(line_indent(""), -1);
        assert_eq!(line_indent("    x"), 4);
        assert_eq!(line_indent("\tx"), 8);
        assert_eq!(line_indent("  \tx"), 8);
        assert_eq!(line_indent("\t\tx"), 16);
        assert_eq!(line_indent("   "), -1);
    }

    #[test]
    fn a_run_needs_identical_lines_to_slide() {
        // The flagged line can only move onto a neighbour that repeats it, so a distinct neighbour
        // pins it in place.
        let lines = ["X", "Y", "X", "Z"];
        assert_eq!(flag_positions(&compact_alone(&lines, &[0])), vec![0]);
    }

    #[test]
    fn a_repeated_line_slides_to_the_lowest_position() {
        // `X` sits at 0 and 2, so a change marked on the first `X` is free to move down to the
        // second. Without sliding, a one-line edit inside a repeated run would print at an
        // arbitrary one of the run's positions.
        let lines = ["X", "Y", "X", "Z"];
        assert_eq!(flag_positions(&compact_alone(&lines, &[2])), vec![2]);
    }

    #[test]
    fn a_run_with_the_wrong_flag_count_is_rejected() {
        let lines = ["a", "b"];
        let hashes: Vec<u64> = lines.iter().map(|line| hash_of(line)).collect();
        let side = Side {
            hashes: &hashes,
            texts: &lines,
        };
        let mut flags = vec![true; 3];
        let other = vec![false; 2];
        assert!(!compact_side(&side, &mut flags, &other));
    }

    #[test]
    fn a_position_with_no_sliding_room_is_left_alone() {
        let lines = [
            "fn a() {",
            "    one();",
            "}",
            "",
            "fn b() {",
            "    two();",
            "}",
        ];
        assert_eq!(flag_positions(&compact_alone(&lines, &[5])), vec![5]);
    }

    #[test]
    fn both_sides_compact_through_the_facade() {
        let old_lines = ["a", "X", "b"];
        let new_lines = ["a", "b"];
        let old_hashes: Vec<u64> = old_lines.iter().map(|line| hash_of(line)).collect();
        let new_hashes: Vec<u64> = new_lines.iter().map(|line| hash_of(line)).collect();
        let compaction = Compaction::new(
            Side {
                hashes: &old_hashes,
                texts: &old_lines,
            },
            Side {
                hashes: &new_hashes,
                texts: &new_lines,
            },
        );
        let mut old_changed = vec![false, true, false];
        let mut new_changed = vec![false, false];
        assert!(compaction.run(&mut old_changed, &mut new_changed));
        assert_eq!(flag_positions(&old_changed), vec![1]);
        assert!(flag_positions(&new_changed).is_empty());
    }
}
