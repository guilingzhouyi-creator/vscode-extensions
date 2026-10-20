//! Module: fg-algorithms — Canonical Hierarchical Tree Diff Operator
//! File Path: crates/fg-algorithms/src/diff/tree_diff.rs
//! Architecture Role: Pure diff algorithm comparing Git tree objects with $O(1)$ subtree
//!   short-circuiting, reusable scratch state buffers (TreeDiffState), and zero heap
//!   allocation on identical subtrees.
//! Dependencies & Triggers: Consumed by PreReceiveGuard, ConflictGuard, and Taxis engine.
//! Responsibilities: Detects additions, deletions, modifications, and mode changes across
//!   directory hierarchies.
//! Exit Semantics & Design Rationale: Bypasses flat map traversal via two-pointer pre-sorted
//!   stream. Identical tree hashes terminate recursive descent in $O(1)$ time, guaranteeing
//!   microsecond latency on massive trees.

use fg_core::models::Oid;
use fg_object::{FileMode, GitTree};
use std::collections::BTreeMap;

/// Type of change detected for a path in a tree diff.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    Added,
    Deleted,
    Modified,
}

/// A single diff entry for a specific path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffEntry {
    pub path: String,
    pub kind: ChangeKind,
    pub old_oid: Option<Oid>,
    pub new_oid: Option<Oid>,
}

/// Reusable allocation cache for tree diff traversal, preventing heap reallocation.
#[derive(Debug, Default)]
pub struct TreeDiffState {
    path_stack: String,
    pub changes: Vec<DiffEntry>,
}

impl TreeDiffState {
    pub fn new() -> Self {
        Self {
            path_stack: String::with_capacity(256),
            changes: Vec::with_capacity(64),
        }
    }

    pub fn clear(&mut self) {
        self.path_stack.clear();
        self.changes.clear();
    }

    pub fn take_changes(&mut self) -> Vec<DiffEntry> {
        self.path_stack.clear();
        let cap = self.changes.capacity().max(64);
        std::mem::replace(&mut self.changes, Vec::with_capacity(cap))
    }
}

/// In-memory tree difference calculator.
pub struct TreeDiff;

impl TreeDiff {
    /// Compares two path-to-Oid maps (legacy backward-compatible flat map mode).
    pub fn compare(
        old_tree: &BTreeMap<String, Oid>,
        new_tree: &BTreeMap<String, Oid>,
    ) -> Vec<DiffEntry> {
        let mut changes = Vec::new();
        let mut old_iter = old_tree.iter().peekable();
        let mut new_iter = new_tree.iter().peekable();

        while let (Some(&(old_path, old_oid)), Some(&(new_path, new_oid))) =
            (old_iter.peek(), new_iter.peek())
        {
            match old_path.cmp(new_path) {
                std::cmp::Ordering::Less => {
                    changes.push(DiffEntry {
                        path: old_path.clone(),
                        kind: ChangeKind::Deleted,
                        old_oid: Some(*old_oid),
                        new_oid: None,
                    });
                    old_iter.next();
                }
                std::cmp::Ordering::Greater => {
                    changes.push(DiffEntry {
                        path: new_path.clone(),
                        kind: ChangeKind::Added,
                        old_oid: None,
                        new_oid: Some(*new_oid),
                    });
                    new_iter.next();
                }
                std::cmp::Ordering::Equal => {
                    if old_oid != new_oid {
                        changes.push(DiffEntry {
                            path: old_path.clone(),
                            kind: ChangeKind::Modified,
                            old_oid: Some(*old_oid),
                            new_oid: Some(*new_oid),
                        });
                    }
                    old_iter.next();
                    new_iter.next();
                }
            }
        }

        for (old_path, old_oid) in old_iter {
            changes.push(DiffEntry {
                path: old_path.clone(),
                kind: ChangeKind::Deleted,
                old_oid: Some(*old_oid),
                new_oid: None,
            });
        }
        for (new_path, new_oid) in new_iter {
            changes.push(DiffEntry {
                path: new_path.clone(),
                kind: ChangeKind::Added,
                old_oid: None,
                new_oid: Some(*new_oid),
            });
        }

        changes
    }

    fn process_matching_entry<F>(
        old_entry: &fg_object::GitTreeEntry,
        new_entry: &fg_object::GitTreeEntry,
        lookup_tree: &mut F,
        state: &mut TreeDiffState,
    ) where
        F: FnMut(&Oid) -> Option<GitTree>,
    {
        if old_entry.oid == new_entry.oid && old_entry.mode == new_entry.mode {
            return;
        }

        let prev_len = state.path_stack.len();
        Self::push_path_component(&mut state.path_stack, &old_entry.name);

        if old_entry.mode == FileMode::Directory && new_entry.mode == FileMode::Directory {
            let sub_old = lookup_tree(&old_entry.oid);
            let sub_new = lookup_tree(&new_entry.oid);
            Self::compare_canonical_trees(sub_old.as_ref(), sub_new.as_ref(), lookup_tree, state);
        } else {
            state.changes.push(DiffEntry {
                path: state.path_stack.clone(),
                kind: ChangeKind::Modified,
                old_oid: Some(old_entry.oid),
                new_oid: Some(new_entry.oid),
            });
        }

        state.path_stack.truncate(prev_len);
    }

    fn handle_entry_pair<F>(
        old_entry: &fg_object::GitTreeEntry,
        new_entry: &fg_object::GitTreeEntry,
        lookup_tree: &mut F,
        state: &mut TreeDiffState,
    ) -> (usize, usize)
    where
        F: FnMut(&Oid) -> Option<GitTree>,
    {
        match old_entry.name.cmp(&new_entry.name) {
            std::cmp::Ordering::Equal => {
                Self::process_matching_entry(old_entry, new_entry, lookup_tree, state);
                (1, 1)
            }
            std::cmp::Ordering::Less => {
                Self::emit_deleted_subtree(old_entry, lookup_tree, state);
                (1, 0)
            }
            std::cmp::Ordering::Greater => {
                Self::emit_added_subtree(new_entry, lookup_tree, state);
                (0, 1)
            }
        }
    }

    /// High-performance hierarchical canonical tree diff with $O(1)$ subtree short-circuiting.
    /// Walks pre-sorted canonical tree entry slices in a single two-pointer merge pass.
    pub fn compare_canonical_trees<F>(
        old_tree: Option<&GitTree>,
        new_tree: Option<&GitTree>,
        lookup_tree: &mut F,
        state: &mut TreeDiffState,
    ) where
        F: FnMut(&Oid) -> Option<GitTree>,
    {
        // 1. O(1) Short-Circuit: Identical Subtree Hash
        if let (Some(old_tree_ref), Some(new_tree_ref)) = (old_tree, new_tree) {
            if old_tree_ref.raw_oid() == new_tree_ref.raw_oid() {
                return;
            }
        }

        let old_entries = old_tree.map(|tree| tree.entries()).unwrap_or(&[]);
        let new_entries = new_tree.map(|tree| tree.entries()).unwrap_or(&[]);

        let mut old_index = 0;
        let mut new_index = 0;

        while old_index < old_entries.len() || new_index < new_entries.len() {
            let old_item = old_entries.get(old_index);
            let new_item = new_entries.get(new_index);

            match (old_item, new_item) {
                (Some(old_entry), Some(new_entry)) => {
                    let (delta_old, delta_new) =
                        Self::handle_entry_pair(old_entry, new_entry, lookup_tree, state);
                    old_index += delta_old;
                    new_index += delta_new;
                }
                (Some(old_entry), None) => {
                    Self::emit_deleted_subtree(old_entry, lookup_tree, state);
                    old_index += 1;
                }
                (None, Some(new_entry)) => {
                    Self::emit_added_subtree(new_entry, lookup_tree, state);
                    new_index += 1;
                }
                (None, None) => break,
            }
        }
    }

    fn push_path_component(stack: &mut String, component: &str) {
        if !stack.is_empty() {
            stack.push('/');
        }
        stack.push_str(component);
    }

    fn emit_added_subtree<F>(
        entry: &fg_object::GitTreeEntry,
        lookup_tree: &mut F,
        state: &mut TreeDiffState,
    ) where
        F: FnMut(&Oid) -> Option<GitTree>,
    {
        let prev_len = state.path_stack.len();
        Self::push_path_component(&mut state.path_stack, &entry.name);

        if entry.mode == FileMode::Directory {
            if let Some(sub_tree) = lookup_tree(&entry.oid) {
                Self::compare_canonical_trees(None, Some(&sub_tree), lookup_tree, state);
            }
        } else {
            state.changes.push(DiffEntry {
                path: state.path_stack.clone(),
                kind: ChangeKind::Added,
                old_oid: None,
                new_oid: Some(entry.oid),
            });
        }

        state.path_stack.truncate(prev_len);
    }

    fn emit_deleted_subtree<F>(
        entry: &fg_object::GitTreeEntry,
        lookup_tree: &mut F,
        state: &mut TreeDiffState,
    ) where
        F: FnMut(&Oid) -> Option<GitTree>,
    {
        let prev_len = state.path_stack.len();
        Self::push_path_component(&mut state.path_stack, &entry.name);

        if entry.mode == FileMode::Directory {
            if let Some(sub_tree) = lookup_tree(&entry.oid) {
                Self::compare_canonical_trees(Some(&sub_tree), None, lookup_tree, state);
            }
        } else {
            state.changes.push(DiffEntry {
                path: state.path_stack.clone(),
                kind: ChangeKind::Deleted,
                old_oid: Some(entry.oid),
                new_oid: None,
            });
        }

        state.path_stack.truncate(prev_len);
    }
}
