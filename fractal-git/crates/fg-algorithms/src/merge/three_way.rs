//! Module: fg-algorithms — Three-Way Merge Engine
//! File Path: crates/fg-algorithms/src/merge/three_way.rs
//! Architecture Role: Pure algorithmic three-way tree merge operator (Base, Ours, Theirs)
//!   with fast-forward detection, clean 3-way reconciliation, and conflicting path isolation.

use fg_core::models::Oid;
use std::collections::{BTreeMap, BTreeSet};

/// A conflicting entry identified during three-way merge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictEntry {
    pub path: String,
    pub base_oid: Option<Oid>,
    pub ours_oid: Option<Oid>,
    pub theirs_oid: Option<Oid>,
}

/// Result of a three-way tree merge evaluation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreeWayMergeResult {
    /// Fast-forward merge: target tree can be directly pointed to source tree.
    FastForward,
    /// Clean merge: all changes reconciled without any conflicts.
    Clean {
        merged_tree: BTreeMap<String, Oid>,
    },
    /// Conflicted merge: some paths merged cleanly, but conflicts require resolution.
    Conflicted {
        merged_tree: BTreeMap<String, Oid>,
        conflicts: Vec<ConflictEntry>,
    },
}

/// Three-way merge algorithm operator.
pub struct ThreeWayMerge;

impl ThreeWayMerge {
    /// Evaluates a 3-way tree merge between Base, Ours, and Theirs maps.
    pub fn merge(
        base: &BTreeMap<String, Oid>,
        ours: &BTreeMap<String, Oid>,
        theirs: &BTreeMap<String, Oid>,
    ) -> ThreeWayMergeResult {
        // Fast-forward check: if ours is identical to base, fast-forward to theirs
        if ours == base {
            return ThreeWayMergeResult::FastForward;
        }

        let mut merged = BTreeMap::new();
        let mut conflicts = Vec::new();

        // Collect all distinct paths across all three trees
        let all_paths: BTreeSet<&String> = base
            .keys()
            .chain(ours.keys())
            .chain(theirs.keys())
            .collect();

        for path in all_paths {
            let b = base.get(path);
            let o = ours.get(path);
            let t = theirs.get(path);

            match (b, o, t) {
                // Case 1: Identical in both branches
                (_, Some(&o_oid), Some(&t_oid)) if o_oid == t_oid => {
                    merged.insert(path.clone(), o_oid);
                }
                // Case 2: Unchanged in ours, changed or added in theirs
                (b_val, o_val, Some(&t_oid)) if o_val == b_val => {
                    merged.insert(path.clone(), t_oid);
                }
                // Case 3: Unchanged in theirs, changed or added in ours
                (b_val, Some(&o_oid), t_val) if t_val == b_val => {
                    merged.insert(path.clone(), o_oid);
                }
                // Case 4: Deleted in theirs, unchanged in ours
                (Some(_), Some(_), None) if o == b => {
                    // Cleanly deleted
                }
                // Case 5: Deleted in ours, unchanged in theirs
                (Some(_), None, Some(_)) if t == b => {
                    // Cleanly deleted
                }
                // Case 6: Concurrent conflicting change or delete-modify conflict
                _ => {
                    conflicts.push(ConflictEntry {
                        path: path.clone(),
                        base_oid: b.copied(),
                        ours_oid: o.copied(),
                        theirs_oid: t.copied(),
                    });
                }
            }
        }

        if conflicts.is_empty() {
            ThreeWayMergeResult::Clean {
                merged_tree: merged,
            }
        } else {
            ThreeWayMergeResult::Conflicted {
                merged_tree: merged,
                conflicts,
            }
        }
    }
}
