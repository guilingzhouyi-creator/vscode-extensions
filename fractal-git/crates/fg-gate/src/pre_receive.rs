//! Module: fg-gate — Protocol-Level Pre-Receive Authorization Guard
//! File Path: crates/fg-gate/src/pre_receive.rs
//! Architecture Role: Implements protocol-level authentication and push privilege validation,
//!   enforcing human-exclusive control on dual trunks and agent sandbox boundary isolation.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{current_unix_seconds, AUTHORITY_REMEDIATION};
pub use fg_core::models::{ActorIdentity, AgentPushContext, TaxisPolicy};
use fg_topology::refs::FractalRef;

/// Pre-receive protocol-level authorization guard.
pub struct PreReceiveGuard;

impl PreReceiveGuard {
    /// Asserts that the pushing agent holds legal authority to advance `target_ref`.
    pub fn assert_push_authorized(
        target_ref: &FractalRef,
        ctx: &AgentPushContext,
    ) -> FractalResult<()> {
        let actor = ActorIdentity::agent(ctx.clone());
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
        if policy.human_controlled_trunks {
            match target_ref {
                FractalRef::SystemTrunk { branch } => {
                    match actor {
                        ActorIdentity::Agent(ctx) => {
                            return Err(FractalError::TopologyBreach {
                                source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                                target_ref: format!(
                                    "{}{}",
                                    fg_core::constants::git::REF_HEADS_PREFIX,
                                    branch
                                ),
                                reason: "Human Control Breach: System Trunk is strictly \
                                         human-controlled; agent direct promotion is forbidden"
                                    .into(),
                            });
                        }
                        ActorIdentity::Human { .. } => {
                            Self::assert_human_authority(target_ref, actor, policy)?;
                        }
                    }
                    return Ok(());
                }
                FractalRef::Trunk => {
                    match actor {
                        ActorIdentity::Agent(ctx) => {
                            return Err(FractalError::TopologyBreach {
                                source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                                target_ref: fg_core::constants::refs::REF_FRACTAL_TRUNK.into(),
                                reason: "Human Control Breach: Integration Trunk is strictly \
                                         human-controlled; promotions require human sign-off"
                                    .into(),
                            });
                        }
                        ActorIdentity::Human { .. } => {
                            Self::assert_human_authority(target_ref, actor, policy)?;
                        }
                    }
                    return Ok(());
                }
                _ => {}
            }
        }

        // Rule 3: Tier isolation for autonomous agents
        if let ActorIdentity::Agent(ref ctx) = actor {
            match target_ref {
                FractalRef::SystemTrunk { .. } | FractalRef::Trunk => {
                    return Err(FractalError::TopologyBreach {
                        source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                        target_ref: target_ref.to_git_ref(),
                        reason: "Direct agent push to trunk hierarchy is forbidden".into(),
                    });
                }
                FractalRef::SubAgentWorktree { cell_id, .. } => {
                    if cell_id != &ctx.cell_id {
                        return Err(FractalError::TopologyBreach {
                            source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                            target_ref: target_ref.to_git_ref(),
                            reason: "Cross-cell push breach in subagent tier".into(),
                        });
                    }
                }
                FractalRef::CardWorktree { cell_id, .. } => {
                    if cell_id != &ctx.cell_id {
                        return Err(FractalError::TopologyBreach {
                            source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                            target_ref: target_ref.to_git_ref(),
                            reason: "Cross-cell push breach in card tier".into(),
                        });
                    }
                }
                FractalRef::CellMain { cell_id } => {
                    if cell_id != &ctx.cell_id {
                        return Err(FractalError::TopologyBreach {
                            source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                            target_ref: target_ref.to_git_ref(),
                            reason: "Cross-cell push breach in cell main tier".into(),
                        });
                    }
                }
            }
        }

        Ok(())
    }

    /// Asserts whether a force-push or forced reference rewrite is legal.
    /// Force-pushing to SystemTrunk, Trunk, or CellMain is categorically prohibited across all actors.
    pub fn assert_force_push_allowed(
        target_ref: &FractalRef,
        actor: &ActorIdentity,
    ) -> FractalResult<()> {
        match target_ref {
            FractalRef::SystemTrunk { .. } | FractalRef::Trunk | FractalRef::CellMain { .. } => {
                Err(FractalError::TopologyBreach {
                    source_ref: actor.display_name(),
                    target_ref: target_ref.to_git_ref(),
                    reason: "Force push (--force) is categorically forbidden on trunk and cell-main branches; use 'revert' instead"
                        .into(),
                })
            }
            FractalRef::SubAgentWorktree { .. } | FractalRef::CardWorktree { .. } => {
                if actor.is_agent() {
                    Err(FractalError::TopologyBreach {
                        source_ref: actor.display_name(),
                        target_ref: target_ref.to_git_ref(),
                        reason: "Force push (--force) is categorically forbidden for autonomous agents".into(),
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
