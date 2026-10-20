//! Module: fg-algorithms — Three-Way Merge Engine
//! File Path: crates/fg-algorithms/src/merge/three_way.rs
//! Architecture Role: Pure algorithmic three-way tree merge operator (Base, Ours, Theirs)
//!   with fast-forward detection, clean 3-way reconciliation, hierarchical
//!   subtree short-circuiting, and conflicting path isolation.
//! Dependencies & Triggers: Consumed by PreReceiveGuard, ConflictGuard, and Taxis engine
//!   merge commands.
//! Responsibilities: Evaluates 3-way differences and short-circuits unchanged subtrees
//!   in O(1) time.
//! Exit Semantics & Design Rationale:
//!   - evaluate_tree_fast_paths allows skipping massive unchanged directory trees in O(1)
//!     time without recursive descent.
//!   - Deterministic ConflictEntry reporting prevents silent data loss during divergent
//!     parallel edits.

use fg_core::models::Oid;
use fg_object::{FileMode, GitTree, GitTreeEntry};
use std::collections::BTreeMap;

/// Fast-path resolution for canonical tree OIDs during three-way merge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FastPathMerge {
    /// Both branches are identical to base; no modifications.
    BothUnchanged,
    /// Unchanged in ours, modified or added in theirs; take theirs directly.
    TakeTheirs,
    /// Unchanged in theirs, modified or added in ours, or identical in both; take ours directly.
    TakeOurs,
}

/// A conflicting entry identified during three-way merge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictEntry {
    pub path: String,
    pub base_oid: Option<Oid>,
    pub ours_oid: Option<Oid>,
    pub theirs_oid: Option<Oid>,
}

/// Result of a three-way tree merge evaluation on flat string maps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreeWayMergeResult {
    /// Fast-forward merge: target tree can be directly pointed to source tree.
    FastForward,
    /// Clean merge: all changes reconciled without any conflicts.
    Clean { merged_tree: BTreeMap<String, Oid> },
    /// Conflicted merge: some paths merged cleanly, but conflicts require resolution.
    Conflicted {
        merged_tree: BTreeMap<String, Oid>,
        conflicts: Vec<ConflictEntry>,
    },
}

/// A conflicting entry identified during canonical hierarchical three-way tree merge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalConflictEntry {
    pub path: String,
    pub mode_base: Option<FileMode>,
    pub oid_base: Option<Oid>,
    pub mode_ours: Option<FileMode>,
    pub oid_ours: Option<Oid>,
    pub mode_theirs: Option<FileMode>,
    pub oid_theirs: Option<Oid>,
}

/// Result of a canonical 3-way tree merge operation on hierarchical GitTree structures (merge-ort).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanonicalMergeResult {
    /// Fast-forward merge: target tree can be pointed directly to the returned Oid.
    FastForward(Oid),
    /// Clean merge: a new GitTree was synthesized without any conflicts.
    Clean(GitTree),
    /// Conflicted merge: reconciled partial tree with conflicting path entries.
    Conflicted {
        partial_tree: Option<GitTree>,
        conflicts: Vec<CanonicalConflictEntry>,
    },
}

/// Three-way merge algorithm operator.
pub struct ThreeWayMerge;

impl ThreeWayMerge {
    /// Evaluates O(1) subtree fast-paths across Base, Ours, and Theirs OIDs.
    /// If a fast path applies, callers can skip recursively inspecting any
    /// child entries in the subtree.
    pub fn evaluate_tree_fast_paths(
        base_oid: &Oid,
        ours_oid: &Oid,
        theirs_oid: &Oid,
    ) -> Option<FastPathMerge> {
        if ours_oid == base_oid && theirs_oid == base_oid {
            return Some(FastPathMerge::BothUnchanged);
        }
        if ours_oid == base_oid {
            return Some(FastPathMerge::TakeTheirs);
        }
        if theirs_oid == base_oid || ours_oid == theirs_oid {
            return Some(FastPathMerge::TakeOurs);
        }
        None
    }

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

        // High-performance 3-way zipper: zero BTreeSet intermediate allocation, O(N) single pass
        let mut base_iter = base.iter().peekable();
        let mut ours_iter = ours.iter().peekable();
        let mut theirs_iter = theirs.iter().peekable();

        while base_iter.peek().is_some()
            || ours_iter.peek().is_some()
            || theirs_iter.peek().is_some()
        {
            let next_path: &String = match [
                base_iter.peek().map(|(path_key, _)| *path_key),
                ours_iter.peek().map(|(path_key, _)| *path_key),
                theirs_iter.peek().map(|(path_key, _)| *path_key),
            ]
            .into_iter()
            .flatten()
            .min() {
                Some(active_path) => active_path,
                None => break,
            };

            let base_oid = if base_iter.peek().map(|(path_key, _)| *path_key) == Some(next_path) {
                base_iter.next().map(|(_, entry_oid)| entry_oid)
            } else {
                None
            };

            let ours_oid = if ours_iter.peek().map(|(path_key, _)| *path_key) == Some(next_path) {
                ours_iter.next().map(|(_, entry_oid)| entry_oid)
            } else {
                None
            };

            let theirs_oid =
                if theirs_iter.peek().map(|(path_key, _)| *path_key) == Some(next_path) {
                    theirs_iter.next().map(|(_, entry_oid)| entry_oid)
                } else {
                    None
                };

            match (base_oid, ours_oid, theirs_oid) {
                // Case 1: Identical in both branches
                (_, Some(&o_oid), Some(&t_oid)) if o_oid == t_oid => {
                    merged.insert(next_path.clone(), o_oid);
                }
                // Case 2: Unchanged in ours, changed or added in theirs
                (base_val, ours_val, Some(&t_oid)) if ours_val == base_val => {
                    merged.insert(next_path.clone(), t_oid);
                }
                // Case 3: Unchanged in theirs, changed or added in ours
                (base_val, Some(&o_oid), theirs_val) if theirs_val == base_val => {
                    merged.insert(next_path.clone(), o_oid);
                }
                // Case 4: Deleted in theirs, unchanged in ours
                (Some(_), Some(_), None) if ours_oid == base_oid => {
                    // Cleanly deleted
                }
                // Case 5: Deleted in ours, unchanged in theirs
                (Some(_), None, Some(_)) if theirs_oid == base_oid => {
                    // Cleanly deleted
                }
                // Case 6: Concurrent conflicting change or delete-modify conflict
                _ => {
                    conflicts.push(ConflictEntry {
                        path: next_path.clone(),
                        base_oid: base_oid.copied(),
                        ours_oid: ours_oid.copied(),
                        theirs_oid: theirs_oid.copied(),
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

    /// Synthesizes an in-memory virtual merge base tree from multiple common ancestors.
    /// In criss-cross branch histories where two branches diverge from multiple common ancestors,
    /// this merges ancestor trees in memory (following Git's merge-ort virtual base strategy).
    /// If an optional root base (`ancestor_base`) is provided, clean 3-way reconciliation occurs;
    /// otherwise, disjoint and non-conflicting entries are consolidated.
    pub fn synthesize_virtual_base(
        ancestor_base: Option<&BTreeMap<String, Oid>>,
        bases: &[&BTreeMap<String, Oid>],
    ) -> BTreeMap<String, Oid> {
        super::virtual_base::VirtualMergeBaseSynthesizer::synthesize_virtual_base(
            ancestor_base,
            bases,
        )
    }

    /// Evaluates a 3-way tree merge with multiple common ancestors, synthesizing
    /// an in-memory virtual base tree.
    pub fn merge_with_virtual_bases(
        ancestor_base: Option<&BTreeMap<String, Oid>>,
        bases: &[&BTreeMap<String, Oid>],
        ours: &BTreeMap<String, Oid>,
        theirs: &BTreeMap<String, Oid>,
    ) -> ThreeWayMergeResult {
        super::virtual_base::VirtualMergeBaseSynthesizer::merge_with_virtual_bases(
            ancestor_base,
            bases,
            ours,
            theirs,
        )
    }

    /// Canonical 3-way hierarchical tree merge conforming to Git's merge-ort architecture.
    ///
    /// Operates directly on sorted GitTree slices with a 3-way zipper.
    /// - Fast-paths: skips identical subtrees in O(1) time without tree expansion.
    /// - Zero BTreeMap allocation: merges into a pre-allocated Vec<GitTreeEntry>.
    /// - Recursively descends into modified subdirectories, or records conflicts if mode differs.
    pub fn merge_canonical_trees<F>(
        base: Option<&GitTree>,
        ours: Option<&GitTree>,
        theirs: Option<&GitTree>,
        lookup_tree: &mut F,
    ) -> CanonicalMergeResult
    where
        F: FnMut(&Oid) -> Option<GitTree>,
    {
        let base_oid = base.map(|tree| *tree.raw_oid()).unwrap_or(Oid::ZERO);
        let ours_oid = ours.map(|tree| *tree.raw_oid()).unwrap_or(Oid::ZERO);
        let theirs_oid = theirs.map(|tree| *tree.raw_oid()).unwrap_or(Oid::ZERO);

        // O(1) Fast-Path evaluation
        if let Some(fast_path) = Self::evaluate_tree_fast_paths(&base_oid, &ours_oid, &theirs_oid) {
            match fast_path {
                FastPathMerge::BothUnchanged | FastPathMerge::TakeOurs => {
                    return match ours {
                        Some(tree) => CanonicalMergeResult::Clean(tree.clone()),
                        None => CanonicalMergeResult::Clean(GitTree::new(Vec::new())),
                    };
                }
                FastPathMerge::TakeTheirs => {
                    return CanonicalMergeResult::FastForward(theirs_oid);
                }
            }
        }

        let mut merged_entries = Vec::new();
        let mut conflicts = Vec::new();
        let mut context = CanonicalMergeContext {
            lookup_tree,
            out_conflicts: &mut conflicts,
        };

        context.merge_canonical_recursive("", base, ours, theirs, &mut merged_entries);

        if conflicts.is_empty() {
            CanonicalMergeResult::Clean(GitTree::new(merged_entries))
        } else {
            let partial = if merged_entries.is_empty() {
                None
            } else {
                Some(GitTree::new(merged_entries))
            };
            CanonicalMergeResult::Conflicted {
                partial_tree: partial,
                conflicts,
            }
        }
    }
}

/// Helper context holding state for hierarchical canonical merge traversal.
struct CanonicalMergeContext<'a, F> {
    lookup_tree: &'a mut F,
    out_conflicts: &'a mut Vec<CanonicalConflictEntry>,
}

impl<'a, F> CanonicalMergeContext<'a, F>
where
    F: FnMut(&Oid) -> Option<GitTree>,
{
    fn merge_canonical_recursive(
        &mut self,
        prefix: &str,
        base: Option<&GitTree>,
        ours: Option<&GitTree>,
        theirs: Option<&GitTree>,
        out_entries: &mut Vec<GitTreeEntry>,
    ) {
        let empty_entries = [];
        let base_entries = base.map(|tree| tree.entries()).unwrap_or(&empty_entries);
        let ours_entries = ours.map(|tree| tree.entries()).unwrap_or(&empty_entries);
        let theirs_entries = theirs.map(|tree| tree.entries()).unwrap_or(&empty_entries);

        let mut base_index = 0;
        let mut ours_index = 0;
        let mut theirs_index = 0;

        while base_index < base_entries.len()
            || ours_index < ours_entries.len()
            || theirs_index < theirs_entries.len()
        {
            let mut min_name = "";
            if base_index < base_entries.len() {
                min_name = &base_entries[base_index].name;
            }
            if ours_index < ours_entries.len()
                && (min_name.is_empty() || ours_entries[ours_index].name.as_str() < min_name)
            {
                min_name = &ours_entries[ours_index].name;
            }
            if theirs_index < theirs_entries.len()
                && (min_name.is_empty() || theirs_entries[theirs_index].name.as_str() < min_name)
            {
                min_name = &theirs_entries[theirs_index].name;
            }

            let base_entry =
                if base_index < base_entries.len() && base_entries[base_index].name == min_name {
                    let entry = &base_entries[base_index];
                    base_index += 1;
                    Some(entry)
                } else {
                    None
                };

            let ours_entry =
                if ours_index < ours_entries.len() && ours_entries[ours_index].name == min_name {
                    let entry = &ours_entries[ours_index];
                    ours_index += 1;
                    Some(entry)
                } else {
                    None
                };

            let theirs_entry = if theirs_index < theirs_entries.len()
                && theirs_entries[theirs_index].name == min_name
            {
                let entry = &theirs_entries[theirs_index];
                theirs_index += 1;
                Some(entry)
            } else {
                None
            };

            match (base_entry, ours_entry, theirs_entry) {
                (_, Some(ours_item), Some(theirs_item))
                    if ours_item.oid == theirs_item.oid && ours_item.mode == theirs_item.mode =>
                {
                    out_entries.push(ours_item.clone());
                }
                (base_item, ours_item, Some(theirs_item))
                    if Self::entries_match(ours_item, base_item) =>
                {
                    out_entries.push(theirs_item.clone());
                }
                (base_item, Some(ours_item), theirs_item)
                    if Self::entries_match(theirs_item, base_item) =>
                {
                    out_entries.push(ours_item.clone());
                }
                (Some(base_item), Some(ours_item), None)
                    if ours_item.oid == base_item.oid && ours_item.mode == base_item.mode => {}
                (Some(base_item), None, Some(theirs_item))
                    if theirs_item.oid == base_item.oid && theirs_item.mode == base_item.mode => {}
                (base_item, Some(ours_item), Some(theirs_item))
                    if ours_item.mode == FileMode::Directory
                        && theirs_item.mode == FileMode::Directory =>
                {
                    self.merge_subdirectory_entry(
                        prefix,
                        min_name,
                        base_item,
                        ours_item,
                        theirs_item,
                        out_entries,
                    );
                }
                _ => {
                    let conflict_path = if prefix.is_empty() {
                        min_name.to_string()
                    } else {
                        format!("{}/{}", prefix, min_name)
                    };
                    self.out_conflicts.push(CanonicalConflictEntry {
                        path: conflict_path,
                        mode_base: base_entry.map(|entry| entry.mode),
                        oid_base: base_entry.map(|entry| entry.oid),
                        mode_ours: ours_entry.map(|entry| entry.mode),
                        oid_ours: ours_entry.map(|entry| entry.oid),
                        mode_theirs: theirs_entry.map(|entry| entry.mode),
                        oid_theirs: theirs_entry.map(|entry| entry.oid),
                    });
                }
            }
        }
    }

    fn merge_subdirectory_entry(
        &mut self,
        prefix: &str,
        name: &str,
        base_entry: Option<&GitTreeEntry>,
        ours_entry: &GitTreeEntry,
        theirs_entry: &GitTreeEntry,
        out_entries: &mut Vec<GitTreeEntry>,
    ) {
        let sub_path = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{}/{}", prefix, name)
        };
        let sub_base = base_entry.and_then(|base_elem| (self.lookup_tree)(&base_elem.oid));
        let sub_ours = (self.lookup_tree)(&ours_entry.oid);
        let sub_theirs = (self.lookup_tree)(&theirs_entry.oid);

        let mut sub_entries = Vec::new();
        self.merge_canonical_recursive(
            &sub_path,
            sub_base.as_ref(),
            sub_ours.as_ref(),
            sub_theirs.as_ref(),
            &mut sub_entries,
        );
        let merged_sub_tree = GitTree::new(sub_entries);
        out_entries.push(GitTreeEntry::from_oid(
            FileMode::Directory,
            name,
            *merged_sub_tree.raw_oid(),
        ));
    }

    #[inline]
    fn entries_match(
        left_entry: Option<&GitTreeEntry>,
        right_entry: Option<&GitTreeEntry>,
    ) -> bool {
        match (left_entry, right_entry) {
            (None, None) => true,
            (Some(left), Some(right)) => left.oid == right.oid && left.mode == right.mode,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonical_tree_merge_clean_disjoint() {
        let base_entries = vec![GitTreeEntry::from_oid(
            FileMode::RegularFile,
            "common.rs",
            Oid::from_bytes([1u8; 20]),
        )];
        let ours_entries = vec![
            GitTreeEntry::from_oid(
                FileMode::RegularFile,
                "common.rs",
                Oid::from_bytes([1u8; 20]),
            ),
            GitTreeEntry::from_oid(FileMode::RegularFile, "ours.rs", Oid::from_bytes([2u8; 20])),
        ];
        let theirs_entries = vec![
            GitTreeEntry::from_oid(
                FileMode::RegularFile,
                "common.rs",
                Oid::from_bytes([1u8; 20]),
            ),
            GitTreeEntry::from_oid(
                FileMode::RegularFile,
                "theirs.rs",
                Oid::from_bytes([3u8; 20]),
            ),
        ];

        let base_tree = GitTree::new(base_entries);
        let ours_tree = GitTree::new(ours_entries);
        let theirs_tree = GitTree::new(theirs_entries);

        let mut lookup = |_oid: &Oid| -> Option<GitTree> { None };

        let result = ThreeWayMerge::merge_canonical_trees(
            Some(&base_tree),
            Some(&ours_tree),
            Some(&theirs_tree),
            &mut lookup,
        );

        if let CanonicalMergeResult::Clean(merged) = result {
            assert_eq!(merged.entries().len(), 3);
            assert_eq!(merged.entries()[0].name, "common.rs");
            assert_eq!(merged.entries()[1].name, "ours.rs");
            assert_eq!(merged.entries()[2].name, "theirs.rs");
        } else {
            panic!("Expected clean canonical merge");
        }
    }

    #[test]
    fn test_canonical_tree_merge_conflict() {
        let base_entries = vec![GitTreeEntry::from_oid(
            FileMode::RegularFile,
            "target.rs",
            Oid::from_bytes([1u8; 20]),
        )];
        let ours_entries = vec![GitTreeEntry::from_oid(
            FileMode::RegularFile,
            "target.rs",
            Oid::from_bytes([2u8; 20]),
        )];
        let theirs_entries = vec![GitTreeEntry::from_oid(
            FileMode::RegularFile,
            "target.rs",
            Oid::from_bytes([3u8; 20]),
        )];

        let base_tree = GitTree::new(base_entries);
        let ours_tree = GitTree::new(ours_entries);
        let theirs_tree = GitTree::new(theirs_entries);

        let mut lookup = |_oid: &Oid| -> Option<GitTree> { None };

        let result = ThreeWayMerge::merge_canonical_trees(
            Some(&base_tree),
            Some(&ours_tree),
            Some(&theirs_tree),
            &mut lookup,
        );

        if let CanonicalMergeResult::Conflicted { conflicts, .. } = result {
            assert_eq!(conflicts.len(), 1);
            assert_eq!(conflicts[0].path, "target.rs");
            assert_eq!(conflicts[0].oid_ours, Some(Oid::from_bytes([2u8; 20])));
            assert_eq!(conflicts[0].oid_theirs, Some(Oid::from_bytes([3u8; 20])));
        } else {
            panic!("Expected conflicted canonical merge");
        }
    }
}
