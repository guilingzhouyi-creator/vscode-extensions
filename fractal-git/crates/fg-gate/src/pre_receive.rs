//! Module: fg-gate — Protocol-Level Pre-Receive Authorization Guard
//! File Path: crates/fg-gate/src/pre_receive.rs
//! Architecture Role: Implements protocol-level authentication and push privilege validation,
//!   enforcing human-exclusive control on dual trunks and agent sandbox boundary isolation.
//! Dependencies & Triggers: Invoked by `AutoAuditHook`, `PromotionBridge`, and `taxis push` CLI.
//! Responsibilities: Enforce force-push prohibition (`FGT-GAT-001`), dual-trunk human MAC authority,
//!   and autonomous SubAgent / Card cell namespace confinement (`FGT-TOP-001`).
//! Exit Semantics & Design Rationale:
//!   - Fail-closed authorization: any missing secret, invalid MAC, or cross-cell reference push
//!     immediately halts with `FractalError::TopologyBreach`.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Protocol gate facade and rule compliance
//! - `FGT-TOP-001`: Worktree topology and reference namespace guard

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{current_unix_seconds, AUTHORITY_REMEDIATION};
pub use fg_core::models::{ActorIdentity, AgentPushContext, TaxisPolicy};
use fg_topology::refs::FractalRef;

/// Returns true if the branch name designates a protected system trunk (`main`, `master`, `trunk`).
#[inline]
pub fn is_protected_trunk_branch(branch: &str) -> bool {
    branch == "main" || branch == "master" || branch == "trunk"
}

/// Pre-receive protocol-level authorization guard.
pub struct PreReceiveGuard;

impl PreReceiveGuard {
    /// Asserts that the pushing agent holds legal authority to advance `target_ref`.
    pub fn assert_push_authorized(
        target_ref: &FractalRef,
        push_context: &AgentPushContext,
    ) -> FractalResult<()> {
        let actor = ActorIdentity::agent(push_context.clone());
        let policy = TaxisPolicy::rust_strict();
        Self::assert_actor_authorized(target_ref, &actor, &policy)
    }

    /// Asserts whether `actor` (Human or Agent) holds legal authority to advance `target_ref`
    /// according to the repository's `TaxisPolicy`.
    ///
    /// Human authority over a dual trunk requires a present, non-blank credential. The
    /// identity variant alone is a claim, not a proof: without this check any caller able to
    /// pass `--human <name>` would satisfy the very boundary the policy declares.
    pub fn assert_actor_authorized(
        target_ref: &FractalRef,
        actor: &ActorIdentity,
        policy: &TaxisPolicy,
    ) -> FractalResult<()> {
        // Rule 1: Check force push
        if actor.is_force_push() {
            return Err(FractalError::TopologyBreach {
                source_ref: actor.display_name(),
                target_ref: target_ref.to_git_ref(),
                reason: "Force push (--force) is categorically forbidden in fractal git".into(),
            });
        }

        // Rule 2: Human control boundary on dual trunks
        if policy.human_controlled_trunks && Self::assert_trunk_control(target_ref, actor, policy)?
        {
            return Ok(());
        }

        // Rule 3: Tier isolation for autonomous agents
        if let ActorIdentity::Agent(ref push_context) = actor {
            Self::assert_agent_cell_isolation(target_ref, push_context)?;
        }

        Ok(())
    }

    /// Enforces human-only promotion on `SystemTrunk` and `Trunk`, returning `Ok(true)` if handled.
    fn assert_trunk_control(
        target_ref: &FractalRef,
        actor: &ActorIdentity,
        policy: &TaxisPolicy,
    ) -> FractalResult<bool> {
        let (target_display, agent_reason) = match target_ref {
            FractalRef::SystemTrunk { branch } if is_protected_trunk_branch(branch) => (
                format!("{}{}", fg_core::constants::git::REF_HEADS_PREFIX, branch),
                "Human Control Breach: System Trunk is strictly human-controlled; agent direct promotion is forbidden",
            ),
            FractalRef::Trunk => (
                fg_core::constants::refs::REF_FRACTAL_TRUNK.into(),
                "Human Control Breach: Integration Trunk is strictly human-controlled; promotions require human sign-off",
            ),
            _ => return Ok(false),
        };

        match actor {
            ActorIdentity::Agent(push_context) => Err(FractalError::TopologyBreach {
                source_ref: format!("{}:{}", push_context.cell_id, push_context.agent_uid),
                target_ref: target_display,
                reason: agent_reason.into(),
            }),
            ActorIdentity::Human { .. } => {
                Self::assert_human_authority(target_ref, actor, policy)?;
                Ok(true)
            }
        }
    }

    /// Enforces cell-level reference confinement for autonomous agents.
    fn assert_agent_cell_isolation(
        target_ref: &FractalRef,
        push_context: &AgentPushContext,
    ) -> FractalResult<()> {
        let source_ref = format!("{}:{}", push_context.cell_id, push_context.agent_uid);
        let (target_cell, tier_label) = match target_ref {
            FractalRef::SystemTrunk { branch } if is_protected_trunk_branch(branch) => {
                return Err(FractalError::TopologyBreach {
                    source_ref,
                    target_ref: target_ref.to_git_ref(),
                    reason: "Direct agent push to trunk hierarchy is forbidden".into(),
                });
            }
            FractalRef::SystemTrunk { .. } => {
                return Ok(());
            }
            FractalRef::Trunk => {
                return Err(FractalError::TopologyBreach {
                    source_ref,
                    target_ref: target_ref.to_git_ref(),
                    reason: "Direct agent push to trunk hierarchy is forbidden".into(),
                });
            }
            FractalRef::TelemetryCommit { .. } => {
                return Err(FractalError::TopologyBreach {
                    source_ref,
                    target_ref: target_ref.to_git_ref(),
                    reason: "Direct agent push to commit telemetry is forbidden; must be issued by kernel audit hook".into(),
                });
            }
            FractalRef::CommitBypassAudit { .. } => {
                return Err(FractalError::TopologyBreach {
                    source_ref,
                    target_ref: target_ref.to_git_ref(),
                    reason: "Direct agent push to a bypass audit receipt is forbidden; must be issued by the commit guard".into(),
                });
            }
            FractalRef::AuditTrunk
            | FractalRef::AuditCellMain { .. }
            | FractalRef::AuditCard { .. }
            | FractalRef::AuditSubAgent { .. } => {
                return Err(FractalError::TopologyBreach {
                    source_ref,
                    target_ref: target_ref.to_git_ref(),
                    reason: "Direct agent push to audit tree is forbidden; must be issued by kernel audit hook".into(),
                });
            }
            FractalRef::SubAgentWorktree { cell_id, .. } => (cell_id, "subagent"),
            FractalRef::CardWorktree { cell_id, .. } => (cell_id, "card"),
            FractalRef::CellMain { cell_id } => (cell_id, "cell main"),
            FractalRef::CellTelemetryLedger { cell_id }
            | FractalRef::CardTelemetrySummary { cell_id, .. } => (cell_id, "telemetry"),
        };

        if target_cell != &push_context.cell_id {
            return Err(FractalError::TopologyBreach {
                source_ref,
                target_ref: target_ref.to_git_ref(),
                reason: format!("Cross-cell push breach in {tier_label} tier"),
            });
        }
        Ok(())
    }

    /// Asserts whether a force-push or forced reference rewrite is legal.
    /// Force-pushing to SystemTrunk, Trunk, CellMain, or protected telemetry references is categorically prohibited.
    pub fn assert_force_push_allowed(
        target_ref: &FractalRef,
        actor: &ActorIdentity,
    ) -> FractalResult<()> {
        match target_ref {
            FractalRef::SystemTrunk { branch } if is_protected_trunk_branch(branch) => {
                Err(FractalError::TopologyBreach {
                    source_ref: actor.display_name(),
                    target_ref: target_ref.to_git_ref(),
                    reason: "Force push (--force) is categorically forbidden on trunk, cell-main, and protected telemetry references; use 'revert' instead"
                        .into(),
                })
            }
            FractalRef::Trunk
            | FractalRef::CellMain { .. }
            | FractalRef::TelemetryCommit { .. }
            | FractalRef::CellTelemetryLedger { .. }
            | FractalRef::CardTelemetrySummary { .. }
            | FractalRef::CommitBypassAudit { .. }
            | FractalRef::AuditTrunk
            | FractalRef::AuditCellMain { .. }
            | FractalRef::AuditCard { .. }
            | FractalRef::AuditSubAgent { .. } => {
                Err(FractalError::TopologyBreach {
                    source_ref: actor.display_name(),
                    target_ref: target_ref.to_git_ref(),
                    reason: "Force push (--force) is categorically forbidden on trunk, cell-main, and protected telemetry references; use 'revert' instead"
                        .into(),
                })
            }
            FractalRef::SystemTrunk { .. } => {
                if actor.is_agent() {
                    Err(FractalError::TopologyBreach {
                        source_ref: actor.display_name(),
                        target_ref: target_ref.to_git_ref(),
                        reason: "Force push (--force) on feature branches is forbidden for autonomous agents".into(),
                    })
                } else {
                    Ok(())
                }
            }
            FractalRef::SubAgentWorktree { .. } | FractalRef::CardWorktree { .. } => {
                if actor.is_agent() {
                    Err(FractalError::TopologyBreach {
                        source_ref: actor.display_name(),
                        target_ref: target_ref.to_git_ref(),
                        reason: "Force push (--force) on worktree branches is forbidden for autonomous agents".into(),
                    })
                } else {
                    Ok(())
                }
            }
        }
    }

    /// Verifies a human authority claim cryptographically (fail-closed).
    ///
    /// A non-blank token is only a claim: the MAC, expiry, and signed subject are
    /// all checked here, and a missing configured secret rejects instead of
    /// disabling verification.
    fn assert_human_authority(
        target_ref: &FractalRef,
        actor: &ActorIdentity,
        policy: &TaxisPolicy,
    ) -> FractalResult<()> {
        let now_secs = current_unix_seconds();
        actor
            .verify_authority(policy.authority_secret.as_ref(), now_secs)
            .map(|_| ())
            .map_err(|error| FractalError::TopologyBreach {
                source_ref: actor.display_name(),
                target_ref: target_ref.to_git_ref(),
                reason: format!("Human Control Breach: {error}; {AUTHORITY_REMEDIATION}"),
            })
    }
}
