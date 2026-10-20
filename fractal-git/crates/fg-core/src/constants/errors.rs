//! Module: fg-core — Standardized Diagnostic & Error Phrase Constants
//! File Path: crates/fg-core/src/constants/errors.rs
//! Architecture Role: Canonical diagnostic and error message formats across Fractal Git,
//!   preventing ad-hoc string variations and supporting unified telemetry assertions.

/// Error diagnostic prefix for PreReceive human authority breaches.
pub const ERR_AUTHORITY_BREACH_PREFIX: &str = "AUTHORITY_BREACH";

/// Error diagnostic prefix for CommitMessageGuard rejections.
pub const ERR_COMMIT_GOVERNANCE_FAIL_PREFIX: &str = "COMMIT_GOVERNANCE_FAIL";

/// Error diagnostic prefix for TopologyVerifier illegal merges.
pub const ERR_TOPOLOGY_VERIFY_FAIL_PREFIX: &str = "VERIFY_FAIL";

/// Error diagnostic prefix for UAC authorization failures.
pub const ERR_UAC_APPROVAL_FAILED_PREFIX: &str = "UAC_APPROVAL_FAILED";

/// Diagnostic message when commit message body is empty.
pub const MSG_COMMIT_MESSAGE_CANNOT_BE_EMPTY: &str = "Commit message cannot be empty";

/// Diagnostic message when unresolved Git conflict marker is found.
pub const MSG_UNRESOLVED_CONFLICT_MARKER: &str = "Unresolved Git conflict marker detected";

/// Diagnostic message when active worktree quota is exceeded.
pub const MSG_QUOTA_WORKTREE_EXCEEDED: &str = "Active worktree quota exceeded";

/// Diagnostic message when storage quota is exceeded.
pub const MSG_QUOTA_STORAGE_EXCEEDED: &str = "Storage budget quota exceeded";

/// Diagnostic message for Path Jail envelope breach.
pub const MSG_PATH_JAIL_VIOLATION: &str =
    "Path Jail violation: write outside authorized subpath envelope";
