//! Module: fg-core — Card-Level Active Intent Blackboard
//! File Path: crates/fg-core/src/models/blackboard.rs
//! Architecture Role: Manages lockless, active intent leases across concurrent SubAgent worktrees
//!   within the parent Card worktree, declaring non-overlapping modification zones to eliminate
//!   semantic collision before coding starts.
//! Dependencies & Triggers: Dispatched by `taxis blackboard` CLI and SubAgent orchestration harnesses.
//! Responsibilities: Intent claim, disjoint scope validation, TTL lease pruning, and JSON serialization.
//! Exit Semantics & Design Rationale:
//!   - Lock-free cooperative lease registration without blocking other agents.
//!   - Collisions are reported with typed `BlackboardCollision` containing the conflicting agent UID.
//!   - Automatic TTL expiry prevents deadlocks if a SubAgent terminates unexpectedly.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use std::hash::BuildHasher;

use serde::{Deserialize, Serialize};

/// Represents an active intention lease on a semantic code block or path range.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntentLease {
    /// Unique lease identifier (e.g. `lease-1792770000-sub01`).
    pub lease_id: String,
    /// Identifier of the SubAgent holding this lease.
    pub agent_uid: String,
    /// Relative file path claimed (e.g. `crates/fg-gate/src/pre_receive.rs`).
    pub file_path: String,
    /// Semantic scope identifier or signature (e.g. `fn assert_push_authorized`).
    pub scope_id: String,
    /// Unix timestamp in milliseconds when the lease was acquired.
    pub acquired_at_ms: i64,
    /// Lease duration in seconds before automatic expiration.
    pub ttl_seconds: u64,
}

impl IntentLease {
    /// Checks if this lease has expired relative to `now_ms`.
    pub fn is_expired(&self, now_ms: i64) -> bool {
        let expiry_ms = self.acquired_at_ms + (self.ttl_seconds as i64 * 1000);
        now_ms > expiry_ms
    }

    /// Checks if this lease collides with a requested file and scope.
    pub fn collides_with(&self, file_path: &str, scope_id: &str, now_ms: i64) -> bool {
        if self.is_expired(now_ms) {
            return false;
        }
        if self.file_path != file_path {
            return false;
        }
        // Scope collision: identical scope or whole-file claim ("*")
        self.scope_id == "*" || scope_id == "*" || self.scope_id == scope_id
    }
}

/// Diagnostic report when an intent claim is rejected due to active conflict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlackboardCollision {
    pub file_path: String,
    pub scope_id: String,
    pub conflicting_agent: String,
    pub conflicting_lease_id: String,
    pub remaining_ttl_seconds: u64,
}

/// Active intent blackboard scoped to a single parent Card worktree.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CardBlackboard {
    pub card_id: String,
    pub cell_id: String,
    pub active_leases: Vec<IntentLease>,
}

impl CardBlackboard {
    /// Creates a new empty blackboard for the given Card worktree context.
    pub fn new(cell_id: impl Into<String>, card_id: impl Into<String>) -> Self {
        Self {
            cell_id: cell_id.into(),
            card_id: card_id.into(),
            active_leases: Vec::new(),
        }
    }

    /// Attempts to claim an intent lease on a specific file and semantic scope.
    ///
    /// # Errors
    /// Returns `Err(BlackboardCollision)` if another active lease on this scope exists.
    pub fn claim(
        &mut self,
        agent_uid: &str,
        file_path: &str,
        scope_id: &str,
        ttl_seconds: u64,
        now_ms: i64,
    ) -> Result<IntentLease, BlackboardCollision> {
        self.prune_expired(now_ms);

        if let Some(existing) = self
            .active_leases
            .iter()
            .find(|l| l.collides_with(file_path, scope_id, now_ms))
        {
            let expiry_ms = existing.acquired_at_ms + (existing.ttl_seconds as i64 * 1000);
            let remaining_ttl = ((expiry_ms - now_ms).max(0) / 1000) as u64;
            return Err(BlackboardCollision {
                file_path: file_path.to_string(),
                scope_id: scope_id.to_string(),
                conflicting_agent: existing.agent_uid.clone(),
                conflicting_lease_id: existing.lease_id.clone(),
                remaining_ttl_seconds: remaining_ttl,
            });
        }

        let lease_id = format!(
            "lease-{now_ms}-{}-{:x}",
            agent_uid,
            std::collections::hash_map::RandomState::new().hash_one(now_ms) & 0xffff
        );

        let lease = IntentLease {
            lease_id,
            agent_uid: agent_uid.to_string(),
            file_path: file_path.to_string(),
            scope_id: scope_id.to_string(),
            acquired_at_ms: now_ms,
            ttl_seconds,
        };

        self.active_leases.push(lease.clone());
        Ok(lease)
    }

    /// Checks if a file and scope are currently claimed by another agent without acquiring a lease.
    pub fn check_collision(
        &self,
        file_path: &str,
        scope_id: &str,
        now_ms: i64,
    ) -> Option<BlackboardCollision> {
        self.active_leases
            .iter()
            .find(|l| l.collides_with(file_path, scope_id, now_ms))
            .map(|existing| {
                let expiry_ms = existing.acquired_at_ms + (existing.ttl_seconds as i64 * 1000);
                let remaining_ttl = ((expiry_ms - now_ms).max(0) / 1000) as u64;
                BlackboardCollision {
                    file_path: file_path.to_string(),
                    scope_id: scope_id.to_string(),
                    conflicting_agent: existing.agent_uid.clone(),
                    conflicting_lease_id: existing.lease_id.clone(),
                    remaining_ttl_seconds: remaining_ttl,
                }
            })
    }

    /// Releases a previously acquired lease by its ID.
    pub fn release(&mut self, lease_id: &str) -> bool {
        let initial_len = self.active_leases.len();
        self.active_leases.retain(|l| l.lease_id != lease_id);
        self.active_leases.len() < initial_len
    }

    /// Releases all active leases registered by a given agent UID (e.g. upon merge).
    pub fn release_agent(&mut self, agent_uid: &str) -> usize {
        let initial_len = self.active_leases.len();
        self.active_leases.retain(|l| l.agent_uid != agent_uid);
        initial_len - self.active_leases.len()
    }

    /// Prunes expired leases, returning the count of cleared entries.
    pub fn prune_expired(&mut self, now_ms: i64) -> usize {
        let initial_len = self.active_leases.len();
        self.active_leases.retain(|l| !l.is_expired(now_ms));
        initial_len - self.active_leases.len()
    }
}
