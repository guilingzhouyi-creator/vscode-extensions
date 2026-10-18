//! Module: fg-index — Lockless In-Memory Tree Index
//! File Path: crates/fg-index/src/lockless_tree.rs
//! Architecture Role: Pure in-memory staging tree index eliminating `.git/index.lock` contention.
//!   Maintains sorted flat paths, detects unmerged conflicts, and constructs nested Git Trees.

use std::collections::BTreeMap;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use fg_object::{FileMode, GitTree, GitTreeEntry};

use crate::conflict_stage::ConflictStageSlot;
use crate::entry::{IndexStage, VirtualIndexEntry};

enum TreeNode {
    File(VirtualIndexEntry),
    Directory(BTreeMap<String, TreeNode>),
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
            return Err(FractalError::IndexConflict("Cannot stage empty path".into()));
        }

        // Clean any lingering conflicts for this path
        self.conflicts.remove(&clean_path);
        self.entries.insert(
            clean_path.clone(),
            VirtualIndexEntry::new(clean_path, mode, oid),
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
            current_dir.insert(segment, TreeNode::File(entry));
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
                    entries.push(GitTreeEntry::from_oid(file_entry.mode, name.clone(), file_entry.oid));
                }
                TreeNode::Directory(child_map) => {
                    let subtree_oid = Self::persist_node_recursive(child_map, persist_tree)?;
                    entries.push(GitTreeEntry::from_oid(FileMode::Directory, name.clone(), subtree_oid));
                }
            }
        }

        let tree = GitTree::new(entries);
        persist_tree(&tree)?;
        Ok(*tree.raw_oid())
    }
}
