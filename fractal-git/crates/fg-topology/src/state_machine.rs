//! Module: fg-topology — Workspace Lifecycle State Machine
//! File Path: crates/fg-topology/src/state_machine.rs
//! Architecture Role: Manages strict deterministic lifecycle state transitions for
//!   fractal worktrees (`Spawned -> InPreReview -> GateApproved -> Materialized -> Reclaimed`).

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use serde::{Deserialize, Serialize};

use crate::refs::FractalRef;

/// Deterministic state of a fractal workspace node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorktreeState {
    /// Workspace spawned from baseline.
    Spawned,
    /// Actively under review in Pre-Review zone.
    InPreReview,
    /// Automated and role gates passed.
    GateApproved,
    /// Git commit materialized and ref updated.
    Materialized,
    /// Physical working tree unmounted and reclaimed.
    Reclaimed,
}

/// A tracked fractal workspace instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FractalWorkspaceNode {
    pub workspace_id: String,
    pub fractal_ref: String,
    pub parent_ref: String,
    pub state: WorktreeState,
    pub baseline_commit_oid: Oid,
    pub head_commit_oid: Option<Oid>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

impl FractalWorkspaceNode {
    /// Spawns a new workspace node in `Spawned` state.
    pub fn new(
        workspace_id: impl Into<String>,
        fractal_ref: &FractalRef,
        parent_ref: &FractalRef,
        baseline_commit_oid: Oid,
    ) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            workspace_id: workspace_id.into(),
            fractal_ref: fractal_ref.to_git_ref(),
            parent_ref: parent_ref.to_git_ref(),
            state: WorktreeState::Spawned,
            baseline_commit_oid,
            head_commit_oid: None,
            created_at_ms: now,
            updated_at_ms: now,
        }
    }

    /// Moves state to `InPreReview`.
    pub fn enter_pre_review(&mut self) -> FractalResult<()> {
        if self.state != WorktreeState::Spawned && self.state != WorktreeState::InPreReview {
            return Err(FractalError::IndexConflict(format!(
                "Cannot enter pre-review from state {:?}",
                self.state
            )));
        }
        self.state = WorktreeState::InPreReview;
        self.updated_at_ms = chrono::Utc::now().timestamp_millis();
        Ok(())
    }

    /// Moves state to `GateApproved` upon satisfying Auto and role gates.
    pub fn approve_gate(&mut self) -> FractalResult<()> {
        if self.state != WorktreeState::InPreReview {
            return Err(FractalError::IndexConflict(format!(
                "Cannot approve gate when workspace is in state {:?}",
                self.state
            )));
        }
        self.state = WorktreeState::GateApproved;
        self.updated_at_ms = chrono::Utc::now().timestamp_millis();
        Ok(())
    }

    /// Moves state to `Materialized` after committing to Git ODB.
    pub fn record_materialization(&mut self, commit_oid: Oid) -> FractalResult<()> {
        if self.state != WorktreeState::GateApproved {
            return Err(FractalError::IndexConflict(format!(
                "Cannot materialize commit when workspace is not GateApproved (current: {:?})",
                self.state
            )));
        }
        self.state = WorktreeState::Materialized;
        self.head_commit_oid = Some(commit_oid);
        self.updated_at_ms = chrono::Utc::now().timestamp_millis();
        Ok(())
    }

    /// Marks physical resources as reclaimed.
    pub fn mark_reclaimed(&mut self) -> FractalResult<()> {
        if self.state != WorktreeState::Materialized && self.state != WorktreeState::Spawned {
            return Err(FractalError::IndexConflict(format!(
                "Cannot reclaim unmaterialized workspace unless abandoned (current: {:?})",
                self.state
            )));
        }
        self.state = WorktreeState::Reclaimed;
        self.updated_at_ms = chrono::Utc::now().timestamp_millis();
        Ok(())
    }
}
