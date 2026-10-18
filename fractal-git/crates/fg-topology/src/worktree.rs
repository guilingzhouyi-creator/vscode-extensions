//! Module: fg-topology — Fractal Worktree & Path Jail Isolation
//! File Path: crates/fg-topology/src/worktree.rs
//! Architecture Role: Models physical and virtual worktree bindings with Path Jail isolation,
//!   preventing concurrent agents from cross-contaminating files or touching unauthorized trees.

use fg_core::error::{FractalError, FractalResult};
use std::path::PathBuf;

use crate::refs::FractalRef;

/// Path Jail security boundary specifying permissible write subtrees.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathJail {
    pub allowed_prefixes: Vec<String>,
}

impl PathJail {
    /// Creates a jail permitting writes only under specified prefixes.
    pub fn new(allowed_prefixes: Vec<String>) -> Self {
        Self { allowed_prefixes }
    }

    /// Creates an open jail allowing all paths.
    pub fn unrestricted() -> Self {
        Self {
            allowed_prefixes: Vec::new(),
        }
    }

    /// Verifies whether writing to target file path is permitted within the jail.
    pub fn is_permitted(&self, relative_path: &str) -> bool {
        if self.allowed_prefixes.is_empty() {
            return true;
        }
        let clean = relative_path.trim_matches('/').replace('\\', "/");
        self.allowed_prefixes
            .iter()
            .any(|prefix| clean.starts_with(prefix))
    }

    /// Enforces jail boundary, returning error if path is unauthorized.
    pub fn assert_permitted(&self, relative_path: &str) -> FractalResult<()> {
        if self.is_permitted(relative_path) {
            Ok(())
        } else {
            Err(FractalError::TopologyBreach {
                source_ref: relative_path.to_string(),
                target_ref: format!("Jail({:?})", self.allowed_prefixes),
                reason: "Path Jail violation: write outside authorized subpath envelope".into(),
            })
        }
    }
}

/// A physical or virtual Fractal Git worktree instance.
#[derive(Debug, Clone)]
pub struct FractalWorktree {
    pub worktree_id: String,
    pub fractal_ref: FractalRef,
    pub physical_path: Option<PathBuf>,
    pub jail: PathJail,
}

impl FractalWorktree {
    /// Constructs a worktree with optional physical directory and Path Jail.
    pub fn new(
        worktree_id: impl Into<String>,
        fractal_ref: FractalRef,
        physical_path: Option<PathBuf>,
        jail: PathJail,
    ) -> Self {
        Self {
            worktree_id: worktree_id.into(),
            fractal_ref,
            physical_path,
            jail,
        }
    }

    /// Checks if a proposed file change violates this worktree's Path Jail.
    pub fn check_write(&self, relative_path: &str) -> FractalResult<()> {
        self.jail.assert_permitted(relative_path)
    }

    /// Checks if this worktree has a dedicated physical directory on disk.
    pub fn has_physical_path(&self) -> bool {
        self.physical_path
            .as_ref()
            .map(|p| p.exists())
            .unwrap_or(false)
    }
}
