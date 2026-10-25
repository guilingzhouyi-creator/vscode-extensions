//! Module: fg-core — Actor Identity & Authority Hierarchy
//! File Path: crates/fg-core/src/models/identity.rs
//! Architecture Role: Strongly-typed human vs agent actor representation,
//!   enforcing physical authority separation between autonomous agent sandboxes
//!   and human-controlled dual trunks (System Trunk & Integration Trunk).

use serde::{Deserialize, Serialize};

use crate::error::{FractalError, FractalResult};
use crate::models::authority::{AuthorityClaims, AuthoritySecret, AUTHORITY_REMEDIATION};

/// Registered CLI tag reused for every authority rejection.
const BREACH_TAG: &str = "[AUTHORITY_BREACH]";

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
    /// Creates a human identity from a verified authority proof.
    ///
    /// The token is mandatory and non-blank: an identity that claims human authority without
    /// any credential would let `--human <name>` alone satisfy the dual-trunk boundary, which
    /// is exactly the boundary this type exists to enforce.
    pub fn human(
        username: impl Into<String>,
        email: impl Into<String>,
        token: impl Into<String>,
    ) -> Self {
        Self::Human {
            username: username.into(),
            email: email.into(),
            authority_token: Some(token.into()),
        }
    }

    /// Creates a human identity whose authority claim carries no credential.
    ///
    /// Reserved for gate self-tests and policy simulation. Callers on a production path must
    /// use [`ActorIdentity::human`] instead.
    pub fn unverified_human(username: impl Into<String>, email: impl Into<String>) -> Self {
        Self::Human {
            username: username.into(),
            email: email.into(),
            authority_token: None,
        }
    }

    /// Returns the presented authority token, if any.
    pub fn authority_token(&self) -> Option<&str> {
        match self {
            Self::Human {
                authority_token, ..
            } => authority_token.as_deref(),
            Self::Agent(_) => None,
        }
    }

    /// Checks whether this identity carries a non-blank authority credential.
    ///
    /// This is a *structural* predicate only: it says nothing about whether the
    /// credential is authentic. Authorization decisions must call
    /// [`ActorIdentity::verify_authority`].
    pub fn has_authority_credential(&self) -> bool {
        self.authority_token()
            .map(|token| !token.trim().is_empty())
            .unwrap_or(false)
    }

    /// Verifies this human identity's authority token against `secret`.
    ///
    /// Fail-closed contract:
    /// - agent identities can never satisfy a human-authority check;
    /// - a missing or blank token is rejected;
    /// - a missing secret is rejected (absence never means "skip verification");
    /// - the signed subject must equal the claimed username, so one human's token
    ///   cannot be replayed under another human's name.
    pub fn verify_authority(
        &self,
        secret: Option<&AuthoritySecret>,
        now_secs: i64,
    ) -> FractalResult<AuthorityClaims> {
        let Self::Human {
            username,
            authority_token,
            ..
        } = self
        else {
            return Err(FractalError::PolicyViolation(format!(
                "{BREACH_TAG} agent identities never carry human authority; {AUTHORITY_REMEDIATION}"
            )));
        };
        let token = authority_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                FractalError::PolicyViolation(format!(
                    "{BREACH_TAG} human '{username}' carries no credential; {AUTHORITY_REMEDIATION}"
                ))
            })?;
        let secret = secret.ok_or_else(|| {
            FractalError::PolicyViolation(format!(
                "{BREACH_TAG} cannot verify human '{username}' because no authority secret is configured; {AUTHORITY_REMEDIATION}"
            ))
        })?;
        let claims = secret.verify(token, now_secs)?;
        if claims.subject != *username {
            return Err(FractalError::AuthProofInvalid(format!(
                "{BREACH_TAG} token subject '{}' does not match claimed human '{username}'; {AUTHORITY_REMEDIATION}",
                claims.subject
            )));
        }
        Ok(claims)
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

    /// Checks if this actor requested a force-push operation.
    pub fn is_force_push(&self) -> bool {
        match self {
            Self::Agent(ctx) => ctx.is_force_push,
            Self::Human { .. } => false,
        }
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
