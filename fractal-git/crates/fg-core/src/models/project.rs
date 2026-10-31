//! Module: fg-core — Controlled Project Lease & Hierarchical TTL Models
//! File Path: crates/fg-core/src/models/project.rs
//! Architecture Role: Domain entities representing controlled project leases, hierarchical
//!   master/sub TTL states, sub-authorization zones, and active lease cache snapshots.
//! Dependencies & Triggers: Consumed by Taxis CLI project commands, gate validation, and commit handlers.
//! Responsibilities: State transitions (Active -> Frozen -> Evicted), TTL expiry calculation,
//!   and path containment checks.
//! Exit Semantics & Design Rationale:
//!   - Zero-allocation state checks on immutable borrowed references.
//!   - Strict fail-closed semantics: expired TTL freezes commit privileges immediately.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::repo_path::path_matches_scope;
use crate::error::{FractalError, FractalResult};

/// Default master TTL duration for controlled project leases (7 days in seconds).
pub const DEFAULT_PROJECT_MASTER_TTL_SECONDS: u64 = 7 * 24 * 3600;

/// Default sub-lease TTL duration for Card/SubAgent worktrees (2 hours in seconds).
pub const DEFAULT_SUBAGENT_TTL_SECONDS: u64 = 2 * 3600;

/// Number of consecutive dormant cycles before an unrenewed frozen project is evicted.
pub const DEFAULT_EVICTION_DORMANT_CYCLE_THRESHOLD: u32 = 3;

/// Registration origin of a controlled project lease.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RegistrationOrigin {
    /// Explicitly registered via CLI interactive command.
    CommandInteractive,
    /// Automatically discovered and registered via project marker file sniffing.
    AutoDiscovered,
}

/// Authorization and lifecycle status of a project lease.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LeaseStatus {
    /// Fully authorized: unrestricted staging, compilation, and commit operations.
    Active,
    /// Commit privileges frozen: TTL expired, strictly blocking all human and agent commits.
    Frozen,
    /// Evicted: pruned from active in-memory cache, cold-deregistered without file loss.
    Evicted,
}

/// Fine-grained sub-authorization zone within a controlled project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubAuthorizationZone {
    /// Zone identifier (e.g. `core`, `tests`, `config`, `views`).
    pub zone_id: String,
    /// Glob path patterns included in this zone relative to project root.
    pub include_patterns: Vec<String>,
    /// Glob path patterns excluded from this zone.
    pub exclude_patterns: Vec<String>,
    /// Criticality tier (0=public, 1=controlled, 2=immutable architecture).
    pub critical_tier: u8,
}

impl SubAuthorizationZone {
    /// Constructs a new sub-authorization zone with inclusion and exclusion rules.
    pub fn new(
        zone_id: impl Into<String>,
        include_patterns: Vec<String>,
        exclude_patterns: Vec<String>,
        critical_tier: u8,
    ) -> Self {
        Self {
            zone_id: zone_id.into(),
            include_patterns,
            exclude_patterns,
            critical_tier,
        }
    }

    /// Checks if a relative path within the project root matches this sub-zone.
    pub fn matches_path(&self, rel_path: &str) -> bool {
        let normalized_path = rel_path.replace('\\', "/");
        let excluded = self
            .exclude_patterns
            .iter()
            .any(|pattern| glob_match(pattern, &normalized_path));
        if excluded {
            return false;
        }

        self.include_patterns
            .iter()
            .any(|pattern| glob_match(pattern, &normalized_path))
    }
}

/// Controlled project lease maintaining active authorization and hierarchical TTL state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectLease {
    /// Unique project identifier (e.g. `workspace-timing`, `fractal-git`, `cell-game-ai`).
    pub id: String,
    /// Normalized project root directory relative to repository workspace root.
    pub root_path: String,
    /// Exclusively owned path jail prefixes (e.g. `["workspace-timing/**"]`).
    pub path_jails: Vec<String>,
    /// Hierarchical sub-authorization zones.
    pub sub_zones: Vec<SubAuthorizationZone>,
    /// Registration origin (command or discovery).
    pub origin: RegistrationOrigin,
    /// Epoch timestamp in seconds when the lease was created.
    pub registered_at: u64,
    /// Epoch timestamp in seconds of the most recent activity / renewal.
    pub last_activity_at: u64,
    /// Master TTL duration in seconds.
    pub master_ttl_seconds: u64,
    /// Number of valid commits produced under this lease during the active cycle.
    pub commit_counter: u64,
    /// Count of consecutive check windows spent in frozen state without renewal.
    pub dormant_cycles: u32,
    /// Current authorization and lifecycle status.
    pub status: LeaseStatus,
}

impl ProjectLease {
    /// Creates a newly active project lease with default sub-zones.
    pub fn new(
        id: impl Into<String>,
        root_path: impl Into<String>,
        master_ttl_seconds: u64,
        origin: RegistrationOrigin,
        now_secs: u64,
    ) -> Self {
        let id_str = id.into();
        let root_str = root_path.into();
        let jail_pattern = if root_str == "." || root_str.is_empty() {
            "**".to_string()
        } else {
            format!("{}/**", root_str.trim_matches(['/', '\\']))
        };

        Self {
            id: id_str,
            root_path: root_str,
            path_jails: vec![jail_pattern],
            sub_zones: Vec::new(),
            origin,
            registered_at: now_secs,
            last_activity_at: now_secs,
            master_ttl_seconds,
            commit_counter: 0,
            dormant_cycles: 0,
            status: LeaseStatus::Active,
        }
    }

    /// Evaluates whether the master TTL lease has elapsed relative to `now_secs`.
    pub fn is_expired(&self, now_secs: u64) -> bool {
        let expiry_point = self
            .last_activity_at
            .saturating_add(self.master_ttl_seconds);
        now_secs > expiry_point
    }

    /// Computes remaining TTL seconds until expiration, or 0 if expired.
    pub fn remaining_ttl_seconds(&self, now_secs: u64) -> u64 {
        let expiry_point = self
            .last_activity_at
            .saturating_add(self.master_ttl_seconds);
        expiry_point.saturating_sub(now_secs)
    }

    /// Refreshes lease activity upon high-frequency commits or heartbeats, resetting dormant counter.
    pub fn touch(&mut self, now_secs: u64) {
        self.last_activity_at = now_secs;
        self.commit_counter = self.commit_counter.saturating_add(1);
        self.dormant_cycles = 0;
        self.status = LeaseStatus::Active;
    }

    /// Explicitly renews an active or frozen lease, extending master TTL.
    pub fn renew(&mut self, now_secs: u64, new_ttl_seconds: Option<u64>) {
        self.last_activity_at = now_secs;
        if let Some(custom_ttl) = new_ttl_seconds {
            self.master_ttl_seconds = custom_ttl;
        }
        self.dormant_cycles = 0;
        self.status = LeaseStatus::Active;
    }

    /// Freezes commit authorization when master TTL elapses.
    pub fn freeze(&mut self) {
        self.status = LeaseStatus::Frozen;
    }

    /// Evicts the project lease from active status.
    pub fn evict(&mut self) {
        self.status = LeaseStatus::Evicted;
    }

    /// Checks if a given relative workspace file path falls within this project's path jails.
    pub fn contains_path(&self, rel_path: &str) -> bool {
        if self.root_path != "."
            && !self.root_path.is_empty()
            && path_matches_scope(rel_path, &self.root_path)
        {
            return true;
        }

        let normalized_path = rel_path.replace('\\', "/");
        self.path_jails
            .iter()
            .any(|pattern| glob_match(pattern, &normalized_path))
    }
}

/// Fractal sub-lease attached to a Card or SubAgent worktree, derived from a project master lease.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FractalSubLease {
    /// Unique sub-lease identifier.
    pub sub_lease_id: String,
    /// Associated parent project identifier.
    pub project_id: String,
    /// Autonomous Agent UID executing within this worktree.
    pub agent_uid: String,
    /// Parent Card identifier.
    pub card_id: String,
    /// Bound sub-authorization zone if scoped.
    pub sub_zone_id: Option<String>,
    /// Acquisition epoch timestamp in seconds.
    pub acquired_at: u64,
    /// Sub-lease TTL duration in seconds, strictly bounded by remaining master TTL.
    pub sub_ttl_seconds: u64,
}

impl FractalSubLease {
    /// Derives a new fractal sub-lease ensuring its duration does not exceed the master lease.
    pub fn derive(
        parent_project: &ProjectLease,
        agent_uid: impl Into<String>,
        card_id: impl Into<String>,
        sub_zone_id: Option<String>,
        requested_ttl_seconds: u64,
        now_secs: u64,
    ) -> FractalResult<Self> {
        if parent_project.status == LeaseStatus::Frozen || parent_project.is_expired(now_secs) {
            return Err(FractalError::CommitLockedTtlExpired {
                project_id: parent_project.id.clone(),
                reason: "Cannot derive sub-lease: parent project lease is frozen".to_string(),
            });
        }

        let remaining_master = parent_project.remaining_ttl_seconds(now_secs);
        let bounded_sub_ttl = requested_ttl_seconds.min(remaining_master);

        let agent_str = agent_uid.into();
        let card_str = card_id.into();
        let sub_id = format!("sublease-{}-{}-{}", parent_project.id, card_str, agent_str);

        Ok(Self {
            sub_lease_id: sub_id,
            project_id: parent_project.id.clone(),
            agent_uid: agent_str,
            card_id: card_str,
            sub_zone_id,
            acquired_at: now_secs,
            sub_ttl_seconds: bounded_sub_ttl,
        })
    }

    /// Evaluates if the fractal sub-lease has expired or if the master lease has lapsed.
    pub fn is_expired(&self, now_secs: u64, master_project: &ProjectLease) -> bool {
        if master_project.status == LeaseStatus::Frozen || master_project.is_expired(now_secs) {
            return true;
        }

        let sub_expiry = self.acquired_at.saturating_add(self.sub_ttl_seconds);
        now_secs > sub_expiry
    }
}

/// In-memory cache holding all active controlled project leases and their status.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectLeaseCache {
    /// Map of project identifier to active ProjectLease.
    pub leases: HashMap<String, ProjectLease>,
}

impl ProjectLeaseCache {
    /// Creates an empty lease cache.
    pub fn new() -> Self {
        Self {
            leases: HashMap::new(),
        }
    }

    /// Registers a new or updated project lease.
    pub fn register(&mut self, lease: ProjectLease) {
        self.leases.insert(lease.id.clone(), lease);
    }

    /// Retrieves an immutable reference to a lease by project id.
    pub fn get(&self, id: &str) -> Option<&ProjectLease> {
        self.leases.get(id)
    }

    /// Retrieves a mutable reference to a lease by project id.
    pub fn get_mut(&mut self, id: &str) -> Option<&mut ProjectLease> {
        self.leases.get_mut(id)
    }

    /// Finds a registered project whose path jail owns the specified relative file path.
    pub fn find_by_path(&self, rel_path: &str) -> Option<&ProjectLease> {
        let specific_match = self
            .leases
            .values()
            .filter(|lease| lease.root_path != "." && !lease.root_path.is_empty())
            .find(|lease| lease.contains_path(rel_path));

        if specific_match.is_some() {
            return specific_match;
        }

        self.leases
            .values()
            .filter(|lease| lease.root_path == "." || lease.root_path.is_empty())
            .find(|lease| lease.contains_path(rel_path))
    }

    /// Touches a project lease upon valid commit activity.
    pub fn touch(&mut self, id: &str, now_secs: u64) -> FractalResult<()> {
        match self.leases.get_mut(id) {
            Some(lease) => {
                lease.touch(now_secs);
                Ok(())
            }
            None => Err(FractalError::LeaseExpired(format!(
                "project '{id}' is not registered in active lease cache"
            ))),
        }
    }

    /// Renews and unfreezes a project lease.
    pub fn renew(
        &mut self,
        id: &str,
        now_secs: u64,
        ttl_seconds: Option<u64>,
    ) -> FractalResult<()> {
        match self.leases.get_mut(id) {
            Some(lease) => {
                lease.renew(now_secs, ttl_seconds);
                Ok(())
            }
            None => Err(FractalError::LeaseExpired(format!(
                "project '{id}' is not registered in active lease cache"
            ))),
        }
    }

    /// Sweeps active projects, transitioning expired projects to Frozen and dormant projects to Evicted.
    pub fn sweep_and_evict(
        &mut self,
        now_secs: u64,
        eviction_dormant_threshold: u32,
    ) -> Vec<String> {
        let mut evicted_ids = Vec::new();

        for lease in self.leases.values_mut() {
            if !lease.is_expired(now_secs) {
                continue;
            }
            match lease.status {
                LeaseStatus::Active => {
                    lease.freeze();
                    lease.dormant_cycles = 1;
                }
                LeaseStatus::Frozen => {
                    lease.dormant_cycles = lease.dormant_cycles.saturating_add(1);
                    if lease.dormant_cycles >= eviction_dormant_threshold {
                        lease.evict();
                        evicted_ids.push(lease.id.clone());
                    }
                }
                LeaseStatus::Evicted => {}
            }
        }

        self.leases
            .retain(|_, lease| lease.status != LeaseStatus::Evicted);
        evicted_ids
    }
}

/// Helper function performing simple glob matching supporting leading/trailing wildcards.
fn glob_match(pattern: &str, target_path: &str) -> bool {
    if pattern == "**" || pattern == "*" {
        return true;
    }

    if let Some(prefix) = pattern.strip_suffix("/**") {
        return path_matches_scope(target_path, prefix);
    }

    if let Some(suffix) = pattern.strip_prefix("*.") {
        return target_path
            .rsplit_once('.')
            .is_some_and(|(_, ext)| ext == suffix);
    }

    pattern == target_path
}
