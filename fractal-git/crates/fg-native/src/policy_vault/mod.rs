//! Module: fg-native — Hidden Encrypted Binary Policy Vault Storage
//! File Path: crates/fg-native/src/policy_vault/mod.rs
//! Architecture Role: Kernel-exclusive atomic persistence and integrity verification for
//!   `.taxis-policy.txp` and `.taxis-policy.seal` without runtime JSON manifests.

mod helpers;
mod store;
#[cfg(test)]
mod tests;

use std::path::PathBuf;

use fg_core::models::SealedPolicyPayload;

pub use store::PolicyVaultStore;

/// Loaded and cryptographically verified repository policy vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedPolicyVault {
    /// Common metadata directory holding the vault and seal (follows `commondir` on worktrees).
    pub common_dir: PathBuf,
    /// Full filesystem path to `.taxis-policy.txp`.
    pub vault_path: PathBuf,
    /// Full filesystem path to `.taxis-policy.seal`.
    pub seal_path: PathBuf,
    /// Decrypted, authenticated binary policy configuration.
    pub payload: SealedPolicyPayload,
}

/// Fail-closed state classification when inspecting a repository's hidden policy vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyVaultState {
    /// Encrypted policy vault exists, matches repository binding, and passed `HMAC-SM3`.
    Sealed(Box<LoadedPolicyVault>),
    /// Repository carries Taxis initialization state (`repo.txc` or `.taxis-policy.seal`), yet
    /// `.taxis-policy.txp` is absent and must be regenerated via `taxis policy init`.
    MissingAfterInit {
        /// Shared metadata directory where the hidden policy file belongs.
        common_dir: PathBuf,
        /// Missing vault file path.
        expected_path: PathBuf,
    },
    /// Policy vault or companion seal failed `HMAC-SM3`, size/magic checks, or `repo_id` binding.
    TamperedOrCorrupt {
        /// Offending vault or seal path.
        path: PathBuf,
        /// Structured diagnostic reason explaining the integrity failure.
        reason: String,
    },
    /// Bare third-party repository with no `repo.txc`, no `.taxis-policy.seal`, and no vault.
    UninitializedExternal,
}
