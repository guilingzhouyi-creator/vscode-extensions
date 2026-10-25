//! Module: fg-core — Repository-Relative Path Jail
//! File Path: crates/fg-core/src/models/repo_path.rs
//! Architecture Role: Canonical validator and containment joiner for every repository-relative
//!   path that leaves the object database and reaches the worktree filesystem.
//! Dependencies & Triggers: Consumed by checkout materialization, stale-file reclamation,
//!   submodule mount validation, and any command that turns a tree/index path into OS I/O.
//! Responsibilities: Reject absolute, drive-letter, UNC, alternate-data-stream, traversal,
//!   reserved-device, and trailing-dot filenames before any filesystem mutation happens.
//! Exit Semantics & Design Rationale:
//!   - Every rejection surfaces as [`FractalError::PolicyViolation`]; paths are never silently
//!     normalized or trimmed, because a normalized path would materialize a different object.
//!   - [`safe_join`] re-asserts lexical containment after joining so a validator regression still
//!     cannot escape the worktree root.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-ALG-001`: Git plumbing binary equivalence (path bytes are never rewritten)

use std::path::{Path, PathBuf};

use crate::error::{FractalError, FractalResult};

/// Windows device names that the kernel resolves regardless of the containing directory.
const WINDOWS_RESERVED_NAMES: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Builds the single rejection surface for path-jail violations.
fn violation(path: &str, reason: &str) -> FractalError {
    FractalError::PolicyViolation(format!("repository path '{path}' {reason}"))
}

/// Validates that `path` is a safe repository-relative path.
///
/// A valid path uses `/` separators only, is not absolute, contains no empty, `.` or `..`
/// component, carries no NUL byte, no drive letter or alternate-data-stream colon, and no
/// component that Windows would reinterpret (reserved device name, trailing dot, trailing space).
///
/// # Errors
/// Returns [`FractalError::PolicyViolation`] naming the offending path and the violated rule.
pub fn validate_repo_relative_path(path: &str) -> FractalResult<()> {
    if path.is_empty() {
        return Err(violation(path, "cannot be empty"));
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return Err(violation(
            path,
            "must be relative and cannot start with a separator",
        ));
    }
    if path.contains('\\') {
        return Err(violation(
            path,
            "must use '/' separators and cannot contain a backslash",
        ));
    }
    if path.ends_with('/') {
        return Err(violation(path, "cannot end with a separator"));
    }
    if path.contains('\0') {
        return Err(violation(path, "cannot contain a NUL byte"));
    }
    if path.contains(':') {
        return Err(violation(
            path,
            "cannot contain ':' (drive letter or alternate data stream)",
        ));
    }

    for component in path.split('/') {
        if component.is_empty() {
            return Err(violation(path, "contains an empty path component"));
        }
        if component == "." || component == ".." {
            return Err(violation(path, "contains a traversal component"));
        }
        if component.ends_with(' ') || component.ends_with('.') {
            return Err(violation(
                path,
                "contains a component ending in a space or dot",
            ));
        }
        let device_stem = component
            .split('.')
            .next()
            .unwrap_or(component)
            .trim()
            .to_ascii_lowercase();
        if WINDOWS_RESERVED_NAMES.contains(&device_stem.as_str()) {
            return Err(violation(path, "names a Windows reserved device"));
        }
    }

    Ok(())
}

/// A repository-relative path that already passed [`validate_repo_relative_path`].
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RepoPath(String);

impl RepoPath {
    /// Validates and wraps a repository-relative path.
    ///
    /// # Errors
    /// Returns [`FractalError::PolicyViolation`] when the path violates the path jail.
    pub fn parse(path: impl Into<String>) -> FractalResult<Self> {
        let raw = path.into();
        validate_repo_relative_path(&raw)?;
        Ok(Self(raw))
    }

    /// Returns the validated path spelling.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Resolves the validated path under `root`, re-asserting lexical containment.
    ///
    /// # Errors
    /// Returns [`FractalError::PolicyViolation`] if the joined path is not lexically contained.
    pub fn join_under(&self, root: &Path) -> FractalResult<PathBuf> {
        safe_join(root, &self.0)
    }
}

impl std::fmt::Display for RepoPath {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Validates `rel` and joins it under `root`, rejecting any escape from the worktree.
///
/// # Errors
/// Returns [`FractalError::PolicyViolation`] when `rel` fails validation or the joined path
/// does not start with `root`.
pub fn safe_join(root: &Path, rel: &str) -> FractalResult<PathBuf> {
    validate_repo_relative_path(rel)?;
    let joined = root.join(rel);
    if !joined.starts_with(root) {
        return Err(violation(rel, "escapes the worktree root after joining"));
    }
    Ok(joined)
}

#[cfg(test)]
mod tests {
    use super::{safe_join, validate_repo_relative_path, RepoPath};
    use std::path::Path;

    #[test]
    fn test_accepts_ordinary_relative_paths() {
        for path in [
            "a.txt",
            "src/main.rs",
            "src/deep/mod.rs",
            "a b/c-d_e.txt",
            ".gitmodules",
        ] {
            assert!(
                validate_repo_relative_path(path).is_ok(),
                "rejected '{path}'"
            );
        }
    }

    #[test]
    fn test_rejects_escapes_and_absolute_paths() {
        for path in [
            "",
            "/etc/passwd",
            r"\\server\share\file",
            concat!("C:", "/Windows/system32"),
            "src\\main.rs",
            "../outside.txt",
            "src/../../outside.txt",
            "src/./main.rs",
            "src//main.rs",
            "src/",
        ] {
            assert!(
                validate_repo_relative_path(path).is_err(),
                "accepted '{path}'"
            );
        }
    }

    #[test]
    fn test_rejects_windows_reinterpretation() {
        for path in [
            "CON",
            "con.txt",
            "src/aux",
            "LPT9.txt",
            "src/trailing.",
            "src/trailing ",
            "file:stream",
        ] {
            assert!(
                validate_repo_relative_path(path).is_err(),
                "accepted '{path}'"
            );
        }
    }

    #[test]
    fn test_safe_join_stays_under_root() {
        let root = Path::new("/work/repo");
        assert_eq!(
            safe_join(root, "src/main.rs").expect("contained path"),
            root.join("src/main.rs")
        );
        assert!(safe_join(root, "../escape.txt").is_err());
    }

    #[test]
    fn test_repo_path_newtype_round_trip() {
        let path = RepoPath::parse("src/lib.rs").expect("valid path");
        assert_eq!(path.as_str(), "src/lib.rs");
        assert_eq!(path.to_string(), "src/lib.rs");
        assert!(RepoPath::parse("/abs/path").is_err());
    }
}
