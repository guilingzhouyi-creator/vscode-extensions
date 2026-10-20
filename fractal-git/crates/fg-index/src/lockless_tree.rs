//! Module: fg-index — Lockless In-Memory Tree Index
//! File Path: crates/fg-index/src/lockless_tree.rs
//! Architecture Role: Pure in-memory staging tree index eliminating `.git/index.lock` contention.
//!   Maintains sorted flat paths, detects unmerged conflicts, and constructs nested Git Trees.
//! Dependencies & Triggers: Utilized by CLI staging commands, worktrees, and merge operators.
//! Responsibilities: Sparse directory collapsing, conflict stage tracking, and tree creation.
//! Exit Semantics & Design Rationale: Enables non-blocking concurrent writes with $O(\log N)$
//!   path navigation and sparse cone collapsing.

use std::collections::BTreeMap;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use fg_object::{FileMode, GitTree, GitTreeEntry};

use crate::conflict_stage::ConflictStageSlot;
use crate::entry::{IndexStage, VirtualIndexEntry};

enum TreeNode {
    File(VirtualIndexEntry),
    Directory(BTreeMap<String, TreeNode>),
    CollapsedSubtree(Oid),
}

/// Thread-safe in-memory virtual staging index.
#[derive(Debug, Default, Clone)]
pub struct InMemoryIndexTree {
    entries: BTreeMap<String, VirtualIndexEntry>,
    conflicts: BTreeMap<String, ConflictStageSlot>,
}

impl InMemoryIndexTree {
    /// Constructs a clean empty in-memory index tree.
    pub fn new() -> Self {
        Self {
            entries: BTreeMap::new(),
            conflicts: BTreeMap::new(),
        }
    }

    /// Stages a file into clean Stage-0 index.
    pub fn stage_file(&mut self, path: &str, mode: FileMode, oid_hex: &str) -> FractalResult<()> {
        let oid = Oid::from_hex(oid_hex)?;
        self.stage_oid(path, mode, oid)
    }

    /// Stages a file with a typed Oid into clean Stage-0 index.
    pub fn stage_oid(&mut self, path: &str, mode: FileMode, oid: Oid) -> FractalResult<()> {
        let clean_path = path.trim_matches('/').replace('\\', "/");
        if clean_path.is_empty() {
            return Err(FractalError::IndexConflict(
                "Cannot stage empty path".into(),
            ));
        }

        // Clean any lingering conflicts for this path
        self.conflicts.remove(&clean_path);
        self.entries.insert(
            clean_path.clone(),
            VirtualIndexEntry::new(clean_path, mode, oid),
        );
        Ok(())
    }

    /// Stages a collapsed sparse directory subtree pointing directly to a pre-computed GitTree.
    /// Aligns with Git's canonical Sparse Index design, eliminating the need to expand out-of-scope
    /// files when reconstructing monorepo tree structures.
    pub fn stage_sparse_directory(&mut self, dir_path: &str, tree_oid: Oid) -> FractalResult<()> {
        let clean_path = dir_path.trim_matches('/').replace('\\', "/");
        if clean_path.is_empty() {
            return Err(FractalError::IndexConflict(
                "Cannot stage empty sparse directory path".into(),
            ));
        }

        self.conflicts.remove(&clean_path);
        self.entries.insert(
            clean_path.clone(),
            VirtualIndexEntry::new_sparse_dir(clean_path, tree_oid),
        );
        Ok(())
    }

    /// Records a multi-stage conflict entry (Stage 1..3).
    pub fn stage_conflict(
        &mut self,
        path: &str,
        mode: FileMode,
        oid: Oid,
        stage: IndexStage,
    ) -> FractalResult<()> {
        let clean_path = path.trim_matches('/').replace('\\', "/");
        if stage == IndexStage::Normal {
            return self.stage_oid(&clean_path, mode, oid);
        }

        let entry = VirtualIndexEntry::with_stage(clean_path.clone(), mode, oid, stage);
        let slot = self
            .conflicts
            .entry(clean_path.clone())
            .or_insert_with(|| ConflictStageSlot::new(clean_path));
        slot.record_stage(&entry);
        Ok(())
    }

    /// Checks if there are unresolved conflict stages.
    pub fn has_conflicts(&self) -> bool {
        !self.conflicts.is_empty()
    }

    /// Removes a staged path from the index.
    pub fn remove_file(&mut self, path: &str) -> bool {
        let clean_path = path.trim_matches('/').replace('\\', "/");
        let removed_entry = self.entries.remove(&clean_path).is_some();
        let removed_conflict = self.conflicts.remove(&clean_path).is_some();
        removed_entry || removed_conflict
    }

    /// Clears all staged entries and conflict slots.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.conflicts.clear();
    }

    /// Total count of staged clean entries.
    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    /// Access all staged entries.
    pub fn entries(&self) -> &BTreeMap<String, VirtualIndexEntry> {
        &self.entries
    }

    /// Access all active conflict slots (first-class conflicts).
    pub fn conflicts(&self) -> &BTreeMap<String, ConflictStageSlot> {
        &self.conflicts
    }

    /// Total count of unresolved conflicts.
    pub fn conflict_count(&self) -> usize {
        self.conflicts.len()
    }

    /// Resolves an in-memory conflict slot in favor of a specific entry.
    pub fn resolve_conflict(&mut self, path: &str, resolved_entry: VirtualIndexEntry) {
        let clean_path = path.trim_matches('/').replace('\\', "/");
        self.conflicts.remove(&clean_path);
        self.entries.insert(clean_path, resolved_entry);
    }

    /// Extracts a scoped subtree index containing only entries that match
    /// one of the scope prefixes.
    pub fn filter_by_scope(&self, scope_prefixes: &[String]) -> Self {
        if scope_prefixes.is_empty()
            || scope_prefixes
                .iter()
                .any(|scope_prefix| scope_prefix == "*")
        {
            return self.clone();
        }
        let mut filtered = Self::new();
        for (path, entry) in &self.entries {
            let matches = scope_prefixes.iter().any(|prefix| {
                let prefix_clean = prefix.trim_matches('/').replace('\\', "/");
                path.starts_with(&prefix_clean)
            });
            if matches {
                filtered.entries.insert(path.clone(), entry.clone());
            }
        }
        filtered
    }

    /// Grafts this scoped index's modifications onto a parent set of entries.
    /// Preserves all parent entries outside this index's modified paths, while
    /// applying this index's additions, modifications, and removals.
    pub fn graft_onto_parent(&self, parent_entries: &BTreeMap<String, (FileMode, Oid)>) -> Self {
        let mut combined = Self::new();
        for (path, (mode, oid)) in parent_entries {
            combined.entries.insert(
                path.clone(),
                VirtualIndexEntry::new(path.clone(), *mode, *oid),
            );
        }
        for (path, entry) in &self.entries {
            combined.entries.insert(path.clone(), entry.clone());
        }
        combined
    }

    /// Builds the hierarchical GitTree structures from in-memory entries,
    /// passing each constructed GitTree to a persistence callback.
    pub fn write_tree_with_persister<F>(&self, mut persist_tree: F) -> FractalResult<Oid>
    where
        F: FnMut(&GitTree) -> FractalResult<()>,
    {
        if self.has_conflicts() {
            return Err(FractalError::IndexConflict(format!(
                "Cannot build tree: {} unmerged conflicts remain in index",
                self.conflicts.len()
            )));
        }

        if self.entries.is_empty() {
            let empty_tree = GitTree::new(Vec::new());
            persist_tree(&empty_tree)?;
            return Ok(*empty_tree.raw_oid());
        }

        let mut root_node = BTreeMap::new();
        for (path, entry) in &self.entries {
            let segments: Vec<&str> = path.split('/').collect();
            Self::insert_recursive(&mut root_node, &segments, entry.clone());
        }

        Self::persist_node_recursive(&root_node, &mut persist_tree)
    }

    fn insert_recursive(
        current_dir: &mut BTreeMap<String, TreeNode>,
        segments: &[&str],
        entry: VirtualIndexEntry,
    ) {
        if segments.is_empty() {
            return;
        }

        let segment = segments[0].to_string();
        if segments.len() == 1 {
            if entry.is_sparse_dir() {
                current_dir.insert(segment, TreeNode::CollapsedSubtree(entry.oid));
            } else {
                current_dir.insert(segment, TreeNode::File(entry));
            }
        } else {
            let next_dir = current_dir
                .entry(segment)
                .or_insert_with(|| TreeNode::Directory(BTreeMap::new()));

            if let TreeNode::Directory(ref mut child_map) = next_dir {
                Self::insert_recursive(child_map, &segments[1..], entry);
            }
        }
    }

    fn persist_node_recursive<F>(
        current_dir: &BTreeMap<String, TreeNode>,
        persist_tree: &mut F,
    ) -> FractalResult<Oid>
    where
        F: FnMut(&GitTree) -> FractalResult<()>,
    {
        let mut entries = Vec::new();

        for (name, node) in current_dir {
            match node {
                TreeNode::File(file_entry) => {
                    entries.push(GitTreeEntry::from_oid(
                        file_entry.mode,
                        name.clone(),
                        file_entry.oid,
                    ));
                }
                TreeNode::Directory(child_map) => {
                    let subtree_oid = Self::persist_node_recursive(child_map, persist_tree)?;
                    entries.push(GitTreeEntry::from_oid(
                        FileMode::Directory,
                        name.clone(),
                        subtree_oid,
                    ));
                }
                TreeNode::CollapsedSubtree(tree_oid) => {
                    entries.push(GitTreeEntry::from_oid(
                        FileMode::Directory,
                        name.clone(),
                        *tree_oid,
                    ));
                }
            }
        }

        let tree = GitTree::new(entries);
        persist_tree(&tree)?;
        Ok(*tree.raw_oid())
    }
}
