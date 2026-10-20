//! Module: fg-core — Actor Identity & Authority Hierarchy
//! File Path: crates/fg-core/src/models/identity.rs
//! Architecture Role: Strongly-typed human vs agent actor representation,
//!   enforcing physical authority separation between autonomous agent sandboxes
//!   and human-controlled dual trunks (System Trunk & Integration Trunk).

use serde::{Deserialize, Serialize};

/// Contextual identity credentials accompanying an agent push or materialization request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentPushContext {
    pub agent_uid: String,
    pub cell_id: String,
    pub role: String,
    pub is_force_push: bool,
}

/// Actor identity enumeration distinguishing human supervisors from autonomous agents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActorIdentity {
    /// Human supervisor: Holds exclusive authority over System Trunk and Integration Trunk.
    Human {
        username: String,
        email: String,
        /// Optional cryptographic or token-based authority proof.
        authority_token: Option<String>,
    },
    /// Autonomous Agent: Operates autonomously within Cell, Card, and SubAgent tiers.
    Agent(AgentPushContext),
}

impl ActorIdentity {
    /// Creates a human identity with optional token.
    pub fn human(
        username: impl Into<String>,
        email: impl Into<String>,
        token: Option<String>,
    ) -> Self {
        Self::Human {
            username: username.into(),
            email: email.into(),
            authority_token: token,
        }
    }

    /// Creates an agent identity from standard push context.
    pub fn agent(ctx: AgentPushContext) -> Self {
        Self::Agent(ctx)
    }

    /// Checks if this actor is a human.
    pub fn is_human(&self) -> bool {
        matches!(self, Self::Human { .. })
    }

    /// Checks if this actor is an autonomous agent.
    pub fn is_agent(&self) -> bool {
        matches!(self, Self::Agent(_))
    }

    /// Formats display name for logging and Git signatures.
    pub fn display_name(&self) -> String {
        match self {
            Self::Human {
                username, email, ..
            } => format!("{} <{}>", username, email),
            Self::Agent(ctx) => format!("{}:{} ({})", ctx.cell_id, ctx.agent_uid, ctx.role),
        }
    }
}

/// Authority tier determining permissions over reference hierarchies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AuthorityTier {
    /// L3/L4: SubAgent and Card worktree (fully autonomous agent execution).
    AgentAutonomous = 0,
    /// L2: Cell Main (consensus among cell agents).
    CellConsensus = 1,
    /// L0/L1: Integration Trunk and System Trunk (strictly human exclusive).
    HumanExclusive = 2,
}
