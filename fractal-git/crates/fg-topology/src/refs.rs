//! Module: fg-topology — Hierarchical Fractal Reference Namespace
//! File Path: crates/fg-topology/src/refs.rs
//! Architecture Role: Manages self-similar Git reference namespaces (`refs/fractal/...`),
//!   strictly separating trunk, cell, card, and subagent pointers with atomic CAS updates.

use std::fs;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use fg_core::traits::RefStore;

/// Enumeration of all valid reference types in the Fractal Git namespace.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum FractalRef {
    /// System Trunk: Standard Git ecosystem root branch (e.g. `refs/heads/main`).
    /// In Dual-Trunk mode, System Trunk strictly ONLY accepts verified promotions
    /// from Integration Trunk!
    SystemTrunk { branch: String },
    /// Integration Trunk: Self-similar fractal integration trunk
    /// (`refs/fractal/trunk` or `refs/fractal/integration`).
    Trunk,
    /// Cell Main integration line (`refs/fractal/cell/{cell_id}/main`).
    CellMain { cell_id: String },
    /// Card Worktree / local integration line (`refs/fractal/cell/{cell_id}/card/{card_id}`).
    CardWorktree { cell_id: String, card_id: String },
    /// Ephemeral SubAgent Worktree
    /// (`refs/fractal/cell/{cell_id}/card/{card_id}/sub/{subagent_id}`).
    SubAgentWorktree {
        cell_id: String,
        card_id: String,
        subagent_id: String,
    },
}

impl FractalRef {
    /// Formats the reference into its standard Git ref path string.
    pub fn to_git_ref(&self) -> String {
        use fg_core::constants::{git::REF_HEADS_PREFIX, refs::*};
        match self {
            Self::SystemTrunk { branch } => format!("{}{}", REF_HEADS_PREFIX, branch),
            Self::Trunk => REF_FRACTAL_TRUNK.to_string(),
            Self::CellMain { cell_id } => format!("{}cell/{}/main", REF_FRACTAL_PREFIX, cell_id),
            Self::CardWorktree { cell_id, card_id } => {
                format!("{}cell/{}/card/{}", REF_FRACTAL_PREFIX, cell_id, card_id)
            }
            Self::SubAgentWorktree {
                cell_id,
                card_id,
                subagent_id,
            } => format!(
                "{}cell/{}/card/{}/sub/{}",
                REF_FRACTAL_PREFIX, cell_id, card_id, subagent_id
            ),
        }
    }

    /// Parses a string into a strongly-typed FractalRef if it belongs to the fractal
    /// namespace or standard system heads.
    pub fn parse(ref_str: &str) -> Option<Self> {
        let parts: Vec<&str> = ref_str.split('/').collect();
        if parts.is_empty() {
            return None;
        }

        // Standard Git System Heads: refs/heads/{branch} or plain "main" / "master"
        if parts.len() == 3 && parts[0] == "refs" && parts[1] == "heads" {
            return Some(Self::SystemTrunk {
                branch: parts[2].to_string(),
            });
        }
        if parts.len() == 1 && (parts[0] == "main" || parts[0] == "master") {
            return Some(Self::SystemTrunk {
                branch: parts[0].to_string(),
            });
        }

        if parts.len() < 3 || parts[0] != "refs" || parts[1] != "fractal" {
            return None;
        }

        match parts[2] {
            "trunk" | "integration" => Some(Self::Trunk),
            "cell" if parts.len() == 5 && parts[4] == "main" => Some(Self::CellMain {
                cell_id: parts[3].to_string(),
            }),
            "cell" if parts.len() == 6 && parts[4] == "card" => Some(Self::CardWorktree {
                cell_id: parts[3].to_string(),
                card_id: parts[5].to_string(),
            }),
            "cell" if parts.len() == 8 && parts[4] == "card" && parts[6] == "sub" => {
                Some(Self::SubAgentWorktree {
                    cell_id: parts[3].to_string(),
                    card_id: parts[5].to_string(),
                    subagent_id: parts[7].to_string(),
                })
            }
            _ => None,
        }
    }

    /// Computes the disk path for loose reference storage in `.git/`.
    pub fn disk_path(&self, git_dir: &Path) -> PathBuf {
        git_dir.join(self.to_git_ref())
    }

    /// Reads the current commit OID pointed to by this reference.
    pub fn read_oid(&self, git_dir: &Path) -> FractalResult<Option<Oid>> {
        let path = self.disk_path(git_dir);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)?;
        let oid = Oid::from_hex(content.trim())?;
        Ok(Some(oid))
    }

    /// Atomically updates reference to target commit OID.
    pub fn update_oid(&self, git_dir: &Path, new_oid: &Oid) -> FractalResult<()> {
        let path = self.disk_path(git_dir);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let staging_path = path.with_extension("tmp");
        fs::write(&staging_path, format!("{}\n", new_oid.to_hex()))?;
        fs::rename(&staging_path, &path)?;
        Ok(())
    }

    /// Deletes the reference file from disk.
    pub fn delete_ref(&self, git_dir: &Path) -> FractalResult<bool> {
        let path = self.disk_path(git_dir);
        if path.exists() {
            fs::remove_file(path)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

/// On-disk filesystem implementation of RefStore trait.
pub struct DiskRefStore {
    git_dir: PathBuf,
}

impl DiskRefStore {
    pub fn new(git_dir: impl Into<PathBuf>) -> Self {
        Self {
            git_dir: git_dir.into(),
        }
    }

    /// Recursively lists all loose references discovered on disk under `.git/refs/`.
    pub fn list_all(&self) -> FractalResult<Vec<(String, Oid)>> {
        let refs_dir = self.git_dir.join("refs");
        if !refs_dir.exists() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();
        Self::scan_dir(&refs_dir, &self.git_dir, &mut results)?;
        Ok(results)
    }

    fn scan_dir(dir: &Path, git_dir: &Path, results: &mut Vec<(String, Oid)>) -> FractalResult<()> {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    Self::scan_dir(&path, git_dir, results)?;
                } else if path.is_file() {
                    if let Ok(rel) = path.strip_prefix(git_dir) {
                        let ref_name = rel.to_string_lossy().replace('\\', "/");
                        if let Ok(content) = fs::read_to_string(&path) {
                            if let Ok(oid) = Oid::from_hex(content.trim()) {
                                results.push((ref_name, oid));
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

impl RefStore for DiskRefStore {
    fn get_ref(&self, ref_name: &str) -> FractalResult<Option<Oid>> {
        let path = self.git_dir.join(ref_name);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)?;
        let oid = Oid::from_hex(content.trim())?;
        Ok(Some(oid))
    }

    fn update_ref(
        &self,
        ref_name: &str,
        new_oid: &Oid,
        expected_old: Option<&Oid>,
    ) -> FractalResult<()> {
        let path = self.git_dir.join(ref_name);
        if let Some(expected) = expected_old {
            let current = self.get_ref(ref_name)?;
            if current.as_ref() != Some(expected) {
                return Err(FractalError::IndexConflict(format!(
                    "CAS ref update conflict on {}: expected {:?}, got {:?}",
                    ref_name, expected, current
                )));
            }
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let staging_path = path.with_extension("tmp");
        fs::write(&staging_path, format!("{}\n", new_oid.to_hex()))?;
        fs::rename(&staging_path, &path)?;
        Ok(())
    }

    fn delete_ref(&self, ref_name: &str) -> FractalResult<bool> {
        let path = self.git_dir.join(ref_name);
        if path.exists() {
            fs::remove_file(path)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
