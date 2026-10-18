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
    Trunk,
    CellMain {
        cell_id: String,
    },
    CardWorktree {
        cell_id: String,
        card_id: String,
    },
    SubAgentWorktree {
        cell_id: String,
        card_id: String,
        subagent_id: String,
    },
}

impl FractalRef {
    /// Formats the reference into its standard Git ref path string.
    pub fn to_git_ref(&self) -> String {
        match self {
            Self::Trunk => "refs/fractal/trunk".to_string(),
            Self::CellMain { cell_id } => format!("refs/fractal/cell/{}/main", cell_id),
            Self::CardWorktree { cell_id, card_id } => {
                format!("refs/fractal/cell/{}/card/{}", cell_id, card_id)
            }
            Self::SubAgentWorktree {
                cell_id,
                card_id,
                subagent_id,
            } => format!(
                "refs/fractal/cell/{}/card/{}/sub/{}",
                cell_id, card_id, subagent_id
            ),
        }
    }

    /// Parses a string into a strongly-typed FractalRef if it belongs to the fractal namespace.
    pub fn parse(ref_str: &str) -> Option<Self> {
        let parts: Vec<&str> = ref_str.split('/').collect();
        if parts.len() < 3 || parts[0] != "refs" || parts[1] != "fractal" {
            return None;
        }

        match parts[2] {
            "trunk" => Some(Self::Trunk),
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

        let temp_path = path.with_extension("tmp");
        fs::write(&temp_path, format!("{}\n", new_oid.to_hex()))?;
        fs::rename(&temp_path, &path)?;
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

    fn update_ref(&self, ref_name: &str, new_oid: &Oid, expected_old: Option<&Oid>) -> FractalResult<()> {
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
        let temp_path = path.with_extension("tmp");
        fs::write(&temp_path, format!("{}\n", new_oid.to_hex()))?;
        fs::rename(&temp_path, &path)?;
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
