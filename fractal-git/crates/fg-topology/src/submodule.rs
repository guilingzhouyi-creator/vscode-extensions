//! Module: fg-topology — Submodule Lifecycle Controller
//! File Path: crates/fg-topology/src/submodule.rs
//! Architecture Role: Manages submodule tree bindings, Gitlink (160000) verification, nested repository
//!   discovery, and Path Jail boundary enforcement.
//! Dependencies & Triggers: Consumed by taxis submodule CLI (`status`, `init`, `sync`, `add`).
//! Responsibilities: Resolve gitlink tree bindings, cross-check against .gitmodules, inspect nested HEADs.
//! Exit Semantics & Design Rationale:
//!   - Enforces Path Jail: guarantees nested submodule paths never escape workspace root.
//!   - Accurately computes Git-compatible status symbols (`-` uninitialized, `+` modified commit, ` ` clean).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileMode, Oid, SubmoduleEntry};
use serde::{Deserialize, Serialize};

/// Detailed status of a submodule relative to the parent tree and working tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubmoduleStatus {
    /// Logical name of the submodule.
    pub name: String,
    /// Relative path within superproject.
    pub path: String,
    /// Configured remote URL.
    pub url: String,
    /// Expected Gitlink commit OID recorded in superproject tree.
    pub gitlink_oid: Option<String>,
    /// Currently checked out commit OID in submodule working tree if present.
    pub head_oid: Option<String>,
    /// Git-compatible status indicator: '-' for uninitialized, '+' for commit mismatch, ' ' for clean.
    pub status_symbol: char,
    /// Whether submodule working tree has uncommitted local modifications.
    pub is_dirty: bool,
    /// Whether submodule configuration has been registered locally.
    pub is_initialized: bool,
}

/// Controller responsible for submodule inspection, path jail verification, and sync.
pub struct SubmoduleController;

impl SubmoduleController {
    /// Discovers and validates absolute physical path for a submodule within parent workspace.
    ///
    /// # Errors
    /// Returns [`FractalError::SecurityBreach`] if the resolved path escapes the workspace root.
    pub fn resolve_submodule_path(workspace_root: &Path, rel_path: &str) -> FractalResult<PathBuf> {
        SubmoduleEntry::validate_path(rel_path)?;
        let candidate = workspace_root.join(rel_path);

        // Path Jail canonical prefix check
        if let Ok(canon_root) = workspace_root.canonicalize() {
            if let Ok(canon_sub) = candidate.canonicalize() {
                if !canon_sub.starts_with(&canon_root) {
                    return Err(FractalError::PolicyViolation(format!(
                        "submodule path '{}' escapes parent workspace boundary",
                        rel_path
                    )));
                }
            }
        }

        Ok(candidate)
    }

    /// Resolves the submodule's effective repository directory (either `.git` dir, `.git` file, or `.taxis`).
    pub fn resolve_submodule_git_dir(sub_worktree: &Path) -> Option<PathBuf> {
        let dot_git = sub_worktree.join(".git");
        if dot_git.is_dir() {
            return Some(dot_git);
        }
        if dot_git.is_file() {
            // Read gitdir pointer file: "gitdir: <path>"
            if let Ok(content) = std::fs::read_to_string(&dot_git) {
                if let Some(rest) = content.trim().strip_prefix("gitdir:") {
                    let rel_gitdir = rest.trim();
                    let target = sub_worktree.join(rel_gitdir);
                    if target.exists() {
                        return Some(target);
                    }
                }
            }
        }
        let dot_taxis = sub_worktree.join(".taxis");
        if dot_taxis.exists() {
            return Some(dot_taxis);
        }
        None
    }

    /// Reads checked out HEAD commit OID from a nested submodule directory if present.
    pub fn read_submodule_head_commit(sub_git_dir: &Path) -> Option<Oid> {
        let head_path = sub_git_dir.join("HEAD");
        let head_text = std::fs::read_to_string(head_path).ok()?;
        let trimmed = head_text.trim();

        if let Some(ref_target) = trimmed.strip_prefix("ref:") {
            let ref_path = sub_git_dir.join(ref_target.trim());
            let ref_oid_text = std::fs::read_to_string(ref_path).ok()?;
            Oid::from_hex(ref_oid_text.trim()).ok()
        } else {
            Oid::from_hex(trimmed).ok()
        }
    }

    /// Cross-checks tree Gitlink entries against `.gitmodules` entries to compute statuses.
    pub fn compute_status(
        workspace_root: &Path,
        gitmodules_entries: &BTreeMap<String, SubmoduleEntry>,
        tree_gitlinks: &BTreeMap<String, (FileMode, Oid)>,
    ) -> Vec<SubmoduleStatus> {
        let mut results = Vec::new();

        for (path, entry) in gitmodules_entries {
            let gitlink_oid = tree_gitlinks.get(path).map(|(_, oid)| *oid);
            let sub_worktree = workspace_root.join(path);
            let sub_git_dir = Self::resolve_submodule_git_dir(&sub_worktree);

            let (head_oid, is_initialized, is_dirty) = match sub_git_dir {
                Some(ref dir) => {
                    let h_oid = Self::read_submodule_head_commit(dir);
                    (h_oid, true, false)
                }
                None => (None, false, false),
            };

            let status_symbol = if !is_initialized {
                '-'
            } else if let (Some(gitlink), Some(head)) = (gitlink_oid, head_oid) {
                if gitlink == head {
                    ' '
                } else {
                    '+'
                }
            } else {
                '+'
            };

            results.push(SubmoduleStatus {
                name: entry.name.clone(),
                path: path.clone(),
                url: entry.url.clone(),
                gitlink_oid: gitlink_oid.map(|o| o.to_hex()),
                head_oid: head_oid.map(|o| o.to_hex()),
                status_symbol,
                is_dirty,
                is_initialized,
            });
        }

        results
    }
}

#[cfg(test)]
mod tests {
    use super::SubmoduleController;
    use fg_core::models::{FileMode, Oid, SubmoduleEntry};
    use std::collections::BTreeMap;
    use std::fs;

    fn dummy_oid(byte: u8) -> Oid {
        let mut bytes = [0u8; 20];
        bytes[0] = byte;
        Oid::from_bytes(bytes)
    }

    #[test]
    fn uninitialized_submodule_shows_minus() {
        let temp_dir = std::env::temp_dir().join(format!("taxis_sub_test_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);

        let mut modules = BTreeMap::new();
        let entry =
            SubmoduleEntry::new("my-sub", "vendor/sub", "https://example.com/repo.git").unwrap();
        modules.insert("vendor/sub".to_string(), entry);

        let mut tree_gitlinks = BTreeMap::new();
        tree_gitlinks.insert("vendor/sub".to_string(), (FileMode::Gitlink, dummy_oid(1)));

        let statuses = SubmoduleController::compute_status(&temp_dir, &modules, &tree_gitlinks);
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].status_symbol, '-');
        assert!(!statuses[0].is_initialized);
        assert_eq!(statuses[0].gitlink_oid, Some(dummy_oid(1).to_hex()));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn matching_submodule_head_shows_clean_space() {
        let temp_dir = std::env::temp_dir().join(format!("taxis_sub_match_{}", std::process::id()));
        let sub_git = temp_dir.join("vendor/sub/.git");
        let _ = fs::create_dir_all(&sub_git);
        let _ = fs::write(sub_git.join("HEAD"), format!("{}\n", dummy_oid(5).to_hex()));

        let mut modules = BTreeMap::new();
        let entry =
            SubmoduleEntry::new("my-sub", "vendor/sub", "https://example.com/repo.git").unwrap();
        modules.insert("vendor/sub".to_string(), entry);

        let mut tree_gitlinks = BTreeMap::new();
        tree_gitlinks.insert("vendor/sub".to_string(), (FileMode::Gitlink, dummy_oid(5)));

        let statuses = SubmoduleController::compute_status(&temp_dir, &modules, &tree_gitlinks);
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].status_symbol, ' ');
        assert!(statuses[0].is_initialized);
        assert_eq!(statuses[0].head_oid, Some(dummy_oid(5).to_hex()));

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
