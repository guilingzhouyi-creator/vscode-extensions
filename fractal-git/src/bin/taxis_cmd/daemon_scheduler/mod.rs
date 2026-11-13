//! Module: taxis_cmd::daemon_scheduler — Persistent Background Async Audit Scheduler
//! File Path: src/bin/taxis_cmd/daemon_scheduler/mod.rs
//! Architecture Role: Defines scheduler state/telemetry structures and exposes background
//!   audit orchestration, ref routing, and ODB report lookup APIs.
//! Dependencies & Triggers: Uses `fractal_git::audit_runner`, `fg_topology::AuditTreeMaterializer`,
//!   `fg_storage::WalJournal`, and `DaemonHotSession`.
//! Responsibilities: Export scheduler data models, worker handle, and cycle entry points cleanly.
//! Exit Semantics & Design Rationale: Separates state schema cleanly from worker execution loops.

mod cycle;
mod eloc_diff;
mod eloc_scan;
mod hydration;
mod loop_batch;
mod materialize;
mod metadata_read;
mod ref_queries;
mod scheduler_handle;
mod snapshot_clone;
mod wal_telemetry;

#[cfg(test)]
mod unit_tests;

use std::collections::BTreeMap;

use fg_algorithms::scoring::ProjectArchetype;
use fg_core::models::Oid;

pub use cycle::{execute_background_audit_cycle, execute_ref_audit_cycle};
pub(crate) use ref_queries::resolve_or_ephemeral_secret;
pub use ref_queries::{
    is_self_owned_audit_or_telemetry_ref, parse_archetype_flag, query_latest_audit_report,
    resolve_audit_target_ref,
};
pub use scheduler_handle::AsyncAuditScheduler;

pub(super) const SCHEDULER_QUEUE_BOUND: usize = 16;
pub(super) const AUDIT_WAL_FILENAME: &str = "audit-wal.bin";

/// Configuration governing debounce, idle heartbeat, and authority behavior of the scheduler.
#[derive(Debug, Clone)]
pub struct SchedulerConfig {
    /// Quiet period after a stage/commit trigger before executing the background review.
    pub quiet_ms: u64,
    /// Periodic idle heartbeat interval forcing fresh review when stale.
    pub heartbeat_ms: u64,
    /// Archetype tuning passed into 10D weight normalization.
    pub archetype: ProjectArchetype,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            quiet_ms: 400,
            heartbeat_ms: 60_000,
            archetype: ProjectArchetype::Library,
        }
    }
}

/// Snapshot trigger pushed onto the scheduler queue by IPC mutations or manual requests.
#[derive(Debug, Clone)]
pub struct AuditTrigger {
    /// Candidate reference being modified (`refs/heads/main`, cell card ref, etc.).
    pub target_ref: Option<String>,
    /// True when triggered explicitly via `ScheduleAudit { force: true }`.
    pub force: bool,
}

/// Previously audited snapshot baseline cached per audit ref for deduplication & delta anti-gaming.
#[derive(Debug, Clone)]
pub struct AuditedSnapshotBaseline {
    /// Audited tree OID of the candidate repository snapshot.
    pub tree_oid: Oid,
    /// Last 10D composite score recorded on this audit ref.
    pub composite_score: f64,
    /// Last SQALE debt total in minutes recorded on this audit ref.
    pub sqale_minutes: f64,
    /// Ordered repository file-path -> blob OID mapping from the audited tree.
    pub blobs: BTreeMap<String, Oid>,
}

/// Shared runtime telemetry updated atomically/cleanly by the background worker.
#[derive(Debug, Clone, Default)]
pub struct SchedulerTelemetry {
    /// Last completed review ID (`rev-...`).
    pub last_review_id: Option<String>,
    /// Tree OID evaluated during the last completed review.
    pub last_tree_oid: Option<String>,
    /// Commit OID written onto the dedicated Fractal Audit Tree ref.
    pub last_audit_commit_oid: Option<String>,
    /// Target audit ref updated by the last review.
    pub last_audit_ref: Option<String>,
    /// Composite 10D score from the last completed review.
    pub last_composite_score: Option<f64>,
    /// Receipt decision string (`"approved"`, `"blocked"`, `"needs-review"`).
    pub last_decision: Option<String>,
    /// Last sealed canonical evidence digest hex for chaining.
    pub last_evidence_digest: Option<String>,
    /// Recent composite scores (oldest -> newest) fed to ADR-Q temporal metrics.
    pub score_history: Vec<f64>,
    /// Per-audit-ref last audited snapshot baselines for idle dedup and delta anti-gaming.
    pub audited_baselines: BTreeMap<String, AuditedSnapshotBaseline>,
}
