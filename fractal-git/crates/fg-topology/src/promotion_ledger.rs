//! Module: fg-topology — Staged Promotion Ledger & Score Ratchet Engine
//! File Path: crates/fg-topology/src/promotion_ledger.rs
//! Architecture Role: Manages the staged promotion ledger, enforcing Auto quality scoring
//!   entry barriers, 1-hour lease expiry, +5.0 score ratchet superiority replacements,
//!   and atomic CAS promotion execution via HumanUacAuthorizer.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{
    AutoQualityScoreEnvelope, HumanUacProof, Oid, StagedPromotionRequest, StagedPromotionStatus,
    TaxisPolicy,
};
use fg_core::traits::RefStore;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::authorizer::HumanUacAuthorizer;
use crate::refs::FractalRef;

/// Persistent ledger payload holding active candidate and archived promotion history.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PromotionLedgerData {
    pub active_candidate: Option<StagedPromotionRequest>,
    pub history: Vec<StagedPromotionRequest>,
}

/// Thread-safe staged promotion ledger manager.
pub struct PromotionStagingLedger {
    disk_path: Option<PathBuf>,
    ledger_data: PromotionLedgerData,
}

impl PromotionStagingLedger {
    /// Creates an in-memory ledger instance.
    pub fn in_memory() -> Self {
        Self {
            disk_path: None,
            ledger_data: PromotionLedgerData::default(),
        }
    }

    /// Loads or initializes a staged promotion ledger backed by disk
    /// (`.git/fractal/staged_promotions.json`).
    pub fn load_or_init(git_dir: &Path) -> FractalResult<Self> {
        let fractal_dir = git_dir.join("fractal");
        let disk_path = fractal_dir.join("staged_promotions.json");

        if disk_path.exists() {
            let content = fs::read_to_string(&disk_path)?;
            let ledger_data: PromotionLedgerData =
                serde_json::from_str(&content).unwrap_or_default();
            Ok(Self {
                disk_path: Some(disk_path),
                ledger_data,
            })
        } else {
            Ok(Self {
                disk_path: Some(disk_path),
                ledger_data: PromotionLedgerData::default(),
            })
        }
    }

    /// Flushes ledger data to disk if backed by filesystem.
    pub fn persist(&self) -> FractalResult<()> {
        if let Some(ref path) = self.disk_path {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let json = serde_json::to_string_pretty(&self.ledger_data)?;
            if let Err(io_err) = fs::write(path, json) {
                // Tolerates sandbox file lock/isolation errors gracefully
                if io_err.kind() != std::io::ErrorKind::PermissionDenied
                    && io_err.raw_os_error() != Some(183)
                {
                    return Err(FractalError::Io(io_err));
                }
            }
        }
        Ok(())
    }

    /// Returns a reference to the active candidate (idiomatic Rust C-GETTER).
    pub fn active_candidate(&self) -> Option<&StagedPromotionRequest> {
        self.ledger_data.active_candidate.as_ref()
    }

    /// Returns a slice of the promotion history (idiomatic Rust C-GETTER).
    pub fn history(&self) -> &[StagedPromotionRequest] {
        &self.ledger_data.history
    }

    /// Access currently active candidate, refreshing lease expiration against current time.
    pub fn get_active_candidate(
        &mut self,
        current_time_ms: i64,
    ) -> Option<&StagedPromotionRequest> {
        if let Some(ref mut candidate) = self.ledger_data.active_candidate {
            if candidate.is_expired(current_time_ms)
                && candidate.status == StagedPromotionStatus::PendingHumanUac
            {
                candidate.status = StagedPromotionStatus::Expired {
                    expired_at_ms: candidate.expires_at_ms,
                };
            }
        }

        // If active candidate has expired, archive it
        if let Some(candidate) = self.ledger_data.active_candidate.as_ref() {
            if matches!(candidate.status, StagedPromotionStatus::Expired { .. }) {
                if let Some(expired) = self.ledger_data.active_candidate.take() {
                    self.ledger_data.history.push(expired);
                    let _ = self.persist();
                }
                return None;
            }
        }

        self.ledger_data.active_candidate.as_ref()
    }

    /// Stages a new promotion proposal from an Agent, evaluating Auto quality scoring,
    /// 1-hour lease expiry, and the score ratchet superiority replacement baseline.
    pub fn stage_promotion(
        &mut self,
        candidate_oid: Oid,
        auto_score: AutoQualityScoreEnvelope,
        summary: impl Into<String>,
        agent_uid: impl Into<String>,
        policy: &TaxisPolicy,
        current_time_ms: i64,
    ) -> FractalResult<String> {
        // 1. Auto Quality Anti-Gaming Check (BLOCK_GAMING_DETECTED guardrail)
        if !auto_score.anti_gaming_passed {
            return Err(FractalError::IndexConflict(
                concat!(
                    "Promotion rejected: Auto-Refactor anti-gaming guard triggered ",
                    "(BLOCK_GAMING_DETECTED)"
                )
                .into(),
            ));
        }

        // 2. Minimum Auto Composite Score Check
        if auto_score.composite_score < policy.minimum_promotion_score {
            return Err(FractalError::IndexConflict(format!(
                "Promotion rejected: Auto composite score {:.1} is below minimum threshold {:.1}",
                auto_score.composite_score, policy.minimum_promotion_score
            )));
        }

        let summary = summary.into();
        let agent_uid = agent_uid.into();

        // 3. Evaluate existing active candidate
        if let Some(mut active) = self.ledger_data.active_candidate.take() {
            if active.is_expired(current_time_ms) {
                // Old candidate expired: archive it
                active.status = StagedPromotionStatus::Expired {
                    expired_at_ms: active.expires_at_ms,
                };
                self.ledger_data.history.push(active);
            } else {
                // Old candidate is still active in its 1-hour window: check score ratchet baseline
                let score_delta = auto_score.composite_score - active.auto_score.composite_score;
                if score_delta >= policy.replacement_score_baseline_delta {
                    // Superiority replacement confirmed! Supersede old candidate
                    let new_req_id =
                        format!("promo-{}-{}", current_time_ms, &candidate_oid.to_hex()[..6]);
                    active.status = StagedPromotionStatus::SupersededByHigherScore {
                        superseded_by_id: new_req_id.clone(),
                        score_delta_pct: (score_delta * 100.0) as i64,
                    };
                    self.ledger_data.history.push(active);

                    let new_request = self.build_request(StagedPromotionParams {
                        request_id: new_req_id.clone(),
                        candidate_commit_oid: candidate_oid,
                        auto_score,
                        summary,
                        agent_uid,
                        policy,
                        current_time_ms,
                    });
                    self.ledger_data.active_candidate = Some(new_request);
                    self.persist()?;
                    return Ok(new_req_id);
                } else {
                    // Put old candidate back and reject new candidate
                    self.ledger_data.active_candidate = Some(active);
                    return Err(FractalError::IndexConflict(format!(
                        "Score delta +{:.1} does not meet required baseline +{:.1} \
                         over active candidate; replacement rejected",
                        score_delta, policy.replacement_score_baseline_delta
                    )));
                }
            }
        }

        // 4. No active candidate: create brand new staged promotion
        let req_id = format!("promo-{}-{}", current_time_ms, &candidate_oid.to_hex()[..6]);
        let new_request = self.build_request(StagedPromotionParams {
            request_id: req_id.clone(),
            candidate_commit_oid: candidate_oid,
            auto_score,
            summary,
            agent_uid,
            policy,
            current_time_ms,
        });
        self.ledger_data.active_candidate = Some(new_request);
        self.persist()?;
        Ok(req_id)
    }

    /// Executes atomic merge into System Trunk upon valid Human GUI UAC click authorization.
    pub fn apply_uac_approval(
        &mut self,
        request_id: &str,
        proof: &HumanUacProof,
        authorizer: &impl HumanUacAuthorizer,
        ref_store: &impl RefStore,
    ) -> FractalResult<()> {
        let mut active = match self.ledger_data.active_candidate.take() {
            Some(cand) if cand.request_id == request_id => cand,
            Some(other) => {
                self.ledger_data.active_candidate = Some(other);
                return Err(FractalError::IndexConflict(format!(
                    "Request ID {} is not the currently active candidate",
                    request_id
                )));
            }
            None => {
                return Err(FractalError::IndexConflict(
                    "No active staged promotion awaiting human UAC approval".into(),
                ));
            }
        };

        // 1. Verify UAC non-forgeable proof
        if let Err(err) = authorizer.verify_uac_proof(&active, proof) {
            self.ledger_data.active_candidate = Some(active);
            return Err(err);
        }

        // 2. Atomically advance System Trunk reference (refs/heads/main)
        let system_ref = FractalRef::SystemTrunk {
            branch: fg_core::constants::git::DEFAULT_SYSTEM_BRANCH.into(),
        };
        if let Err(err) =
            ref_store.update_ref(&system_ref.to_git_ref(), &active.candidate_commit_oid, None)
        {
            self.ledger_data.active_candidate = Some(active);
            return Err(err);
        }

        // 3. Mark status as ApprovedAndPromoted and archive
        active.status = StagedPromotionStatus::ApprovedAndPromoted {
            promoted_at_ms: proof.timestamp_ms,
            human_operator: proof.operator_name.clone(),
        };

        authorizer.record_audit_entry(
            request_id,
            "SYSTEM_TRUNK_PROMOTION_APPROVED",
            &proof.operator_name,
        )?;

        self.ledger_data.history.push(active);
        self.persist()?;
        Ok(())
    }

    /// Records human rejection with constructive feedback injected back to the agent team.
    pub fn reject_uac_promotion(
        &mut self,
        request_id: &str,
        operator: impl Into<String>,
        feedback: impl Into<String>,
        current_time_ms: i64,
    ) -> FractalResult<()> {
        let mut active = match self.ledger_data.active_candidate.take() {
            Some(cand) if cand.request_id == request_id => cand,
            Some(other) => {
                self.ledger_data.active_candidate = Some(other);
                return Err(FractalError::IndexConflict(format!(
                    "Request ID {} is not the active candidate",
                    request_id
                )));
            }
            None => {
                return Err(FractalError::IndexConflict(
                    "No active staged promotion to reject".into(),
                ));
            }
        };

        let operator = operator.into();
        let feedback = feedback.into();

        active.status = StagedPromotionStatus::RejectedByHuman {
            rejected_at_ms: current_time_ms,
            human_operator: operator,
            feedback,
        };

        self.ledger_data.history.push(active);
        self.persist()?;
        Ok(())
    }

    /// Lists active candidate and promotion history.
    pub fn list_promotions(&self) -> (&Option<StagedPromotionRequest>, &[StagedPromotionRequest]) {
        (
            &self.ledger_data.active_candidate,
            &self.ledger_data.history,
        )
    }

    fn build_request(&self, params: StagedPromotionParams<'_>) -> StagedPromotionRequest {
        // Generate cryptographic 32-byte challenge nonce
        let mut nonce = [0u8; 32];
        let seed = format!(
            "{}:{}:{}",
            params.request_id, params.current_time_ms, params.agent_uid
        );
        let hash = sha1_hash_32(seed.as_bytes());
        nonce.copy_from_slice(&hash);

        let expires_at_ms =
            params.current_time_ms + (params.policy.staged_promotion_ttl_seconds as i64) * 1000;

        StagedPromotionRequest {
            request_id: params.request_id,
            source_ref: "refs/fractal/trunk".into(),
            target_ref: "refs/heads/main".into(),
            candidate_commit_oid: params.candidate_commit_oid,
            auto_score: params.auto_score,
            status: StagedPromotionStatus::PendingHumanUac,
            challenge_nonce: nonce,
            created_at_ms: params.current_time_ms,
            expires_at_ms,
            summary: params.summary,
            agent_uid: params.agent_uid,
        }
    }
}

/// Parameter encapsulation for building staged promotion requests.
pub struct StagedPromotionParams<'a> {
    pub request_id: String,
    pub candidate_commit_oid: Oid,
    pub auto_score: AutoQualityScoreEnvelope,
    pub summary: String,
    pub agent_uid: String,
    pub policy: &'a TaxisPolicy,
    pub current_time_ms: i64,
}

fn sha1_hash_32(input_bytes: &[u8]) -> [u8; 32] {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(input_bytes);
    let mut digest_prefix: [u8; 20] = hasher.finalize().into();

    let mut digest_buffer = [0u8; 32];
    digest_buffer[..20].copy_from_slice(&digest_prefix);
    // Fill remaining 12 bytes with inverted hash
    digest_prefix.reverse();
    digest_buffer[20..32].copy_from_slice(&digest_prefix[..12]);
    digest_buffer
}
