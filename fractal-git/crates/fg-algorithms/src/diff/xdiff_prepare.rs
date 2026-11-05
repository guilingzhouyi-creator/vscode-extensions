//! Module: fg-algorithms::diff::xdiff_prepare — Record Classification and Discarding
//! File Path: crates/fg-algorithms/src/diff/xdiff_prepare.rs
//! Architecture Role: The stage that runs before the edit-graph search. It assigns each line an
//!   identity shared across both files, trims the matching ends, and pre-marks lines it can prove
//!   are changed without searching at all.
//! Dependencies & Triggers: Called by `xdl::diff` with both sides' raw records.
//! Responsibilities: Classify records into equivalence classes, drop repeated lines that would only
//!   slow the search down, and record the resulting changed flags and reference index.
//! Exit Semantics & Design Rationale:
//!   - The discarding is not an optimisation in the usual sense: it deliberately gives up
//!     minimality. A line that appears many times on both sides has no trustworthy counterpart, so
//!     matching one instance ties the diff to an arbitrary choice. Git marks such lines changed and
//!     searches only around them, and reproducing that choice is the only way to get its output.
//!   - Records are compared as raw bytes including the terminator. Hashing the text alone would
//!     call `"a"` and `"a\n"` the same line, which is the difference a missing final newline is.
//!   - The thresholds are integer square roots of the record count, not constants, because "many
//!     times" has to mean "many relative to this file". A fixed threshold either discards half a
//!     small file or nothing at all in a large one.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// High-throughput non-cryptographic byte hasher (FxHash) for line equivalence class grouping.
#[derive(Default, Clone, Copy)]
pub struct FastByteHasher(u64);

impl Hasher for FastByteHasher {
    #[inline(always)]
    fn finish(&self) -> u64 {
        self.0
    }

    #[inline(always)]
    fn write(&mut self, bytes: &[u8]) {
        const K: u64 = 0x517cc1b727220a95;
        let mut hash = self.0;
        let mut chunks = bytes.chunks_exact(8);
        for chunk in &mut chunks {
            let mut word = [0u8; 8];
            word.copy_from_slice(chunk);
            let val = u64::from_le_bytes(word);
            hash = (hash.rotate_left(5) ^ val).wrapping_mul(K);
        }
        let remainder = chunks.remainder();
        if !remainder.is_empty() {
            let mut last = 0u64;
            for (i, &b) in remainder.iter().enumerate() {
                last |= (b as u64) << (i * 8);
            }
            hash = (hash.rotate_left(5) ^ last).wrapping_mul(K);
        }
        self.0 = hash;
    }
}

/// Equivalence class of one record, shared between both sides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LineClass {
    /// How often the line occurs on the old side.
    old_occurrences: usize,
    /// How often it occurs on the new side.
    new_occurrences: usize,
}

/// What should happen to one line before the search starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    /// The line has no counterpart at all, so it is certainly changed.
    Discard,
    /// The line has a plausible counterpart, so the search decides.
    Keep,
    /// The line repeats often enough that a match would be arbitrary; examine its neighbourhood.
    Investigate,
}

/// Window, in lines, examined around a repeated line when deciding whether to discard it.
const SIMILARITY_SCAN_WINDOW: isize = 100;

/// Ceiling on the occurrence count that still counts as "plausibly pairable".
const MAX_EQUALITY_LIMIT: usize = 1024;

/// Numerator/denominator balance for discarding a repeated line.
///
/// A repeated line is dropped only when it sits inside a run that is mostly unmatched lines: the
/// factor keeps a pair of adjacent repeats — which usually do pair up — from being discarded.
const REPEATED_LINE_DISCRIMINATOR: usize = 4;

/// One side of a comparison, prepared for the search.
#[derive(Debug, Clone, Default)]
pub struct PreparedSide {
    /// Equivalence class per record, in file order.
    pub classes: Vec<u32>,
    /// Changed flag per record, as the search receives it.
    pub changed: Vec<bool>,
    /// Indices of records the search is allowed to match, in file order.
    pub reference: Vec<u32>,
    /// First record the search may consider.
    pub start: usize,
    /// One past the last record the search may consider.
    pub end: usize,
}

impl PreparedSide {
    /// Number of records the search may consider.
    pub fn reference_len(&self) -> usize {
        self.reference.len()
    }
}

/// Integer square root by shift, matching Git's `xdl_bogosqrt`.
///
/// The approximation is one power of two above the true square root, which is what Git uses to size
/// its search heuristics. Substituting an exact root would change how many lines get discarded and
/// therefore change the output.
pub fn bogo_sqrt(value: usize) -> usize {
    let mut result = 1usize;
    let mut remaining = value;
    while remaining > 0 {
        result <<= 1;
        remaining >>= 2;
    }
    result
}

/// Trims the matching head and tail of the two files.
///
/// Returns the first and last record index still worth searching, as `(start, end)` per side. This
/// is Git's `xdl_trim_ends`, and the trimming happens before discarding so the discarding never has
/// to reason about the long unchanged runs at either end.
fn trim_ends(
    old_len: usize,
    new_len: usize,
    same: impl Fn(usize, usize) -> bool,
) -> (usize, usize) {
    let limit = old_len.min(new_len);
    let mut head = 0usize;
    while head < limit && same(head, head) {
        head += 1;
    }
    let mut tail = 0usize;
    while tail < limit - head && same(old_len - 1 - tail, new_len - 1 - tail) {
        tail += 1;
    }
    (head, tail)
}

/// Counts how many lines around `position` are unmatched and how many merely repeat.
///
/// Returns `(discarded, repeated)` for the run above and below combined, capped at
/// [`SIMILARITY_SCAN_WINDOW`] in each direction. The cap exists because a file of repeated lines
/// would otherwise make this scan quadratic.
fn scan_neighbourhood(actions: &[Action], position: usize) -> Option<(usize, usize)> {
    let length = actions.len() as isize;
    let mut discarded_before = 0usize;
    // Git seeds the repeat count with one per side, counting the line under examination twice.
    let mut repeated = 2usize;

    let mut cursor = position as isize - 1;
    let floor = (position as isize - SIMILARITY_SCAN_WINDOW).max(0);
    while cursor >= floor {
        match actions[cursor as usize] {
            Action::Discard => discarded_before += 1,
            Action::Investigate => repeated += 1,
            Action::Keep => break,
        }
        cursor -= 1;
    }
    // Each side must contribute at least one unmatched line on its own; a run that is unmatched
    // on one side only is a boundary, not the middle of a discardable stretch.
    if discarded_before == 0 {
        return None;
    }

    let mut discarded_after = 0usize;
    let mut cursor = position as isize + 1;
    let ceiling = (position as isize + SIMILARITY_SCAN_WINDOW).min(length - 1);
    while cursor <= ceiling {
        match actions[cursor as usize] {
            Action::Discard => discarded_after += 1,
            Action::Investigate => repeated += 1,
            Action::Keep => break,
        }
        cursor += 1;
    }
    if discarded_after == 0 {
        return None;
    }

    Some((discarded_before + discarded_after, repeated))
}

/// Decides whether a repeated line should be discarded.
///
/// A repeated line is only dropped when unmatched lines surround it on both sides: on its own it is
/// more likely to be a legitimate counterpart, and discarding it would split a real change in two.
fn should_discard(actions: &[Action], position: usize) -> bool {
    let Some((discarded, repeated)) = scan_neighbourhood(actions, position) else {
        return false;
    };
    repeated * REPEATED_LINE_DISCRIMINATOR < repeated + discarded
}

/// Assigns every record an equivalence class and marks the lines the search need not consider.
///
/// The two sides share one class table so a class id means the same line on both sides, which is
/// what lets the search compare integers.
pub fn prepare(old_records: &[&[u8]], new_records: &[&[u8]]) -> (PreparedSide, PreparedSide) {
    let cap = old_records.len() + new_records.len();
    let mut classes: HashMap<&[u8], u32, BuildHasherDefault<FastByteHasher>> =
        HashMap::with_capacity_and_hasher(cap, BuildHasherDefault::default());
    let mut table: Vec<LineClass> = Vec::with_capacity(cap);

    let mut old_classes = Vec::with_capacity(old_records.len());
    let mut new_classes = Vec::with_capacity(new_records.len());
    for record in old_records {
        let id = *classes.entry(record).or_insert_with(|| {
            table.push(LineClass {
                old_occurrences: 0,
                new_occurrences: 0,
            });
            (table.len() - 1) as u32
        });
        table[id as usize].old_occurrences += 1;
        old_classes.push(id);
    }
    for record in new_records {
        let id = *classes.entry(record).or_insert_with(|| {
            table.push(LineClass {
                old_occurrences: 0,
                new_occurrences: 0,
            });
            (table.len() - 1) as u32
        });
        table[id as usize].new_occurrences += 1;
        new_classes.push(id);
    }

    let (head, tail) = trim_ends(old_records.len(), new_records.len(), |old, new| {
        old_classes[old] == new_classes[new]
    });

    let old = mark_side(&old_classes, &table, head, tail, true);
    let new = mark_side(&new_classes, &table, head, tail, false);
    (old, new)
}

/// Marks one side's records, discarding everything the search cannot usefully match.
fn mark_side(
    classes: &[u32],
    table: &[LineClass],
    head: usize,
    tail: usize,
    old_side: bool,
) -> PreparedSide {
    let mut changed = vec![false; classes.len()];
    let mut actions = Vec::with_capacity(classes.len().saturating_sub(head + tail));
    let limit = bogo_sqrt(classes.len()).min(MAX_EQUALITY_LIMIT);

    for class_id in &classes[head..classes.len() - tail] {
        let entry = table[*class_id as usize];
        let counterpart = if old_side {
            entry.new_occurrences
        } else {
            entry.old_occurrences
        };
        actions.push(if counterpart == 0 {
            Action::Discard
        } else if counterpart < limit {
            Action::Keep
        } else {
            Action::Investigate
        });
    }

    let mut reference = Vec::with_capacity(actions.len());
    for (index, action) in actions.iter().enumerate() {
        let settled = match *action {
            Action::Investigate if should_discard(&actions, index) => Action::Discard,
            Action::Investigate => Action::Keep,
            other => other,
        };
        match settled {
            Action::Keep => reference.push((index + head) as u32),
            Action::Discard => changed[index + head] = true,
            Action::Investigate => changed[index + head] = true,
        }
    }

    PreparedSide {
        classes: classes.to_vec(),
        changed,
        reference,
        start: head,
        end: classes.len() - tail,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn records<'a>(lines: &'a [&'a str]) -> Vec<&'a [u8]> {
        lines.iter().map(|line| line.as_bytes()).collect()
    }

    #[test]
    fn the_shift_square_root_doubles_per_two_bits() {
        assert_eq!(bogo_sqrt(0), 1);
        assert_eq!(bogo_sqrt(1), 2);
        assert_eq!(bogo_sqrt(4), 4);
        assert_eq!(bogo_sqrt(16), 8);
        assert_eq!(bogo_sqrt(15), 4);
    }

    #[test]
    fn lines_absent_from_the_other_side_are_discarded() {
        let old = records(&["a\n", "gone\n", "b\n"]);
        let new = records(&["a\n", "b\n"]);
        let (prepared_old, prepared_new) = prepare(&old, &new);
        assert!(prepared_old.changed[1], "the vanished line is marked");
        assert!(!prepared_old.changed[0]);
        assert!(prepared_new.changed.iter().all(|flag| !*flag));
    }

    #[test]
    fn a_terminal_newline_is_part_of_a_lines_identity() {
        let old = records(&["a\n", "b"]);
        let new = records(&["a\n", "b\n"]);
        let (prepared_old, _) = prepare(&old, &new);
        assert!(
            prepared_old.changed[1],
            "`b` without a terminator is not `b` with one"
        );
    }

    #[test]
    fn matching_ends_shrink_the_searched_region() {
        let old = records(&["a\n", "b\n", "c\n"]);
        let new = records(&["a\n", "b\n", "z\n"]);
        let (prepared_old, _) = prepare(&old, &new);
        // The two leading lines match, so the searched region starts at the third; `end` is
        // exclusive, which is why it stays at the record count.
        assert_eq!(prepared_old.start, 2);
        assert_eq!(prepared_old.end, 3);
    }
}
