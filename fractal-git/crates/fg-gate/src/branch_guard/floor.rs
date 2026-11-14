//! Module: fg-gate — Branch Governance Floor & Active Lease Overlay
//! File Path: crates/fg-gate/src/branch_guard/floor.rs
//! Architecture Role: Resolves repository branch governance posture (`Native`, `Advisory`,
//!   `Strict`) from `.taxis-policy.txp` fail-closed, overlays active project leases, and
//!   applies monotonic environment ratchets.
//! Dependencies & Triggers: Uses `fg_topology::{DiskProjectStore, PolicyVaultState, PolicyVaultStore}`
//!   and `crate::policy_floor::PolicyVaultHealth`.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use fg_core::constants::branch::BRANCH_GOVERNANCE_ENV;
use fg_core::models::{BranchEnforcementTier, BranchPolicySpec, LeaseStatus};
use fg_topology::{DiskProjectStore, FractalRef, PolicyVaultState, PolicyVaultStore};

use crate::policy_floor::PolicyVaultHealth;

/// Origin classifying how the effective branch governance tier was obtained.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchFloorSource {
    /// Loaded and verified from encrypted `.taxis-policy.txp`.
    Vault,
    /// Tightened monotonically via `TAXIS_BRANCH_GOVERNANCE` environment variable.
    EnvOverride,
    /// Bare external repository without Taxis initialization (`Native` compatibility default).
    UninitializedExternal,
}

/// Optional audited override supplied by operators when migrating historical branches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchBypassContext {
    /// Non-empty rationale (`>= BRANCH_BYPASS_MIN_REASON_CHARS`) persisted in diagnostics.
    pub reason: String,
    /// True only when verified against `AuthoritySecret`.
    pub human_authorized: bool,
}

/// Result produced by validating a proposed branch operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchGateOutcome {
    /// Non-fatal advisory warnings surfaced on `stderr` in `Advisory` tier.
    pub warnings: Vec<String>,
    /// Parsed canonical `FractalRef` when the branch matches the 5-tier grammar.
    pub parsed_child: Option<FractalRef>,
}

/// Resolved branch governance floor + domain whitelist specification for one repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchGovernanceFloor {
    /// Effective branch governance enforcement tier.
    pub tier: BranchEnforcementTier,
    /// Effective branch grammar specification (with active lease overlay if enabled).
    pub spec: BranchPolicySpec,
    /// `true` when loaded from an authenticated `.taxis-policy.txp` vault.
    pub declared: bool,
    /// Health status of the companion binary policy vault.
    pub vault_health: PolicyVaultHealth,
    /// Origin selector explaining which configuration layer supplied the active tier.
    pub source: BranchFloorSource,
}

impl BranchGovernanceFloor {
    /// Resolves branch governance tier and naming specification from `git_dir` fail-closed.
    #[must_use]
    pub fn resolve(git_dir: &Path) -> Self {
        let (base_tier, mut spec, declared, vault_health, base_source) =
            match PolicyVaultStore::load_state(git_dir) {
                PolicyVaultState::Sealed(loaded) => (
                    loaded.payload.branch_floor,
                    loaded.payload.branch_spec,
                    true,
                    PolicyVaultHealth::Verified {
                        revision: loaded.payload.revision,
                        locked_by_authority: loaded.payload.locked_by_authority,
                    },
                    BranchFloorSource::Vault,
                ),
                PolicyVaultState::MissingAfterInit { expected_path, .. } => (
                    BranchEnforcementTier::Strict,
                    BranchPolicySpec::workspace_default(),
                    false,
                    PolicyVaultHealth::MissingAfterInit {
                        reason: format!(
                            "hidden policy vault '{}' was removed after repository initialization; \
                             run 'taxis policy init' to regenerate and configure repository policy",
                            expected_path.display()
                        ),
                    },
                    BranchFloorSource::Vault,
                ),
                PolicyVaultState::TamperedOrCorrupt { path, reason } => (
                    BranchEnforcementTier::Strict,
                    BranchPolicySpec::workspace_default(),
                    false,
                    PolicyVaultHealth::TamperedOrCorrupt {
                        reason: format!(
                            "hidden policy vault '{}' failed integrity verification ({reason}); \
                             run 'taxis policy init' with authority credentials to recover",
                            path.display()
                        ),
                    },
                    BranchFloorSource::Vault,
                ),
                PolicyVaultState::UninitializedExternal => (
                    BranchEnforcementTier::Native,
                    BranchPolicySpec::workspace_default(),
                    false,
                    PolicyVaultHealth::ExternalOrDefault,
                    BranchFloorSource::UninitializedExternal,
                ),
            };

        if spec.enforce_dynamic_leases {
            overlay_active_leases(git_dir, &mut spec);
        }

        let (tier, source) = apply_env_ratchet(base_tier, base_source);
        Self {
            tier,
            spec,
            declared,
            vault_health,
            source,
        }
    }
}

fn overlay_active_leases(git_dir: &Path, spec: &mut BranchPolicySpec) {
    let common_dir = PolicyVaultStore::resolve_common_repo_dir(git_dir);
    let lease_file = common_dir
        .join(fg_topology::PROJECTS_DIR)
        .join(fg_topology::PROJECTS_CACHE_FILE);
    if !lease_file.is_file() {
        return;
    }
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let store = DiskProjectStore::new(&common_dir);
    let Ok(cache) = store.load_or_discover(None, now_secs) else {
        return;
    };
    for lease in cache.leases.values() {
        if lease.status != LeaseStatus::Active {
            continue;
        }
        let normalized = spec.normalize_cell(&lease.id).to_owned();
        if !spec
            .recognized_cells
            .iter()
            .any(|existing| existing == &normalized)
        {
            spec.recognized_cells.push(normalized);
        }
    }
}

fn apply_env_ratchet(
    base_tier: BranchEnforcementTier,
    base_source: BranchFloorSource,
) -> (BranchEnforcementTier, BranchFloorSource) {
    let Ok(raw_env) = std::env::var(BRANCH_GOVERNANCE_ENV) else {
        return (base_tier, base_source);
    };
    let Some(env_tier) = BranchEnforcementTier::parse_str(&raw_env) else {
        return (base_tier, base_source);
    };
    if env_tier.rank() > base_tier.rank() {
        return (env_tier, BranchFloorSource::EnvOverride);
    }
    (base_tier, base_source)
}
