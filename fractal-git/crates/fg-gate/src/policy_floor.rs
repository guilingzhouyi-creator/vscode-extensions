//! Module: fg-gate — Commit Policy Tier Floor
//! File Path: crates/fg-gate/src/policy_floor.rs
//! Architecture Role: Resolves the versioned enforcement floor declared by the repository and
//!   decides whether a requested preset is allowed to run.
//! Dependencies & Triggers: Consumed by the Taxis commit, merge and history-rewrite dispatchers
//!   before a message is validated.
//! Responsibilities: Read the floor manifest, compare enforcement tiers monotonically, and reject
//!   a request that would relax the contract rather than apply it silently.
//! Exit Semantics & Design Rationale: A downgrade attempt is a typed rejection, never a warning.
//!   The failure being guarded against is a gate that looks binding but can be switched off by the
//!   very caller it constrains, so the check has to fail closed. An absent manifest falls back to
//!   the strictest tier: a repository that lost its manifest must not silently become permissive.
//!
//! Domain Governance Rules: FGT-MSG-011 (policy tier guard), FGT-GAT-001.

use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{EnforcementTier, TaxisPolicy};

/// Repository-relative location of the versioned floor manifest.
const MANIFEST_RELATIVE_PATH: &str = "commit-policy.json";

/// Resolved enforcement floor for one repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyFloor {
    /// Tier every commit in this repository must at least satisfy.
    pub tier: EnforcementTier,
    /// Name of the preset that supplies the minimum obligations.
    pub preset: String,
    /// Whether a floor manifest was actually found and parsed.
    pub declared: bool,
}

impl PolicyFloor {
    /// Fallback floor used when no manifest can be read.
    ///
    /// Falling back to the strictest tier is deliberate: a missing manifest is an unknown state,
    /// and an unknown state must not grant more freedom than the governed default.
    pub fn governed_default() -> Self {
        Self {
            tier: EnforcementTier::Strict,
            preset: "workspace-strict".to_string(),
            declared: false,
        }
    }

    /// Resolves the floor declared by `git_dir`'s owning repository.
    ///
    /// The manifest lives beside the working tree rather than inside `.git`, because a file that
    /// only exists in the untracked metadata directory cannot be reviewed when it changes.
    pub fn resolve(git_dir: &Path) -> Self {
        let candidates = candidate_manifest_paths(git_dir);
        for path in candidates {
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) else {
                continue;
            };
            let Some(preset) = parsed
                .get("floor")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            let Some(tier) = EnforcementTier::parse_str(preset) else {
                continue;
            };
            return Self {
                tier,
                preset: preset.to_string(),
                declared: true,
            };
        }
        Self::governed_default()
    }

    /// Returns `Ok(())` when `requested` may run under this floor.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::GateRejection`] carrying `FGT-MSG-011` when the requested preset
    /// ranks below the floor, which is a downgrade attempt rather than a valid choice.
    pub fn assert_permits(&self, requested: &TaxisPolicy) -> FractalResult<()> {
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
    /// Returns the stricter of the requested preset and the floor, so an operation that asks for
    /// something looser silently upgrades rather than failing when the caller had no intent to
    /// bypass. Callers that must surface a downgrade as an error use [`Self::assert_permits`].
    pub fn effective_policy(&self, requested: TaxisPolicy) -> TaxisPolicy {
        if requested.enforcement_tier().rank() >= self.tier.rank() {
            return requested;
        }
        crate::policy_floor::preset_for_tier(self.tier)
    }
}

/// Returns the canonical preset for one tier.
///
/// Kept here rather than in `fg-core` because the mapping from a tier to a policy preset is a gate
/// decision: core defines what the tiers mean, the gate decides which preset enforces one.
pub fn preset_for_tier(tier: EnforcementTier) -> TaxisPolicy {
    match tier {
        EnforcementTier::Strict => TaxisPolicy::workspace_strict(),
        EnforcementTier::Conventional => TaxisPolicy::conventional_semantic(),
        EnforcementTier::Native => TaxisPolicy::git_native(),
    }
}

/// Lists the manifest paths to try, most specific first.
fn candidate_manifest_paths(git_dir: &Path) -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::with_capacity(3);
    if let Some(work_root) = git_dir.parent() {
        candidates.push(work_root.join(MANIFEST_RELATIVE_PATH));
        candidates.push(work_root.join("fractal-git").join(MANIFEST_RELATIVE_PATH));
    }
    candidates.push(git_dir.join(MANIFEST_RELATIVE_PATH));
    candidates
}
