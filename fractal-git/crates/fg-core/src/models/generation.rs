//! Module: fg-core — Generation Numbers & Corrected Commit Date (CCD v2)
//! File Path: crates/fg-core/src/models/generation.rs
//! Architecture Role: Encapsulates mathematically sound generation numbers and Corrected Commit
//!   Date (CCD v2) for Directed Acyclic Graphs (DAG) of Git commits.
//! Dependencies & Triggers: Consumed by fg-algorithms DagWalker, fg-topology, and gate checkers.
//! Responsibilities: Enforces strict monotonic poset homomorphism to provide O(1) negative cutoff
//!   for commit ancestor reachability.
//! Exit Semantics & Design Rationale:
//!   - CCD(C) = committer_date(C) if parents(C) is empty.
//!   - CCD(C) = max(committer_date(C), max_{P in parents}(CCD(P)) + 1) otherwise.
//!   - If ancestor_ccd >= descendant_ccd and ancestor != descendant,
//!     reachability is strictly impossible (O(1) false-path).

use serde::{Deserialize, Serialize};

/// Corrected Commit Date (CCD v2) value.
/// Enforces monotonic order: If u is an ancestor of v (u != v), then CCD(u) < CCD(v).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct CorrectedCommitDate(pub u64);

impl CorrectedCommitDate {
    /// Zero/epoch representation.
    pub const ZERO: Self = Self(0);

    /// Construct a new typed CorrectedCommitDate directly.
    #[inline(always)]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    /// Computes the Corrected Commit Date for a node given its committer timestamp (in seconds)
    /// and the maximum Corrected Commit Date among all its direct parents.
    #[inline]
    pub fn compute(committer_timestamp: u64, max_parent_ccd: Option<Self>) -> Self {
        match max_parent_ccd {
            None => Self(committer_timestamp),
            Some(parent_ccd) => {
                let candidate = parent_ccd.0.saturating_add(1);
                Self(committer_timestamp.max(candidate))
            }
        }
    }

    /// Computes from an iterator of parent CCDs.
    #[inline]
    pub fn compute_from_parents<I>(committer_timestamp: u64, parents: I) -> Self
    where
        I: IntoIterator<Item = Self>,
    {
        let max_parent = parents.into_iter().map(|parent_ccd| parent_ccd.0).max();
        match max_parent {
            None => Self(committer_timestamp),
            Some(max_parent_val) => Self(committer_timestamp.max(max_parent_val.saturating_add(1))),
        }
    }

    /// O(1) Negative reachability check:
    /// If self >= descendant_ccd, returns false (meaning self cannot possibly
    /// be an ancestor of descendant).
    #[inline(always)]
    pub fn can_be_ancestor_of(&self, descendant_ccd: &Self) -> bool {
        self.0 < descendant_ccd.0
    }

    /// Returns the raw u64 value.
    #[inline(always)]
    pub const fn get(&self) -> u64 {
        self.0
    }

    /// Returns the raw u64 value (alias for backwards compatibility).
    #[inline(always)]
    pub const fn as_u64(&self) -> u64 {
        self.0
    }
}

impl From<u64> for CorrectedCommitDate {
    #[inline(always)]
    fn from(value: u64) -> Self {
        Self(value)
    }
}

impl From<CorrectedCommitDate> for u64 {
    #[inline(always)]
    fn from(ccd: CorrectedCommitDate) -> Self {
        ccd.0
    }
}

impl std::fmt::Display for CorrectedCommitDate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CCD({})", self.0)
    }
}
