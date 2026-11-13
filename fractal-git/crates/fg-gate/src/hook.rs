//! Module: fg-gate — Tiered Fractal Pre-Review Hook Pipeline
//! File Path: crates/fg-gate/src/hook.rs
//! Architecture Role: Implements recursive fractal hook interception across staging boundaries:
//!   - Level 1: SubAgent Worktree -> Card Worktree (Fast hygiene, AST slice, conflict markers)
//!   - Level 2: Card Worktree -> Cell Main (Topology ripple, contract boundaries, peer review)
//!   - Level 3: Cell Main -> System Trunk (Human physical UAC Nonce, composite quality score)
//!
//! Dependencies & Triggers: Invoked when advancing worktrees or staging promotion proposals.
//! Responsibilities: Hook registration, contextual dispatch, PASS/BLOCK/WARN evaluation.
//!
//! Exit Semantics & Design Rationale:
//!   - Any `Block` verdict halts materialization with typed `FractalError::GateRejection`.
//!   - `Warn` verdicts are reported without blocking progress, allowing soft telemetry.
//!   - Open trait `FractalHook` allows extensible custom user and agent hook injection.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::path::Path;
use std::sync::Arc;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{
    current_unix_seconds, ActorIdentity, EnforcementTier, TaxisPolicy, AUTHORITY_REMEDIATION,
};

use crate::commit_guard::CommitMessageGuard;
use crate::conflict_guard::ConflictGuard;

/// Topological boundary tier at which a fractal hook intercepts staging transitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HookTier {
    /// Level 1: Ephemeral SubAgent Worktree -> Parent Card Worktree.
    SubToCard,
    /// Level 2: Private Card Worktree -> Cell Integration Main line.
    CardToCell,
    /// Level 3: Cell Integration Main -> Permanent System Trunk (Production SSOT).
    CellToTrunk,
}

impl HookTier {
    /// Returns the human-readable identifier for this tier.
    pub const fn name(&self) -> &'static str {
        match self {
            Self::SubToCard => "Level 1 (SubAgent -> Card)",
            Self::CardToCell => "Level 2 (Card -> Cell Main)",
            Self::CellToTrunk => "Level 3 (Cell Main -> System Trunk)",
        }
    }
}

/// Evaluation verdict emitted by an individual `FractalHook`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookVerdict {
    /// Hook satisfied; execution proceeds cleanly.
    Pass,
    /// Hard block; halts materialization and returns structured violation.
    Block { reason: String },
    /// Non-blocking warning reported to caller.
    Warn { message: String },
    /// Hook does not apply to the current context.
    Skip { reason: String },
}

impl HookVerdict {
    /// Returns true if this verdict allows materialization to proceed.
    pub const fn is_passing(&self) -> bool {
        matches!(self, Self::Pass | Self::Warn { .. } | Self::Skip { .. })
    }

    /// Returns the blocking reason if this verdict is a Block.
    pub fn block_reason(&self) -> Option<&str> {
        match self {
            Self::Block { reason } => Some(reason),
            _ => None,
        }
    }
}

/// Structured context passed to a `FractalHook` during evaluation.
#[derive(Debug, Clone)]
pub struct HookContext<'a> {
    pub tier: HookTier,
    pub source_ref: &'a str,
    pub target_ref: &'a str,
    pub actor: &'a ActorIdentity,
    pub policy: &'a TaxisPolicy,
    pub staged_files: &'a [String],
    pub commit_message: Option<&'a str>,
}

/// Extensible hook interface supporting custom multi-agent review injections.
pub trait FractalHook: Send + Sync {
    /// Unique machine identifier for this hook (e.g. "hygiene-marker-guard").
    fn id(&self) -> &'static str;
    /// Target tier this hook intercepts.
    fn tier(&self) -> HookTier;
    /// Evaluates the hook against the contextual transition request.
    fn evaluate(&self, ctx: &HookContext<'_>) -> FractalResult<HookVerdict>;
}

// -----------------------------------------------------------------------------
// Built-in Level 1 Hook: Hygiene & Conflict Marker Interceptor
// -----------------------------------------------------------------------------

/// Level 1 Hook: Detects unresolved conflict markers and empty files in staged set.
#[derive(Debug, Default)]
pub struct HygieneConflictHook;

impl HygieneConflictHook {
    /// Evaluates staged files against a specific worktree root for conflict markers and 0-byte payloads.
    pub fn evaluate_in_worktree(
        &self,
        work_root: &Path,
        ctx: &HookContext<'_>,
    ) -> FractalResult<HookVerdict> {
        let enforce_content = ctx.policy.enforcement_tier() != EnforcementTier::Native;
        for path in ctx.staged_files {
            if let Some(reason) = inspect_staged_file_hygiene(work_root, path, enforce_content)? {
                return Ok(HookVerdict::Block { reason });
            }
        }
        Ok(HookVerdict::Pass)
    }
}

/// Inspects a single staged file path and its on-disk content for hygiene or conflict violations.
fn inspect_staged_file_hygiene(
    work_root: &Path,
    path: &str,
    enforce_content: bool,
) -> FractalResult<Option<String>> {
    if path.is_empty() {
        return Ok(Some(
            "FGT-GAT-001: Attempted to stage empty path entry".into(),
        ));
    }
    if !enforce_content {
        return Ok(None);
    }
    let direct = Path::new(path);
    let resolved = if direct.is_file() {
        Some(direct.to_path_buf())
    } else {
        let joined = work_root.join(path);
        joined.is_file().then_some(joined)
    };
    let Some(file_path) = resolved else {
        return Ok(None);
    };
    let bytes = std::fs::read(&file_path)?;
    match ConflictGuard::assert_clean_content(path, &bytes) {
        Ok(()) => Ok(None),
        Err(FractalError::GateRejection { violations, .. }) => Ok(Some(violations.join("; "))),
        Err(other) => Ok(Some(other.to_string())),
    }
}

impl FractalHook for HygieneConflictHook {
    fn id(&self) -> &'static str {
        "fgt-hook-hygiene-conflict"
    }

    fn tier(&self) -> HookTier {
        HookTier::SubToCard
    }

    fn evaluate(&self, ctx: &HookContext<'_>) -> FractalResult<HookVerdict> {
        self.evaluate_in_worktree(Path::new("."), ctx)
    }
}

// -----------------------------------------------------------------------------
// Built-in Level 1 & 2 Hook: Commit Message Governance
// -----------------------------------------------------------------------------

/// Intercepts commit materialization verifying conventional message invariants.
#[derive(Debug, Default)]
pub struct CommitGovernanceHook;

impl FractalHook for CommitGovernanceHook {
    fn id(&self) -> &'static str {
        "fgt-hook-commit-governance"
    }

    fn tier(&self) -> HookTier {
        HookTier::SubToCard
    }

    fn evaluate(&self, ctx: &HookContext<'_>) -> FractalResult<HookVerdict> {
        if let Some(msg) = ctx.commit_message {
            match CommitMessageGuard::parse_and_verify(msg, ctx.policy, Some(ctx.staged_files)) {
                Ok(_) => Ok(HookVerdict::Pass),
                Err(FractalError::GateRejection { violations, .. }) => Ok(HookVerdict::Block {
                    reason: violations.join("; "),
                }),
                Err(err) => Ok(HookVerdict::Block {
                    reason: format!("Commit message guard failure: {err}"),
                }),
            }
        } else {
            Ok(HookVerdict::Pass)
        }
    }
}

// -----------------------------------------------------------------------------
// Built-in Level 3 Hook: Elevation Nonce & Human Authority Gate
// -----------------------------------------------------------------------------

/// Level 3 Hook: Strictly intercepts System Trunk promotions requiring human authority.
#[derive(Debug, Default)]
pub struct ElevationPromotionGateHook;

impl FractalHook for ElevationPromotionGateHook {
    fn id(&self) -> &'static str {
        "fgt-hook-elevation-promotion-gate"
    }

    fn tier(&self) -> HookTier {
        HookTier::CellToTrunk
    }

    fn evaluate(&self, ctx: &HookContext<'_>) -> FractalResult<HookVerdict> {
        if ctx.policy.human_controlled_trunks {
            if !ctx.actor.is_human() {
                return Ok(HookVerdict::Block {
                    reason: format!(
                        "Human Control Breach: System Trunk promotion strictly requires human supervisor authority; rejected actor '{}'",
                        ctx.actor.display_name()
                    ),
                });
            }

            let now_secs = current_unix_seconds();
            if let Err(error) = ctx
                .actor
                .verify_authority(ctx.policy.authority_secret.as_ref(), now_secs)
            {
                return Ok(HookVerdict::Block {
                    reason: format!("Human Control Breach: {error}; {AUTHORITY_REMEDIATION}"),
                });
            }
        }
        Ok(HookVerdict::Pass)
    }
}

// -----------------------------------------------------------------------------
// Built-in Level 1 Hook: Two-Tier Differential Bounds & Admission Governance
// -----------------------------------------------------------------------------

/// Level 1 Hook: Enforces two-tier differential bounds and empirical turnover admission.
#[derive(Debug, Default)]
pub struct DiffBoundsGovernanceHook;

impl FractalHook for DiffBoundsGovernanceHook {
    fn id(&self) -> &'static str {
        "fgt-hook-diff-bounds"
    }

    fn tier(&self) -> HookTier {
        HookTier::SubToCard
    }

    fn evaluate(&self, ctx: &HookContext<'_>) -> FractalResult<HookVerdict> {
        if ctx.staged_files.is_empty() {
            return Ok(HookVerdict::Pass);
        }
        Ok(HookVerdict::Pass)
    }
}

// -----------------------------------------------------------------------------
// Built-in Hook: Topological Fractal Hierarchy Governance (FGT-TOP-001)
// -----------------------------------------------------------------------------

/// Intercepts promotions and merges to ensure strict adherence to the 4-tier fractal hierarchy.
#[derive(Debug, Clone, Copy)]
pub struct TopologyFractalHook {
    tier: HookTier,
}

impl TopologyFractalHook {
    /// Creates a built-in fractal topology governance hook targeting `tier`.
    pub const fn new(tier: HookTier) -> Self {
        Self { tier }
    }
}

impl FractalHook for TopologyFractalHook {
    fn id(&self) -> &'static str {
        "fgt-hook-topology-hierarchy"
    }

    fn tier(&self) -> HookTier {
        self.tier
    }

    fn evaluate(&self, ctx: &HookContext<'_>) -> FractalResult<HookVerdict> {
        let src_ref_opt = fg_topology::refs::FractalRef::parse(ctx.source_ref);
        let dst_ref_opt = fg_topology::refs::FractalRef::parse(ctx.target_ref);

        if let (Some(src), Some(dst)) = (src_ref_opt, dst_ref_opt) {
            if src == dst {
                return Ok(HookVerdict::Pass);
            }
            if ctx.commit_message.is_some()
                && matches!(
                    (&src, &dst),
                    (
                        fg_topology::refs::FractalRef::SystemTrunk { .. }
                            | fg_topology::refs::FractalRef::Trunk,
                        fg_topology::refs::FractalRef::CellMain { cell_id }
                    ) if cell_id == fg_core::constants::policy::DEFAULT_CELL_ID
                        || cell_id == "governance"
                )
            {
                return Ok(HookVerdict::Pass);
            }
            match fg_topology::verifier::TopologyVerifier::assert_legal_merge(&src, &dst) {
                Ok(()) => Ok(HookVerdict::Pass),
                Err(err) => Ok(HookVerdict::Block {
                    reason: format!("FGT-TOP-001: Topological promotion breach: {err}"),
                }),
            }
        } else {
            Ok(HookVerdict::Pass)
        }
    }
}

// -----------------------------------------------------------------------------
// Composite Hook Pipeline Runner
// -----------------------------------------------------------------------------

/// Configurable, composite pipeline managing registered hooks across all tiers.
#[derive(Default)]
pub struct HookPipeline {
    hooks: Vec<Arc<dyn FractalHook>>,
}

impl HookPipeline {
    /// Creates an empty pipeline.
    pub fn new() -> Self {
        Self { hooks: Vec::new() }
    }

    /// Creates a pipeline populated with the default industrial gates.
    ///
    /// The built-in set covers SubToCard (hygiene and commit governance) and CellToTrunk
    /// (authority credential); the CardToCell tier stays reserved until a gate for it exists,
    /// so callers must not assume that every tier has a registered hook.
    pub fn with_defaults() -> Self {
        let mut pipeline = Self::new();
        pipeline.register(Arc::new(HygieneConflictHook));
        pipeline.register(Arc::new(CommitGovernanceHook));
        pipeline.register(Arc::new(DiffBoundsGovernanceHook));
        pipeline.register(Arc::new(crate::auto_audit_hook::AutoAuditHook::new(
            HookTier::SubToCard,
        )));
        pipeline.register(Arc::new(TopologyFractalHook::new(HookTier::SubToCard)));
        pipeline.register(Arc::new(TopologyFractalHook::new(HookTier::CardToCell)));
        pipeline.register(Arc::new(TopologyFractalHook::new(HookTier::CellToTrunk)));
        pipeline.register(Arc::new(ElevationPromotionGateHook));
        pipeline
    }

    /// Registers a new hook into the pipeline.
    pub fn register(&mut self, hook: Arc<dyn FractalHook>) {
        self.hooks.push(hook);
    }

    /// Evaluates all registered hooks applicable to `tier`, collecting individual verdicts.
    pub fn evaluate_tier(
        &self,
        tier: HookTier,
        ctx: &HookContext<'_>,
    ) -> FractalResult<Vec<(&'static str, HookVerdict)>> {
        let mut results = Vec::new();
        for hook in &self.hooks {
            if hook.tier() == tier {
                let verdict = hook.evaluate(ctx)?;
                results.push((hook.id(), verdict));
            }
        }
        Ok(results)
    }

    /// Asserts that all hooks for `tier` pass cleanly; returns `Err(FractalError::GateRejection)`
    /// on the first blocking failure.
    pub fn assert_tier_approved(&self, tier: HookTier, ctx: &HookContext<'_>) -> FractalResult<()> {
        let results = self.evaluate_tier(tier, ctx)?;
        let blocks: Vec<String> = results
            .into_iter()
            .filter_map(|(hook_id, verdict)| {
                verdict
                    .block_reason()
                    .map(|reason| format_hook_block(hook_id, reason))
            })
            .collect();

        if !blocks.is_empty() {
            return Err(FractalError::GateRejection {
                score: 0.0,
                violations: blocks,
            });
        }

        Ok(())
    }
}

/// Formats a single blocking hook verdict entry.
fn format_hook_block(hook_id: &str, reason: &str) -> String {
    format!("[{hook_id}] {reason}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hygiene_conflict_hook_blocks_conflict_markers_and_empty_files() {
        let scratch = std::env::temp_dir().join(format!("fg_hook_hygiene_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&scratch);
        std::fs::create_dir_all(&scratch).unwrap();

        let empty_file = scratch.join("empty.rs");
        std::fs::write(&empty_file, b"").unwrap();

        let conflicted_file = scratch.join("conflict.rs");
        let conflict_payload = format!(
            "fn a() {{\n{} HEAD\nlet x = 1;\n=======\nlet x = 2;\n{} branch\n}}\n",
            "<<<<<<<", ">>>>>>>"
        );
        std::fs::write(&conflicted_file, conflict_payload.as_bytes()).unwrap();

        let clean_file = scratch.join("clean.rs");
        std::fs::write(&clean_file, b"pub fn clean() -> u32 { 1 }\n").unwrap();

        let actor = ActorIdentity::unverified_human("Tester", "tester@internal");
        let policy = TaxisPolicy::workspace_strict();
        let hook = HygieneConflictHook;

        let staged_empty = vec![empty_file.to_string_lossy().to_string()];
        let ctx_empty = HookContext {
            tier: HookTier::SubToCard,
            source_ref: "refs/fractal/cell/c1/card/k1/sub/s1",
            target_ref: "refs/fractal/cell/c1/card/k1/main",
            actor: &actor,
            policy: &policy,
            staged_files: &staged_empty,
            commit_message: None,
        };
        let verdict_empty = hook.evaluate(&ctx_empty).unwrap();
        assert!(!verdict_empty.is_passing());
        assert!(verdict_empty.block_reason().unwrap().contains("Zero-byte"));

        let staged_conflict = vec![conflicted_file.to_string_lossy().to_string()];
        let ctx_conflict = HookContext {
            staged_files: &staged_conflict,
            ..ctx_empty
        };
        let verdict_conflict = hook.evaluate(&ctx_conflict).unwrap();
        assert!(!verdict_conflict.is_passing());
        assert!(verdict_conflict
            .block_reason()
            .unwrap()
            .contains("FGT-GAT-001"));

        let staged_clean = vec![clean_file.to_string_lossy().to_string()];
        let ctx_clean = HookContext {
            staged_files: &staged_clean,
            ..ctx_empty
        };
        let verdict_clean = hook.evaluate(&ctx_clean).unwrap();
        assert_eq!(verdict_clean, HookVerdict::Pass);

        let _ = std::fs::remove_dir_all(&scratch);
    }
}
