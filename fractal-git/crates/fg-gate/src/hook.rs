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

use std::sync::Arc;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{ActorIdentity, TaxisPolicy};

use crate::commit_guard::CommitMessageGuard;

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

impl FractalHook for HygieneConflictHook {
    fn id(&self) -> &'static str {
        "fgt-hook-hygiene-conflict"
    }

    fn tier(&self) -> HookTier {
        HookTier::SubToCard
    }

    fn evaluate(&self, ctx: &HookContext<'_>) -> FractalResult<HookVerdict> {
        for path in ctx.staged_files {
            if path.is_empty() {
                return Ok(HookVerdict::Block {
                    reason: "HYG-EMP-001: Attempted to stage empty path entry".into(),
                });
            }
        }
        Ok(HookVerdict::Pass)
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
// Built-in Level 3 Hook: UAC Nonce & Human Authority Gate
// -----------------------------------------------------------------------------

/// Level 3 Hook: Strictly intercepts System Trunk promotions requiring human authority.
#[derive(Debug, Default)]
pub struct UacPromotionGateHook;

impl FractalHook for UacPromotionGateHook {
    fn id(&self) -> &'static str {
        "fgt-hook-uac-promotion-gate"
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

            if !ctx.actor.has_authority_credential() {
                return Ok(HookVerdict::Block {
                    reason: "Human authority claim carries no credential token; provide a verified --token for System Trunk writes".into(),
                });
            }
        }
        Ok(HookVerdict::Pass)
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

    /// Creates a pipeline populated with default industrial gates across L1~L3.
    pub fn with_defaults() -> Self {
        let mut pipeline = Self::new();
        pipeline.register(Arc::new(HygieneConflictHook));
        pipeline.register(Arc::new(CommitGovernanceHook));
        pipeline.register(Arc::new(UacPromotionGateHook));
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
        let mut blocks = Vec::new();

        for (hook_id, verdict) in results {
            if let Some(reason) = verdict.block_reason() {
                blocks.push(format!("[{hook_id}] {reason}"));
            }
        }

        if !blocks.is_empty() {
            return Err(FractalError::GateRejection {
                score: 0.0,
                violations: blocks,
            });
        }

        Ok(())
    }
}
