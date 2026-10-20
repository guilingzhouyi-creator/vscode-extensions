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

/// Scope Projection specification defining the delegated subpath region for an agent worktree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeProjection {
    /// Permitted relative path envelopes (e.g. ["auto-refactor/src/analyzers/"]).
    pub scopes: Vec<String>,
    /// Flag indicating whether this is an explicit full universe checkout.
    /// Defaults to false (only System Trunk defaults to full).
    pub is_full: bool,
}

impl ScopeProjection {
    /// Creates a scoped subtree projection for a list of path prefixes.
    pub fn scoped(scopes: Vec<String>) -> Self {
        Self {
            scopes,
            is_full: false,
        }
    }

    /// Creates an explicit full-universe checkout projection.
    pub fn full() -> Self {
        Self {
            scopes: vec!["*".to_string()],
            is_full: true,
        }
    }

    /// Verifies if a path is included within this projection scope.
    pub fn contains_path(&self, relative_path: &str) -> bool {
        if self.is_full {
            return true;
        }
        let clean = relative_path.trim_matches('/').replace('\\', "/");
        self.scopes.iter().any(|prefix| {
            let p_clean = prefix.trim_matches('/').replace('\\', "/");
            clean.starts_with(&p_clean)
        })
    }

    /// Asserts that a child projection's scopes are strictly a subset of this parent projection.
    /// Prevents privilege escalation across fractal delegation boundaries.
    pub fn assert_subsumes(&self, child: &ScopeProjection) -> FractalResult<()> {
        if self.is_full {
            return Ok(());
        }
        if child.is_full {
            return Err(FractalError::TopologyBreach {
                source_ref: "Child(full)".into(),
                target_ref: format!("ParentScopes({:?})", self.scopes),
                reason: "Child worktree cannot request full checkout when parent is scoped".into(),
            });
        }
        for child_scope in &child.scopes {
            let c_clean = child_scope.trim_matches('/').replace('\\', "/");
            let permitted = self.scopes.iter().any(|parent_scope| {
                let p_clean = parent_scope.trim_matches('/').replace('\\', "/");
                c_clean.starts_with(&p_clean)
            });
            if !permitted {
                return Err(FractalError::TopologyBreach {
                    source_ref: child_scope.clone(),
                    target_ref: format!("ParentScopes({:?})", self.scopes),
                    reason: "Child scope breaches parent delegation boundary (not a subset)".into(),
                });
            }
        }
        Ok(())
    }
}

/// A physical or virtual Fractal Git worktree instance.
#[derive(Debug, Clone)]
pub struct FractalWorktree {
    pub worktree_id: String,
    pub fractal_ref: FractalRef,
    pub physical_path: Option<PathBuf>,
    pub jail: PathJail,
    pub parent_ref: Option<FractalRef>,
    pub projection: ScopeProjection,
}

impl FractalWorktree {
    /// Constructs a worktree with optional physical directory and Path Jail.
    pub fn new(
        worktree_id: impl Into<String>,
        fractal_ref: FractalRef,
        physical_path: Option<PathBuf>,
        jail: PathJail,
    ) -> Self {
        let scopes = jail.allowed_prefixes.clone();
        let projection = if scopes.is_empty() {
            ScopeProjection::full()
        } else {
            ScopeProjection::scoped(scopes)
        };
        Self {
            worktree_id: worktree_id.into(),
            fractal_ref,
            physical_path,
            jail,
            parent_ref: None,
            projection,
        }
    }

    /// Constructs a worktree with explicit parent reference and scope projection.
    pub fn with_projection(
        worktree_id: impl Into<String>,
        fractal_ref: FractalRef,
        parent_ref: Option<FractalRef>,
        physical_path: Option<PathBuf>,
        projection: ScopeProjection,
    ) -> Self {
        let jail = if projection.is_full {
            PathJail::unrestricted()
        } else {
            PathJail::new(projection.scopes.clone())
        };
        Self {
            worktree_id: worktree_id.into(),
            fractal_ref,
            physical_path,
            jail,
            parent_ref,
            projection,
        }
    }

    /// Asserts that a child worktree's scope is strictly subsumed by this worktree's scope.
    pub fn assert_child_scope_subsumed(&self, child: &FractalWorktree) -> FractalResult<()> {
        self.projection.assert_subsumes(&child.projection)
    }

    /// Checks if a proposed file change violates this worktree's Path Jail.
    pub fn check_write(&self, relative_path: &str) -> FractalResult<()> {
        self.jail.assert_permitted(relative_path)
    }

    /// Checks if this worktree has a dedicated physical directory on disk.
    pub fn has_physical_path(&self) -> bool {
        self.physical_path
            .as_ref()
            .map(|disk_path| disk_path.exists())
            .unwrap_or(false)
    }
}
