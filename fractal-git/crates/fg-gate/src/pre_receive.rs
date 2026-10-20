//! Module: fg-gate — Protocol-Level Pre-Receive Authorization Guard
//! File Path: crates/fg-gate/src/pre_receive.rs
//! Architecture Role: Implements protocol-level authentication and push privilege validation,
//!   enforcing human-exclusive control on dual trunks and agent sandbox boundary isolation.

use fg_core::error::{FractalError, FractalResult};
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
    pub fn assert_actor_authorized(
        target_ref: &FractalRef,
        actor: &ActorIdentity,
        policy: &TaxisPolicy,
    ) -> FractalResult<()> {
        // Rule 1: Check force push if agent
        if let ActorIdentity::Agent(ref ctx) = actor {
            if ctx.is_force_push {
                return Err(FractalError::TopologyBreach {
                    source_ref: ctx.agent_uid.clone(),
                    target_ref: target_ref.to_git_ref(),
                    reason: "Force push (--force) is categorically forbidden in fractal git".into(),
                });
            }
        }

        // Rule 2: Human control boundary on dual trunks
        if policy.human_controlled_trunks {
            match target_ref {
                FractalRef::SystemTrunk { branch } => {
                    if let ActorIdentity::Agent(ctx) = actor {
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
                    return Ok(());
                }
                FractalRef::Trunk => {
                    if let ActorIdentity::Agent(ctx) = actor {
                        return Err(FractalError::TopologyBreach {
                            source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                            target_ref: fg_core::constants::refs::REF_FRACTAL_TRUNK.into(),
                            reason: "Human Control Breach: Integration Trunk is strictly \
                                     human-controlled; promotions require human sign-off"
                                .into(),
                        });
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
}
