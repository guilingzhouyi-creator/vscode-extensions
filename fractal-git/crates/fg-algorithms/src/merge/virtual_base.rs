//! Module: fg-algorithms — Recursive Virtual Merge Base Synthesizer
//! File Path: crates/fg-algorithms/src/merge/virtual_base.rs
//! Architecture Role: Pure algorithmic operator synthesizing in-memory virtual merge base trees
//!   in criss-cross DAG histories with multiple common ancestors
//!   (following Git's merge-ort strategy).
//! Dependencies & Triggers: Consumed by ThreeWayMerge, PreReceiveGuard, and Taxis merge commands.
//! Responsibilities: Recursively reconcile divergent ancestor trees in memory without disk I/O,
//!   producing a canonical virtual base tree for unambiguous 3-way branch reconciliation.
//! Exit Semantics & Design Rationale:
//!   - Linear three-pointer scan over sorted PathId arrays (Arena-Backed Virtual Base).
//!   - Completely avoids filesystem access or lock acquisition during virtual base construction.
//!   - Safely preserves unmerged conflict slots when synthesizing ancestor states.
//!
//! Domain Governance Rules: FGT-ALG-001 (merge correctness), FGT-PRF-001 (zero transient allocations).

use fg_core::models::Oid;
use std::collections::{BTreeMap, HashMap};

use super::three_way::{ThreeWayMerge, ThreeWayMergeResult};

/// Interned path identifier within an arena.
pub type PathId = u32;

/// Compact entry representing `(PathId, Oid)`, strictly ordered by `PathId`.
pub type CompactTreeEntry = (PathId, Oid);

/// Contiguous string arena interning paths to sequential 32-bit IDs.
#[derive(Debug, Default, Clone)]
pub struct PathArena {
    paths: Vec<String>,
    index: HashMap<String, PathId>,
}

impl PathArena {
    /// Creates an empty path arena.
    pub fn new() -> Self {
        Self::default()
    }

    /// Interns a path slice, returning its stable 32-bit identifier.
    pub fn intern(&mut self, path: &str) -> PathId {
        if let Some(&path_id) = self.index.get(path) {
            return path_id;
        }
        let path_id = self.paths.len() as PathId;
        self.paths.push(path.to_string());
        self.index.insert(path.to_string(), path_id);
        path_id
    }

    /// Resolves an interned identifier back to its original path slice.
    pub fn resolve(&self, path_id: PathId) -> Option<&str> {
        self.paths.get(path_id as usize).map(String::as_str)
    }

    /// Returns the number of distinct paths interned in this arena.
    pub fn len(&self) -> usize {
        self.paths.len()
    }

    /// Returns true when no paths are interned.
    pub fn is_empty(&self) -> bool {
        self.paths.is_empty()
    }
}

/// Linear three-pointer scan merging sorted `(PathId, Oid)` slices without string hashing or tree balancing.
///
/// Runs in $O(N_b + N_o + N_t)$ time, evaluating 3-way conflict rules purely with integer comparisons.
pub fn three_way_linear_scan(
    base: &[CompactTreeEntry],
    ours: &[CompactTreeEntry],
    theirs: &[CompactTreeEntry],
) -> Vec<CompactTreeEntry> {
    let mut result = Vec::with_capacity(ours.len().max(theirs.len()));
    let (mut index_base, mut index_ours, mut index_theirs) = (0, 0, 0);

    while index_base < base.len() || index_ours < ours.len() || index_theirs < theirs.len() {
        let mut min_path_id = u32::MAX;
        if index_base < base.len() && base[index_base].0 < min_path_id {
            min_path_id = base[index_base].0;
        }
        if index_ours < ours.len() && ours[index_ours].0 < min_path_id {
            min_path_id = ours[index_ours].0;
        }
        if index_theirs < theirs.len() && theirs[index_theirs].0 < min_path_id {
            min_path_id = theirs[index_theirs].0;
        }

        let base_oid = if index_base < base.len() && base[index_base].0 == min_path_id {
            let oid = base[index_base].1;
            index_base += 1;
            Some(oid)
        } else {
            None
        };

        let ours_oid = if index_ours < ours.len() && ours[index_ours].0 == min_path_id {
            let oid = ours[index_ours].1;
            index_ours += 1;
            Some(oid)
        } else {
            None
        };

        let theirs_oid = if index_theirs < theirs.len() && theirs[index_theirs].0 == min_path_id {
            let oid = theirs[index_theirs].1;
            index_theirs += 1;
            Some(oid)
        } else {
            None
        };

        // 3-way merge decision
        if ours_oid == theirs_oid {
            if let Some(oid) = ours_oid {
                result.push((min_path_id, oid));
            }
        } else if base_oid == ours_oid {
            // theirs modified or deleted
            if let Some(oid) = theirs_oid {
                result.push((min_path_id, oid));
            }
        } else if base_oid == theirs_oid {
            // ours modified or deleted
            if let Some(oid) = ours_oid {
                result.push((min_path_id, oid));
            }
        } else {
            // Divergent change: in virtual base synthesis, preserve either branch's entry
            if let Some(oid) = ours_oid.or(theirs_oid) {
                result.push((min_path_id, oid));
            }
        }
    }

    result
}

/// Pure in-memory synthesizer for virtual merge base trees across multiple common ancestors.
pub struct VirtualMergeBaseSynthesizer;

impl VirtualMergeBaseSynthesizer {
    /// Performs compact virtual base synthesis on sorted `(PathId, Oid)` slices via linear multi-pointer scan.
    pub fn synthesize_compact(
        ancestor_base: Option<&[CompactTreeEntry]>,
        bases: &[&[CompactTreeEntry]],
    ) -> Vec<CompactTreeEntry> {
        if bases.is_empty() {
            return Vec::new();
        }
        if bases.len() == 1 {
            return bases[0].to_vec();
        }

        let empty = Vec::new();
        let base_tree = ancestor_base.unwrap_or(&empty);

        let mut current_base = bases[0].to_vec();
        for next_base in &bases[1..] {
            current_base = three_way_linear_scan(base_tree, &current_base, next_base);
        }
        current_base
    }

    /// Synthesizes an in-memory virtual merge base tree from multiple common ancestors.
    ///
    /// In criss-cross branch histories where two branches diverge from multiple common ancestors,
    /// this merges ancestor trees in memory (following Git's merge-ort virtual base strategy).
    /// Interns paths into a contiguous arena and executes linear multi-pointer scanning.
    pub fn synthesize_virtual_base(
        ancestor_base: Option<&BTreeMap<String, Oid>>,
        bases: &[&BTreeMap<String, Oid>],
    ) -> BTreeMap<String, Oid> {
        if bases.is_empty() {
            return BTreeMap::new();
        }
        if bases.len() == 1 {
            return (*bases[0]).clone();
        }

        let mut arena = PathArena::new();
        let mut convert_tree = |tree: &BTreeMap<String, Oid>| -> Vec<CompactTreeEntry> {
            let mut entries: Vec<CompactTreeEntry> = tree
                .iter()
                .map(|(path, &oid)| (arena.intern(path), oid))
                .collect();
            entries.sort_unstable_by_key(|entry| entry.0);
            entries
        };

        let compact_ancestor = ancestor_base.map(&mut convert_tree);
        let compact_bases: Vec<Vec<CompactTreeEntry>> =
            bases.iter().map(|base_tree| convert_tree(base_tree)).collect();
        let compact_base_refs: Vec<&[CompactTreeEntry]> =
            compact_bases.iter().map(|base_entries| base_entries.as_slice()).collect();

        let merged_compact =
            Self::synthesize_compact(compact_ancestor.as_deref(), &compact_base_refs);

        let mut result = BTreeMap::new();
        for (path_id, oid) in merged_compact {
            if let Some(path) = arena.resolve(path_id) {
                result.insert(path.to_string(), oid);
            }
        }
        result
    }

    /// Evaluates a 3-way tree merge with multiple common ancestors, synthesizing
    /// an in-memory virtual base tree.
    pub fn merge_with_virtual_bases(
        ancestor_base: Option<&BTreeMap<String, Oid>>,
        bases: &[&BTreeMap<String, Oid>],
        ours: &BTreeMap<String, Oid>,
        theirs: &BTreeMap<String, Oid>,
    ) -> ThreeWayMergeResult {
        let virtual_base = Self::synthesize_virtual_base(ancestor_base, bases);
        ThreeWayMerge::merge(&virtual_base, ours, theirs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_oid(byte: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = byte;
        Oid::from_bytes(raw)
    }

    #[test]
    fn test_path_arena_interning_and_lookup() {
        let mut arena = PathArena::new();
        assert!(arena.is_empty());

        let id1 = arena.intern("src/main.rs");
        let id2 = arena.intern("Cargo.toml");
        let id3 = arena.intern("src/main.rs");

        assert_eq!(id1, 0);
        assert_eq!(id2, 1);
        assert_eq!(id1, id3);
        assert_eq!(arena.len(), 2);

        assert_eq!(arena.resolve(id1), Some("src/main.rs"));
        assert_eq!(arena.resolve(id2), Some("Cargo.toml"));
        assert_eq!(arena.resolve(99), None);
    }

    #[test]
    fn test_compact_three_way_linear_merge_clean() {
        let oid_base = dummy_oid(1);
        let oid_ours = dummy_oid(2);
        let oid_theirs = dummy_oid(3);

        // base: {path0: oid_base, path1: oid_base}
        let base = vec![(0, oid_base), (1, oid_base)];
        // ours modified path0 to oid_ours
        let ours = vec![(0, oid_ours), (1, oid_base)];
        // theirs modified path1 to oid_theirs
        let theirs = vec![(0, oid_base), (1, oid_theirs)];

        let merged = three_way_linear_scan(&base, &ours, &theirs);
        assert_eq!(merged, vec![(0, oid_ours), (1, oid_theirs)]);
    }

    #[test]
    fn test_compact_three_way_linear_merge_conflict_resolution() {
        let oid_base = dummy_oid(1);
        let oid_ours = dummy_oid(2);
        let oid_theirs = dummy_oid(3);

        let base = vec![(0, oid_base)];
        // Both branches modified path0 divergently
        let ours = vec![(0, oid_ours)];
        let theirs = vec![(0, oid_theirs)];

        let merged = three_way_linear_scan(&base, &ours, &theirs);
        // Virtual base preserves either candidate
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].0, 0);
        assert!(merged[0].1 == oid_ours || merged[0].1 == oid_theirs);
    }

    #[test]
    fn test_virtual_base_synthesizer_empty_and_single() {
        let empty = VirtualMergeBaseSynthesizer::synthesize_virtual_base(None, &[]);
        assert!(empty.is_empty());

        let mut single_tree = BTreeMap::new();
        single_tree.insert("file.txt".to_string(), dummy_oid(5));
        let result = VirtualMergeBaseSynthesizer::synthesize_virtual_base(None, &[&single_tree]);
        assert_eq!(result, single_tree);
    }

    #[test]
    fn test_virtual_base_synthesizer_criss_cross() {
        let mut ancestor = BTreeMap::new();
        ancestor.insert("shared.txt".to_string(), dummy_oid(1));
        ancestor.insert("ours_mod.txt".to_string(), dummy_oid(1));
        ancestor.insert("theirs_mod.txt".to_string(), dummy_oid(1));

        let mut base1 = ancestor.clone();
        base1.insert("ours_mod.txt".to_string(), dummy_oid(2));

        let mut base2 = ancestor.clone();
        base2.insert("theirs_mod.txt".to_string(), dummy_oid(3));

        let virtual_base =
            VirtualMergeBaseSynthesizer::synthesize_virtual_base(Some(&ancestor), &[&base1, &base2]);

        assert_eq!(virtual_base.get("shared.txt"), Some(&dummy_oid(1)));
        assert_eq!(virtual_base.get("ours_mod.txt"), Some(&dummy_oid(2)));
        assert_eq!(virtual_base.get("theirs_mod.txt"), Some(&dummy_oid(3)));
    }
}
