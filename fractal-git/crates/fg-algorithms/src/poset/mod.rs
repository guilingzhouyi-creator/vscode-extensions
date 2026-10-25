//! Module: fg-algorithms::poset — Poset Algebra & Monotonic Topological Clocks
//! File Path: crates/fg-algorithms/src/poset/mod.rs
//! Architecture Role: Facade and operators for Poset monotonic homomorphisms (CCD v2)
//!   and topological generation numbers, ensuring O(1) negative reachability cutoffs.
//! Dependencies & Triggers: Consumed by DAG walker, revision parsers, and commit graph queries.
//! Responsibilities: Monotonic generation verification, O(1) ancestor reachability bounds checking,
//!   and branch topological divergence distance calculation.
//! Exit Semantics & Design Rationale:
//!   - Monotonic Homomorphism: If A is a strict ancestor of B, CCD(A) < CCD(B).
//!   - O(1) Negative Cutoff: If CCD(A) >= CCD(B) and A != B, A cannot possibly be an ancestor of B.
//!
//! Domain Governance Rules: FGT-ALG-001 (poset algorithms), FGT-COR-001, FGT-PRF-001.

pub use fg_core::models::CorrectedCommitDate;

/// Evaluates whether an ancestor candidate could potentially reach the given descendant node
/// based purely on their Corrected Commit Date (CCD v2) values.
///
/// Returns `false` in O(1) time if reachability is mathematically impossible according to
/// the poset homomorphism invariant `CCD(u) < CCD(v)`.
///
/// Note: A return value of `true` indicates that reachability is *possible* (not ruled out),
/// requiring a DAG traversal to verify exact path existence.
#[inline(always)]
pub fn can_potentially_reach(
    ancestor_ccd: CorrectedCommitDate,
    descendant_ccd: CorrectedCommitDate,
) -> bool {
    ancestor_ccd <= descendant_ccd
}

/// Filters out candidate descendants that are mathematically impossible to be descendants
/// of the specified ancestor in O(1) time per element.
///
/// Returns a slice partition count indicating how many candidates survived the cutoff.
pub fn filter_unreachable_descendants<I>(
    ancestor_ccd: CorrectedCommitDate,
    candidate_descendants: I,
) -> Vec<CorrectedCommitDate>
where
    I: IntoIterator<Item = CorrectedCommitDate>,
{
    candidate_descendants
        .into_iter()
        .filter(|&descendant_ccd| can_potentially_reach(ancestor_ccd, descendant_ccd))
        .collect()
}

/// Calculates the conservative topological distance between two monotonically ordered nodes.
///
/// If `descendant_ccd >= ancestor_ccd`, returns the monotonic clock delta.
/// Otherwise returns 0, signifying an inverted or topologically invalid order.
#[inline(always)]
pub fn topological_bound_distance(
    ancestor_ccd: CorrectedCommitDate,
    descendant_ccd: CorrectedCommitDate,
) -> u64 {
    if descendant_ccd >= ancestor_ccd {
        descendant_ccd.0 - ancestor_ccd.0
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_poset_reachability_cutoffs() {
        let root = CorrectedCommitDate::new(100);
        let child1 = CorrectedCommitDate::new(101);
        let child2 = CorrectedCommitDate::new(105);

        assert!(can_potentially_reach(root, child1));
        assert!(can_potentially_reach(root, child2));
        assert!(can_potentially_reach(child1, child2));

        // Negative reachability cutoffs (impossible directions)
        assert!(!can_potentially_reach(child2, root));
        assert!(!can_potentially_reach(child1, root));

        let candidates = vec![
            CorrectedCommitDate::new(50),  // impossible
            CorrectedCommitDate::new(99),  // impossible
            CorrectedCommitDate::new(100), // possible
            CorrectedCommitDate::new(200), // possible
        ];

        let filtered = filter_unreachable_descendants(root, candidates);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0], CorrectedCommitDate::new(100));
        assert_eq!(filtered[1], CorrectedCommitDate::new(200));

        assert_eq!(topological_bound_distance(root, child2), 5);
        assert_eq!(topological_bound_distance(child2, root), 0);
    }
}
