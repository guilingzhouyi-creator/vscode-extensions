//! Module: fg-gate — Branch Rename, Deletion, Merge, Rebase & Ref Mutation Guards
//! File Path: crates/fg-gate/src/branch_guard/ops.rs
//! Architecture Role: Validates destructive and cross-branch mutations (`branch -m/-d/-D`,
//!   `merge`, `rebase`, `update-ref`, `symbolic-ref`) against active branch governance floors.
//! Dependencies & Triggers: Extends `super::BranchGuard` using `fg_topology::TopologyVerifier`.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::BranchEnforcementTier;
use fg_topology::{FractalRef, TopologyVerifier};

use super::floor::BranchGovernanceFloor;
use super::BranchGuard;

impl BranchGuard {
    /// Validates `taxis branch -m` (and `taxis branch migrate`) across governance tiers.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError`] on protected trunk renames, cross-cell/tier drift, or invalid
    /// target branch names under `Strict`.
    pub fn check_branch_rename(
        floor: &BranchGovernanceFloor,
        old_raw: &str,
        new_raw: &str,
        allow_card_migrate: bool,
    ) -> FractalResult<()> {
        Self::assert_vault_healthy(floor)?;

        if floor.tier != BranchEnforcementTier::Strict {
            let old_parsed = FractalRef::parse(old_raw);
            let new_parsed = FractalRef::parse(new_raw);
            if old_parsed.as_ref().is_some_and(FractalRef::is_protected)
                || new_parsed.as_ref().is_some_and(FractalRef::is_protected)
            {
                if let (Some(ref old_ref), Some(ref new_ref)) = (&old_parsed, &new_parsed) {
                    return TopologyVerifier::assert_legal_rename(
                        old_ref, new_ref, old_raw, new_raw, allow_card_migrate,
                    );
                }
                return Err(FractalError::TopologyBreach {
                    source_ref: old_raw.to_owned(),
                    target_ref: new_raw.to_owned(),
                    reason: format!(
                        "FGT-TOP-001: protected trunk branch cannot participate in arbitrary rename ('{old_raw}' -> '{new_raw}')"
                    ),
                });
            }
            if let (Some(ref old_ref), Some(ref new_ref)) = (&old_parsed, &new_parsed) {
                TopologyVerifier::assert_legal_rename(
                    old_ref, new_ref, old_raw, new_raw, allow_card_migrate,
                )?;
            }
            return Ok(());
        }

        let old_ref = FractalRef::from_git_ref_checked(old_raw, &floor.spec, true)?;
        let new_ref = FractalRef::from_git_ref_checked(new_raw, &floor.spec, false)?;
        TopologyVerifier::assert_legal_rename(&old_ref, &new_ref, old_raw, new_raw, allow_card_migrate)
    }

    /// Validates `taxis branch -d / -D` against trunk and CellMain deletion protections.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::TopologyBreach`] if deleting Tier 0/1 trunks or Tier 2
    /// `cell/<cell>/main` without verified human authority.
    pub fn check_branch_delete(
        floor: &BranchGovernanceFloor,
        target_raw: &str,
        force: bool,
        human_authorized: bool,
    ) -> FractalResult<()> {
        Self::assert_vault_healthy(floor)?;
        let Some(target_ref) = FractalRef::parse(target_raw) else {
            return Ok(());
        };
        if matches!(
            target_ref,
            FractalRef::SystemTrunk { .. } | FractalRef::Trunk | FractalRef::CellMain { .. }
        ) {
            return TopologyVerifier::assert_legal_delete(&target_ref, force, human_authorized);
        }
        Ok(())
    }

    /// Validates `taxis merge` and `taxis rebase` according to active branch governance tier.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError`] on unparseable ad-hoc branches under `Strict` or illegal mutations.
    pub fn check_merge_or_rebase(
        floor: &BranchGovernanceFloor,
        source_raw: &str,
        target_raw: &str,
        is_rebase: bool,
    ) -> FractalResult<Vec<String>> {
        Self::assert_vault_healthy(floor)?;

        if floor.tier == BranchEnforcementTier::Strict {
            let src_ref = FractalRef::from_git_ref_checked(source_raw, &floor.spec, true)?;
            let dst_ref = FractalRef::from_git_ref_checked(target_raw, &floor.spec, true)?;
            if is_rebase {
                TopologyVerifier::assert_legal_rebase(&src_ref, &dst_ref)?;
            } else if src_ref != dst_ref {
                TopologyVerifier::assert_legal_merge(&src_ref, &dst_ref)?;
            }
            return Ok(Vec::new());
        }

        let mut warnings = Vec::new();
        let src_opt = FractalRef::parse(source_raw);
        let dst_opt = FractalRef::parse(target_raw);
        if let (Some(src_ref), Some(dst_ref)) = (src_opt, dst_opt) {
            if is_rebase {
                TopologyVerifier::assert_legal_rebase(&src_ref, &dst_ref)?;
            } else if src_ref != dst_ref {
                TopologyVerifier::assert_legal_merge(&src_ref, &dst_ref)?;
            }
        } else if floor.tier == BranchEnforcementTier::Advisory {
            warnings.push(format!(
                "FGT-TOP-001 (advisory): {} between '{source_raw}' and '{target_raw}' involves a legacy non-fractal branch",
                if is_rebase { "rebase" } else { "merge" }
            ));
        }
        Ok(warnings)
    }

    /// Validates raw plumbing reference writes/deletions (`taxis update-ref`, `taxis symbolic-ref`).
    ///
    /// # Errors
    ///
    /// Returns [`FractalError`] when forging arbitrary branches under `Strict` or deleting trunks.
    pub fn check_ref_mutation(
        floor: &BranchGovernanceFloor,
        ref_name: &str,
        is_delete: bool,
        human_authorized: bool,
    ) -> FractalResult<()> {
        Self::assert_vault_healthy(floor)?;
        if is_exempt_auxiliary_ref(ref_name) {
            return Ok(());
        }
        if is_delete {
            if let Some(target_ref) = FractalRef::parse(ref_name) {
                return TopologyVerifier::assert_legal_delete(&target_ref, true, human_authorized);
            }
            return Ok(());
        }
        if floor.tier != BranchEnforcementTier::Strict || ref_name == "HEAD" || ref_name == "refs/fractal/trunk" {
            return Ok(());
        }
        if ref_name.starts_with("refs/heads/") || ref_name.starts_with("refs/fractal/cell/") {
            let _ = FractalRef::from_git_ref_checked(ref_name, &floor.spec, false)?;
            return Ok(());
        }
        Err(FractalError::TopologyBreach {
            source_ref: ref_name.to_owned(),
            target_ref: "canonical-ref".to_owned(),
            reason: format!(
                "FGT-TOP-001: strict governance forbids creating uncategorized reference '{ref_name}'"
            ),
        })
    }
}

fn is_exempt_auxiliary_ref(ref_name: &str) -> bool {
    ref_name.starts_with("refs/remotes/")
        || ref_name.starts_with("refs/tags/")
        || ref_name.starts_with("refs/replace/")
        || ref_name.starts_with("refs/fractal/quarantine/")
        || ref_name.starts_with("refs/fractal/telemetry/")
}
