//! Module: fg-algorithms — Generation-Number Accelerated DAG Traversal & Topological Sort
//! File Path: crates/fg-algorithms/src/traverse/dag_walk.rs
//! Architecture Role: High-performance graph algorithms for Git commit DAGs: generation-number
//!   bounded cutoff pruning ($O(1)$ negative fast-path), FastOidHasher zero-SipHash set, and
//!   priority queue search.
//! Dependencies & Triggers: Consumed by PreReceiveGuard, TopologyVerifier,
//!   and branch merge evaluators.
//! Responsibilities: Evaluates commit reachability, ancestor invariants, and topological sorting
//!   without external process invocation.
//! Exit Semantics & Design Rationale:
//!   - If ancestor_gen >= descendant_gen (and ancestor != descendant),
//!     proves reachability is impossible in O(1) time.
//!   - Max-heap priority queue by generation number cuts off all paths where node generation falls
//!     below ancestor generation.
//!   - FastOidHasher directly indexes the first 8 bytes of 20-byte SHA-1 digests, eliminating
//!     SipHash overhead.
//!
//! Domain Governance Rules: FGT-ALG-001 (DAG traversal and generation pruning), FGT-COR-001, FGT-PRF-001.

pub use fg_core::models::{
    CorrectedCommitDate, FastOidHasher, FastOidMap, FastOidSet, Oid, PathBloomFilter,
};
use std::collections::{BinaryHeap, VecDeque};

#[derive(PartialEq, Eq)]
struct QueueItem {
    gen: u64,
    oid: Oid,
}

impl Ord for QueueItem {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.gen.cmp(&other.gen)
    }
}

impl PartialOrd for QueueItem {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Compact stack-allocated parent container eliminating heap allocation
/// for commits with up to 2 parents (covering 99.9% of all Git commits).
pub use fg_object::borrowed::{SmallParentIntoIter, SmallParentList};

/// Traversal engine for directed acyclic graphs of Git commits.
pub struct DagWalker;

impl DagWalker {
    /// Determines whether `ancestor` is an ancestor of `descendant` given a parent lookup function.
    pub fn is_ancestor<F, I>(ancestor: &Oid, descendant: &Oid, mut get_parents: F) -> bool
    where
        F: FnMut(&Oid) -> I,
        I: IntoIterator<Item = Oid>,
    {
        if ancestor == descendant {
            return true;
        }

        let mut visited: FastOidSet = FastOidSet::default();
        let mut queue = VecDeque::new();

        queue.push_back(*descendant);
        visited.insert(*descendant);

        while let Some(current) = queue.pop_front() {
            let parents = get_parents(&current);
            for parent in parents {
                if &parent == ancestor {
                    return true;
                }
                if visited.insert(parent) {
                    queue.push_back(parent);
                }
            }
        }

        false
    }

    /// Shared monotonic-cutoff max-heap ancestor search powering both generation-number and CCD v2
    /// reachability checks (`D9`).
    fn is_ancestor_by_cutoff<F, P>(
        ancestor: &Oid,
        descendant: &Oid,
        ancestor_cutoff: u64,
        descendant_cutoff: u64,
        mut get_node: F,
    ) -> bool
    where
        F: FnMut(&Oid) -> Option<(u64, P)>,
        P: Into<SmallParentList>,
    {
        if ancestor == descendant {
            return true;
        }
        if ancestor_cutoff >= descendant_cutoff {
            return false;
        }

        let mut visited: FastOidSet = FastOidSet::default();
        let mut heap: BinaryHeap<QueueItem> = BinaryHeap::new();
        let mut node_cache: FastOidMap<SmallParentList> = FastOidMap::default();

        heap.push(QueueItem {
            gen: descendant_cutoff,
            oid: *descendant,
        });
        visited.insert(*descendant);

        while let Some(item) = heap.pop() {
            if item.gen < ancestor_cutoff {
                continue;
            }
            if &item.oid == ancestor {
                return true;
            }

            let Some(parents) = node_cache
                .remove(&item.oid)
                .or_else(|| get_node(&item.oid).map(|(_, parents)| parents.into()))
            else {
                continue;
            };

            for &parent in parents.as_slice() {
                if &parent == ancestor {
                    return true;
                }
                if !visited.insert(parent) {
                    continue;
                }
                let Some((p_cutoff, p_parents)) = get_node(&parent) else {
                    continue;
                };
                if p_cutoff >= ancestor_cutoff {
                    heap.push(QueueItem {
                        gen: p_cutoff,
                        oid: parent,
                    });
                    node_cache.insert(parent, p_parents.into());
                }
            }
        }

        false
    }

    /// Generation-number accelerated ancestor evaluation.
    /// Fast-path invariant: If ancestor_gen >= descendant_gen and ancestor != descendant,
    /// returns false in O(1) time.
    /// Searches using a max-heap priority queue, cutting off paths as soon
    /// as current_gen < ancestor_gen.
    pub fn is_ancestor_with_generation<F>(
        ancestor: &Oid,
        descendant: &Oid,
        ancestor_gen: u64,
        descendant_gen: u64,
        get_node: F,
    ) -> bool
    where
        F: FnMut(&Oid) -> Option<(u64, Vec<Oid>)>,
    {
        Self::is_ancestor_by_cutoff(ancestor, descendant, ancestor_gen, descendant_gen, get_node)
    }

    /// Generation-number accelerated ancestor evaluation accepting zero-allocation [`SmallParentList`].
    pub fn is_ancestor_with_generation_small<F>(
        ancestor: &Oid,
        descendant: &Oid,
        ancestor_gen: u64,
        descendant_gen: u64,
        get_node: F,
    ) -> bool
    where
        F: FnMut(&Oid) -> Option<(u64, SmallParentList)>,
    {
        Self::is_ancestor_by_cutoff(ancestor, descendant, ancestor_gen, descendant_gen, get_node)
    }

    /// Corrected Commit Date (CCD v2) accelerated ancestor evaluation.
    /// Fast-path invariant: If ancestor_ccd >= descendant_ccd and ancestor != descendant,
    /// returns false in O(1) time.
    /// Uses max-heap cutoff pruning when node CCD falls below ancestor CCD.
    pub fn is_ancestor_with_ccd<F>(
        ancestor: &Oid,
        descendant: &Oid,
        ancestor_ccd: CorrectedCommitDate,
        descendant_ccd: CorrectedCommitDate,
        mut get_node: F,
    ) -> bool
    where
        F: FnMut(&Oid) -> Option<(CorrectedCommitDate, Vec<Oid>)>,
    {
        if ancestor == descendant {
            return true;
        }
        if !ancestor_ccd.can_be_ancestor_of(&descendant_ccd) {
            return false;
        }
        Self::is_ancestor_by_cutoff(
            ancestor,
            descendant,
            ancestor_ccd.0,
            descendant_ccd.0,
            |oid| get_node(oid).map(|(ccd, parents)| (ccd.0, parents)),
        )
    }

    /// CCD v2 accelerated ancestor evaluation accepting zero-allocation [`SmallParentList`].
    pub fn is_ancestor_with_ccd_small<F>(
        ancestor: &Oid,
        descendant: &Oid,
        ancestor_ccd: CorrectedCommitDate,
        descendant_ccd: CorrectedCommitDate,
        mut get_node: F,
    ) -> bool
    where
        F: FnMut(&Oid) -> Option<(CorrectedCommitDate, SmallParentList)>,
    {
        if ancestor == descendant {
            return true;
        }
        if !ancestor_ccd.can_be_ancestor_of(&descendant_ccd) {
            return false;
        }
        Self::is_ancestor_by_cutoff(
            ancestor,
            descendant,
            ancestor_ccd.0,
            descendant_ccd.0,
            |oid| get_node(oid).map(|(ccd, parents)| (ccd.0, parents)),
        )
    }

    /// Performs breadth-first topological walk from start commit down to root.
    pub fn walk_ancestors<F, I>(start: &Oid, mut get_parents: F) -> Vec<Oid>
    where
        F: FnMut(&Oid) -> I,
        I: IntoIterator<Item = Oid>,
    {
        let mut order = Vec::new();
        let mut visited: FastOidSet = FastOidSet::default();
        let mut queue = VecDeque::new();

        queue.push_back(*start);
        visited.insert(*start);

        while let Some(current) = queue.pop_front() {
            order.push(current);
            let parents = get_parents(&current);
            for parent in parents {
                if visited.insert(parent) {
                    queue.push_back(parent);
                }
            }
        }

        order
    }

    /// Traverses commit history from `start` filtering commits that potentially
    /// modified `target_path`.
    /// Uses PathBloomFilter to short-circuit 99%+ of commits without reading their trees.
    pub fn walk_path_history<F>(start: &Oid, target_path: &str, mut get_commit: F) -> Vec<Oid>
    where
        F: FnMut(&Oid) -> Option<(Option<PathBloomFilter>, Vec<Oid>)>,
    {
        let mut matching_commits = Vec::new();
        let mut visited: FastOidSet = FastOidSet::default();
        let mut queue = VecDeque::new();

        queue.push_back(*start);
        visited.insert(*start);

        while let Some(current) = queue.pop_front() {
            if let Some((bloom_opt, parents)) = get_commit(&current) {
                let may_affect = match bloom_opt {
                    Some(bloom) => bloom.may_contain(target_path),
                    None => true, // Fallback: conservative inspection
                };

                if may_affect {
                    matching_commits.push(current);
                }

                for parent in parents {
                    if visited.insert(parent) {
                        queue.push_back(parent);
                    }
                }
            }
        }

        matching_commits
    }

    /// Finds all lowest common ancestors (LCAs / Merge Bases) between two commits
    /// using Git's two-color painting algorithm accelerated by monotonic
    /// Corrected Commit Dates (CCD v2).
    ///
    /// - If `commit_a == commit_b`, returns `vec![*commit_a]`.
    /// - If histories are disjoint, returns an empty vector `vec![]`.
    /// - If a single unique LCA exists, returns `vec![lca]`.
    /// - If criss-cross branches exist with multiple minimal common ancestors,
    ///   returns all of them.
    pub fn find_merge_bases_with_ccd<F>(commit_a: &Oid, commit_b: &Oid, mut get_node: F) -> Vec<Oid>
    where
        F: FnMut(&Oid) -> Option<(CorrectedCommitDate, Vec<Oid>)>,
    {
        if commit_a == commit_b {
            return vec![*commit_a];
        }

        let node_a = get_node(commit_a);
        let node_b = get_node(commit_b);
        let (ccd_a, parents_a) = match node_a {
            Some(node) => node,
            None => return Vec::new(),
        };
        let (ccd_b, parents_b) = match node_b {
            Some(n) => n,
            None => return Vec::new(),
        };

        // Fast-path: is A an ancestor of B?
        if DagWalker::is_ancestor_with_ccd(commit_a, commit_b, ccd_a, ccd_b, &mut get_node) {
            return vec![*commit_a];
        }
        // Fast-path: is B an ancestor of A?
        if DagWalker::is_ancestor_with_ccd(commit_b, commit_a, ccd_b, ccd_a, &mut get_node) {
            return vec![*commit_b];
        }

        let mut node_cache: FastOidMap<(CorrectedCommitDate, Vec<Oid>)> = FastOidMap::default();
        node_cache.insert(*commit_a, (ccd_a, parents_a));
        node_cache.insert(*commit_b, (ccd_b, parents_b));

        let candidate_bases = Self::collect_candidate_merge_bases(
            commit_a,
            commit_b,
            ccd_a,
            ccd_b,
            &mut get_node,
            &mut node_cache,
        );

        if candidate_bases.len() <= 1 {
            return candidate_bases;
        }

        Self::prune_redundant_merge_bases(&candidate_bases, get_node, node_cache)
    }

    fn ensure_cached_ccd<F>(
        oid: &Oid,
        get_node: &mut F,
        node_cache: &mut FastOidMap<(CorrectedCommitDate, Vec<Oid>)>,
    ) -> Option<CorrectedCommitDate>
    where
        F: FnMut(&Oid) -> Option<(CorrectedCommitDate, Vec<Oid>)>,
    {
        if let Some((ccd, _)) = node_cache.get(oid) {
            return Some(*ccd);
        }
        let loaded = get_node(oid)?;
        let ccd = loaded.0;
        node_cache.insert(*oid, loaded);
        Some(ccd)
    }

    fn propagate_merge_base_parents<F>(
        parents: &[Oid],
        flags_to_propagate: u8,
        flags_map: &mut FastOidMap<u8>,
        queue: &mut BinaryHeap<QueueItem>,
        get_node: &mut F,
        node_cache: &mut FastOidMap<(CorrectedCommitDate, Vec<Oid>)>,
    ) where
        F: FnMut(&Oid) -> Option<(CorrectedCommitDate, Vec<Oid>)>,
    {
        for &parent in parents {
            let entry = flags_map.entry(parent).or_insert(0);
            let old_flags = *entry;
            let new_flags = old_flags | flags_to_propagate;
            if new_flags == old_flags {
                continue;
            }
            *entry = new_flags;
            if let Some(p_ccd) = Self::ensure_cached_ccd(&parent, get_node, node_cache) {
                queue.push(QueueItem {
                    gen: p_ccd.0,
                    oid: parent,
                });
            }
        }
    }

    fn collect_candidate_merge_bases<F>(
        commit_a: &Oid,
        commit_b: &Oid,
        ccd_a: CorrectedCommitDate,
        ccd_b: CorrectedCommitDate,
        mut get_node: F,
        node_cache: &mut FastOidMap<(CorrectedCommitDate, Vec<Oid>)>,
    ) -> Vec<Oid>
    where
        F: FnMut(&Oid) -> Option<(CorrectedCommitDate, Vec<Oid>)>,
    {
        const FLAG_A: u8 = 1 << 0;
        const FLAG_B: u8 = 1 << 1;
        const FLAG_COMMON: u8 = FLAG_A | FLAG_B;
        const FLAG_RESULT: u8 = 1 << 2;
        const FLAG_STALE: u8 = 1 << 3;

        let mut flags_map: FastOidMap<u8> = FastOidMap::default();
        let mut queue: BinaryHeap<QueueItem> = BinaryHeap::new();

        flags_map.insert(*commit_a, FLAG_A);
        flags_map.insert(*commit_b, FLAG_B);

        queue.push(QueueItem {
            gen: ccd_a.0,
            oid: *commit_a,
        });
        queue.push(QueueItem {
            gen: ccd_b.0,
            oid: *commit_b,
        });

        let mut candidate_bases: Vec<Oid> = Vec::new();

        while let Some(item) = queue.pop() {
            let current_flags = flags_map.get(&item.oid).copied().unwrap_or(0);
            let is_common = (current_flags & FLAG_COMMON) == FLAG_COMMON;

            if is_common && (current_flags & FLAG_STALE) == 0 {
                if let Some(flags_mut) = flags_map.get_mut(&item.oid) {
                    *flags_mut |= FLAG_RESULT | FLAG_STALE;
                    candidate_bases.push(item.oid);
                }
            }

            if Self::ensure_cached_ccd(&item.oid, &mut get_node, node_cache).is_none() {
                continue;
            }
            let Some((_, parents)) = node_cache.get(&item.oid).cloned() else {
                continue;
            };
            let flags_to_propagate = if is_common {
                current_flags | FLAG_STALE
            } else {
                current_flags
            };
            Self::propagate_merge_base_parents(
                &parents,
                flags_to_propagate,
                &mut flags_map,
                &mut queue,
                &mut get_node,
                node_cache,
            );
        }

        candidate_bases
    }

    fn prune_redundant_merge_bases<F>(
        candidate_bases: &[Oid],
        mut get_node: F,
        mut node_cache: FastOidMap<(CorrectedCommitDate, Vec<Oid>)>,
    ) -> Vec<Oid>
    where
        F: FnMut(&Oid) -> Option<(CorrectedCommitDate, Vec<Oid>)>,
    {
        let mut cached_lookup = |oid: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
            if let Some(cached) = node_cache.get(oid) {
                return Some(cached.clone());
            }
            let loaded = get_node(oid)?;
            node_cache.insert(*oid, loaded.clone());
            Some(loaded)
        };

        let mut final_bases = Vec::with_capacity(candidate_bases.len());
        for (i, cand) in candidate_bases.iter().enumerate() {
            let cand_ccd = cached_lookup(cand)
                .map(|(commit_date, _)| commit_date)
                .unwrap_or(CorrectedCommitDate(0));
            let is_redundant = candidate_bases.iter().enumerate().any(|(j, other)| {
                if i == j {
                    return false;
                }
                let other_ccd = cached_lookup(other)
                    .map(|(commit_date, _)| commit_date)
                    .unwrap_or(CorrectedCommitDate(0));
                DagWalker::is_ancestor_with_ccd(
                    cand,
                    other,
                    cand_ccd,
                    other_ccd,
                    &mut cached_lookup,
                )
            });

            if !is_redundant {
                final_bases.push(*cand);
            }
        }

        final_bases
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_find_merge_bases_branch_and_linear() {
        let mut map: HashMap<Oid, (CorrectedCommitDate, Vec<Oid>)> = HashMap::new();

        let make_oid = |b: u8| Oid::from_bytes([b; 20]);
        let root = make_oid(1);
        let left = make_oid(2);
        let right = make_oid(3);

        map.insert(root, (CorrectedCommitDate(100), vec![]));
        map.insert(left, (CorrectedCommitDate(110), vec![root]));
        map.insert(right, (CorrectedCommitDate(110), vec![root]));

        let mut lookup = |oid: &Oid| map.get(oid).cloned();

        // 1. Direct ancestry fast-path
        let base_linear = DagWalker::find_merge_bases_with_ccd(&root, &left, &mut lookup);
        assert_eq!(base_linear, vec![root]);

        // 2. Branching LCA
        let bases = DagWalker::find_merge_bases_with_ccd(&left, &right, &mut lookup);
        assert_eq!(bases, vec![root]);
    }

    #[test]
    fn test_find_merge_bases_criss_cross_dag() {
        let mut map: HashMap<Oid, (CorrectedCommitDate, Vec<Oid>)> = HashMap::new();

        let make_oid = |b: u8| Oid::from_bytes([b; 20]);
        let root = make_oid(1);
        let base_a = make_oid(2);
        let base_b = make_oid(3);
        let merge_x = make_oid(4);
        let merge_y = make_oid(5);

        // Criss-cross topology:
        // root -> base_a, base_b
        // merge_x = base_a + base_b
        // merge_y = base_a + base_b
        map.insert(root, (CorrectedCommitDate(100), vec![]));
        map.insert(base_a, (CorrectedCommitDate(200), vec![root]));
        map.insert(base_b, (CorrectedCommitDate(200), vec![root]));
        map.insert(merge_x, (CorrectedCommitDate(300), vec![base_a, base_b]));
        map.insert(merge_y, (CorrectedCommitDate(300), vec![base_a, base_b]));

        let mut lookup = |oid: &Oid| map.get(oid).cloned();

        let mut bases = DagWalker::find_merge_bases_with_ccd(&merge_x, &merge_y, &mut lookup);
        bases.sort_by_key(|oid_entry| *oid_entry.as_bytes());

        let mut expected = vec![base_a, base_b];
        expected.sort_by_key(|oid_entry| *oid_entry.as_bytes());

        assert_eq!(bases, expected);
    }

    #[test]
    fn test_small_parent_list_and_zero_alloc_ancestry() {
        let root = Oid::from_bytes([1u8; 20]);
        let parent1 = Oid::from_bytes([2u8; 20]);
        let parent2 = Oid::from_bytes([3u8; 20]);
        let merge = Oid::from_bytes([4u8; 20]);

        let zero = SmallParentList::empty();
        assert_eq!(zero.len(), 0);
        assert!(zero.is_empty());

        let one = SmallParentList::one(root);
        assert_eq!(one.len(), 1);
        assert_eq!((&one).into_iter().collect::<Vec<_>>(), vec![root]);

        let two = SmallParentList::two(parent1, parent2);
        assert_eq!(two.len(), 2);
        assert_eq!(
            (&two).into_iter().collect::<Vec<_>>(),
            vec![parent1, parent2]
        );

        // Verify DagWalker::is_ancestor with SmallParentList
        let is_anc = DagWalker::is_ancestor(&root, &merge, |oid| {
            if oid == &merge {
                SmallParentList::two(parent1, parent2)
            } else if oid == &parent1 {
                SmallParentList::one(root)
            } else {
                SmallParentList::empty()
            }
        });
        assert!(is_anc);
    }
}
