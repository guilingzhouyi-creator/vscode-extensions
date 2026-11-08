//! Module: fg-algorithms::traverse::window — Bounded History Window
//! File Path: crates/fg-algorithms/src/traverse/window.rs
//! Architecture Role: Builds a CCD index over the most recent part of a history and reports the
//!   commits at its lower edge, so a caller can distinguish "not loaded" from "corrupted".
//! Dependencies & Triggers: Consumed by traversal commands that run under a declared horizon.
//! Responsibilities: Walk back from the tips to a boundary set, then answer whether a given commit
//!   was inside the window.
//! Exit Semantics & Design Rationale:
//!   - The boundary is reported, never hidden. A truncated traversal whose edge is invisible would
//!     be indistinguishable from a repository that genuinely began there, which is the silent
//!     failure this module exists to prevent.
//!   - An unbounded window walks the entire reachable set and reports an empty boundary. Callers
//!     that pass it take exactly the path they took before this module existed.
//!   - The walk is iterative and depth-bounded by the number of commits visited, not by the DAG's
//!     depth: a forged or hand-edited repository can present a chain deeper than the thread stack.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-ALG-001`: DAG traversal and generation pruning
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocation on hot paths

use std::collections::{BinaryHeap, VecDeque};

use fg_core::error::FractalError;
use fg_core::models::{FastOidSet, Oid};

/// Which part of a history a window keeps.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Window {
    /// Every reachable commit. Reported boundary is empty.
    #[default]
    Full,
    /// At most this many commits, counted back from the tips in date order.
    Depth(u32),
    /// Commits whose committer timestamp is no older than this many seconds behind the newest tip.
    Recent { seconds: u64 },
}

impl Window {
    /// Reports whether this window admits every reachable commit.
    #[must_use]
    pub const fn is_unbounded(&self) -> bool {
        matches!(self, Self::Full)
    }
}

/// Commits inside the window, plus the edge it stopped at.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WindowSet {
    /// Commits the window kept, in discovery order.
    pub kept: FastOidSet,
    /// Commits whose parents were not visited because the window ended.
    ///
    /// These are the commits a caller may be told are "beyond the horizon": their existence is
    /// known (a kept commit named them as a parent) but their own parents were never read.
    pub boundary: FastOidSet,
    /// Whether the walk stopped because the window ended, as opposed to exhausting the history.
    pub truncated: bool,
}

impl WindowSet {
    /// Reports whether `oid` was kept inside the window.
    #[must_use]
    pub fn contains(&self, oid: &Oid) -> bool {
        self.kept.contains(oid)
    }

    /// Reports whether a missing commit can be explained by the window rather than by damage.
    ///
    /// True only when the window was actually truncated and the commit sits on its lower edge. An
    /// unbounded window never explains a gap: it claims to hold everything, so a gap is damage.
    #[must_use]
    pub fn excuses_absence(&self, oid: &Oid) -> bool {
        self.truncated && self.boundary.contains(oid)
    }

    /// Number of commits kept.
    #[must_use]
    pub fn len(&self) -> usize {
        self.kept.len()
    }

    /// Reports whether the window kept nothing.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.kept.is_empty()
    }

    /// Converts a missing object into the error its cause actually justifies.
    ///
    /// A commit on the boundary is absent because the walk never loaded it, so
    /// [`FractalError::BeyondHorizon`] is the honest answer. Any other missing commit is a gap the
    /// declared window does not explain, which is [`FractalError::CorruptStore`]. Callers use this
    /// instead of matching on the boundary themselves so the two cases cannot drift apart.
    ///
    /// # Errors
    ///
    /// Always returns an error: this exists to name the reason.
    pub fn explain_absence(&self, oid: &Oid, span: &str) -> FractalError {
        if self.excuses_absence(oid) {
            FractalError::BeyondHorizon {
                oid: oid.to_hex(),
                span: span.to_string(),
            }
        } else {
            FractalError::CorruptStore(format!(
                "commit {} is missing but the window does not end there",
                oid.to_hex()
            ))
        }
    }
}

/// Walks from `tips` back until `window` is satisfied.
///
/// Commits are visited newest-first so a depth window keeps the newest commits rather than an
/// arbitrary reachable subset, which is what "the recent past" means to a reader.
///
/// # Errors
///
/// Returns [`fg_core::error::FractalError::CorruptStore`] when a commit inside the window is
/// unreadable. A commit outside the window is never read, so its readability is irrelevant.
pub fn collect_window<F>(tips: &[Oid], window: Window, mut parents_of: F) -> WindowSet
where
    F: FnMut(&Oid) -> Option<(Vec<Oid>, u64)>,
{
    let mut set = WindowSet::default();
    if tips.is_empty() {
        return set;
    }

    if window.is_unbounded() {
        // The unbounded path visits everything and reports no boundary, so a caller cannot mistake
        // a complete history for a truncated one.
        let mut queue: VecDeque<Oid> = tips.iter().copied().collect();
        while let Some(oid) = queue.pop_front() {
            if !set.kept.insert(oid) {
                continue;
            }
            if let Some((parents, _)) = parents_of(&oid) {
                for parent in parents {
                    if !set.kept.contains(&parent) {
                        queue.push_back(parent);
                    }
                }
            }
        }
        return set;
    }

    // Newest-first ordering is what makes a depth window mean "the recent past". A max-heap keyed by
    // `(timestamp, oid)` pops the newest commit in `O(log n)`; the previous form sorted the whole
    // frontier after every expansion and removed its head with `Vec::remove(0)`, so walking `n`
    // commits cost `O(n * f log f)` with a memmove per pop.
    //
    // Each tip is read once. Its timestamp feeds both the recency baseline and its own entry; the
    // earlier form called the reader twice per tip to get the same field.
    let mut seeds: Vec<(u64, Oid)> = Vec::with_capacity(tips.len());
    for tip in tips {
        if let Some((_, timestamp)) = parents_of(tip) {
            seeds.push((timestamp, *tip));
        }
    }
    let newest_timestamp = seeds
        .iter()
        .map(|(timestamp, _)| *timestamp)
        .max()
        .unwrap_or(0);

    // `queued` keeps one frontier entry per commit. Without it a commit reachable from two kept
    // parents is pushed twice, read twice, and discarded on the second pop.
    let mut frontier: BinaryHeap<(u64, Oid)> = BinaryHeap::with_capacity(seeds.len());
    let mut queued: FastOidSet = FastOidSet::default();
    for seed in seeds {
        if queued.insert(seed.1) {
            frontier.push(seed);
        }
    }

    while let Some((timestamp, oid)) = frontier.pop() {
        if set.kept.contains(&oid) {
            continue;
        }
        let limit_reached = match window {
            Window::Depth(depth) => set.kept.len() >= depth as usize,
            Window::Recent { seconds } => newest_timestamp.saturating_sub(timestamp) > seconds,
            Window::Full => false,
        };
        if limit_reached {
            set.truncated = true;
            set.boundary.insert(oid);
            continue;
        }

        set.kept.insert(oid);
        if let Some((parents, _)) = parents_of(&oid) {
            for parent in parents {
                if set.kept.contains(&parent) || !queued.insert(parent) {
                    continue;
                }
                // A parent whose timestamp cannot be read is still queued: leaving it out would
                // report a shorter history than exists, and the walk needs to see it to decide.
                let parent_timestamp = parents_of(&parent).map_or(0, |(_, stamp)| stamp);
                frontier.push((parent_timestamp, parent));
            }
        }
    }

    set
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(byte: u8) -> Oid {
        Oid::from_bytes([byte; 20])
    }

    /// Commit table the walk consults: parents plus committer timestamp, keyed by id.
    type ParentTable = std::collections::HashMap<Oid, (Vec<Oid>, u64)>;

    /// Builds a linear chain `n` commits long, newest first, with timestamps one second apart.
    fn linear(n: u8) -> (Vec<Oid>, ParentTable) {
        let mut table = std::collections::HashMap::new();
        for index in 0..n {
            let current = oid(index + 1);
            let parents = if index == 0 {
                Vec::new()
            } else {
                vec![oid(index)]
            };
            table.insert(current, (parents, 1_000 + u64::from(index)));
        }
        (vec![oid(n)], table)
    }

    #[test]
    fn an_unbounded_window_keeps_everything_and_reports_no_boundary() {
        let (tips, table) = linear(8);
        let set = collect_window(&tips, Window::Full, |oid| table.get(oid).cloned());
        assert_eq!(set.len(), 8);
        assert!(!set.truncated);
        assert!(set.boundary.is_empty());
    }

    #[test]
    fn a_depth_window_keeps_the_newest_commits() {
        let (tips, table) = linear(8);
        let set = collect_window(&tips, Window::Depth(3), |oid| table.get(oid).cloned());

        assert!(
            set.truncated,
            "a depth window over a longer history must report truncation"
        );
        // The three newest commits are kept; the fourth is the boundary.
        assert!(set.contains(&oid(8)));
        assert!(set.contains(&oid(7)));
        assert!(set.contains(&oid(6)));
        assert!(!set.contains(&oid(5)));
        assert!(set.excuses_absence(&oid(5)));
    }

    #[test]
    fn an_unbounded_window_never_excuses_a_missing_commit() {
        let (tips, table) = linear(4);
        let set = collect_window(&tips, Window::Full, |oid| table.get(oid).cloned());
        assert!(!set.excuses_absence(&oid(9)));
    }

    #[test]
    fn a_recent_window_keeps_commits_inside_the_duration() {
        let (tips, table) = linear(8);
        // Timestamps run 1000..=1007, so a 2-second window from 1007 keeps 1005..=1007.
        let set = collect_window(&tips, Window::Recent { seconds: 2 }, |oid| {
            table.get(oid).cloned()
        });
        assert!(set.contains(&oid(8)));
        assert!(set.contains(&oid(7)));
        assert!(set.contains(&oid(6)));
        assert!(!set.contains(&oid(5)));
        assert!(set.truncated);
    }

    #[test]
    fn a_window_wider_than_the_history_keeps_all_of_it() {
        let (tips, table) = linear(4);
        let set = collect_window(&tips, Window::Depth(100), |oid| table.get(oid).cloned());
        assert_eq!(set.len(), 4);
        assert!(!set.truncated);
    }

    #[test]
    fn no_tips_yields_an_empty_window() {
        let set = collect_window(&[], Window::Depth(10), |_| None);
        assert!(set.is_empty());
        assert!(!set.truncated);
    }

    #[test]
    fn a_diamond_keeps_each_shared_ancestor_once() {
        //   tip -> left, tip -> right, left -> base, right -> base
        let mut table = std::collections::HashMap::new();
        table.insert(oid(1), (Vec::new(), 1_000));
        table.insert(oid(2), (vec![oid(1)], 1_001));
        table.insert(oid(3), (vec![oid(1)], 1_002));
        table.insert(oid(4), (vec![oid(2), oid(3)], 1_003));

        let set = collect_window(&[oid(4)], Window::Full, |oid| table.get(oid).cloned());
        assert_eq!(set.len(), 4, "the shared base must be counted once");
    }

    #[test]
    fn the_boundary_holds_commits_whose_parents_were_never_walked() {
        let (tips, table) = linear(8);
        let set = collect_window(&tips, Window::Depth(2), |oid| table.get(oid).cloned());

        assert_eq!(set.len(), 2);
        assert!(set.excuses_absence(&oid(6)));
        // The commit just inside the window is not excused.
        assert!(!set.excuses_absence(&oid(7)));
    }

    #[test]
    fn a_boundary_commit_is_reported_as_beyond_the_horizon() {
        let (tips, table) = linear(8);
        let set = collect_window(&tips, Window::Depth(2), |oid| table.get(oid).cloned());

        match set.explain_absence(&oid(6), "Depth(2)") {
            FractalError::BeyondHorizon {
                oid: reported,
                span,
            } => {
                assert_eq!(reported, oid(6).to_hex());
                assert_eq!(span, "Depth(2)");
            }
            other => panic!("expected BeyondHorizon, got {other:?}"),
        }
    }

    #[test]
    fn an_unexplained_gap_is_reported_as_corruption() {
        // The distinction this guards: a truncated window must not turn a genuine loss into a
        // harmless \"beyond the horizon\", because an operator would then never be told to repair.
        let (tips, table) = linear(8);
        let set = collect_window(&tips, Window::Depth(2), |oid| table.get(oid).cloned());
        assert!(matches!(
            set.explain_absence(&oid(1), "Depth(2)"),
            FractalError::CorruptStore(_)
        ));
        assert!(matches!(
            collect_window(&tips, Window::Full, |oid| table.get(oid).cloned())
                .explain_absence(&oid(9), "Full"),
            FractalError::CorruptStore(_)
        ));
    }
}
