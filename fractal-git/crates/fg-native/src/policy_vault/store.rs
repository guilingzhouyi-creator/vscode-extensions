//! Module: fg-native — Policy Vault Persistence Store
//! File Path: crates/fg-native/src/policy_vault/store.rs
//! Architecture Role: Kernel-exclusive atomic load, seal, regenerate, and erasure
//!   controller for `.taxis-policy.txp` and `.taxis-policy.seal`.
//! Dependencies & Triggers: Uses `super::helpers`, `super::types`, `fg_core`, and
//!   `crate::repo_identity::fill_random_bytes`.
//! Responsibilities: Inspect vaults fail-closed across linked worktrees and persist
//!   encrypted binary envelopes atomically.
//! Exit Semantics & Design Rationale: Rejects repo_id mismatches and HMAC-SM3
//!   failures without silent permissive fallback.

use std::path::{Path, PathBuf};

use fg_core::constants::branch::{POLICY_SEAL_FILENAME, POLICY_VAULT_FILENAME};
use fg_core::error::{FractalError, FractalResult};
use fg_core::fs_atomic::write_file_atomic;
use fg_core::models::{
    ct_eq_bytes, encode_seal_record, seal_policy_envelope, unseal_policy_envelope,
    BranchEnforcementTier, EnforcementTier, SealedPolicyPayload, POLICY_REPO_ID_LEN,
};

use crate::constants::CONTAINER_FILE_NAME;
use crate::repo_identity::fill_random_bytes;

use super::helpers::{
    current_unix_secs, normalize_lexical_path, read_container_repo_id, read_verified_seal,
    restrict_and_hide_file,
};
use super::{LoadedPolicyVault, PolicyVaultState};

/// Kernel storage controller for the hidden binary policy vault.
pub struct PolicyVaultStore;

impl PolicyVaultStore {
    /// Resolves the shared metadata directory, following `<git_dir>/commondir` for linked worktrees.
    #[must_use]
    pub fn resolve_common_repo_dir(repo_or_git_dir: &Path) -> PathBuf {
        let commondir_file = repo_or_git_dir.join("commondir");
        if let Ok(raw_rel) = std::fs::read_to_string(&commondir_file) {
            let trimmed = raw_rel.trim();
            if !trimmed.is_empty() {
                let candidate = repo_or_git_dir.join(trimmed);
                if candidate.is_dir() {
                    return normalize_lexical_path(&candidate);
                }
            }
        }
        repo_or_git_dir.to_path_buf()
    }

    /// Returns the hidden vault file path under `common_dir`.
    #[must_use]
    pub fn vault_path(common_dir: &Path) -> PathBuf {
        common_dir.join(POLICY_VAULT_FILENAME)
    }

    /// Returns the hidden seal file path under `common_dir`.
    #[must_use]
    pub fn seal_path(common_dir: &Path) -> PathBuf {
        common_dir.join(POLICY_SEAL_FILENAME)
    }

    /// Inspects and authenticates the hidden policy vault for `repo_or_git_dir` (fail-closed).
    #[must_use]
    pub fn load_state(repo_or_git_dir: &Path) -> PolicyVaultState {
        let common_dir = Self::resolve_common_repo_dir(repo_or_git_dir);
        let vault_path = Self::vault_path(&common_dir);
        let seal_path = Self::seal_path(&common_dir);
        let container_path = common_dir.join(CONTAINER_FILE_NAME);

        let container_id = match read_container_repo_id(&container_path) {
            Ok(found) => found,
            Err(reason) => return PolicyVaultState::TamperedOrCorrupt { path: container_path, reason },
        };
        let seal_id = match read_verified_seal(&seal_path) {
            Ok(found) => found,
            Err(reason) => return PolicyVaultState::TamperedOrCorrupt { path: seal_path, reason },
        };
        if let (Some(left), Some(right)) = (container_id.as_ref(), seal_id.as_ref()) {
            if !ct_eq_bytes(left, right) {
                return PolicyVaultState::TamperedOrCorrupt {
                    path: seal_path,
                    reason: "policy seal repo_id disagrees with container META repo_id".to_owned(),
                };
            }
        }
        let bound_repo_id = container_id.or(seal_id);
        if !vault_path.is_file() {
            return if bound_repo_id.is_some() {
                PolicyVaultState::MissingAfterInit { common_dir, expected_path: vault_path }
            } else {
                PolicyVaultState::UninitializedExternal
            };
        }
        let Some(expected_id) = bound_repo_id else {
            return PolicyVaultState::TamperedOrCorrupt {
                path: vault_path,
                reason: "companion initialization seal missing for policy vault".to_owned(),
            };
        };
        let bytes = match std::fs::read(&vault_path) {
            Ok(raw) => raw,
            Err(read_err) => {
                return PolicyVaultState::TamperedOrCorrupt {
                    path: vault_path,
                    reason: format!("unable to read policy vault: {read_err}"),
                };
            }
        };
        match unseal_policy_envelope(&bytes, Some(&expected_id)) {
            Ok(payload) => PolicyVaultState::Sealed(Box::new(LoadedPolicyVault {
                common_dir,
                vault_path,
                seal_path,
                payload,
            })),
            Err(unseal_err) => {
                PolicyVaultState::TamperedOrCorrupt { path: vault_path, reason: unseal_err.to_string() }
            }
        }
    }

    /// Seals and atomically persists `payload` along with its companion seal, applying OS hiding.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError`] if `repo_id` validation, CSPRNG sampling, or disk writes fail.
    pub fn save_sealed(
        repo_or_git_dir: &Path,
        payload: &SealedPolicyPayload,
    ) -> FractalResult<LoadedPolicyVault> {
        let common_dir = Self::resolve_common_repo_dir(repo_or_git_dir);
        let container_path = common_dir.join(CONTAINER_FILE_NAME);
        if let Ok(Some(container_id)) = read_container_repo_id(&container_path) {
            if !ct_eq_bytes(&container_id, &payload.repo_id) {
                return Err(FractalError::AuthProofInvalid(
                    "cannot seal policy vault with a repo_id that differs from container META".to_owned(),
                ));
            }
        }
        let (mut salt, mut nonce) = ([0u8; POLICY_REPO_ID_LEN], [0u8; POLICY_REPO_ID_LEN]);
        fill_random_bytes(&mut salt).map_err(|e| FractalError::PolicyViolation(format!("CSPRNG salt error: {e}")))?;
        fill_random_bytes(&mut nonce).map_err(|e| FractalError::PolicyViolation(format!("CSPRNG nonce error: {e}")))?;
        let seal_path = Self::seal_path(&common_dir);
        let vault_path = Self::vault_path(&common_dir);
        let seal_bytes = encode_seal_record(&payload.repo_id);
        let envelope = seal_policy_envelope(payload, salt, nonce)?;
        write_file_atomic(&seal_path, &seal_bytes, true)?;
        restrict_and_hide_file(&seal_path);
        write_file_atomic(&vault_path, &envelope, true)?;
        restrict_and_hide_file(&vault_path);
        Ok(LoadedPolicyVault { common_dir, vault_path, seal_path, payload: payload.clone() })
    }

    /// Writes the initial sealed policy vault during native `taxis init`.
    ///
    /// # Errors
    ///
    /// Propagates serialization, random-source, or I/O errors.
    pub fn write_initial_for_container(
        repo_dir: &Path,
        repo_id: [u8; POLICY_REPO_ID_LEN],
        commit_floor: EnforcementTier,
        branch_floor: BranchEnforcementTier,
        locked_by_authority: bool,
    ) -> FractalResult<LoadedPolicyVault> {
        let payload = SealedPolicyPayload::with_tiers(
            repo_id,
            commit_floor,
            branch_floor,
            locked_by_authority,
            current_unix_secs(),
        );
        Self::save_sealed(repo_dir, &payload)
    }

    /// Initializes or regenerates the hidden binary policy vault on `.taxis` or `.git` repos,
    /// preserving bound `repo_id` from `repo.txc` or existing valid seal and bumping revision.
    ///
    /// # Errors
    ///
    /// Propagates I/O, CSPRNG, or container read failures.
    pub fn initialize_or_regenerate(
        repo_or_git_dir: &Path,
        commit_floor: EnforcementTier,
        branch_floor: BranchEnforcementTier,
        locked_by_authority: bool,
    ) -> FractalResult<LoadedPolicyVault> {
        let common_dir = Self::resolve_common_repo_dir(repo_or_git_dir);
        let container_id =
            read_container_repo_id(&common_dir.join(CONTAINER_FILE_NAME)).map_err(FractalError::CorruptStore)?;
        let seal_id = read_verified_seal(&Self::seal_path(&common_dir)).ok().flatten();
        let repo_id = match container_id.or(seal_id) {
            Some(bound) => bound,
            None => {
                let mut generated = [0u8; POLICY_REPO_ID_LEN];
                fill_random_bytes(&mut generated)
                    .map_err(|e| FractalError::PolicyViolation(format!("CSPRNG repo_id error: {e}")))?;
                generated
            }
        };
        let next_revision = match Self::load_state(&common_dir) {
            PolicyVaultState::Sealed(existing) => existing.payload.revision.saturating_add(1),
            _ => 1,
        };
        let mut payload = SealedPolicyPayload::with_tiers(
            repo_id,
            commit_floor,
            branch_floor,
            locked_by_authority,
            current_unix_secs(),
        );
        payload.revision = next_revision;
        Self::save_sealed(&common_dir, &payload)
    }

    /// Kernel-controlled removal of `.taxis-policy.txp` (keeping seal intact).
    ///
    /// # Errors
    ///
    /// Propagates filesystem deletion errors other than absence.
    pub fn erase_vault_only(repo_or_git_dir: &Path) -> FractalResult<bool> {
        let common_dir = Self::resolve_common_repo_dir(repo_or_git_dir);
        match std::fs::remove_file(Self::vault_path(&common_dir)) {
            Ok(()) => Ok(true),
            Err(remove_err) if remove_err.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(remove_err) => Err(FractalError::Io(remove_err)),
        }
    }
}
