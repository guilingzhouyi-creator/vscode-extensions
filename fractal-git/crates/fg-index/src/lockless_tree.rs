//! Module: fg-index — Lockless In-Memory Index
//! File Path: crates/fg-index/src/lockless_tree.rs
//! Architecture Role: In-memory staging index that eliminates `.git/index.lock` contention.
//!   Maintains sorted flat paths, tracks unmerged conflicts, and reconstructs nested Git trees.
//! Dependencies & Triggers: Utilized by CLI staging commands, worktrees, and merge operators.
//! Responsibilities: Sparse directory collapsing, conflict stage tracking, and tree creation.
//! Exit Semantics & Design Rationale:
//!   - Paths are normalized through one function, [`normalize_path`], so that every mutating entry
//!     point agrees on what a path is. Normalizing inconsistently is how a sparse-directory entry
//!     loses the trailing `/` that defines it.
//!   - The tree is rebuilt with a prefix stack rather than by materializing one map per directory:
//!     memory stays proportional to tree depth instead of tree size.
//!   - There is exactly one public type name, [`InMemoryIndexTree`]. A second alias for the same
//!     type splits call sites and hides which name is authoritative.

use std::collections::BTreeMap;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileMode, IndexStage, Oid};
use fg_object::{GitTree, GitTreeEntry};

use crate::conflict_stage::ConflictStageSlot;
use crate::entry::StagingEntry;

/// Normalizes a worktree path to `/`-separated form with no leading or trailing separator.
///
/// # Errors
///
/// Returns [`FractalError::IndexConflict`] naming `field` when the normalized path is empty.
fn normalize_path(path: &str, field: &'static str) -> FractalResult<String> {
    let normalized = path.trim_matches('/').replace('\\', "/");
    if normalized.is_empty() {
        return Err(FractalError::IndexConflict(format!(
            "Cannot stage empty {field} path"
        )));
    }
    Ok(normalized)
}

/// Derives the display path of a sparse directory from its normalized index key.
///
/// The index key never carries a trailing separator, because a key is an address and `vendor/`
/// and `vendor` must resolve to the same slot. The display path does carry it, because the
/// trailing `/` is what marks the subtree as collapsed. Keeping the two forms in one place stops
/// them from drifting apart at the three call sites that stage, remove, and resolve entries.
fn sparse_display_path(index_key: &str) -> String {
    let mut display_path = index_key.to_owned();
    display_path.push('/');
    display_path
}

/// One directory frame in the prefix-stack tree builder.
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

/// In-memory staging index keyed by path.
#[derive(Debug, Default, Clone)]
pub struct InMemoryIndexTree {
    entries: BTreeMap<String, StagingEntry>,
    conflicts: BTreeMap<String, ConflictStageSlot>,
}

impl InMemoryIndexTree {
    /// Constructs an empty index.
    pub fn new() -> Self {
        Self {
            entries: BTreeMap::new(),
            conflicts: BTreeMap::new(),
        }
    }

    /// Stages a file from a 40-character hexadecimal object id into the resolved stage.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] when the hex text is not a valid object id, and
    /// [`FractalError::IndexConflict`] when the path normalizes to nothing.
    pub fn stage_file(&mut self, path: &str, mode: FileMode, oid_hex: &str) -> FractalResult<()> {
        let oid = Oid::from_hex(oid_hex)?;
        self.stage_oid(path, mode, oid)
    }

    /// Stages a file from a typed object id into the resolved stage.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::IndexConflict`] when the path normalizes to nothing.
    pub fn stage_oid(&mut self, path: &str, mode: FileMode, oid: Oid) -> FractalResult<()> {
        let clean_path = normalize_path(path, "file")?;
        self.conflicts.remove(&clean_path);
        self.entries
            .insert(clean_path.clone(), StagingEntry::new(clean_path, mode, oid));
        Ok(())
    }

    /// Stages a collapsed sparse-checkout subtree pointing at a pre-computed tree object.
    ///
    /// The entry's display path keeps a trailing `/`, which is what marks the entry as collapsed.
    /// Stripping that slash would make the entry indistinguishable from an ordinary directory and
    /// force the tree builder to expand it. The map key drops it, so the sparse entry and any
    /// later `stage_oid("vendor", ...)` address the same slot instead of coexisting.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::IndexConflict`] when the path normalizes to nothing.
    pub fn stage_sparse_directory(&mut self, dir_path: &str, tree_oid: Oid) -> FractalResult<()> {
        let clean_path = normalize_path(dir_path, "sparse directory")?;
        self.conflicts.remove(&clean_path);
        self.entries.insert(
            clean_path.clone(),
            StagingEntry::new_sparse_directory(sparse_display_path(&clean_path), tree_oid),
        );
        Ok(())
    }

    /// Records a multi-stage conflict entry.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::IndexConflict`] when the path normalizes to nothing.
    pub fn stage_conflict(
        &mut self,
        path: &str,
        mode: FileMode,
        oid: Oid,
        stage: IndexStage,
    ) -> FractalResult<()> {
        let clean_path = normalize_path(path, "conflict")?;
        if stage.is_resolved() {
            return self.stage_oid(&clean_path, mode, oid);
        }

        let entry = StagingEntry::with_stage(clean_path.clone(), mode, oid, stage);
        let slot = self
            .conflicts
            .entry(clean_path.clone())
            .or_insert_with(|| ConflictStageSlot::new(clean_path));
        slot.record_stage(&entry);
        Ok(())
    }

    /// Reports whether any conflict stage remains unresolved.
    pub fn has_conflicts(&self) -> bool {
        !self.conflicts.is_empty()
    }

    /// Removes a staged path and any conflict slot for it, reporting whether either existed.
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

    /// Returns the number of resolved staged entries.
    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    /// Returns all resolved staged entries.
    ///
    /// The map key is the path with any trailing separator stripped, so `stage_oid`, `remove_file`
    /// and `resolve_conflict` all address the same slot for a sparse directory and for the
    /// directory it collapses. The authoritative spelling of a path is [`StagingEntry::path`],
    /// which is the only field the tree builder reads.
    pub const fn entries(&self) -> &BTreeMap<String, StagingEntry> {
        &self.entries
    }

    /// Returns all active conflict slots.
    pub const fn conflicts(&self) -> &BTreeMap<String, ConflictStageSlot> {
        &self.conflicts
    }

    /// Returns the number of unresolved conflicts.
    pub fn conflict_count(&self) -> usize {
        self.conflicts.len()
    }

    /// Resolves a conflict slot in favor of a specific entry.
    pub fn resolve_conflict(&mut self, path: &str, resolved_entry: StagingEntry) {
        let clean_path = path.trim_matches('/').replace('\\', "/");
        self.conflicts.remove(&clean_path);
        self.entries.insert(clean_path, resolved_entry);
    }

    /// Returns a scoped copy holding only entries under one of the given prefixes.
    ///
    /// An empty scope list, or a list containing `*`, means "everything". Component boundaries
    /// are strictly enforced via [`fg_core::path_matches_scope`] (`FGT-TOP-001`).
    pub fn filter_by_scope<S: AsRef<str>>(&self, scope_prefixes: &[S]) -> Self {
        let selects_all = scope_prefixes.is_empty()
            || scope_prefixes
                .iter()
                .any(|scope_prefix| scope_prefix.as_ref().trim() == "*");
        if selects_all {
            return self.clone();
        }

        let mut filtered = Self::new();
        for (path, entry) in &self.entries {
            let in_scope = scope_prefixes
                .iter()
                .any(|prefix| fg_core::path_matches_scope(path, prefix.as_ref()));
            if in_scope {
                filtered.entries.insert(path.clone(), entry.clone());
            }
        }
        filtered
    }

    /// Grafts this index's modifications onto a parent entry set.
    ///
    /// Parent entries outside this index's paths are preserved, so a scoped index can be applied
    /// without materializing the whole repository.
    pub fn graft_onto_parent(&self, parent_entries: &BTreeMap<String, (FileMode, Oid)>) -> Self {
        let mut combined = Self::new();
        for (path, (mode, oid)) in parent_entries {
            combined
                .entries
                .insert(path.clone(), StagingEntry::new(path.clone(), *mode, *oid));
        }
        for (path, entry) in &self.entries {
            combined.entries.insert(path.clone(), entry.clone());
        }
        combined
    }

    /// Pops directory frames down to `target_len`, persisting each completed subtree.
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
                let subtree_oid = *subtree.oid();
                if let Some(parent_frame) = dir_stack.last_mut() {
                    parent_frame.entries.push(GitTreeEntry::new(
                        FileMode::Directory,
                        completed_frame.dir_name,
                        subtree_oid,
                    ));
                }
            }
        }
        Ok(())
    }

    /// Finds how much of `dir_path` the current stack already represents, plus the remainder.
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

    /// Pushes frames for the part of a path the stack does not yet represent.
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

    /// Appends one staged entry into the frame that currently represents its parent directory.
    fn append_entry_to_tree<F>(
        dir_stack: &mut Vec<DirectoryFrame>,
        path: &str,
        entry: &StagingEntry,
        persist_tree: &mut F,
    ) -> FractalResult<()>
    where
        F: FnMut(&GitTree) -> FractalResult<()>,
    {
        let (dir_path_opt, entry_name) = match path.rfind('/') {
            Some(slash_idx) => (Some(&path[..slash_idx]), &path[slash_idx + 1..]),
            None => (None, path),
        };

        let (common_depth, mismatch_branch) =
            Self::resolve_directory_branch(dir_path_opt, dir_stack);

        Self::pop_and_persist_down_to(dir_stack, common_depth + 1, persist_tree)?;
        Self::push_mismatch_branches(dir_stack, mismatch_branch);

        let mode = if entry.is_sparse_directory() {
            FileMode::Directory
        } else {
            entry.mode
        };

        if let Some(current_frame) = dir_stack.last_mut() {
            current_frame
                .entries
                .push(GitTreeEntry::new(mode, entry_name.to_owned(), entry.oid));
        }
        Ok(())
    }

    /// Builds the hierarchical Git trees from the staged entries, handing each to a persister.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::IndexConflict`] when any conflict stage is still unresolved, and
    /// propagates persister failures.
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
            return Ok(*empty_tree.oid());
        }

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
        Ok(*root_tree.oid())
    }

    /// Pops directory frames down to `target_len`, serializing and persisting each subtree once.
    fn pop_and_persist_payloads_down_to<F>(
        dir_stack: &mut Vec<DirectoryFrame>,
        target_len: usize,
        persist_payload: &mut F,
    ) -> FractalResult<()>
    where
        F: FnMut(&[u8]) -> FractalResult<Oid>,
    {
        while dir_stack.len() > target_len {
            if let Some(mut completed_frame) = dir_stack.pop() {
                let raw_payload = GitTree::serialize_sorted_entries(&mut completed_frame.entries);
                let subtree_oid = persist_payload(&raw_payload)?;
                if let Some(parent_frame) = dir_stack.last_mut() {
                    parent_frame.entries.push(GitTreeEntry::new(
                        FileMode::Directory,
                        completed_frame.dir_name,
                        subtree_oid,
                    ));
                }
            }
        }
        Ok(())
    }

    /// Appends one staged entry into the frame stack using single-pass payload persistence.
    fn append_entry_to_payload_tree<F>(
        dir_stack: &mut Vec<DirectoryFrame>,
        path: &str,
        entry: &StagingEntry,
        persist_payload: &mut F,
    ) -> FractalResult<()>
    where
        F: FnMut(&[u8]) -> FractalResult<Oid>,
    {
        let (dir_path_opt, entry_name) = match path.rfind('/') {
            Some(slash_idx) => (Some(&path[..slash_idx]), &path[slash_idx + 1..]),
            None => (None, path),
        };

        let (common_depth, mismatch_branch) =
            Self::resolve_directory_branch(dir_path_opt, dir_stack);

        Self::pop_and_persist_payloads_down_to(dir_stack, common_depth + 1, persist_payload)?;
        Self::push_mismatch_branches(dir_stack, mismatch_branch);

        let mode = if entry.is_sparse_directory() {
            FileMode::Directory
        } else {
            entry.mode
        };

        if let Some(current_frame) = dir_stack.last_mut() {
            current_frame
                .entries
                .push(GitTreeEntry::new(mode, entry_name.to_owned(), entry.oid));
        }
        Ok(())
    }

    /// Builds hierarchical Git trees in a single canonical sort + serialize + hash pass per
    /// directory (`FGT-PRF-001`), delegating OID computation directly to `persist_tree_payload`
    /// (typically `|payload| odb.write_object("tree", payload)`).
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::IndexConflict`] when any conflict stage remains unresolved, and
    /// propagates storage persister errors.
    pub fn write_tree_with_payload_persister<F>(
        &self,
        mut persist_tree_payload: F,
    ) -> FractalResult<Oid>
    where
        F: FnMut(&[u8]) -> FractalResult<Oid>,
    {
        if self.has_conflicts() {
            return Err(FractalError::IndexConflict(format!(
                "Cannot build tree: {} unmerged conflicts remain in index",
                self.conflicts.len()
            )));
        }

        if self.entries.is_empty() {
            return persist_tree_payload(&[]);
        }

        let mut dir_stack: Vec<DirectoryFrame> = vec![DirectoryFrame::new("")];
        for (path, entry) in &self.entries {
            Self::append_entry_to_payload_tree(
                &mut dir_stack,
                path,
                entry,
                &mut persist_tree_payload,
            )?;
        }

        Self::pop_and_persist_payloads_down_to(&mut dir_stack, 1, &mut persist_tree_payload)?;

        let Some(mut root_frame) = dir_stack.pop() else {
            return Ok(Oid::ZERO);
        };
        let raw_payload = GitTree::serialize_sorted_entries(&mut root_frame.entries);
        persist_tree_payload(&raw_payload)
    }
}

#[cfg(test)]
mod tests {
    use fg_core::models::{FileMode, IndexStage, Oid};
    use fg_object::GitTree;

    use super::InMemoryIndexTree;

    fn oid_from(seed: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = seed;
        Oid::from_bytes(raw)
    }

    fn collect_trees(index: &InMemoryIndexTree) -> Vec<GitTree> {
        let mut collected = Vec::new();
        index
            .write_tree_with_persister(|tree| {
                collected.push(tree.clone());
                Ok(())
            })
            .expect("tree build");
        collected
    }

    #[test]
    fn stage_file_normalizes_separators_and_slashes() {
        let mut index = InMemoryIndexTree::new();
        index
            .stage_oid("/src\\main.rs/", FileMode::RegularFile, oid_from(1))
            .expect("stage");
        assert!(index.entries().contains_key("src/main.rs"));
    }

    #[test]
    fn stage_rejects_empty_path() {
        let mut index = InMemoryIndexTree::new();
        assert!(index
            .stage_oid("///", FileMode::RegularFile, oid_from(1))
            .is_err());
        assert!(index.stage_sparse_directory("", oid_from(1)).is_err());
    }

    #[test]
    fn sparse_directory_keeps_its_collapsed_marker() {
        // The trailing slash is what marks the entry as collapsed; stripping it silently expands
        // the subtree on the next tree build.
        let mut index = InMemoryIndexTree::new();
        index
            .stage_sparse_directory("vendor", oid_from(2))
            .expect("stage sparse");

        let stored = index.entries().get("vendor").expect("stored");
        assert_eq!(stored.path, "vendor/");
        assert!(stored.is_sparse_directory());
    }

    #[test]
    fn sparse_directory_projects_onto_a_directory_tree_entry() {
        let mut index = InMemoryIndexTree::new();
        index
            .stage_sparse_directory("vendor", oid_from(2))
            .expect("stage sparse");

        let trees = collect_trees(&index);
        let root = trees.last().expect("root tree");
        let entry = root
            .entries()
            .iter()
            .find(|candidate| candidate.name == "vendor")
            .expect("vendor entry");
        assert_eq!(entry.mode, FileMode::Directory);
        assert_eq!(entry.oid, oid_from(2));
    }

    #[test]
    fn nested_paths_build_one_tree_per_directory() {
        let mut index = InMemoryIndexTree::new();
        index
            .stage_oid("src/lib.rs", FileMode::RegularFile, oid_from(1))
            .expect("stage");
        index
            .stage_oid("src/deep/mod.rs", FileMode::RegularFile, oid_from(2))
            .expect("stage");
        index
            .stage_oid("README.md", FileMode::RegularFile, oid_from(3))
            .expect("stage");

        let trees = collect_trees(&index);
        // deep, src, root
        assert_eq!(trees.len(), 3);
        let root = trees.last().expect("root");
        let names: Vec<&str> = root.entries().iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["README.md", "src"]);
    }

    #[test]
    fn conflict_stages_block_tree_construction() {
        let mut index = InMemoryIndexTree::new();
        index
            .stage_conflict(
                "a.txt",
                FileMode::RegularFile,
                oid_from(1),
                IndexStage::Ours,
            )
            .expect("stage conflict");
        assert!(index.has_conflicts());
        assert!(index.write_tree_with_persister(|_| Ok(())).is_err());
    }

    #[test]
    fn staging_a_resolved_entry_clears_its_conflict_slot() {
        let mut index = InMemoryIndexTree::new();
        index
            .stage_conflict(
                "a.txt",
                FileMode::RegularFile,
                oid_from(1),
                IndexStage::Ours,
            )
            .expect("stage conflict");
        index
            .stage_oid("a.txt", FileMode::RegularFile, oid_from(9))
            .expect("stage resolved");

        assert!(!index.has_conflicts());
        assert_eq!(
            index.entries().get("a.txt").map(|entry| entry.oid),
            Some(oid_from(9))
        );
    }

    #[test]
    fn filter_by_scope_selects_prefixes_and_wildcard() {
        let mut index = InMemoryIndexTree::new();
        index
            .stage_oid("src/a.rs", FileMode::RegularFile, oid_from(1))
            .expect("stage");
        index
            .stage_oid("src-extra/evil.rs", FileMode::RegularFile, oid_from(3))
            .expect("stage");
        index
            .stage_oid("docs/b.md", FileMode::RegularFile, oid_from(2))
            .expect("stage");

        let scoped = index.filter_by_scope(&["src".to_owned()]);
        assert_eq!(scoped.entry_count(), 1);
        assert!(scoped.entries().contains_key("src/a.rs"));
        assert!(!scoped.entries().contains_key("src-extra/evil.rs"));

        let all = index.filter_by_scope(&["*".to_owned()]);
        assert_eq!(all.entry_count(), 3);
    }

    #[test]
    fn payload_persister_matches_tree_persister_byte_for_byte() {
        let mut index = InMemoryIndexTree::new();
        index
            .stage_oid("src/lib.rs", FileMode::RegularFile, oid_from(1))
            .expect("stage");
        index
            .stage_oid("src/deep/mod.rs", FileMode::RegularFile, oid_from(2))
            .expect("stage");
        index
            .stage_oid("README.md", FileMode::RegularFile, oid_from(3))
            .expect("stage");

        let expected = index.write_tree_with_persister(|_| Ok(())).expect("tree");
        let actual = index
            .write_tree_with_payload_persister(|payload| {
                Ok(fg_core::models::compute_object_oid(
                    fg_core::models::ObjectKind::Tree,
                    payload,
                ))
            })
            .expect("payload tree");
        assert_eq!(actual, expected);
    }

    #[test]
    fn graft_preserves_parent_entries_outside_scope() {
        let mut index = InMemoryIndexTree::new();
        index
            .stage_oid("src/a.rs", FileMode::RegularFile, oid_from(9))
            .expect("stage");

        let mut parent = std::collections::BTreeMap::new();
        parent.insert("docs/b.md".to_owned(), (FileMode::RegularFile, oid_from(2)));
        parent.insert("src/a.rs".to_owned(), (FileMode::RegularFile, oid_from(1)));

        let combined = index.graft_onto_parent(&parent);
        assert_eq!(combined.entry_count(), 2);
        assert_eq!(
            combined.entries().get("src/a.rs").map(|entry| entry.oid),
            Some(oid_from(9))
        );
        assert!(combined.entries().contains_key("docs/b.md"));
    }

    #[test]
    fn empty_index_produces_the_empty_tree() {
        let index = InMemoryIndexTree::new();
        let oid = index.write_tree_with_persister(|_| Ok(())).expect("build");
        assert_eq!(oid.to_hex(), "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    }
}
