//! Module: fg-algorithms::traverse::corrected_date_index — Corrected Commit Date Index
//! File Path: crates/fg-algorithms/src/traverse/corrected_date_index.rs
//! Architecture Role: Materialises the Corrected Commit Date (CCD v2) recurrence for a commit DAG
//!   and answers reachability / merge-base queries from it, so callers never have to supply cutoff
//!   values themselves.
//! Dependencies & Triggers: Consumed by the Taxis CLI commands that resolve ancestry — `merge`,
//!   `rebase`, `branch`, `lineage`.
//! Responsibilities: Topological ordering of the reachable commit set, the monotone CCD recurrence,
//!   parent lookup, and the two query entry points the CLI needs.
//! Exit Semantics & Design Rationale:
//!   The cutoff used by `is_ancestor_with_ccd` is only sound when it satisfies
//!   `CCD(u) < CCD(v)` for every proper ancestor `u` of `v`. A raw committer timestamp does not
//!   satisfy that: Git stores time at one-second granularity, so a parent and child written in the
//!   same second carry the same value, and a clock correction can make a child look older than its
//!   parent. Both cases make the O(1) negative fast path veto a true ancestor.
//!   Because that invariant is easy to break at a call site and impossible to notice when it
//!   breaks, this module does not accept pre-computed dates at all: it derives them from the graph
//!   it is given and keeps the derivation next to the ordering it depends on. A caller therefore
//!   cannot pass the wrong number, because there is no number to pass.
//!
//!   The build is iterative, not recursive: a hand-edited or hostile repository can present a chain
//!   deeper than the thread stack, and a deep history must degrade into an error rather than a
//!   stack overflow. A cycle is rejected for the same reason a missing parent is — the recurrence
//!   has no fixpoint on a cycle, so any value produced there would be a guess.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-ALG-001`: DAG traversal and generation pruning
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocation on hot paths

use std::collections::HashMap;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{CorrectedCommitDate, FastOidMap, FastOidSet, Oid};

use super::dag_walk::{DagWalker, SmallParentList};

/// Upper bound on distinct commits materialised in one index.
///
/// Mirrors the walk cap in the CLI layer: a traversal this large indicates either a pathological
/// repository or a corrupted parent chain, and continuing would exhaust memory before it finished.
pub const MAX_INDEXED_COMMITS: usize = 2_000_000;

/// One commit's contribution to the recurrence.
#[derive(Debug, Clone)]
struct CcdNode {
    /// Corrected date satisfying the strict monotone invariant.
    ccd: CorrectedCommitDate,
    /// Parents, inline for the overwhelmingly common one- and two-parent case.
    parents: SmallParentList,
}

/// Materialised CCD v2 index over one commit DAG.
#[derive(Debug, Clone, Default)]
pub struct CcdIndex {
    nodes: FastOidMap<CcdNode>,
}

impl CcdIndex {
    /// Builds the index from an arbitrary parent table.
    ///
    /// `parents_of` returns the parents of a commit paired with its raw committer timestamp, or
    /// `None` when the commit must be treated as absent. A parent named but not returned by
    /// `parents_of` is an error: silently treating it as a root would make every commit beyond the
    /// gap look like it had no history.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] for a cycle, a missing parent, or a graph larger than
    /// [`MAX_INDEXED_COMMITS`].
    pub fn build<F, I>(tips: I, mut parents_of: F) -> FractalResult<Self>
    where
        F: FnMut(&Oid) -> Option<(&'static [Oid], u64)>,
        I: IntoIterator<Item = Oid>,
    {
        let tips: Vec<Oid> = tips.into_iter().collect();
        let order = topological_order(&tips, &mut parents_of)?;
        let mut nodes: FastOidMap<CcdNode> = FastOidMap::default();

        // Children follow parents in `order`, so one forward pass is enough.
        for oid in order {
            let Some((parent_oids, timestamp)) = parents_of(&oid) else {
                return Err(FractalError::CorruptStore(format!(
                    "commit {} disappeared while building the CCD index",
                    oid.to_hex()
                )));
            };
            let max_parent_ccd = parent_oids
                .iter()
                .filter_map(|parent| nodes.get(parent).map(|node| node.ccd))
                .max();
            let ccd = CorrectedCommitDate::compute(timestamp, max_parent_ccd);
            nodes.insert(
                oid,
                CcdNode {
                    ccd,
                    parents: SmallParentList::from_slice(parent_oids),
                },
            );
        }

        Ok(Self { nodes })
    }

    /// Builds the index from a parent table already held in memory.
    ///
    /// Provided for callers that have parsed a commit set once and would rather not re-read it;
    /// the invariant is identical to [`Self::build`] because the same recurrence runs.
    ///
    /// # Errors
    ///
    /// Same conditions as [`Self::build`].
    pub fn from_table(table: &HashMap<Oid, (Vec<Oid>, u64)>, tips: &[Oid]) -> FractalResult<Self> {
        let mut nodes: FastOidMap<CcdNode> = FastOidMap::default();
        let order = topological_order_from_table(table, tips)?;

        for oid in order {
            let Some((parent_oids, timestamp)) = table.get(&oid) else {
                return Err(FractalError::CorruptStore(format!(
                    "commit {} is not present in the parent table",
                    oid.to_hex()
                )));
            };
            let max_parent_ccd = parent_oids
                .iter()
                .filter_map(|parent| nodes.get(parent).map(|node| node.ccd))
                .max();
            let ccd = CorrectedCommitDate::compute(*timestamp, max_parent_ccd);
            nodes.insert(
                oid,
                CcdNode {
                    ccd,
                    parents: SmallParentList::from_slice(parent_oids),
                },
            );
        }

        Ok(Self { nodes })
    }

    /// Number of commits materialised.
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// Whether the index covers no commits.
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Whether `oid` is covered by this index.
    pub fn contains(&self, oid: &Oid) -> bool {
        self.nodes.contains_key(oid)
    }

    /// Corrected date of `oid`, when present.
    pub fn corrected_date(&self, oid: &Oid) -> Option<CorrectedCommitDate> {
        self.nodes.get(oid).map(|node| node.ccd)
    }

    /// Parents of `oid`, when present.
    pub fn parents(&self, oid: &Oid) -> Option<&SmallParentList> {
        self.nodes.get(oid).map(|node| &node.parents)
    }

    /// Whether `ancestor` is reachable from `descendant`.
    ///
    /// A commit outside the index is treated as unreachable rather than assumed absent from the
    /// repository: the index was built from a specific tip set, and claiming ancestry for a commit
    /// it never visited would be a fabrication.
    pub fn is_ancestor(&self, ancestor: &Oid, descendant: &Oid) -> bool {
        let Some(descendant_node) = self.nodes.get(descendant) else {
            return ancestor == descendant;
        };
        let Some(ancestor_node) = self.nodes.get(ancestor) else {
            return ancestor == descendant;
        };
        if ancestor == descendant {
            return true;
        }
        if !ancestor_node.ccd.can_be_ancestor_of(&descendant_node.ccd) {
            return false;
        }
        let mut get_node = |oid: &Oid| -> Option<(CorrectedCommitDate, SmallParentList)> {
            self.nodes
                .get(oid)
                .map(|node| (node.ccd, node.parents.clone()))
        };
        DagWalker::is_ancestor_with_ccd_small(
            ancestor,
            descendant,
            ancestor_node.ccd,
            descendant_node.ccd,
            &mut get_node,
        )
    }

    /// Minimal common ancestors of `a` and `b`.
    ///
    /// Returns every minimal base, because a criss-cross history has several and collapsing them
    /// to one removes a branch from the virtual base tree. Returns an empty vector when the two
    /// commits share no history within the indexed set.
    pub fn merge_bases(&self, a: &Oid, b: &Oid) -> Vec<Oid> {
        if !self.contains(a) || !self.contains(b) {
            return Vec::new();
        }
        let mut get_node = |oid: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
            self.nodes.get(oid).map(|node| {
                let parents = node.parents.as_slice().to_vec();
                (node.ccd, parents)
            })
        };
        DagWalker::find_merge_bases_with_ccd(a, b, &mut get_node)
    }
}

/// Produces a parents-before-children ordering of every commit reachable from `tips`.
fn topological_order<F>(tips: &[Oid], parents_of: &mut F) -> FractalResult<Vec<Oid>>
where
    F: FnMut(&Oid) -> Option<(&'static [Oid], u64)>,
{
    let mut children: FastOidMap<Vec<Oid>> = FastOidMap::default();
    let mut pending_parents: FastOidMap<usize> = FastOidMap::default();
    let mut discovered: FastOidSet = FastOidSet::default();
    let mut stack: Vec<Oid> = tips.to_vec();

    while let Some(oid) = stack.pop() {
        if !discovered.insert(oid) {
            continue;
        }
        if discovered.len() > MAX_INDEXED_COMMITS {
            return Err(FractalError::CorruptStore(format!(
                "commit graph exceeds {MAX_INDEXED_COMMITS} commits"
            )));
        }
        let Some((parent_oids, _)) = parents_of(&oid) else {
            return Err(FractalError::CorruptStore(format!(
                "commit {} named as a parent is not readable",
                oid.to_hex()
            )));
        };
        pending_parents.insert(oid, parent_oids.len());
        for parent in parent_oids {
            children.entry(*parent).or_default().push(oid);
            stack.push(*parent);
        }
    }

    // Every discovered commit had its readable parent list recorded, so a parent outside the set
    // can only mean the table is inconsistent.
    for parent in children.keys() {
        if !discovered.contains(parent) {
            return Err(FractalError::CorruptStore(format!(
                "commit {} is reachable but absent from the traversal",
                parent.to_hex()
            )));
        }
    }

    let mut ready: Vec<Oid> = discovered
        .iter()
        .copied()
        .filter(|oid| pending_parents.get(oid).copied().unwrap_or(0) == 0)
        .collect();
    let mut order: Vec<Oid> = Vec::with_capacity(discovered.len());

    while let Some(oid) = ready.pop() {
        order.push(oid);
        for child in children.get(&oid).cloned().unwrap_or_default() {
            if let Some(count) = pending_parents.get_mut(&child) {
                *count -= 1;
                if *count == 0 {
                    ready.push(child);
                }
            }
        }
    }

    if order.len() != discovered.len() {
        return Err(FractalError::CorruptStore(
            "commit graph contains a cycle; corrected commit dates are undefined on it".to_string(),
        ));
    }
    Ok(order)
}

/// Ordering over an in-memory table, sharing the cycle and completeness checks.
fn topological_order_from_table(
    table: &HashMap<Oid, (Vec<Oid>, u64)>,
    tips: &[Oid],
) -> FractalResult<Vec<Oid>> {
    let mut children: FastOidMap<Vec<Oid>> = FastOidMap::default();
    let mut pending_parents: FastOidMap<usize> = FastOidMap::default();
    let mut discovered: FastOidSet = FastOidSet::default();
    let mut stack: Vec<Oid> = tips.to_vec();

    while let Some(oid) = stack.pop() {
        if !discovered.insert(oid) {
            continue;
        }
        if discovered.len() > MAX_INDEXED_COMMITS {
            return Err(FractalError::CorruptStore(format!(
                "commit graph exceeds {MAX_INDEXED_COMMITS} commits"
            )));
        }
        let Some((parent_oids, _)) = table.get(&oid) else {
            return Err(FractalError::CorruptStore(format!(
                "commit {} is not present in the parent table",
                oid.to_hex()
            )));
        };
        pending_parents.insert(oid, parent_oids.len());
        for parent in parent_oids {
            children.entry(*parent).or_default().push(oid);
            stack.push(*parent);
        }
    }

    let mut ready: Vec<Oid> = discovered
        .iter()
        .copied()
        .filter(|oid| pending_parents.get(oid).copied().unwrap_or(0) == 0)
        .collect();
    let mut order: Vec<Oid> = Vec::with_capacity(discovered.len());

    while let Some(oid) = ready.pop() {
        order.push(oid);
        for child in children.get(&oid).cloned().unwrap_or_default() {
            if let Some(count) = pending_parents.get_mut(&child) {
                *count -= 1;
                if *count == 0 {
                    ready.push(child);
                }
            }
        }
    }

    if order.len() != discovered.len() {
        return Err(FractalError::CorruptStore(
            "commit graph contains a cycle; corrected commit dates are undefined on it".to_string(),
        ));
    }
    Ok(order)
}
