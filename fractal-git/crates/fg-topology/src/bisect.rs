//! Module: fg-topology::bisect — Topological Centroid Bisect State Machine
//! File Path: crates/fg-topology/src/bisect.rs
//! Architecture Role: Manages binary search state machine across the commit DAG to isolate
//!   regressions with minimal verification steps using topological centroid selection.
//! Dependencies & Triggers: Consumed by taxis bisect CLI command and automated test drivers.
//! Responsibilities: Manage bisect session lifecycle (start, good, bad, skip, reset),
//!   compute optimal topological centroid midpoints, and persist session checkpoints.
//! Exit Semantics & Design Rationale:
//!   - Topological Centroid: selects candidate minimizing |2*ancestors(c) - total|, achieving
//!     strictly optimal O(log N) regression search depth.
//!   - Deterministic tie-breaking: identical commit graphs always choose identical midpoints.
//!   - Crash-resilient persistence in BISECT_STATE.

use std::collections::{BTreeSet, HashSet, VecDeque};
use std::path::Path;

use fg_core::error::FractalError;
use fg_core::models::Oid;
use serde::{Deserialize, Serialize};

/// State file name within the repository storage directory.
pub const BISECT_STATE_FILE: &str = "BISECT_STATE";

/// Active state of a bisection session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BisectState {
    /// Original HEAD commit before bisection started.
    pub orig_head: Oid,
    /// Known bad (or regressed) commit OID.
    pub bad: Oid,
    /// Known good (clean) commit OIDs.
    pub good: Vec<Oid>,
    /// Commits that could not be tested and were skipped.
    pub skipped: Vec<Oid>,
    /// Whether bisection is currently active.
    pub active: bool,
}

impl BisectState {
    /// Creates a new active bisect state.
    pub fn new(orig_head: Oid, bad: Oid) -> Self {
        Self {
            orig_head,
            bad,
            good: Vec::new(),
            skipped: Vec::new(),
            active: true,
        }
    }

    /// Saves state to the repository storage directory.
    pub fn save(&self, dir: &Path) -> Result<(), FractalError> {
        let path = dir.join(BISECT_STATE_FILE);
        let serialized_bytes = serde_json::to_vec_pretty(self)?;
        fg_core::write_file_atomic(&path, &serialized_bytes, false)?;
        Ok(())
    }

    /// Loads active state if present.
    pub fn load(dir: &Path) -> Result<Option<Self>, FractalError> {
        let path = dir.join(BISECT_STATE_FILE);
        if !path.exists() {
            return Ok(None);
        }
        let payload_bytes = std::fs::read(&path)?;
        let state: Self = serde_json::from_slice(&payload_bytes)?;
        Ok(Some(state))
    }

    /// Clears any persisted bisect state.
    pub fn clear(dir: &Path) -> Result<(), FractalError> {
        let path = dir.join(BISECT_STATE_FILE);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        Ok(())
    }
}

/// Outcome of a bisection step calculation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BisectStep {
    /// Intermediate step: test this candidate next.
    Step {
        candidate: Oid,
        remaining_candidates: usize,
        estimated_steps: usize,
    },
    /// Bisection converged: identified the first bad commit.
    Found { first_bad: Oid },
    /// No candidates remaining or invalid state.
    Finished { message: String },
}

/// Bisect algorithmic engine.
pub struct BisectEngine;

impl BisectEngine {
    /// Computes the optimal midpoint commit to inspect next given parent relationships.
    ///
    /// `parent_map` maps a commit OID to its parent OIDs.
    pub fn compute_midpoint<F>(
        bad: &Oid,
        good: &[Oid],
        skipped: &[Oid],
        mut parent_fn: F,
    ) -> BisectStep
    where
        F: FnMut(&Oid) -> Option<Vec<Oid>>,
    {
        // 1. Collect all reachable ancestors of bad and good commits
        let bad_ancestors = collect_ancestors(std::slice::from_ref(bad), None, &mut parent_fn);
        let good_ancestors = collect_ancestors(good, None, &mut parent_fn);

        // 2. Candidate set: bad_ancestors \ good_ancestors
        let candidates: BTreeSet<Oid> = bad_ancestors
            .into_iter()
            .filter(|commit| !good_ancestors.contains(commit))
            .collect();

        if candidates.is_empty() {
            return BisectStep::Finished {
                message: "No candidate commits between good and bad commits.".to_string(),
            };
        }

        // If only 1 candidate remains, it must be the first bad commit
        if candidates.len() == 1 {
            let first_bad = *candidates.iter().next().unwrap_or(bad);
            return BisectStep::Found { first_bad };
        }

        // 3. Compute candidate weights (number of ancestors of c within the candidate set)
        let skipped_set: HashSet<Oid> = skipped.iter().copied().collect();
        let total_candidates = candidates.len();
        let target_weight = total_candidates / 2;

        let mut best_candidate: Option<Oid> = None;
        let mut best_diff = usize::MAX;

        for candidate in &candidates {
            if skipped_set.contains(candidate) {
                continue;
            }
            let c_ancestors = collect_ancestors(
                std::slice::from_ref(candidate),
                Some(&candidates),
                &mut parent_fn,
            );
            let diff = c_ancestors.len().abs_diff(target_weight);
            if diff < best_diff {
                best_diff = diff;
                best_candidate = Some(*candidate);
            }
        }

        let Some(selected) = best_candidate else {
            return BisectStep::Finished {
                message: "All remaining candidates are skipped; cannot bisect further.".to_string(),
            };
        };

        let est_steps = (total_candidates as f64).log2().ceil().max(1.0) as usize;

        BisectStep::Step {
            candidate: selected,
            remaining_candidates: total_candidates,
            estimated_steps: est_steps,
        }
    }
}

/// Collects all reachable ancestors from `seeds`, optionally restricted to `allowed`.
fn collect_ancestors<F>(
    seeds: &[Oid],
    allowed: Option<&BTreeSet<Oid>>,
    parent_fn: &mut F,
) -> HashSet<Oid>
where
    F: FnMut(&Oid) -> Option<Vec<Oid>>,
{
    let mut ancestors = HashSet::new();
    let mut queue = VecDeque::new();
    for seed in seeds {
        if ancestors.insert(*seed) {
            queue.push_back(*seed);
        }
    }
    while let Some(current) = queue.pop_front() {
        let Some(parents) = parent_fn(&current) else {
            continue;
        };
        for parent in parents {
            if allowed.is_some_and(|set| !set.contains(&parent)) {
                continue;
            }
            if ancestors.insert(parent) {
                queue.push_back(parent);
            }
        }
    }
    ancestors
}
