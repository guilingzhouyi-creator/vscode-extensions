//! Module: fg-algorithms — DAG Traversal & Topological Sort
//! File Path: crates/fg-algorithms/src/traverse/dag_walk.rs
//! Architecture Role: Graph algorithms for Git commit DAGs: ancestry testing, reachability,
//!   and topological sorting without external process invocation.

use fg_core::models::Oid;
use std::collections::{HashSet, VecDeque};

/// Traversal engine for directed acyclic graphs of Git commits.
pub struct DagWalker;

impl DagWalker {
    /// Determines whether `ancestor` is an ancestor of `descendant` given a parent lookup function.
    pub fn is_ancestor<F>(ancestor: &Oid, descendant: &Oid, mut get_parents: F) -> bool
    where
        F: FnMut(&Oid) -> Vec<Oid>,
    {
        if ancestor == descendant {
            return true;
        }

        let mut visited = HashSet::new();
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

    /// Performs breadth-first topological walk from start commit down to root.
    pub fn walk_ancestors<F>(start: &Oid, mut get_parents: F) -> Vec<Oid>
    where
        F: FnMut(&Oid) -> Vec<Oid>,
    {
        let mut order = Vec::new();
        let mut visited = HashSet::new();
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
}
