//! Module: fg-core — Human GUI UAC Elevation & Staged Promotion Models
//! File Path: crates/fg-core/src/models/uac.rs
//! Architecture Role: Strongly-typed models for human GUI UAC authorization,
//!   Auto quality scoring integration, 1-hour lease lifecycle, and score ratchet baselines.

use crate::models::Oid;
use serde::{Deserialize, Serialize};

/// Quality scoring envelope aligned with auto-refactor's 30 analyzers and CAI telemetry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoQualityScoreEnvelope {
    /// Composite quality score (0.0 .. 100.0).
    pub composite_score: f64,
    /// Pure objective in-house autonomy index (CAI: 0.0 .. 100.0).
    pub cai_index: f64,
    /// Cyclomatic complexity delta (negative indicates net reduction).
    pub cyclomatic_complexity_delta: i32,
    /// Net effective lines of code delta (ELOC).
    pub eloc_delta: i32,
    /// Jeffreys Beta (0.5, 0.5) posterior credible interval lower bound.
    pub credible_interval_lower: f64,
    /// Anti-gaming guardrail verdict (false if BLOCK_GAMING_DETECTED).
    pub anti_gaming_passed: bool,
    /// Qualitative summary report.
    pub summary_report: String,
}

impl Default for AutoQualityScoreEnvelope {
    fn default() -> Self {
        Self {
            composite_score: 0.0,
            cai_index: 0.0,
            cyclomatic_complexity_delta: 0,
            eloc_delta: 0,
            credible_interval_lower: 0.0,
            anti_gaming_passed: false,
            summary_report: "Uninitialized quality envelope: pending automated audit evaluation."
                .into(),
        }
    }
}

/// Lifecycle state machine for a staged promotion request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StagedPromotionStatus {
    /// Actively awaiting human physical click in GUI UAC modal (within 1-hour TTL).
    PendingHumanUac,
    /// Superseded by a higher-scoring candidate meeting the score ratchet baseline.
    SupersededByHigherScore {
        superseded_by_id: String,
        score_delta_pct: i64,
    },
    /// Expired after 1-hour lease timeout without human action.
    Expired { expired_at_ms: i64 },
    /// Approved by human physical click in GUI and atomically merged into System Trunk.
    ApprovedAndPromoted {
        promoted_at_ms: i64,
        human_operator: String,
    },
    /// Rejected by human in GUI with constructive feedback injected back to agent.
    RejectedByHuman {
        rejected_at_ms: i64,
        human_operator: String,
        feedback: String,
    },
}

/// Staged promotion entity awaiting human UAC approval.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StagedPromotionRequest {
    pub request_id: String,
    pub source_ref: String,
    pub target_ref: String,
    pub candidate_commit_oid: Oid,
    pub auto_score: AutoQualityScoreEnvelope,
    pub status: StagedPromotionStatus,
    pub challenge_nonce: [u8; 32],
    pub created_at_ms: i64,
    pub expires_at_ms: i64,
    pub summary: String,
    pub agent_uid: String,
}

impl StagedPromotionRequest {
    /// Checks if this staged promotion has expired given the current timestamp in milliseconds.
    pub fn is_expired(&self, current_time_ms: i64) -> bool {
        current_time_ms > self.expires_at_ms
    }

    /// Checks if this request is actively pending human UAC approval.
    pub fn is_active_pending(&self, current_time_ms: i64) -> bool {
        self.status == StagedPromotionStatus::PendingHumanUac && !self.is_expired(current_time_ms)
    }
}

/// Non-forgeable cryptographic UAC approval proof signed via GUI interface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HumanUacProof {
    pub request_id: String,
    pub signed_nonce: [u8; 32],
    pub operator_name: String,
    pub operator_email: String,
    pub gui_session_token: String,
    pub timestamp_ms: i64,
}
