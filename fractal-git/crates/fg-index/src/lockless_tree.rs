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

struct DirectoryFrame {
    dir_name: String,
    entries: Vec<GitTreeEntry>,
}

impl DirectoryFrame {
    fn new(dir_name: impl Into<String>) -> Self {
        Self {
            dir_name: dir_name.into(),
            entries: Vec::new(),
        }
    }
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

    fn pop_and_persist_down_to<F>(
        dir_stack: &mut Vec<DirectoryFrame>,
        target_len: usize,
        persist_tree: &mut F,
    ) -> FractalResult<()>
    where
        F: FnMut(&GitTree) -> FractalResult<()>,
    {
        while dir_stack.len() > target_len {
            if let Some(completed_frame) = dir_stack.pop() {
                let subtree = GitTree::new(completed_frame.entries);
                persist_tree(&subtree)?;
                let subtree_oid = *subtree.raw_oid();
                if let Some(parent_frame) = dir_stack.last_mut() {
                    parent_frame.entries.push(GitTreeEntry::from_oid(
                        FileMode::Directory,
                        completed_frame.dir_name,
                        subtree_oid,
                    ));
                }
            }
        }
        Ok(())
    }

    fn resolve_directory_branch<'a>(
        dir_path_opt: Option<&'a str>,
        dir_stack: &[DirectoryFrame],
    ) -> (usize, Option<(&'a str, std::str::Split<'a, char>)>) {
        let Some(dir_path) = dir_path_opt else {
            return (0, None);
        };
        let mut common_depth = 0;
        let mut dir_parts = dir_path.split('/');
        while let Some(part) = dir_parts.next() {
            if common_depth + 1 < dir_stack.len() && dir_stack[common_depth + 1].dir_name == part {
                common_depth += 1;
            } else {
                return (common_depth, Some((part, dir_parts)));
            }
        }
        (common_depth, None)
    }

    fn push_mismatch_branches<'a>(
        dir_stack: &mut Vec<DirectoryFrame>,
        mismatch_branch: Option<(&'a str, std::str::Split<'a, char>)>,
    ) {
        if let Some((first_segment, remaining_segments)) = mismatch_branch {
            dir_stack.push(DirectoryFrame::new(first_segment));
            for segment in remaining_segments {
                dir_stack.push(DirectoryFrame::new(segment));
            }
        }
    }

    fn append_entry_to_tree<F>(
        dir_stack: &mut Vec<DirectoryFrame>,
        path: &str,
        entry: &VirtualIndexEntry,
        persist_tree: &mut F,
    ) -> FractalResult<()>
    where
        F: FnMut(&GitTree) -> FractalResult<()>,
    {
        let is_sparse = entry.is_sparse_dir();
        let (dir_path_opt, entry_name) = match path.rfind('/') {
            Some(slash_idx) => (Some(&path[..slash_idx]), &path[slash_idx + 1..]),
            None => (None, path),
        };

        let (common_depth, mismatch_branch) =
            Self::resolve_directory_branch(dir_path_opt, dir_stack);

        Self::pop_and_persist_down_to(dir_stack, common_depth + 1, persist_tree)?;
        Self::push_mismatch_branches(dir_stack, mismatch_branch);

        let mode = if is_sparse {
            FileMode::Directory
        } else {
            entry.mode
        };

        if let Some(current_frame) = dir_stack.last_mut() {
            current_frame.entries.push(GitTreeEntry::from_oid(
                mode,
                entry_name.to_string(),
                entry.oid,
            ));
        }
        Ok(())
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

        // Prefix-Stack Tree Builder: O(TreeDepth) memory space, zero intermediate BTreeMap trees
        let mut dir_stack: Vec<DirectoryFrame> = vec![DirectoryFrame::new("")];

        for (path, entry) in &self.entries {
            Self::append_entry_to_tree(&mut dir_stack, path, entry, &mut persist_tree)?;
        }

        Self::pop_and_persist_down_to(&mut dir_stack, 1, &mut persist_tree)?;

        let root_frame = match dir_stack.pop() {
            Some(frame) => frame,
            None => return Ok(Oid::ZERO),
        };
        let root_tree = GitTree::new(root_frame.entries);
        persist_tree(&root_tree)?;
        Ok(*root_tree.raw_oid())
    }
}
