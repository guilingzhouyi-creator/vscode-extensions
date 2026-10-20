//! Module: fg-algorithms — Synthetic Monorepo Tree Generator
//! File Path: crates/fg-algorithms/src/synthetic/monorepo_tree.rs
//! Architecture Role: Pure in-memory generator for large-scale hierarchical Git trees.
//! Dependencies & Triggers: Consumed by tree diff benchmarks, sparse traversal
//!   algorithms, and scale testing.
//! Responsibilities: Construct canonical two-level monorepo tree structures
//!   (e.g. 50 packages x 200 files = 10,000 files) with selective subtree modifications
//!   to benchmark O(1) subtree pruning.
//! Exit Semantics & Design Rationale:
//!   - Deterministic synthetic OIDs based on package & file index to avoid filesystem I/O.
//!   - Accurately models sparse changes (e.g. 3 files mutated in 1 out of 50 packages).
//!   - Provides an O(1) in-memory lookup closure to simulate content-addressable storage.

use fg_core::models::Oid;
use fg_object::{FileMode, GitTree, GitTreeEntry};

/// Result of generating synthetic monorepo trees.
#[derive(Debug, Clone)]
pub struct SyntheticMonorepo {
    /// Base root tree containing directory entries for all packages.
    pub base_root: GitTree,
    /// Modified root tree containing directory entries, where modified package has new tree OID.
    pub mod_root: GitTree,
    /// Vector of all base package subtrees.
    pub base_subtrees: Vec<GitTree>,
    /// The modified package subtree.
    pub mod_subtree: GitTree,
    /// The directory index that was mutated.
    pub mod_dir_idx: usize,
    /// Number of files modified in the target directory.
    pub mutated_file_count: usize,
    /// Total number of files across all packages.
    pub total_file_count: usize,
}

impl SyntheticMonorepo {
    /// Performs an in-memory tree lookup given a tree OID.
    /// Simulates O(1) / O(N) object store lookup without disk I/O.
    pub fn lookup_tree(&self, oid: &Oid) -> Option<GitTree> {
        if *oid == *self.mod_subtree.raw_oid() {
            Some(self.mod_subtree.clone())
        } else {
            self.base_subtrees
                .iter()
                .find(|subtree| *subtree.raw_oid() == *oid)
                .cloned()
        }
    }
}

/// Generates a synthetic monorepo tree hierarchy.
///
/// # Arguments
/// - `subdirs`: Number of packages / subdirectories (e.g., 50).
/// - `files_per_dir`: Number of files in each subdirectory (e.g., 200).
/// - `mod_dir_idx`: Which subdirectory index to mutate (e.g., 42).
/// - `mutated_file_count`: How many files in `mod_dir_idx` to mutate (e.g., 3).
pub fn generate_monorepo_trees(
    subdirs: usize,
    files_per_dir: usize,
    mod_dir_idx: usize,
    mutated_file_count: usize,
) -> SyntheticMonorepo {
    let subdirs = subdirs.max(1);
    let files_per_dir = files_per_dir.max(1);
    let target_mod_idx = mod_dir_idx.min(subdirs - 1);
    let mutated_count = mutated_file_count.min(files_per_dir);

    let mut base_subtrees = Vec::with_capacity(subdirs);
    let mut base_root_entries = Vec::with_capacity(subdirs);
    let mut mod_root_entries = Vec::with_capacity(subdirs);

    for dir_idx in 0..subdirs {
        let mut entries = Vec::with_capacity(files_per_dir);
        for file_idx in 0..files_per_dir {
            let mut oid_bytes = [0u8; 20];
            oid_bytes[0..2].copy_from_slice(&(dir_idx as u16).to_le_bytes());
            oid_bytes[2..4].copy_from_slice(&(file_idx as u16).to_le_bytes());
            entries.push(GitTreeEntry::from_oid(
                FileMode::RegularFile,
                format!("f_{}.rs", file_idx),
                Oid::from_bytes(oid_bytes),
            ));
        }
        let tree = GitTree::new(entries);
        let sub_oid = *tree.raw_oid();
        base_subtrees.push(tree);

        let dir_name = format!("pkg_{}", dir_idx);
        base_root_entries.push(GitTreeEntry::from_oid(
            FileMode::Directory,
            &dir_name,
            sub_oid,
        ));
        mod_root_entries.push(GitTreeEntry::from_oid(
            FileMode::Directory,
            &dir_name,
            sub_oid,
        ));
    }

    let mut mod_entries = Vec::with_capacity(files_per_dir);
    for file_idx in 0..files_per_dir {
        let mut oid_bytes = [0u8; 20];
        oid_bytes[0..2].copy_from_slice(&(target_mod_idx as u16).to_le_bytes());
        oid_bytes[2..4].copy_from_slice(&(file_idx as u16).to_le_bytes());
        if file_idx < mutated_count {
            oid_bytes[19] = 0xff;
        }
        mod_entries.push(GitTreeEntry::from_oid(
            FileMode::RegularFile,
            format!("f_{}.rs", file_idx),
            Oid::from_bytes(oid_bytes),
        ));
    }
    let mod_subtree = GitTree::new(mod_entries);
    let mod_name = format!("pkg_{}", target_mod_idx);
    mod_root_entries[target_mod_idx] =
        GitTreeEntry::from_oid(FileMode::Directory, &mod_name, *mod_subtree.raw_oid());

    let base_root = GitTree::new(base_root_entries);
    let mod_root = GitTree::new(mod_root_entries);

    SyntheticMonorepo {
        base_root,
        mod_root,
        base_subtrees,
        mod_subtree,
        mod_dir_idx: target_mod_idx,
        mutated_file_count: mutated_count,
        total_file_count: subdirs * files_per_dir,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_monorepo_trees_properties() {
        let monorepo = generate_monorepo_trees(10, 20, 3, 2);
        assert_eq!(monorepo.base_subtrees.len(), 10);
        assert_eq!(monorepo.total_file_count, 200);
        assert_ne!(monorepo.base_root.raw_oid(), monorepo.mod_root.raw_oid());

        let lookup_mod = monorepo.lookup_tree(monorepo.mod_subtree.raw_oid());
        assert_eq!(
            lookup_mod.as_ref().map(|tree| tree.raw_oid()),
            Some(monorepo.mod_subtree.raw_oid())
        );
    }
}
