//! Module: fg-gate — Commit Policy Tier Floor (Vault-Backed)
//! File Path: crates/fg-gate/src/policy_floor.rs
//! Architecture Role: Resolves the cryptographic hidden-vault enforcement floor declared by the
//!   repository and decides whether a requested commit policy preset is allowed to run.
//! Dependencies & Triggers: Consumed by the Taxis commit, merge, rebase, cherry-pick, and stash
//!   dispatchers before a commit message is validated.
//! Responsibilities: Load commit floor metadata from `.taxis-policy.txp` via
//!   [`fg_topology::PolicyVaultStore`], verify vault integrity fail-closed, compare enforcement tiers
//!   monotonically, and reject any relaxation attempt.
//! Exit Semantics & Design Rationale:
//!   - Zero runtime dependency on JSON configuration files; policy storage is owned exclusively by
//!     the authenticated encrypted binary `.taxis-policy.txp` vault.
//!   - If `.taxis-policy.txp` was deleted after repository initialization (`MissingAfterInit`) or
//!     tampered (`TamperedOrCorrupt`), operations fail closed and instruct the administrator to run
//!     `taxis policy init`.
//!
//! Domain Governance Rules: FGT-MSG-011 (policy tier guard), FGT-GAT-001.

use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{EnforcementTier, TaxisPolicy};
use fg_topology::{PolicyVaultState, PolicyVaultStore};

/// Integrity classification of the underlying binary `.taxis-policy.txp` vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyVaultHealth {
    /// Vault was loaded and passed `repo_id` binding + `HMAC-SM3` verification.
    Verified {
        /// Monotonic policy revision stored in the authenticated payload.
        revision: u64,
        /// Indicates policy mutations/downgrades/plaintext inspection require `AuthoritySecret`.
        locked_by_authority: bool,
    },
    /// Bare third-party `.git` repository without Taxis container or initialization seal.
    ExternalOrDefault,
    /// Repository carries Taxis initialization artifacts (`repo.txc` or `.taxis-policy.seal`),
    /// yet `.taxis-policy.txp` is absent and must be regenerated via `taxis policy init`.
    MissingAfterInit {
        /// Structured diagnostic remediation guidance.
        reason: String,
    },
    /// Hidden policy vault or initialization seal failed integrity or binding verification.
    TamperedOrCorrupt {
        /// Structured integrity diagnostic reason.
        reason: String,
    },
}

/// Resolved commit-message enforcement floor for one repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyFloor {
    /// Tier every commit in this repository must at least satisfy.
    pub tier: EnforcementTier,
    /// Name of the preset that supplies the minimum obligations.
    pub preset: String,
    /// Whether an authenticated policy vault was found and decrypted.
    pub declared: bool,
    /// Cryptographic integrity health state of the underlying hidden policy vault.
    pub vault_health: PolicyVaultHealth,
}

impl PolicyFloor {
    /// Fallback floor used in bare external Git repositories or pure unit tests without a vault.
    ///
    /// Falling back to the strictest tier is deliberate: an unconfigured state must never silently
    /// grant more permissiveness than the governed default.
    #[must_use]
    pub fn governed_default() -> Self {
        Self {
            tier: EnforcementTier::Strict,
            preset: "workspace-strict".to_owned(),
            declared: false,
            vault_health: PolicyVaultHealth::ExternalOrDefault,
        }
    }

    /// Resolves the commit policy floor declared in `git_dir`'s encrypted `.taxis-policy.txp`.
    #[must_use]
    pub fn resolve(git_dir: &Path) -> Self {
        match PolicyVaultStore::load_state(git_dir) {
            PolicyVaultState::Sealed(loaded) => {
                let tier = loaded.payload.commit_floor;
                Self {
                    tier,
                    preset: preset_name_for_commit_tier(tier).to_owned(),
                    declared: true,
                    vault_health: PolicyVaultHealth::Verified {
                        revision: loaded.payload.revision,
                        locked_by_authority: loaded.payload.locked_by_authority,
                    },
                }
            }
            PolicyVaultState::MissingAfterInit { expected_path, .. } => Self {
                tier: EnforcementTier::Strict,
                preset: "workspace-strict".to_owned(),
                declared: false,
                vault_health: PolicyVaultHealth::MissingAfterInit {
                    reason: format!(
                        "hidden policy vault '{}' was removed after repository initialization; \
                         run 'taxis policy init' to regenerate and configure repository policy",
                        expected_path.display()
                    ),
                },
            },
            PolicyVaultState::TamperedOrCorrupt { path, reason } => Self {
                tier: EnforcementTier::Strict,
                preset: "workspace-strict".to_owned(),
                declared: false,
                vault_health: PolicyVaultHealth::TamperedOrCorrupt {
                    reason: format!(
                        "hidden policy vault '{}' failed integrity verification ({reason}); \
                         run 'taxis policy init' with authority credentials to recover",
                        path.display()
                    ),
                },
            },
            PolicyVaultState::UninitializedExternal => Self::governed_default(),
        }
    }

    /// Verifies that the underlying hidden policy vault is neither deleted nor corrupted.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::GateRejection`] carrying `FGT-MSG-011` when `.taxis-policy.txp` is
    /// missing after initialization or fails `HMAC-SM3` verification.
    pub fn assert_healthy(&self) -> FractalResult<()> {
        match &self.vault_health {
            PolicyVaultHealth::Verified { .. } | PolicyVaultHealth::ExternalOrDefault => Ok(()),
            PolicyVaultHealth::MissingAfterInit { reason }
            | PolicyVaultHealth::TamperedOrCorrupt { reason } => Err(FractalError::GateRejection {
                score: 0.0,
                violations: vec![format!(
                    "{}: {reason}",
                    fg_core::constants::rules::RULE_FGT_MSG_011
                )],
            }),
        }
    }

    /// Returns `Ok(())` when the vault is healthy and `requested` meets or exceeds the floor.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::GateRejection`] carrying `FGT-MSG-011` when the vault is missing/
    /// tampered or when the requested preset ranks below the floor.
    pub fn assert_permits(&self, requested: &TaxisPolicy) -> FractalResult<()> {
        self.assert_healthy()?;

        let requested_tier = requested.enforcement_tier();
        if requested_tier.rank() >= self.tier.rank() {
            return Ok(());
        }
        Err(FractalError::GateRejection {
            score: 0.0,
            violations: vec![format!(
                "{}: Policy '{}' (tier {}) is below the repository floor '{}' (tier {}); \
                 a selector may tighten the contract but never relax it. Remove the flag, or \
                 use --bypass-message-guard with an explicit --reason to record a real exception.",
                fg_core::constants::rules::RULE_FGT_MSG_011,
                requested.name,
                requested_tier,
                self.preset,
                self.tier
            )],
        })
    }

    /// Builds the policy a governed operation must run with.
    ///
    /// Returns the stricter of the requested preset and the floor, silently tightening when the
    /// caller had no intent to bypass.
    #[must_use]
    pub fn effective_policy(&self, requested: TaxisPolicy) -> TaxisPolicy {
        if requested.enforcement_tier().rank() >= self.tier.rank() {
            return requested;
        }
        preset_for_tier(self.tier)
    }
}

/// Returns the canonical preset name for one [`EnforcementTier`].
#[must_use]
pub const fn preset_name_for_commit_tier(tier: EnforcementTier) -> &'static str {
    match tier {
        EnforcementTier::Strict => "workspace-strict",
        EnforcementTier::Conventional => "conventional-semantic",
        EnforcementTier::Native => "git-native",
    }
}

/// Returns the canonical preset for one tier.
#[must_use]
pub fn preset_for_tier(tier: EnforcementTier) -> TaxisPolicy {
    match tier {
        EnforcementTier::Strict => TaxisPolicy::workspace_strict(),
        EnforcementTier::Conventional => TaxisPolicy::conventional_semantic(),
        EnforcementTier::Native => TaxisPolicy::git_native(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use fg_core::models::BranchEnforcementTier;
    use fg_topology::PolicyVaultStore;

    #[test]
    fn resolve_reads_encrypted_vault_tiers_without_json() {
        let dir = TempDir::new().expect("temp dir");
        let git_dir = dir.path().join(".taxis");
        std::fs::create_dir_all(&git_dir).expect("create repo dir");

        PolicyVaultStore::initialize_or_regenerate(
            &git_dir,
            EnforcementTier::Conventional,
            BranchEnforcementTier::Strict,
            false,
        )
        .expect("seal vault");

        let floor = PolicyFloor::resolve(&git_dir);
        assert!(floor.declared);
        assert_eq!(floor.tier, EnforcementTier::Conventional);
        assert_eq!(floor.preset, "conventional-semantic");
        assert!(matches!(
            floor.vault_health,
            PolicyVaultHealth::Verified { revision: 1, .. }
        ));
        assert!(floor
            .assert_permits(&TaxisPolicy::workspace_strict())
            .is_ok());
        assert!(floor.assert_permits(&TaxisPolicy::git_native()).is_err());
    }

    #[test]
    fn deleted_or_tampered_vault_fails_closed() {
        let dir = TempDir::new().expect("temp dir");
        let git_dir = dir.path().join(".taxis");
        std::fs::create_dir_all(&git_dir).expect("create repo dir");

        let loaded = PolicyVaultStore::initialize_or_regenerate(
            &git_dir,
            EnforcementTier::Native,
            BranchEnforcementTier::Native,
            false,
        )
        .expect("seal vault");

        let _ = PolicyVaultStore::erase_vault_only(&git_dir).expect("erase vault");
        let missing_floor = PolicyFloor::resolve(&git_dir);
        assert!(matches!(
            missing_floor.vault_health,
            PolicyVaultHealth::MissingAfterInit { .. }
        ));
        let err_missing = missing_floor
            .assert_permits(&TaxisPolicy::workspace_strict())
            .expect_err("deleted vault must lock down writes fail-closed");
        assert!(err_missing.to_string().contains("taxis policy init"));

        std::fs::write(&loaded.vault_path, b"corrupted").expect("corrupt vault");
        let corrupt_floor = PolicyFloor::resolve(&git_dir);
        assert!(matches!(
            corrupt_floor.vault_health,
            PolicyVaultHealth::TamperedOrCorrupt { .. }
        ));
        assert!(corrupt_floor
            .assert_permits(&TaxisPolicy::workspace_strict())
            .is_err());
    }
}
