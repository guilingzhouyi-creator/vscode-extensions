//! Module: fg-topology — Staged Promotion Ledger & Score Ratchet Engine
//! File Path: crates/fg-topology/src/promotion_ledger.rs
//! Architecture Role: Manages the staged promotion ledger, enforcing Auto quality scoring
//!   entry barriers, lease expiry, score ratchet superiority replacements, and atomic CAS
//!   promotion execution via [`HumanUacAuthorizer`].
//! Dependencies & Triggers: Consumed by `taxis promotion` and the GUI elevation bridge.
//! Responsibilities: Stage, supersede, expire, approve, and reject promotion requests durably.
//! Exit Semantics & Design Rationale:
//!   - Durable state lives in the repository container's `PROM` section, not a JSON document.
//!     Scores are stored as IEEE-754 bit patterns so the ratchet compares the exact values it was
//!     given; a decimal rendering would let a value shift in the last digit and flip a comparison.
//!   - A malformed ledger is never replaced by an empty one. Doing so would discard the active
//!     candidate and its challenge nonce, letting a later approval act on a ledger the operator
//!     never saw.
//!   - Write failures propagate. Suppressing them would report a staged or promoted request that
//!     does not exist on disk, so durable state and reported state would diverge with no signal.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{
    AutoQualityScoreEnvelope, HumanUacProof, Oid, StagedPromotionRequest, StagedPromotionStatus,
    TaxisPolicy,
};
use fg_core::traits::RefStore;
use fg_native::document::RepoDocument;
use fg_native::sections::prom::{PromSection, PromotionRecord, PromotionStatus};
use std::path::{Path, PathBuf};

use crate::authorizer::HumanUacAuthorizer;
use crate::refs::FractalRef;

/// Persistent ledger payload holding the active candidate and archived promotion history.
#[derive(Debug, Clone, Default)]
pub struct PromotionLedgerData {
    /// Candidate currently holding the lease, if any.
    pub active_candidate: Option<StagedPromotionRequest>,
    /// Resolved requests in insertion order.
    pub history: Vec<StagedPromotionRequest>,
}

/// Staged promotion ledger manager.
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

    /// Loads or initializes a staged promotion ledger from the repository container.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when the container exists but cannot be decoded, and
    /// [`FractalError::Io`] for a filesystem failure other than absence.
    pub fn load_or_init(git_dir: &Path) -> FractalResult<Self> {
        let disk_path = fg_native::container_path(git_dir);
        if !disk_path.exists() {
            return Ok(Self {
                disk_path: Some(disk_path),
                ledger_data: PromotionLedgerData::default(),
            });
        }

        let document = RepoDocument::load(&disk_path).map_err(native_to_domain)?;
        let ledger_data = PromotionLedgerData {
            active_candidate: document.prom.active().map(to_request),
            history: document.prom.history().iter().map(to_request).collect(),
        };

        Ok(Self {
            disk_path: Some(disk_path),
            ledger_data,
        })
    }

    /// Flushes ledger data into the repository container.
    ///
    /// # Errors
    ///
    /// Propagates container-encoding and I/O failures.
    pub fn persist(&self) -> FractalResult<()> {
        let Some(ref path) = self.disk_path else {
            return Ok(());
        };

        let mut document = RepoDocument::load(path).map_err(native_to_domain)?;
        document.prom = self.to_prom_section()?;
        document.save_atomic(path).map_err(native_to_domain)
    }

    /// Projects the in-memory ledger onto the container's `PROM` section.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when a record cannot be encoded.
    pub fn to_prom_section(&self) -> FractalResult<PromSection> {
        let mut section = PromSection::new();
        if let Some(candidate) = self.ledger_data.active_candidate.as_ref() {
            section.set_active(to_record(candidate)?);
        }
        for archived in &self.ledger_data.history {
            section
                .record_history(to_record(archived)?)
                .map_err(native_to_domain)?;
        }
        Ok(section)
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
    ///
    /// Expiry archiving mutates memory only. Persisting here would turn a read accessor into
    /// a fallible writer and would leave a half-applied ledger on I/O failure; the expired
    /// state is re-derived from `expires_at_ms` on every load, so disk never needs the fixup.
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
            return Err(FractalError::PolicyViolation(
                concat!(
                    "Promotion rejected: Auto-Refactor anti-gaming guard triggered ",
                    "(BLOCK_GAMING_DETECTED)"
                )
                .into(),
            ));
        }

        // 2. Minimum Auto Composite Score Check
        if auto_score.composite_score < policy.minimum_promotion_score {
            return Err(FractalError::PolicyViolation(format!(
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
                    })?;
                    self.ledger_data.active_candidate = Some(new_request);
                    self.persist()?;
                    return Ok(new_req_id);
                } else {
                    // Put old candidate back and reject new candidate
                    self.ledger_data.active_candidate = Some(active);
                    return Err(FractalError::PolicyViolation(format!(
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
        })?;
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
                return Err(FractalError::PolicyViolation(format!(
                    "Request ID {} is not the currently active candidate",
                    request_id
                )));
            }
            None => {
                return Err(FractalError::PolicyViolation(
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
                return Err(FractalError::PolicyViolation(format!(
                    "Request ID {} is not the active candidate",
                    request_id
                )));
            }
            None => {
                return Err(FractalError::PolicyViolation(
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

    fn build_request(
        &self,
        params: StagedPromotionParams<'_>,
    ) -> FractalResult<StagedPromotionRequest> {
        // Fill unpredictable 32-byte UAC challenge nonce from the OS CSPRNG
        let mut nonce = [0u8; 32];
        fg_native::fill_random_bytes(&mut nonce).map_err(native_to_domain)?;

        let expires_at_ms =
            params.current_time_ms + (params.policy.staged_promotion_ttl_seconds as i64) * 1000;

        Ok(StagedPromotionRequest {
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
        })
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

/// Translates a container-layer failure into the domain error type.
///
/// The topology crate keeps `fg-native`'s error type out of its public surface: a caller of
/// `persist` should not need to know that the durable form is a container.
fn native_to_domain(error: fg_native::NativeError) -> FractalError {
    FractalError::CorruptStore(format!("promotion ledger encoding rejected: {error}"))
}

/// Maps the domain status onto the container's closed discriminant set.
fn to_status(status: &StagedPromotionStatus) -> PromotionStatus {
    match status {
        StagedPromotionStatus::PendingHumanUac => PromotionStatus::Pending,
        StagedPromotionStatus::SupersededByHigherScore { .. } => PromotionStatus::Superseded,
        StagedPromotionStatus::Expired { .. } => PromotionStatus::Expired,
        StagedPromotionStatus::ApprovedAndPromoted { .. } => PromotionStatus::Approved,
        StagedPromotionStatus::RejectedByHuman { .. } => PromotionStatus::Rejected,
    }
}

/// Projects a domain request onto a container record.
///
/// The container's `PROM` section carries the scoring and lease fields that the ratchet compares;
/// the richer domain status payloads (operator name, feedback text) are not persisted here because
/// they belong to the audit log, not to the ratchet's inputs.
///
/// # Errors
///
/// Returns [`FractalError::CorruptStore`] when a score is non-finite, which the container refuses.
fn to_record(request: &StagedPromotionRequest) -> FractalResult<PromotionRecord> {
    if !request.auto_score.composite_score.is_finite()
        || !request.auto_score.cai_index.is_finite()
        || !request.auto_score.credible_interval_lower.is_finite()
    {
        return Err(FractalError::CorruptStore(format!(
            "promotion request '{}' carries a non-finite score",
            request.request_id
        )));
    }

    Ok(PromotionRecord {
        request_id: request.request_id.clone(),
        candidate_oid: request.candidate_commit_oid,
        source_ref: request.source_ref.clone(),
        target_ref: request.target_ref.clone(),
        composite_score: request.auto_score.composite_score,
        cai_index: request.auto_score.cai_index,
        credible_interval_lower: request.auto_score.credible_interval_lower,
        anti_gaming_passed: request.auto_score.anti_gaming_passed,
        status: to_status(&request.status),
        created_at_ms: request.created_at_ms,
        expires_at_ms: request.expires_at_ms,
        challenge_nonce: request.challenge_nonce,
        agent_uid: request.agent_uid.clone(),
        summary: request.summary.clone(),
    })
}

/// Rebuilds a domain request from a container record.
///
/// Status payloads that the container does not carry are reconstructed with the timestamp the
/// record does carry, so a round trip through the container never invents an operator name.
fn to_request(record: &PromotionRecord) -> StagedPromotionRequest {
    let status = match record.status {
        PromotionStatus::Pending => StagedPromotionStatus::PendingHumanUac,
        PromotionStatus::Approved => StagedPromotionStatus::ApprovedAndPromoted {
            promoted_at_ms: record.created_at_ms,
            human_operator: String::new(),
        },
        PromotionStatus::Rejected => StagedPromotionStatus::RejectedByHuman {
            rejected_at_ms: record.created_at_ms,
            human_operator: String::new(),
            feedback: String::new(),
        },
        PromotionStatus::Superseded => StagedPromotionStatus::SupersededByHigherScore {
            superseded_by_id: String::new(),
            score_delta_pct: 0,
        },
        PromotionStatus::Expired => StagedPromotionStatus::Expired {
            expired_at_ms: record.expires_at_ms,
        },
    };

    StagedPromotionRequest {
        request_id: record.request_id.clone(),
        source_ref: record.source_ref.clone(),
        target_ref: record.target_ref.clone(),
        candidate_commit_oid: record.candidate_oid,
        auto_score: AutoQualityScoreEnvelope {
            composite_score: record.composite_score,
            cai_index: record.cai_index,
            cyclomatic_complexity_delta: 0,
            eloc_delta: 0,
            credible_interval_lower: record.credible_interval_lower,
            anti_gaming_passed: record.anti_gaming_passed,
            summary_report: record.summary.clone(),
        },
        status,
        challenge_nonce: record.challenge_nonce,
        created_at_ms: record.created_at_ms,
        expires_at_ms: record.expires_at_ms,
        summary: record.summary.clone(),
        agent_uid: record.agent_uid.clone(),
    }
}
