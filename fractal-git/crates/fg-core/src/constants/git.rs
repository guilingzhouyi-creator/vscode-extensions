//! Module: fg-core — Git Protocol & Object Primitives Constants
//! File Path: crates/fg-core/src/constants/git.rs
//! Architecture Role: Canonical constants for Git protocol tokens, loose object headers,
//!   file mode octals, and default repository paths.

/// Canonical Git object type identifier for Blob.
pub const OBJ_BLOB: &str = "blob";

/// Canonical Git object type identifier for Tree.
pub const OBJ_TREE: &str = "tree";

/// Canonical Git object type identifier for Commit.
pub const OBJ_COMMIT: &str = "commit";

/// Canonical Git object type identifier for Tag.
pub const OBJ_TAG: &str = "tag";

/// Standard Git tree octal mode string for regular non-executable files (`0100644`).
pub const MODE_REGULAR_STR: &str = "100644";

/// Standard Git tree octal mode string for executable files (`0100755`).
pub const MODE_EXECUTABLE_STR: &str = "100755";

/// Standard Git tree octal mode string for subdirectories/trees (`040000`).
pub const MODE_DIRECTORY_STR: &str = "40000";

/// Standard Git tree octal mode string for symbolic links (`0120000`).
pub const MODE_SYMLINK_STR: &str = "120000";

/// Standard Git tree octal mode string for gitlinks/submodules (`0160000`).
pub const MODE_GITLINK_STR: &str = "160000";

/// Canonical Git reference name for symbolic HEAD pointer.
pub const REF_HEAD: &str = "HEAD";

/// Canonical prefix for standard Git local branches.
pub const REF_HEADS_PREFIX: &str = "refs/heads/";

/// Canonical prefix for standard Git tags.
pub const REF_TAGS_PREFIX: &str = "refs/tags/";

/// Default branch name for System Trunk in modern Git repositories.
pub const DEFAULT_SYSTEM_BRANCH: &str = "main";

/// Alternative legacy branch name for System Trunk.
pub const LEGACY_SYSTEM_BRANCH: &str = "master";

/// Default Git directory name.
pub const DEFAULT_GIT_DIR: &str = ".git";

/// Default Taxis storage directory name.
pub const DEFAULT_TAXIS_DIR: &str = ".taxis";
