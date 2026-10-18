//! Module: fg-algorithms — Tree Diff Operator
//! File Path: crates/fg-algorithms/src/diff/tree_diff.rs
//! Architecture Role: Pure diff algorithm between two collections of path entries,
//!   identifying additions, deletions, and modifications with zero disk I/O.

use fg_core::models::Oid;
use std::collections::{BTreeMap, BTreeSet};

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

/// In-memory tree difference calculator.
pub struct TreeDiff;

impl TreeDiff {
    /// Compares two path-to-Oid maps and computes the deterministic list of changes.
    pub fn compare(
        old_tree: &BTreeMap<String, Oid>,
        new_tree: &BTreeMap<String, Oid>,
    ) -> Vec<DiffEntry> {
        let mut changes = Vec::new();

        // Collect all distinct paths
        let all_paths: BTreeSet<&String> = old_tree.keys().chain(new_tree.keys()).collect();

        for path in all_paths {
            let old_entry = old_tree.get(path);
            let new_entry = new_tree.get(path);

            match (old_entry, new_entry) {
                (None, Some(&new_oid)) => {
                    changes.push(DiffEntry {
                        path: path.clone(),
                        kind: ChangeKind::Added,
                        old_oid: None,
                        new_oid: Some(new_oid),
                    });
                }
                (Some(&old_oid), None) => {
                    changes.push(DiffEntry {
                        path: path.clone(),
                        kind: ChangeKind::Deleted,
                        old_oid: Some(old_oid),
                        new_oid: None,
                    });
                }
                (Some(&old_oid), Some(&new_oid)) => {
                    if old_oid != new_oid {
                        changes.push(DiffEntry {
                            path: path.clone(),
                            kind: ChangeKind::Modified,
                            old_oid: Some(old_oid),
                            new_oid: Some(new_oid),
                        });
                    }
                }
                (None, None) => {}
            }
        }

        changes
    }
}
