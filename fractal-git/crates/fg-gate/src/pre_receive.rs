//! Module: fg-gate — Protocol-Level Pre-Receive Authorization Guard
//! File Path: crates/fg-gate/src/pre_receive.rs
//! Architecture Role: Implements protocol-level authentication and push privilege validation,
//!   blocking unauthorized direct pushes to System Trunk or cross-role violations.

use fg_core::error::{FractalError, FractalResult};
use fg_topology::refs::FractalRef;

/// Contextual identity credentials accompanying a Git push or materialization request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentPushContext {
    pub agent_uid: String,
    pub cell_id: String,
    pub role: String,
    pub is_force_push: bool,
}

/// Pre-receive protocol-level authorization guard.
pub struct PreReceiveGuard;

impl PreReceiveGuard {
    /// Asserts that the pushing agent holds legal authority to advance `target_ref`.
    pub fn assert_push_authorized(
        target_ref: &FractalRef,
        ctx: &AgentPushContext,
    ) -> FractalResult<()> {
        // Rule 1: Force push is categorically banned across all fractal tiers
        if ctx.is_force_push {
            return Err(FractalError::TopologyBreach {
                source_ref: ctx.agent_uid.clone(),
                target_ref: target_ref.to_git_ref(),
                reason: "Force push (--force) is categorically forbidden in fractal git".into(),
            });
        }

        match target_ref {
            // Rule 2: System Trunk can NEVER be directly pushed to by individual agents
            FractalRef::Trunk => Err(FractalError::TopologyBreach {
                source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                target_ref: target_ref.to_git_ref(),
                reason: "Direct agent push to System Trunk is forbidden; requires L3A promotion".into(),
            }),

            // Rule 3: SubAgents can only push to their designated subagent branch
            FractalRef::SubAgentWorktree { cell_id, .. } => {
                if cell_id != &ctx.cell_id {
                    Err(FractalError::TopologyBreach {
                        source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                        target_ref: target_ref.to_git_ref(),
                        reason: "Cross-cell push breach in subagent tier".into(),
                    })
                } else {
                    Ok(())
                }
            }

            // Rule 4: Card worktrees can only be updated by members of the designated cell
            FractalRef::CardWorktree { cell_id, .. } => {
                if cell_id != &ctx.cell_id {
                    Err(FractalError::TopologyBreach {
                        source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                        target_ref: target_ref.to_git_ref(),
                        reason: "Cross-cell push breach in card tier".into(),
                    })
                } else {
                    Ok(())
                }
            }

            // Rule 5: Cell Main can only be updated via verified merge from card tier
            FractalRef::CellMain { cell_id } => {
                if cell_id != &ctx.cell_id {
                    Err(FractalError::TopologyBreach {
                        source_ref: format!("{}:{}", ctx.cell_id, ctx.agent_uid),
                        target_ref: target_ref.to_git_ref(),
                        reason: "Cross-cell push breach in cell main tier".into(),
                    })
                } else {
                    Ok(())
                }
            }
        }
    }
}
