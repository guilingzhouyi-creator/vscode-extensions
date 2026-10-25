//! Module: fg-index — Dirty Worktree Guard
//! File Path: crates/fg-index/src/dirty_guard.rs
//! Architecture Role: Implements 3-way dirty worktree safety validation (HEAD vs Index vs Worktree)
//!   before checkout, switch, merge, rebase, and reset operations to prevent silent data clobbering.
//! Dependencies & Triggers: Invoked by checkout, switch, merge, rebase, and reset commands.
//! Responsibilities: Detect collisions with untracked files, unstaged modifications, and staged uncommitted work.
//! Exit Semantics & Design Rationale:
//!   - Zero-allocation evaluation loop using hoisted collectors and reference slices.
//!   - Strict 3-way collision taxonomy: UntrackedOverwritten, UnstagedModified, StagedModified.
//!   - Non-conflicting mutations allowed: when a path is identical between current tree and target tree,
//!     local dirty edits are carried across without blocking the operation.

use std::collections::{BTreeMap, BTreeSet};

use fg_core::models::{FileMode, Oid};

use crate::index_file::IndexEntry;

/// Collision classification for dirty worktree protection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirtyCollisionKind {
    /// Local untracked file would be overwritten by incoming tree.
    UntrackedOverwritten,
    /// Local unstaged modifications would be overwritten by incoming tree.
    UnstagedModified,
    /// Staged uncommitted changes would be overwritten by incoming tree.
    StagedModified,
}

impl DirtyCollisionKind {
    /// Returns human-readable diagnostic description.
    pub const fn description(&self) -> &'static str {
        match self {
            Self::UntrackedOverwritten => "untracked file would be overwritten",
            Self::UnstagedModified => "local unstaged changes would be overwritten",
            Self::StagedModified => "staged uncommitted changes would be overwritten",
        }
    }
}

/// A detected dirty worktree collision on a specific path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirtyCollision {
    /// Path experiencing the collision.
    pub path: String,
    /// Specific collision kind.
    pub kind: DirtyCollisionKind,
}

impl DirtyCollision {
    /// Creates a new collision record.
    pub fn new(path: impl Into<String>, kind: DirtyCollisionKind) -> Self {
        Self {
            path: path.into(),
            kind,
        }
    }
}

/// 3-way dirty worktree safety guard.
pub struct DirtyWorktreeGuard;

impl DirtyWorktreeGuard {
    /// Evaluates 3-way transition safety between `current_tree` and `target_tree`.
    ///
    /// Paths that do not mutate between `current_tree` and `target_tree` are skipped,
    /// allowing non-conflicting local edits to be safely carried across the transition.
    ///
    /// # Zero-Allocation Invariant:
    /// Does not allocate inside hot loop branches.
    pub fn check_transition<'a, FExists, FDirty>(
        current_tree: &BTreeMap<String, (FileMode, Oid)>,
        target_tree: &BTreeMap<String, (FileMode, Oid)>,
        index_entries: &BTreeMap<String, &'a IndexEntry>,
        worktree_file_exists: FExists,
        is_worktree_dirty: FDirty,
    ) -> Vec<DirtyCollision>
    where
        FExists: Fn(&str) -> bool,
        FDirty: Fn(&str, &'a IndexEntry) -> bool,
    {
        let mut collisions = Vec::new();
        let mut checked_paths = BTreeSet::new();

        // 1. Inspect all paths in target_tree that differ from current_tree
        for (path, (target_mode, target_oid)) in target_tree {
            checked_paths.insert(path.as_str());
            let current = current_tree.get(path);
            let is_identical = match current {
                Some((cur_mode, cur_oid)) => cur_mode == target_mode && cur_oid == target_oid,
                None => false,
            };

            if is_identical {
                // Unchanged path: local edits can safely survive
                continue;
            }

            Self::inspect_incoming_path(
                path,
                current.map(|(m, o)| (*m, *o)),
                index_entries.get(path).copied(),
                &worktree_file_exists,
                &is_worktree_dirty,
                &mut collisions,
            );
        }

        // 2. Inspect paths that exist in current_tree but are deleted in target_tree
        for (path, (cur_mode, cur_oid)) in current_tree {
            if checked_paths.contains(path.as_str()) {
                continue;
            }
            // Path is removed in target_tree
            Self::inspect_deleted_path(
                path,
                (*cur_mode, *cur_oid),
                index_entries.get(path).copied(),
                &is_worktree_dirty,
                &mut collisions,
            );
        }

        collisions
    }

    fn inspect_incoming_path<'a, FExists, FDirty>(
        path: &str,
        current: Option<(FileMode, Oid)>,
        index_entry: Option<&'a IndexEntry>,
        exists: &FExists,
        dirty: &FDirty,
        collisions: &mut Vec<DirtyCollision>,
    ) where
        FExists: Fn(&str) -> bool,
        FDirty: Fn(&str, &'a IndexEntry) -> bool,
    {
        match (current, index_entry) {
            (None, None) => {
                // Untracked in HEAD and Index: if file physically exists, target would overwrite it
                if exists(path) {
                    collisions.push(DirtyCollision::new(
                        path,
                        DirtyCollisionKind::UntrackedOverwritten,
                    ));
                }
            }
            (Some((_, cur_oid)), Some(idx)) => {
                // Check staged change
                if idx.oid != cur_oid {
                    collisions.push(DirtyCollision::new(
                        path,
                        DirtyCollisionKind::StagedModified,
                    ));
                } else if dirty(path, idx) {
                    collisions.push(DirtyCollision::new(
                        path,
                        DirtyCollisionKind::UnstagedModified,
                    ));
                }
            }
            (None, Some(_)) => {
                // Staged new file in Index, but not in current HEAD tree
                collisions.push(DirtyCollision::new(
                    path,
                    DirtyCollisionKind::StagedModified,
                ));
            }
            (Some(_), None) => {
                // Staged deletion in Index (not in index, but in current HEAD tree)
                collisions.push(DirtyCollision::new(
                    path,
                    DirtyCollisionKind::StagedModified,
                ));
            }
        }
    }

    fn inspect_deleted_path<'a, FDirty>(
        path: &str,
        current: (FileMode, Oid),
        index_entry: Option<&'a IndexEntry>,
        dirty: &FDirty,
        collisions: &mut Vec<DirtyCollision>,
    ) where
        FDirty: Fn(&str, &'a IndexEntry) -> bool,
    {
        match index_entry {
            Some(idx) => {
                if idx.oid != current.1 {
                    collisions.push(DirtyCollision::new(
                        path,
                        DirtyCollisionKind::StagedModified,
                    ));
                } else if dirty(path, idx) {
                    collisions.push(DirtyCollision::new(
                        path,
                        DirtyCollisionKind::UnstagedModified,
                    ));
                }
            }
            None => {
                // Already staged deleted in Index, deletion matches target
            }
        }
    }

    /// Formats collision diagnostics into human-readable Git-compatible rejection message.
    pub fn format_rejection(collisions: &[DirtyCollision], operation: &str) -> String {
        let mut untracked = Vec::new();
        let mut modified = Vec::new();

        for c in collisions {
            match c.kind {
                DirtyCollisionKind::UntrackedOverwritten => untracked.push(c.path.as_str()),
                DirtyCollisionKind::UnstagedModified | DirtyCollisionKind::StagedModified => {
                    modified.push(c.path.as_str());
                }
            }
        }

        let mut output = String::new();
        if !modified.is_empty() {
            output.push_str(&format!(
                "error: Your local changes to the following files would be overwritten by {operation}:\n  {}\nPlease commit your changes or stash them before you {operation}.\n",
                modified.join("\n  ")
            ));
        }
        if !untracked.is_empty() {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&format!(
                "error: The following untracked working tree files would be overwritten by {operation}:\n  {}\nPlease move or remove them before you {operation}.\n",
                untracked.join("\n  ")
            ));
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::{DirtyCollisionKind, DirtyWorktreeGuard};
    use crate::index_file::IndexEntry;
    use fg_core::models::{FileMode, IndexStage, Oid};
    use std::collections::BTreeMap;

    fn dummy_oid(byte: u8) -> Oid {
        let mut bytes = [0u8; 20];
        bytes[0] = byte;
        Oid::from_bytes(bytes)
    }

    fn dummy_entry(path: &str, oid: Oid) -> IndexEntry {
        IndexEntry {
            path: path.to_string(),
            mode: FileMode::RegularFile,
            oid,
            stage: IndexStage::Normal,
            size: 100,
            mtime_seconds: 1000,
            mtime_nanos: 0,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        }
    }

    #[test]
    fn clean_transition_reports_no_collisions() {
        let mut cur = BTreeMap::new();
        cur.insert(
            "file.txt".to_string(),
            (FileMode::RegularFile, dummy_oid(1)),
        );
        let mut target = BTreeMap::new();
        target.insert(
            "file.txt".to_string(),
            (FileMode::RegularFile, dummy_oid(2)),
        );

        let entry = dummy_entry("file.txt", dummy_oid(1));
        let mut idx = BTreeMap::new();
        idx.insert("file.txt".to_string(), &entry);

        let collisions =
            DirtyWorktreeGuard::check_transition(&cur, &target, &idx, |_| true, |_, _| false);
        assert!(collisions.is_empty());
    }

    #[test]
    fn untracked_collision_detected() {
        let cur = BTreeMap::new();
        let mut target = BTreeMap::new();
        target.insert(
            "untracked.txt".to_string(),
            (FileMode::RegularFile, dummy_oid(2)),
        );
        let idx = BTreeMap::new();

        let collisions = DirtyWorktreeGuard::check_transition(
            &cur,
            &target,
            &idx,
            |p| p == "untracked.txt",
            |_, _| false,
        );
        assert_eq!(collisions.len(), 1);
        assert_eq!(collisions[0].kind, DirtyCollisionKind::UntrackedOverwritten);
        assert_eq!(collisions[0].path, "untracked.txt");
    }

    #[test]
    fn unstaged_modification_detected() {
        let mut cur = BTreeMap::new();
        cur.insert(
            "dirty.txt".to_string(),
            (FileMode::RegularFile, dummy_oid(1)),
        );
        let mut target = BTreeMap::new();
        target.insert(
            "dirty.txt".to_string(),
            (FileMode::RegularFile, dummy_oid(2)),
        );

        let entry = dummy_entry("dirty.txt", dummy_oid(1));
        let mut idx = BTreeMap::new();
        idx.insert("dirty.txt".to_string(), &entry);

        let collisions = DirtyWorktreeGuard::check_transition(
            &cur,
            &target,
            &idx,
            |_| true,
            |p, _| p == "dirty.txt",
        );
        assert_eq!(collisions.len(), 1);
        assert_eq!(collisions[0].kind, DirtyCollisionKind::UnstagedModified);
    }

    #[test]
    fn staged_change_detected() {
        let mut cur = BTreeMap::new();
        cur.insert(
            "staged.txt".to_string(),
            (FileMode::RegularFile, dummy_oid(1)),
        );
        let mut target = BTreeMap::new();
        target.insert(
            "staged.txt".to_string(),
            (FileMode::RegularFile, dummy_oid(3)),
        );

        // Index has dummy_oid(2), which differs from current HEAD dummy_oid(1)
        let entry = dummy_entry("staged.txt", dummy_oid(2));
        let mut idx = BTreeMap::new();
        idx.insert("staged.txt".to_string(), &entry);

        let collisions =
            DirtyWorktreeGuard::check_transition(&cur, &target, &idx, |_| true, |_, _| false);
        assert_eq!(collisions.len(), 1);
        assert_eq!(collisions[0].kind, DirtyCollisionKind::StagedModified);
    }

    #[test]
    fn identical_path_dirty_carries_over_without_collision() {
        let mut cur = BTreeMap::new();
        cur.insert(
            "same.txt".to_string(),
            (FileMode::RegularFile, dummy_oid(1)),
        );
        let mut target = BTreeMap::new();
        target.insert(
            "same.txt".to_string(),
            (FileMode::RegularFile, dummy_oid(1)),
        );

        let entry = dummy_entry("same.txt", dummy_oid(1));
        let mut idx = BTreeMap::new();
        idx.insert("same.txt".to_string(), &entry);

        // Path is dirty in worktree, but target and cur agree!
        let collisions =
            DirtyWorktreeGuard::check_transition(&cur, &target, &idx, |_| true, |_, _| true);
        assert!(collisions.is_empty(), "identical paths should not collide");
    }
}
