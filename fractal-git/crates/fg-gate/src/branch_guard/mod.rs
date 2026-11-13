//! Module: fg-gate — Kernel Branch Standardization & Topology Governance Guard
//! File Path: crates/fg-gate/src/branch_guard/mod.rs
//! Architecture Role: Enforces repository branch governance tiers backed by encrypted
//!   `.taxis-policy.txp` vaults across creation, force-reset, rename, deletion, merge, and plumbing.

mod floor;
mod ops;
#[cfg(test)]
mod tests;

use fg_core::constants::branch::BRANCH_BYPASS_MIN_REASON_CHARS;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::BranchEnforcementTier;
use fg_topology::{FractalRef, TopologyVerifier};

use crate::policy_floor::PolicyVaultHealth;

pub use floor::{
    BranchBypassContext, BranchFloorSource, BranchGateOutcome, BranchGovernanceFloor,
};

/// Stateful fail-closed validator across all Taxis branch mutation entrypoints.
pub struct BranchGuard;

impl BranchGuard {
    /// Fails closed whenever `.taxis-policy.txp` was deleted post-init or fails authentication.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::GateRejection`] carrying `FGT-GAT-001`.
    pub fn assert_vault_healthy(floor: &BranchGovernanceFloor) -> FractalResult<()> {
        match &floor.vault_health {
            PolicyVaultHealth::Verified { .. } | PolicyVaultHealth::ExternalOrDefault => Ok(()),
            PolicyVaultHealth::MissingAfterInit { reason }
            | PolicyVaultHealth::TamperedOrCorrupt { reason } => Err(FractalError::GateRejection {
                score: 0.0,
                violations: vec![format!(
                    "{}: {reason}",
                    fg_core::constants::rules::RULE_FGT_GAT_001
                )],
            }),
        }
    }

    /// Validates branch creation (`branch`, `checkout -b/-B`, `switch -c/-C/--orphan`, `worktree add`).
    ///
    /// # Errors
    ///
    /// Returns [`FractalError`] on vault tampering/absence, Strict lexical/cell rejections, or
    /// illegal parent-child topological derivation.
    pub fn check_branch_creation(
        floor: &BranchGovernanceFloor,
        parent_raw: Option<&str>,
        child_raw: &str,
        bypass: Option<&BranchBypassContext>,
    ) -> FractalResult<BranchGateOutcome> {
        Self::assert_vault_healthy(floor)?;
        let parent_ref = parent_raw.and_then(FractalRef::parse);
        let parsed_loose = FractalRef::parse(child_raw);

        match floor.tier {
            BranchEnforcementTier::Native => {
                if let (Some(ref parent), Some(ref child)) = (&parent_ref, &parsed_loose) {
                    TopologyVerifier::assert_legal_fork(parent, child)?;
                }
                Ok(BranchGateOutcome { warnings: Vec::new(), parsed_child: parsed_loose })
            }
            BranchEnforcementTier::Advisory => {
                if let (Some(ref parent), Some(ref child)) = (&parent_ref, &parsed_loose) {
                    TopologyVerifier::assert_legal_fork(parent, child)?;
                }
                let mut warnings = Vec::new();
                let parsed_child = match FractalRef::from_git_ref_checked(child_raw, &floor.spec, false) {
                    Ok(valid) => Some(valid),
                    Err(advisory_err) => {
                        warnings.push(format!("FGT-TOP-001 (advisory): {advisory_err}"));
                        parsed_loose
                    }
                };
                Ok(BranchGateOutcome { warnings, parsed_child })
            }
            BranchEnforcementTier::Strict => {
                if let Some(ctx) = bypass {
                    Self::validate_bypass_context(ctx, child_raw)?;
                    return Ok(BranchGateOutcome {
                        warnings: vec![format!("FGT-GAT-001 (audited bypass for '{}'): {}", child_raw, ctx.reason)],
                        parsed_child: parsed_loose,
                    });
                }
                let strict_child = FractalRef::from_git_ref_checked(child_raw, &floor.spec, false)?;
                Self::assert_strict_parent_fork(&strict_child, parent_ref.as_ref(), parent_raw, child_raw)?;
                Ok(BranchGateOutcome { warnings: Vec::new(), parsed_child: Some(strict_child) })
            }
        }
    }

    /// Validates force-resetting an existing branch (`checkout -B` / `switch -C`) against trunk safety.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::TopologyBreach`] if resetting a protected Tier 0/1/2 trunk without
    /// verified human authority.
    pub fn check_force_branch_reset(
        floor: &BranchGovernanceFloor,
        branch_raw: &str,
        human_authorized: bool,
    ) -> FractalResult<()> {
        Self::assert_vault_healthy(floor)?;
        let Some(target) = FractalRef::parse(branch_raw) else {
            return Ok(());
        };
        if target.is_protected() && !human_authorized {
            return Err(FractalError::TopologyBreach {
                source_ref: branch_raw.to_owned(),
                target_ref: "force-reset".to_owned(),
                reason: format!(
                    "FGT-TOP-001: force-resetting protected trunk/telemetry branch '{branch_raw}' requires human AuthoritySecret verification"
                ),
            });
        }
        Ok(())
    }

    fn validate_bypass_context(ctx: &BranchBypassContext, child_raw: &str) -> FractalResult<()> {
        if !ctx.human_authorized {
            return Err(FractalError::AuthProofInvalid(format!(
                "--bypass-branch-guard for '{child_raw}' requires verified AuthoritySecret"
            )));
        }
        if ctx.reason.trim().len() < BRANCH_BYPASS_MIN_REASON_CHARS {
            return Err(FractalError::PolicyViolation(format!(
                "--bypass-branch-guard requires --reason with at least {BRANCH_BYPASS_MIN_REASON_CHARS} characters"
            )));
        }
        Ok(())
    }

    fn assert_strict_parent_fork(
        child: &FractalRef,
        parent_opt: Option<&FractalRef>,
        parent_raw: Option<&str>,
        child_raw: &str,
    ) -> FractalResult<()> {
        if matches!(child, FractalRef::SystemTrunk { .. }) {
            return Ok(());
        }
        match parent_opt {
            Some(parent) => TopologyVerifier::assert_legal_fork(parent, child),
            None => {
                let parent_desc = parent_raw.unwrap_or("(detached or missing parent branch)");
                let expected = child
                    .parent()
                    .and_then(|parent_coord| parent_coord.to_short_branch_name())
                    .unwrap_or_else(|| "a valid fractal parent branch".to_owned());
                Err(FractalError::TopologyBreach {
                    source_ref: child_raw.to_owned(),
                    target_ref: parent_desc.to_owned(),
                    reason: format!(
                        "FGT-TOP-001: cannot create '{child_raw}' from '{parent_desc}'; check out or pass '--base {expected}'"
                    ),
                })
            }
        }
    }
}
