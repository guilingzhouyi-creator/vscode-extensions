//! Module: fg-core — Submodule Entry & Lifecycle Model
//! File Path: crates/fg-core/src/models/submodule.rs
//! Architecture Role: Strongly typed value object and validation logic for nested Git submodule bindings.
//! Dependencies & Triggers: Consumed by fg-index (.gitmodules codec), fg-topology (tree traversal),
//!   and taxis submodule CLI.
//! Responsibilities: Encapsulate submodule configuration, path jail validation, and update strategies.
//! Exit Semantics & Design Rationale:
//!   - Enforces Path Jail security: rejects absolute paths, drive letters, and escaping `..` traversal.
//!   - Maps Gitlink mode `160000` to recorded submodule OID bindings without ambiguity.

use serde::{Deserialize, Serialize};

use crate::error::FractalResult;
use crate::models::Oid;

/// Submodule update strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum SubmoduleUpdateStrategy {
    /// Checkout the commit recorded in the superproject.
    #[default]
    Checkout,
    /// Rebase the current branch onto the commit recorded in the superproject.
    Rebase,
    /// Merge the commit recorded in the superproject into the current branch.
    Merge,
    /// Do not update this submodule.
    None,
}

impl SubmoduleUpdateStrategy {
    /// Canonical string spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Checkout => "checkout",
            Self::Rebase => "rebase",
            Self::Merge => "merge",
            Self::None => "none",
        }
    }

    /// Parses string representation.
    pub fn parse_str(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "checkout" => Some(Self::Checkout),
            "rebase" => Some(Self::Rebase),
            "merge" => Some(Self::Merge),
            "none" => Some(Self::None),
            _ => None,
        }
    }
}

/// Representation of one submodule binding declared in `.gitmodules`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubmoduleEntry {
    /// Logical submodule name (e.g. "vendor/lib").
    pub name: String,
    /// Relative path within working tree where submodule is mounted.
    pub path: String,
    /// Remote repository URL.
    pub url: String,
    /// Optional tracked remote branch.
    pub branch: Option<String>,
    /// Gitlink commit OID bound in parent tree (mode 160000).
    pub commit_oid: Option<Oid>,
    /// Configured update strategy.
    pub update_strategy: SubmoduleUpdateStrategy,
    /// Whether the submodule is currently initialized in local configuration.
    pub initialized: bool,
}

impl SubmoduleEntry {
    /// Creates and validates a new submodule entry.
    ///
    /// # Errors
    /// Returns [`FractalError::SecurityBreach`] if `path` violates Path Jail constraints.
    pub fn new(
        name: impl Into<String>,
        path: impl Into<String>,
        url: impl Into<String>,
    ) -> FractalResult<Self> {
        let name_str = name.into();
        let path_str = path.into();
        let url_str = url.into();

        Self::validate_path(&path_str)?;

        Ok(Self {
            name: name_str,
            path: path_str,
            url: url_str,
            branch: None,
            commit_oid: None,
            update_strategy: SubmoduleUpdateStrategy::Checkout,
            initialized: false,
        })
    }

    /// Validates path jail safety invariants for submodule mount path.
    ///
    /// Delegates to the shared repository path jail so submodule mounts and worktree
    /// materialization enforce exactly one path policy.
    ///
    /// # Errors
    /// Returns [`FractalError::PolicyViolation`] when the mount path would escape the worktree.
    pub fn validate_path(path: &str) -> FractalResult<()> {
        crate::models::repo_path::validate_repo_relative_path(path)
    }

    /// Sets optional branch.
    pub fn with_branch(mut self, branch: impl Into<String>) -> Self {
        self.branch = Some(branch.into());
        self
    }

    /// Sets Gitlink commit OID.
    pub fn with_commit_oid(mut self, oid: Oid) -> Self {
        self.commit_oid = Some(oid);
        self
    }

    /// Sets update strategy.
    pub fn with_update_strategy(mut self, strategy: SubmoduleUpdateStrategy) -> Self {
        self.update_strategy = strategy;
        self
    }

    /// Sets initialized status.
    pub fn with_initialized(mut self, initialized: bool) -> Self {
        self.initialized = initialized;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::{SubmoduleEntry, SubmoduleUpdateStrategy};

    #[test]
    fn valid_submodule_path_passes() {
        let entry =
            SubmoduleEntry::new("my-lib", "vendor/my-lib", "https://github.com/foo/bar.git")
                .expect("valid entry");
        assert_eq!(entry.name, "my-lib");
        assert_eq!(entry.path, "vendor/my-lib");
        assert_eq!(entry.update_strategy, SubmoduleUpdateStrategy::Checkout);
    }

    #[test]
    fn path_traversal_is_blocked() {
        assert!(SubmoduleEntry::new("bad", "../escaping", "https://example.com").is_err());
        assert!(
            SubmoduleEntry::new("bad", "vendor/../../escaping", "https://example.com").is_err()
        );
        assert!(SubmoduleEntry::new("bad", "/absolute/path", "https://example.com").is_err());
        assert!(SubmoduleEntry::new("bad", "C:\\escaped", "https://example.com").is_err());
    }
}
