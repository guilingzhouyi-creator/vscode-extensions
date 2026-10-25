//! Module: fg-algorithms::diff::xdiff — Bidirectional Edit-Graph Search
//! File Path: crates/fg-algorithms/src/diff/xdiff.rs
//! Architecture Role: The alignment engine. It decides which lines of each side changed; compaction
//!   then decides where those changes rest, and the renderer prints them.
//! Dependencies & Triggers: Called by `PatchGenerator` once both sides' records are prepared.
//! Responsibilities: Walk the forward and backward frontiers towards each other, split the edit box
//!   where they meet, and mark every line no matching run covers.
//! Exit Semantics & Design Rationale:
//!   - Both frontiers advance at once. A single-ended search always prefers one direction when two
//!     alignments are equally short, so it picks the same one every time; Git's frontiers meet
//!     wherever they happen to overlap, which selects a different — equally minimal — alignment.
//!     That choice is visible in the output even when the edit count is identical, and it was the
//!     measured cause of eleven of thirty sampled commits differing once the layout pass was added.
//!   - The frontier arrays are one allocation reused by every split, indexed from a base offset.
//!     Entries outside the current diagonal range therefore hold values from an earlier, wider
//!     range. The algorithm depends on that not mattering: every read is guarded by a range test,
//!     and the borders are seeded with `-1` forward and `isize::MAX` backward so the two inner
//!     loops need no special case for the first step.
//!   - The cost limit is derived from the diagonal count rather than from elapsed work. Git sizes it
//!     with an integer square root so a large input gets a proportionally larger search before the
//!     heuristics cut in; a fixed limit would either truncate small inputs or hang on large ones.
//!   - Boxes are processed from an explicit stack rather than by recursion. No line belongs to two
//!     boxes, so visiting order cannot change the result, and an input that splits badly would
//!     otherwise overflow the stack on data an attacker controls.
//!
//! Domain Governance Rules: FGT-ALG-001 (bidirectional Myers/xdiff alignment), FGT-COR-001, FGT-PRF-001.

use crate::diff::xdiff_prepare::{bogo_sqrt, PreparedSide};

/// Minimum diagonal-derived cost before the fallbacks take over.
const MAX_COST_MIN: usize = 256;

/// Cost above which the sampling heuristic may cut the search short.
const HEURISTIC_MIN_COST: isize = 256;

/// Run length, in lines, that counts as an "interesting" path while sampling.
const SNAKE_COUNT: isize = 20;

/// Multiplier turning edit cost into the reach a path needs before it is interesting.
const HEURISTIC_FACTOR: isize = 4;

/// Sentinel written at a forward frontier border: one line before the first possible position.
const FORWARD_SEED: isize = -1;

/// Sentinel written at a backward frontier border: one line past the last possible position.
const BACKWARD_SEED: isize = isize::MAX;

/// One edit box, in reference-index space.
#[derive(Debug, Clone, Copy)]
struct EditBox {
    /// First old-side reference index still under consideration.
    off_old: isize,
    /// One past the last old-side reference index.
    lim_old: isize,
    /// First new-side reference index still under consideration.
    off_new: isize,
    /// One past the last new-side reference index.
    lim_new: isize,
    /// Whether the result must be provably shortest rather than merely good.
    needs_minimal: bool,
}

/// Where an edit box was split.
#[derive(Debug, Clone, Copy)]
struct Split {
    /// Old-side position of the meeting point.
    old_at: isize,
    /// New-side position of the meeting point.
    new_at: isize,
    /// Whether the low half must still be solved minimally.
    minimal_low: bool,
    /// Whether the high half must still be solved minimally.
    minimal_high: bool,
}

/// Range of diagonals a frontier currently covers, as `(lowest, highest)`.
type Range = (isize, isize);

/// The search state: line identity per reference index, one shared frontier buffer, and the cost at
/// which the fallback takes over.
struct Engine {
    old_hashes: Vec<u32>,
    new_hashes: Vec<u32>,
    /// Forward frontier followed by backward frontier, both centred on their base offsets.
    frontiers: Vec<isize>,
    base_forward: isize,
    base_backward: isize,
    cost_limit: isize,
}

impl Engine {
    /// Builds an engine for a prepared pair of sides.
    fn new(old: &PreparedSide, new: &PreparedSide) -> Self {
        let old_hashes: Vec<u32> = old
            .reference
            .iter()
            .map(|index| old.classes[*index as usize])
            .collect();
        let new_hashes: Vec<u32> = new
            .reference
            .iter()
            .map(|index| new.classes[*index as usize])
            .collect();
        let diagonal_count = old_hashes.len() + new_hashes.len() + 3;
        // One spare entry beyond each frontier's widest range holds the seeded border.
        let base_forward = new_hashes.len() as isize + 1;
        let base_backward = base_forward + diagonal_count as isize;
        Self {
            frontiers: vec![0; 2 * diagonal_count + 2],
            old_hashes,
            new_hashes,
            base_forward,
            base_backward,
            cost_limit: bogo_sqrt(diagonal_count).max(MAX_COST_MIN) as isize,
        }
    }

    /// Reads a forward-frontier entry.
    fn forward(&self, diagonal: isize) -> isize {
        self.frontiers[(self.base_forward + diagonal) as usize]
    }

    /// Writes a forward-frontier entry.
    fn set_forward(&mut self, diagonal: isize, value: isize) {
        self.frontiers[(self.base_forward + diagonal) as usize] = value;
    }

    /// Reads a backward-frontier entry.
    fn backward(&self, diagonal: isize) -> isize {
        self.frontiers[(self.base_backward + diagonal) as usize]
    }

    /// Writes a backward-frontier entry.
    fn set_backward(&mut self, diagonal: isize, value: isize) {
        self.frontiers[(self.base_backward + diagonal) as usize] = value;
    }

    /// Reads one side's line identity at a reference index; out-of-range reads report "no line".
    fn hash_old(&self, index: isize) -> Option<u32> {
        if index < 0 {
            return None;
        }
        self.old_hashes.get(index as usize).copied()
    }

    /// Reads the other side's line identity at a reference index.
    fn hash_new(&self, index: isize) -> Option<u32> {
        if index < 0 {
            return None;
        }
        self.new_hashes.get(index as usize).copied()
    }

    /// Reports whether the two sides hold the same line at these reference indices.
    fn same(&self, old_index: isize, new_index: isize) -> bool {
        match (self.hash_old(old_index), self.hash_new(new_index)) {
            (Some(first), Some(second)) => first == second,
            _ => false,
        }
    }

    /// Same test, additionally requiring both indices to stay inside the box.
    ///
    /// The box limits are what stop a matching run from extending past the region being solved.
    /// Without them the run walks into the unchanged head or tail that the caller already matched
    /// away, which places the split outside the box.
    fn same_within(
        &self,
        old_index: isize,
        new_index: isize,
        lim_old: isize,
        lim_new: isize,
    ) -> bool {
        old_index < lim_old && new_index < lim_new && self.same(old_index, new_index)
    }

    /// Extends one frontier by one diagonal on each side of its middle, seeding the new borders.
    ///
    /// A range that cannot grow in one direction shrinks in the other, because it must stay symmetric
    /// about its middle. The dropped diagonals lie outside the box and never contribute, which is why
    /// shrinking instead of stopping is safe.
    fn grow(buffer: &mut [isize], base: isize, bounds: Range, range: &mut Range, seed: isize) {
        let (lowest, highest) = bounds;
        if range.0 > lowest {
            range.0 -= 1;
            buffer[(base + range.0 - 1) as usize] = seed;
        } else {
            range.0 += 1;
        }
        if range.1 < highest {
            range.1 += 1;
            buffer[(base + range.1 + 1) as usize] = seed;
        } else {
            range.1 -= 1;
        }
    }

    /// Advances the forward frontier one cost step, reporting a meeting point when it crosses back.
    ///
    /// The overlap is tested against the backward range as it stands now, not as it stood when this
    /// box began: the two frontiers grow in separate steps and the crossing has to be noticed on
    /// whichever step reaches it.
    fn step_forward(
        &mut self,
        box_: EditBox,
        range: Range,
        backward_range: Range,
        meets: bool,
    ) -> Option<Split> {
        let mut diagonal = range.1;
        while diagonal >= range.0 {
            let lower = self.forward(diagonal - 1);
            let upper = self.forward(diagonal + 1);
            // Equality goes to the lower diagonal, which advances the old side. Taking the other
            // branch on a tie selects a different — equally short — alignment.
            let mut old_index = if lower >= upper { lower + 1 } else { upper };
            let mut new_index = old_index - diagonal;
            while self.same_within(old_index, new_index, box_.lim_old, box_.lim_new) {
                old_index += 1;
                new_index += 1;
            }
            self.set_forward(diagonal, old_index);
            let overlaps = diagonal >= backward_range.0 && diagonal <= backward_range.1;
            if meets && overlaps && self.backward(diagonal) <= old_index {
                return Some(Split {
                    old_at: old_index,
                    new_at: new_index,
                    minimal_low: true,
                    minimal_high: true,
                });
            }
            diagonal -= 2;
        }
        None
    }

    /// Advances the backward frontier one cost step, reporting a meeting point on a crossing.
    fn step_backward(
        &mut self,
        box_: EditBox,
        range: Range,
        forward_range: Range,
        meets: bool,
    ) -> Option<Split> {
        let mut diagonal = range.1;
        while diagonal >= range.0 {
            let lower = self.backward(diagonal - 1);
            let upper = self.backward(diagonal + 1);
            let mut old_index = if lower < upper { lower } else { upper - 1 };
            let mut new_index = old_index - diagonal;
            while old_index > box_.off_old
                && new_index > box_.off_new
                && self.same(old_index - 1, new_index - 1)
            {
                old_index -= 1;
                new_index -= 1;
            }
            self.set_backward(diagonal, old_index);
            let overlaps = diagonal >= forward_range.0 && diagonal <= forward_range.1;
            if meets && overlaps && old_index <= self.forward(diagonal) {
                return Some(Split {
                    old_at: old_index,
                    new_at: new_index,
                    minimal_low: true,
                    minimal_high: true,
                });
            }
            diagonal -= 2;
        }
        None
    }

    /// Searches inside one box and splits it where the two frontiers meet.
    fn split_box(&mut self, box_: EditBox) -> Split {
        let bounds = (box_.off_old - box_.lim_new, box_.lim_old - box_.off_new);
        let forward_middle = box_.off_old - box_.off_new;
        let backward_middle = box_.lim_old - box_.lim_new;
        let odd = (forward_middle - backward_middle) & 1 != 0;

        let mut forward_range = (forward_middle, forward_middle);
        let mut backward_range = (backward_middle, backward_middle);
        self.set_forward(forward_middle, box_.off_old);
        self.set_backward(backward_middle, box_.lim_old);

        let (base_forward, base_backward) = (self.base_forward, self.base_backward);
        let mut cost = 1isize;
        loop {
            Self::grow(
                &mut self.frontiers,
                base_forward,
                bounds,
                &mut forward_range,
                FORWARD_SEED,
            );
            if let Some(split) = self.step_forward(box_, forward_range, backward_range, odd) {
                return split;
            }

            Self::grow(
                &mut self.frontiers,
                base_backward,
                bounds,
                &mut backward_range,
                BACKWARD_SEED,
            );
            if let Some(split) = self.step_backward(box_, backward_range, forward_range, !odd) {
                return split;
            }

            if box_.needs_minimal {
                cost += 1;
                continue;
            }

            if cost > HEURISTIC_MIN_COST {
                if let Some(split) = self.sampled_split(box_, (forward_range, backward_range), cost)
                {
                    return split;
                }
            }

            if cost >= self.cost_limit {
                return self.furthest_reach(box_, (forward_range, backward_range));
            }
            cost += 1;
        }
    }

    /// Samples the frontiers for a path that has advanced far enough to be worth cutting at.
    ///
    /// Returns `None` when nothing looks promising, in which case the exact search continues.
    fn sampled_split(&self, box_: EditBox, ranges: (Range, Range), cost: isize) -> Option<Split> {
        let mut best = 0isize;
        let mut chosen = None;

        let mut diagonal = ranges.0 .1;
        while diagonal >= ranges.0 .0 {
            let distance = (diagonal - (box_.off_old - box_.off_new)).abs();
            let old_index = self.forward(diagonal);
            let new_index = old_index - diagonal;
            let reach = (old_index - box_.off_old) + (new_index - box_.off_new) - distance;
            if reach > HEURISTIC_FACTOR * cost
                && reach > best
                && box_.off_old + SNAKE_COUNT <= old_index
                && old_index < box_.lim_old
                && box_.off_new + SNAKE_COUNT <= new_index
                && new_index < box_.lim_new
                && self.snake_before(old_index, new_index)
            {
                best = reach;
                chosen = Some(Split {
                    old_at: old_index,
                    new_at: new_index,
                    minimal_low: true,
                    minimal_high: false,
                });
            }
            diagonal -= 2;
        }
        if best > 0 {
            return chosen;
        }

        let mut diagonal = ranges.1 .1;
        while diagonal >= ranges.1 .0 {
            let distance = (diagonal - (box_.lim_old - box_.lim_new)).abs();
            let old_index = self.backward(diagonal);
            let new_index = old_index - diagonal;
            let reach = (box_.lim_old - old_index) + (box_.lim_new - new_index) - distance;
            if reach > HEURISTIC_FACTOR * cost
                && reach > best
                && box_.off_old < old_index
                && old_index <= box_.lim_old - SNAKE_COUNT
                && box_.off_new < new_index
                && new_index <= box_.lim_new - SNAKE_COUNT
                && self.snake_after(old_index, new_index)
            {
                best = reach;
                chosen = Some(Split {
                    old_at: old_index,
                    new_at: new_index,
                    minimal_low: false,
                    minimal_high: true,
                });
            }
            diagonal -= 2;
        }
        if best > 0 {
            chosen
        } else {
            None
        }
    }

    /// Reports whether a run of at least [`SNAKE_COUNT`] matching lines ends just before a position.
    fn snake_before(&self, old_index: isize, new_index: isize) -> bool {
        let mut step = 1isize;
        while self.same(old_index - step, new_index - step) {
            if step == SNAKE_COUNT {
                return true;
            }
            step += 1;
        }
        false
    }

    /// Reports whether a run of at least [`SNAKE_COUNT`] matching lines starts at a position.
    fn snake_after(&self, old_index: isize, new_index: isize) -> bool {
        let mut step = 0isize;
        while self.same(old_index + step, new_index + step) {
            if step == SNAKE_COUNT - 1 {
                return true;
            }
            step += 1;
        }
        false
    }

    /// Picks the furthest-reaching split once the exact search has run past its budget.
    fn furthest_reach(&self, box_: EditBox, ranges: (Range, Range)) -> Split {
        let mut best_forward = -1isize;
        let mut best_forward_old = -1isize;
        let mut diagonal = ranges.0 .1;
        while diagonal >= ranges.0 .0 {
            let mut old_index = self.forward(diagonal).min(box_.lim_old);
            let mut new_index = old_index - diagonal;
            if box_.lim_new < new_index {
                old_index = box_.lim_new + diagonal;
                new_index = box_.lim_new;
            }
            if best_forward < old_index + new_index {
                best_forward = old_index + new_index;
                best_forward_old = old_index;
            }
            diagonal -= 2;
        }

        let mut best_backward = isize::MAX;
        let mut best_backward_old = isize::MAX;
        let mut diagonal = ranges.1 .1;
        while diagonal >= ranges.1 .0 {
            let mut old_index = box_.off_old.max(self.backward(diagonal));
            let mut new_index = old_index - diagonal;
            if new_index < box_.off_new {
                old_index = box_.off_new + diagonal;
                new_index = box_.off_new;
            }
            if old_index + new_index < best_backward {
                best_backward = old_index + new_index;
                best_backward_old = old_index;
            }
            diagonal -= 2;
        }

        if (box_.lim_old + box_.lim_new) - best_backward
            < best_forward - (box_.off_old + box_.off_new)
        {
            Split {
                old_at: best_forward_old,
                new_at: best_forward - best_forward_old,
                minimal_low: true,
                minimal_high: false,
            }
        } else {
            Split {
                old_at: best_backward_old,
                new_at: best_backward - best_backward_old,
                minimal_low: false,
                minimal_high: true,
            }
        }
    }
}

/// Marks the lines of one box that no matching run covers.
///
/// The head and tail of the box are matched away first. That is not a shortcut: it is what keeps the
/// search from descending into regions already known to align, and it is why the frontier walk only
/// ever sees the interior of a box.
fn compare_box(
    engine: &mut Engine,
    box_: EditBox,
    old_changed: &mut [bool],
    new_changed: &mut [bool],
    pending: &mut Vec<EditBox>,
) {
    let mut off_old = box_.off_old;
    let mut lim_old = box_.lim_old;
    let mut off_new = box_.off_new;
    let mut lim_new = box_.lim_new;

    while off_old < lim_old && off_new < lim_new && engine.same(off_old, off_new) {
        off_old += 1;
        off_new += 1;
    }
    while off_old < lim_old && off_new < lim_new && engine.same(lim_old - 1, lim_new - 1) {
        lim_old -= 1;
        lim_new -= 1;
    }

    if off_old == lim_old {
        for index in off_new..lim_new {
            new_changed[index as usize] = true;
        }
        return;
    }
    if off_new == lim_new {
        for index in off_old..lim_old {
            old_changed[index as usize] = true;
        }
        return;
    }

    let split = engine.split_box(EditBox {
        off_old,
        lim_old,
        off_new,
        lim_new,
        needs_minimal: box_.needs_minimal,
    });

    // A split at either boundary would hand back a box identical to this one and loop forever. It
    // can only happen if a heuristic reports a position outside the interior, so the whole box is
    // marked changed instead: that is what an unsplittable region means, and it is always a valid
    // answer even though it is not the shortest one.
    if (split.old_at, split.new_at) == (off_old, off_new)
        || (split.old_at, split.new_at) == (lim_old, lim_new)
    {
        for index in off_old..lim_old {
            old_changed[index as usize] = true;
        }
        for index in off_new..lim_new {
            new_changed[index as usize] = true;
        }
        return;
    }
    // Pushed high half first so the low half is processed next, which is the order a recursive
    // formulation would use and therefore the order the split flags were computed for.
    pending.push(EditBox {
        off_old: split.old_at,
        lim_old,
        off_new: split.new_at,
        lim_new,
        needs_minimal: split.minimal_high,
    });
    pending.push(EditBox {
        off_old,
        lim_old: split.old_at,
        off_new,
        lim_new: split.new_at,
        needs_minimal: split.minimal_low,
    });
}

/// Marks the changed lines of both sides, in record space.
///
/// The result carries one flag per record of each side, so the caller can lay the two sides out
/// together. Records the preparation discarded are changed by definition and stay marked.
pub fn mark_changed(old: &PreparedSide, new: &PreparedSide) -> (Vec<bool>, Vec<bool>) {
    let mut engine = Engine::new(old, new);
    let mut old_reference = vec![false; engine.old_hashes.len()];
    let mut new_reference = vec![false; engine.new_hashes.len()];

    let mut pending = vec![EditBox {
        off_old: 0,
        lim_old: engine.old_hashes.len() as isize,
        off_new: 0,
        lim_new: engine.new_hashes.len() as isize,
        needs_minimal: false,
    }];
    while let Some(next) = pending.pop() {
        compare_box(
            &mut engine,
            next,
            &mut old_reference,
            &mut new_reference,
            &mut pending,
        );
    }

    let mut old_flags = old.changed.clone();
    let mut new_flags = new.changed.clone();
    for (position, index) in old.reference.iter().enumerate() {
        if old_reference[position] {
            old_flags[*index as usize] = true;
        }
    }
    for (position, index) in new.reference.iter().enumerate() {
        if new_reference[position] {
            new_flags[*index as usize] = true;
        }
    }
    (old_flags, new_flags)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::xdiff_prepare::prepare;

    fn records<'a>(lines: &'a [&'a str]) -> Vec<&'a [u8]> {
        lines.iter().map(|line| line.as_bytes()).collect()
    }

    fn flags_for(old: &[&str], new: &[&str]) -> (Vec<bool>, Vec<bool>) {
        let old_records = records(old);
        let new_records = records(new);
        let (prepared_old, prepared_new) = prepare(&old_records, &new_records);
        mark_changed(&prepared_old, &prepared_new)
    }

    fn marked(flags: &[bool]) -> Vec<usize> {
        flags
            .iter()
            .enumerate()
            .filter(|(_, flag)| **flag)
            .map(|(index, _)| index)
            .collect()
    }

    #[test]
    fn identical_sides_mark_nothing() {
        let (old, new) = flags_for(&["a\n", "b\n"], &["a\n", "b\n"]);
        assert!(marked(&old).is_empty());
        assert!(marked(&new).is_empty());
    }

    #[test]
    fn an_appended_line_is_the_only_change() {
        let (old, new) = flags_for(&["a\n", "b\n"], &["a\n", "b\n", "c\n"]);
        assert!(marked(&old).is_empty());
        assert_eq!(marked(&new), vec![2]);
    }

    #[test]
    fn a_removed_line_is_the_only_change() {
        let (old, new) = flags_for(&["a\n", "b\n", "c\n"], &["a\n", "c\n"]);
        assert_eq!(marked(&old), vec![1]);
        assert!(marked(&new).is_empty());
    }

    #[test]
    fn a_replacement_marks_one_line_on_each_side() {
        let (old, new) = flags_for(&["a\n", "b\n", "c\n"], &["a\n", "z\n", "c\n"]);
        assert_eq!(marked(&old), vec![1]);
        assert_eq!(marked(&new), vec![1]);
    }

    #[test]
    fn a_moved_line_is_reported_as_a_removal_and_an_addition() {
        let (old, new) = flags_for(&["a\n", "b\n", "c\n"], &["b\n", "c\n", "a\n"]);
        // Exactly one line of each side must be unmatched: a diff may not claim a move happened,
        // only that a line vanished here and appeared there.
        assert_eq!(marked(&old).len(), 1);
        assert_eq!(marked(&new).len(), 1);
    }
}
