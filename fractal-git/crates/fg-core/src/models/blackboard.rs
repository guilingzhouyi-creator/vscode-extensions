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
    /// Optional fine-grained AST symbol name (e.g. `assert_push_authorized` or `MyStruct`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol_name: Option<String>,
    /// Optional fine-grained AST symbol kind (e.g. `Function`, `Struct`, `Impl`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol_kind: Option<String>,
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
        self.collides_with_symbol(file_path, scope_id, None, now_ms)
    }

    /// Checks if this lease collides with a requested file, scope, and optional AST symbol.
    pub fn collides_with_symbol(
        &self,
        file_path: &str,
        scope_id: &str,
        symbol_name: Option<&str>,
        now_ms: i64,
    ) -> bool {
        if self.is_expired(now_ms) {
            return false;
        }
        if self.file_path != file_path {
            return false;
        }
        // If either lease is a whole-file claim ("*"), they collide
        if self.scope_id == "*" || scope_id == "*" {
            return true;
        }
        // If both specify a symbol_name, they collide only if symbol names match
        if let (Some(s1), Some(s2)) = (&self.symbol_name, symbol_name) {
            return s1 == s2;
        }
        // Fall back to scope_id matching
        self.scope_id == scope_id
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

/// Request payload for a fine-grained intent lease claim, including the optional AST symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SymbolClaim<'a> {
    /// Identifier of the SubAgent requesting the lease.
    pub agent_uid: &'a str,
    /// Relative file path claimed.
    pub file_path: &'a str,
    /// Semantic scope identifier, or `*` for a whole-file claim.
    pub scope_id: &'a str,
    /// Optional fine-grained AST symbol name.
    pub symbol_name: Option<&'a str>,
    /// Optional fine-grained AST symbol kind.
    pub symbol_kind: Option<&'a str>,
    /// Lease duration in seconds before automatic expiration.
    pub ttl_seconds: u64,
    /// Current time in Unix milliseconds.
    pub now_ms: i64,
}

impl<'a> SymbolClaim<'a> {
    /// Creates a whole-scope claim that carries no AST symbol binding.
    pub fn new(
        agent_uid: &'a str,
        file_path: &'a str,
        scope_id: &'a str,
        ttl_seconds: u64,
        now_ms: i64,
    ) -> Self {
        Self {
            agent_uid,
            file_path,
            scope_id,
            symbol_name: None,
            symbol_kind: None,
            ttl_seconds,
            now_ms,
        }
    }

    /// Binds the claim to one AST symbol, optionally with its kind.
    pub fn with_symbol(mut self, symbol_name: &'a str, symbol_kind: Option<&'a str>) -> Self {
        self.symbol_name = Some(symbol_name);
        self.symbol_kind = symbol_kind;
        self
    }
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
    pub fn claim(
        &mut self,
        agent_uid: &str,
        file_path: &str,
        scope_id: &str,
        ttl_seconds: u64,
        now_ms: i64,
    ) -> Result<IntentLease, BlackboardCollision> {
        self.claim_symbol(SymbolClaim::new(
            agent_uid,
            file_path,
            scope_id,
            ttl_seconds,
            now_ms,
        ))
    }

    /// Attempts to claim a fine-grained intent lease on a specific file, semantic scope, and optional AST symbol.
    pub fn claim_symbol(
        &mut self,
        claim: SymbolClaim<'_>,
    ) -> Result<IntentLease, BlackboardCollision> {
        let now_ms = claim.now_ms;
        self.prune_expired(now_ms);

        if let Some(existing) = self.active_leases.iter().find(|lease| {
            lease.collides_with_symbol(claim.file_path, claim.scope_id, claim.symbol_name, now_ms)
        }) {
            let expiry_ms = existing.acquired_at_ms + (existing.ttl_seconds as i64 * 1000);
            let remaining_ttl = ((expiry_ms - now_ms).max(0) / 1000) as u64;
            return Err(BlackboardCollision {
                file_path: claim.file_path.to_string(),
                scope_id: claim.scope_id.to_string(),
                conflicting_agent: existing.agent_uid.clone(),
                conflicting_lease_id: existing.lease_id.clone(),
                remaining_ttl_seconds: remaining_ttl,
            });
        }

        let lease_id = format!(
            "lease-{now_ms}-{}-{:x}",
            claim.agent_uid,
            std::collections::hash_map::RandomState::new().hash_one(now_ms) & 0xffff
        );

        let lease = IntentLease {
            lease_id,
            agent_uid: claim.agent_uid.to_string(),
            file_path: claim.file_path.to_string(),
            scope_id: claim.scope_id.to_string(),
            symbol_name: claim.symbol_name.map(|symbol| symbol.to_string()),
            symbol_kind: claim.symbol_kind.map(|kind| kind.to_string()),
            acquired_at_ms: now_ms,
            ttl_seconds: claim.ttl_seconds,
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
        self.check_collision_symbol(file_path, scope_id, None, now_ms)
    }

    /// Checks if a file, scope, and optional AST symbol are currently claimed by another agent.
    pub fn check_collision_symbol(
        &self,
        file_path: &str,
        scope_id: &str,
        symbol_name: Option<&str>,
        now_ms: i64,
    ) -> Option<BlackboardCollision> {
        self.active_leases
            .iter()
            .find(|l| l.collides_with_symbol(file_path, scope_id, symbol_name, now_ms))
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
