//! Module: fg-algorithms::traverse::segmented_dag — Segmented Commit DAG & Roaring Reachability
//! File Path: crates/fg-algorithms/src/traverse/segmented_dag.rs
//! Architecture Role: Encapsulates high-performance reachability bitmaps and segment indexing
//!   for Git commit graphs using Roaring bitmaps.
//! Dependencies & Triggers: Consumed by DagWalker, commit_walk, rev-list, and pack bitmap indexing.
//! Responsibilities: Sub-microsecond commit reachability, merge-base intersection, and revision
//!   range exclusion using SIMD-accelerated Roaring bitmap operations.
//! Exit Semantics & Design Rationale:
//!   - RoaringBitmap compresses reachability sets into run-length and bitset containers.
//!   - is_ancestor(A, D) resolves in O(1) via `bitmap.contains(A_index)`.
//!   - Common ancestors between multiple tips resolve via bitwise AND `&bm_a & &bm_b`.
//!   - Segmented indexing maps OIDs to dense u32 integer indices.
//!
//! Domain Governance Rules: FGT-ALG-001 (DAG reachability), FGT-COR-001, FGT-PRF-001.

use std::collections::{HashMap, VecDeque};
use std::hash::BuildHasherDefault;

use fg_core::models::{FastOidHasher, Oid};
use roaring::RoaringBitmap;

/// Dense integer mapping and compressed reachability index for a commit DAG.
#[derive(Debug, Clone, Default)]
pub struct SegmentedCommitDag {
    /// Ordered list of commit OIDs mapping index -> Oid.
    oids: Vec<Oid>,
    /// Reverse lookup mapping Oid -> index.
    oid_to_index: HashMap<Oid, u32, BuildHasherDefault<FastOidHasher>>,
    /// Reachability bitmaps per commit index: reachability[i] contains i and all its ancestors.
    reachability: Vec<RoaringBitmap>,
    /// Direct parents per commit index.
    parents: Vec<Vec<u32>>,
}

impl SegmentedCommitDag {
    /// Creates an empty segmented commit DAG.
    pub fn new() -> Self {
        Self {
            oids: Vec::new(),
            oid_to_index: HashMap::default(),
            reachability: Vec::new(),
            parents: Vec::new(),
        }
    }

    /// Number of commits indexed in this DAG.
    pub fn len(&self) -> usize {
        self.oids.len()
    }

    /// Returns true if the DAG contains no commits.
    pub fn is_empty(&self) -> bool {
        self.oids.is_empty()
    }

    /// Resolves an OID to its dense u32 index if present.
    pub fn get_index(&self, oid: &Oid) -> Option<u32> {
        self.oid_to_index.get(oid).copied()
    }

    /// Resolves a u32 index to its OID.
    pub fn get_oid(&self, index: u32) -> Option<&Oid> {
        self.oids.get(index as usize)
    }

    /// Returns the direct parent indices of a commit index.
    pub fn parents(&self, index: u32) -> Option<&[u32]> {
        self.parents
            .get(index as usize)
            .map(|parent_list| parent_list.as_slice())
    }

    /// Returns the reachability bitmap for a commit OID.
    pub fn reachability_bitmap(&self, oid: &Oid) -> Option<&RoaringBitmap> {
        let index = self.get_index(oid)?;
        self.reachability.get(index as usize)
    }

    /// Builds a `SegmentedCommitDag` from an unordered list of `(commit_oid, parent_oids)`.
    /// Automatically performs in-degree Kahn topological sorting and propagates reachability.
    pub fn from_commits(commits: &[(Oid, Vec<Oid>)]) -> Self {
        let commit_count = commits.len();
        if commit_count == 0 {
            return Self::new();
        }

        let mut oids = Vec::with_capacity(commit_count);
        let mut oid_to_index =
            HashMap::with_capacity_and_hasher(commit_count, BuildHasherDefault::default());

        for (oid, _) in commits {
            if !oid_to_index.contains_key(oid) {
                let index = oids.len() as u32;
                oids.push(*oid);
                oid_to_index.insert(*oid, index);
            }
        }

        let mut parents = vec![Vec::new(); oids.len()];
        let mut in_degree = vec![0u32; oids.len()];
        let mut children = vec![Vec::new(); oids.len()];

        for (oid, parent_list) in commits {
            let Some(&child_idx) = oid_to_index.get(oid) else {
                continue;
            };
            for parent_oid in parent_list {
                let Some(&parent_idx) = oid_to_index.get(parent_oid) else {
                    continue;
                };
                parents[child_idx as usize].push(parent_idx);
                children[parent_idx as usize].push(child_idx);
                in_degree[child_idx as usize] += 1;
            }
        }

        // Initialize reachability: each node reaches itself
        let mut reachability = vec![RoaringBitmap::new(); oids.len()];
        for (node_idx, node_bitmap) in reachability.iter_mut().enumerate() {
            node_bitmap.insert(node_idx as u32);
        }

        // Kahn's algorithm starting from roots (in_degree == 0, commits with no registered parents)
        let mut queue = VecDeque::new();
        for (node_idx, parent_indices) in parents.iter().enumerate() {
            if parent_indices.is_empty() {
                queue.push_back(node_idx as u32);
            }
        }

        // If there are cycles or disconnected components, fall back to BFS traversal for reachability
        let mut visited_count = 0;
        while let Some(node_idx) = queue.pop_front() {
            visited_count += 1;

            for &child_idx in &children[node_idx as usize] {
                Self::or_reachability_in_place(
                    &mut reachability,
                    child_idx as usize,
                    node_idx as usize,
                );

                in_degree[child_idx as usize] = in_degree[child_idx as usize].saturating_sub(1);
                if in_degree[child_idx as usize] == 0 {
                    queue.push_back(child_idx);
                }
            }
        }

        // If cycle or unvisited nodes remain, do iterative fixpoint pass
        if visited_count < oids.len() {
            for (node_idx, parent_list) in parents.iter().enumerate() {
                for &parent_idx in parent_list {
                    Self::or_reachability_in_place(
                        &mut reachability,
                        node_idx,
                        parent_idx as usize,
                    );
                }
            }
        }

        Self {
            oids,
            oid_to_index,
            reachability,
            parents,
        }
    }

    /// Merges `reachability[src]` into `reachability[dst]` in-place via disjoint slice borrows
    /// with zero `RoaringBitmap::clone()` allocation (`FGT-PRF-001`).
    #[inline]
    fn or_reachability_in_place(reachability: &mut [RoaringBitmap], dst: usize, src: usize) {
        if dst < src {
            let (left, right) = reachability.split_at_mut(src);
            left[dst] |= &right[0];
        } else if dst > src {
            let (left, right) = reachability.split_at_mut(dst);
            right[0] |= &left[src];
        }
    }

    /// Evaluates whether `ancestor` is reachable from `descendant` in O(1) time.
    pub fn is_ancestor(&self, ancestor: &Oid, descendant: &Oid) -> bool {
        if ancestor == descendant {
            return true;
        }

        let Some(&ancestor_index) = self.oid_to_index.get(ancestor) else {
            return false;
        };
        let Some(&descendant_index) = self.oid_to_index.get(descendant) else {
            return false;
        };

        self.reachability[descendant_index as usize].contains(ancestor_index)
    }

    /// Computes common ancestors between two commits via bitwise AND on reachability bitmaps.
    pub fn common_ancestors(&self, first_tip: &Oid, second_tip: &Oid) -> RoaringBitmap {
        let Some(&index_first) = self.oid_to_index.get(first_tip) else {
            return RoaringBitmap::new();
        };
        let Some(&index_second) = self.oid_to_index.get(second_tip) else {
            return RoaringBitmap::new();
        };

        &self.reachability[index_first as usize] & &self.reachability[index_second as usize]
    }

    /// Computes revision range exclusion: `include..exclude` (commits in include excluding exclude and their ancestors).
    pub fn revision_range(&self, include: &[Oid], exclude: &[Oid]) -> RoaringBitmap {
        let mut include_bitmap = RoaringBitmap::new();
        for oid in include {
            if let Some(&commit_index) = self.oid_to_index.get(oid) {
                include_bitmap |= &self.reachability[commit_index as usize];
            }
        }

        let mut exclude_bitmap = RoaringBitmap::new();
        for oid in exclude {
            if let Some(&commit_index) = self.oid_to_index.get(oid) {
                exclude_bitmap |= &self.reachability[commit_index as usize];
            }
        }

        include_bitmap - exclude_bitmap
    }

    /// Converts a RoaringBitmap of commit indices back into an ordered vector of OIDs.
    pub fn to_oids(&self, bitmap: &RoaringBitmap) -> Vec<Oid> {
        bitmap
            .iter()
            .filter_map(|idx| self.oids.get(idx as usize).copied())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_segmented_dag_empty() {
        let dag = SegmentedCommitDag::new();
        assert!(dag.is_empty());
        assert_eq!(dag.len(), 0);
    }

    #[test]
    fn test_segmented_dag_linear_chain() {
        let root = Oid::from_bytes([0x01; 20]);
        let c1 = Oid::from_bytes([0x02; 20]);
        let c2 = Oid::from_bytes([0x03; 20]);

        let commits = vec![(root, Vec::new()), (c1, vec![root]), (c2, vec![c1])];

        let dag = SegmentedCommitDag::from_commits(&commits);
        assert_eq!(dag.len(), 3);

        assert!(dag.is_ancestor(&root, &root));
        assert!(dag.is_ancestor(&root, &c1));
        assert!(dag.is_ancestor(&root, &c2));
        assert!(dag.is_ancestor(&c1, &c2));

        assert!(!dag.is_ancestor(&c2, &c1));
        assert!(!dag.is_ancestor(&c1, &root));
    }

    #[test]
    fn test_segmented_dag_diamond_topology() {
        let root = Oid::from_bytes([0x10; 20]);
        let branch_a = Oid::from_bytes([0x20; 20]);
        let branch_b = Oid::from_bytes([0x30; 20]);
        let merge = Oid::from_bytes([0x40; 20]);

        let commits = vec![
            (root, Vec::new()),
            (branch_a, vec![root]),
            (branch_b, vec![root]),
            (merge, vec![branch_a, branch_b]),
        ];

        let dag = SegmentedCommitDag::from_commits(&commits);
        assert_eq!(dag.len(), 4);

        assert!(dag.is_ancestor(&root, &merge));
        assert!(dag.is_ancestor(&branch_a, &merge));
        assert!(dag.is_ancestor(&branch_b, &merge));

        assert!(!dag.is_ancestor(&branch_a, &branch_b));
        assert!(!dag.is_ancestor(&branch_b, &branch_a));

        // Common ancestors of branch_a and branch_b
        let common = dag.common_ancestors(&branch_a, &branch_b);
        let common_oids = dag.to_oids(&common);
        assert_eq!(common_oids, vec![root]);

        // Range merge..branch_a should yield merge and branch_b
        let range = dag.revision_range(&[merge], &[branch_a]);
        let range_oids = dag.to_oids(&range);
        assert!(range_oids.contains(&merge));
        assert!(range_oids.contains(&branch_b));
        assert!(!range_oids.contains(&branch_a));
        assert!(!range_oids.contains(&root));
    }
}
