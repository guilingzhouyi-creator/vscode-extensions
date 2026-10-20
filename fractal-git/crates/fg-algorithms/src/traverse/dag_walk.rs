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
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SmallParentList {
    Zero,
    One(Oid),
    Two(Oid, Oid),
    Many(Vec<Oid>),
}

impl SmallParentList {
    pub const fn empty() -> Self {
        Self::Zero
    }

    pub const fn one(parent: Oid) -> Self {
        Self::One(parent)
    }

    pub const fn two(first: Oid, second: Oid) -> Self {
        Self::Two(first, second)
    }

    pub fn from_slice(slice: &[Oid]) -> Self {
        match slice.len() {
            0 => Self::Zero,
            1 => Self::One(slice[0]),
            2 => Self::Two(slice[0], slice[1]),
            _ => Self::Many(slice.to_vec()),
        }
    }

    pub fn len(&self) -> usize {
        match self {
            Self::Zero => 0,
            Self::One(_) => 1,
            Self::Two(_, _) => 2,
            Self::Many(entries) => entries.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl From<Vec<Oid>> for SmallParentList {
    fn from(entries: Vec<Oid>) -> Self {
        match entries.len() {
            0 => Self::Zero,
            1 => Self::One(entries[0]),
            2 => Self::Two(entries[0], entries[1]),
            _ => Self::Many(entries),
        }
    }
}

pub struct SmallParentIter<'a> {
    list: &'a SmallParentList,
    index: usize,
}

impl<'a> Iterator for SmallParentIter<'a> {
    type Item = Oid;

    fn next(&mut self) -> Option<Self::Item> {
        let item = match self.list {
            SmallParentList::Zero => None,
            SmallParentList::One(parent) => {
                if self.index == 0 {
                    Some(*parent)
                } else {
                    None
                }
            }
            SmallParentList::Two(first, second) => match self.index {
                0 => Some(*first),
                1 => Some(*second),
                _ => None,
            },
            SmallParentList::Many(entries) => entries.get(self.index).copied(),
        };
        if item.is_some() {
            self.index += 1;
        }
        item
    }
}

impl<'a> IntoIterator for &'a SmallParentList {
    type Item = Oid;
    type IntoIter = SmallParentIter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        SmallParentIter {
            list: self,
            index: 0,
        }
    }
}

pub struct SmallParentIntoIter {
    list: SmallParentList,
    index: usize,
}

impl Iterator for SmallParentIntoIter {
    type Item = Oid;

    fn next(&mut self) -> Option<Self::Item> {
        let item = match &self.list {
            SmallParentList::Zero => None,
            SmallParentList::One(parent) => {
                if self.index == 0 {
                    Some(*parent)
                } else {
                    None
                }
            }
            SmallParentList::Two(first, second) => match self.index {
                0 => Some(*first),
                1 => Some(*second),
                _ => None,
            },
            SmallParentList::Many(entries) => entries.get(self.index).copied(),
        };
        if item.is_some() {
            self.index += 1;
        }
        item
    }
}

impl IntoIterator for SmallParentList {
    type Item = Oid;
    type IntoIter = SmallParentIntoIter;

    fn into_iter(self) -> Self::IntoIter {
        SmallParentIntoIter {
            list: self,
            index: 0,
        }
    }
}

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
        mut get_node: F,
    ) -> bool
    where
        F: FnMut(&Oid) -> Option<(u64, Vec<Oid>)>,
    {
        if ancestor == descendant {
            return true;
        }

        // O(1) Invariant: An ancestor strictly must have a lower generation
        // number than its descendant!
        if ancestor_gen >= descendant_gen {
            return false;
        }

        let mut visited: FastOidSet = FastOidSet::default();
        let mut heap: BinaryHeap<QueueItem> = BinaryHeap::new();

        heap.push(QueueItem {
            gen: descendant_gen,
            oid: *descendant,
        });
        visited.insert(*descendant);

        while let Some(item) = heap.pop() {
            // Cutoff pruning: no parent of this node can have generation >= ancestor_gen!
            if item.gen < ancestor_gen {
                continue;
            }

            if &item.oid == ancestor {
                return true;
            }

            if let Some((_, parents)) = get_node(&item.oid) {
                for parent in parents {
                    if &parent == ancestor {
                        return true;
                    }

                    if visited.insert(parent) {
                        if let Some((p_gen, _)) = get_node(&parent) {
                            if p_gen >= ancestor_gen {
                                heap.push(QueueItem {
                                    gen: p_gen,
                                    oid: parent,
                                });
                            }
                        }
                    }
                }
            }
        }

        false
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

        // O(1) Poset Homomorphism Invariant: Ancestor strictly must have CCD < descendant_ccd
        if !ancestor_ccd.can_be_ancestor_of(&descendant_ccd) {
            return false;
        }

        let mut visited: FastOidSet = FastOidSet::default();
        let mut heap: BinaryHeap<QueueItem> = BinaryHeap::new();

        heap.push(QueueItem {
            gen: descendant_ccd.0,
            oid: *descendant,
        });
        visited.insert(*descendant);

        while let Some(item) = heap.pop() {
            // Cutoff pruning: no parent of this node can have CCD >= ancestor_ccd!
            if item.gen < ancestor_ccd.0 {
                continue;
            }

            if &item.oid == ancestor {
                return true;
            }

            if let Some((_, parents)) = get_node(&item.oid) {
                for parent in parents {
                    if &parent == ancestor {
                        return true;
                    }

                    if visited.insert(parent) {
                        if let Some((p_ccd, _)) = get_node(&parent) {
                            if p_ccd.0 >= ancestor_ccd.0 {
                                heap.push(QueueItem {
                                    gen: p_ccd.0,
                                    oid: parent,
                                });
                            }
                        }
                    }
                }
            }
        }

        false
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
        let (ccd_a, _) = match node_a {
            Some(node) => node,
            None => return Vec::new(),
        };
        let (ccd_b, _) = match node_b {
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
        let mut min_common_ccd: Option<u64> = None;

        while let Some(item) = queue.pop() {
            let current_flags = *flags_map.get(&item.oid).unwrap_or(&0);

            // Cutoff: if current item's generation is strictly below the lowest
            // common ancestor found and all active elements are already stale, we can prune
            if let Some(min_ccd) = min_common_ccd {
                if item.gen < min_ccd && (current_flags & FLAG_COMMON) == FLAG_COMMON {
                    continue;
                }
            }

            if (current_flags & FLAG_COMMON) == FLAG_COMMON && (current_flags & FLAG_STALE) == 0 {
                // Potential merge base
                if let Some(flags_mut) = flags_map.get_mut(&item.oid) {
                    *flags_mut |= FLAG_RESULT | FLAG_STALE;
                    candidate_bases.push(item.oid);
                    min_common_ccd = Some(
                        min_common_ccd.map_or(item.gen, |current_min| current_min.min(item.gen)),
                    );
                }
            }

            if let Some((_, parents)) = get_node(&item.oid) {
                let parent_flags_to_propagate = if (current_flags & FLAG_COMMON) == FLAG_COMMON {
                    current_flags | FLAG_STALE
                } else {
                    current_flags
                };

                for parent in parents {
                    let entry = flags_map.entry(parent).or_insert(0);
                    let old_flags = *entry;
                    let new_flags = old_flags | parent_flags_to_propagate;

                    if new_flags != old_flags {
                        *entry = new_flags;
                        if let Some((p_ccd, _)) = get_node(&parent) {
                            queue.push(QueueItem {
                                gen: p_ccd.0,
                                oid: parent,
                            });
                        }
                    }
                }
            }
        }

        if candidate_bases.len() <= 1 {
            return candidate_bases;
        }

        // Post-filter: eliminate any candidate that is an ancestor of another candidate
        let mut final_bases = Vec::new();
        for (i, cand) in candidate_bases.iter().enumerate() {
            let cand_ccd = get_node(cand)
                .map(|(commit_date, _)| commit_date)
                .unwrap_or(CorrectedCommitDate(0));
            let mut is_redundant = false;

            for (j, other) in candidate_bases.iter().enumerate() {
                if i != j {
                    let other_ccd = get_node(other)
                        .map(|(commit_date, _)| commit_date)
                        .unwrap_or(CorrectedCommitDate(0));
                    if DagWalker::is_ancestor_with_ccd(
                        cand,
                        other,
                        cand_ccd,
                        other_ccd,
                        &mut get_node,
                    ) {
                        is_redundant = true;
                        break;
                    }
                }
            }

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
}
