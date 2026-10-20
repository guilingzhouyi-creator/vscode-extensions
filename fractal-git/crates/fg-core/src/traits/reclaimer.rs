//! Module: fg-core — Worktree Reclaimer Trait
//! File Path: crates/fg-core/src/traits/reclaimer.rs
//! Architecture Role: Abstract contract for physical and virtual workspace reclamation.

use crate::error::FractalResult;

/// Reclamation result audit summary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReclamationAudit {
    pub workspace_id: String,
    pub target_ref: String,
    pub bytes_freed: u64,
    pub duration_ms: i64,
}

/// Abstract interface for workspace reclamation engines.
pub trait WorktreeReclaimer: Send + Sync {
    /// Reclaims physical or virtual resources allocated to target workspace.
    fn reclaim_workspace(
        &self,
        workspace_id: &str,
        target_ref: &str,
    ) -> FractalResult<ReclamationAudit>;
}
