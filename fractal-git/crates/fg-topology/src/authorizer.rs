//! Module: fg-topology — Human Elevation Authorizer Trait & Nonce Guard
//! File Path: crates/fg-topology/src/authorizer.rs
//! Architecture Role: Defines the core authorization interface and cryptographic nonce
//!   challenge-response verifier for operator-driven human promotions into System Trunk.
//! Dependencies & Triggers: Invoked by `PromotionStagingLedger::apply_elevation_approval` during trunk elevation.
//! Responsibilities: Validate request binding, constant-time 32-byte challenge nonce match, 1-hour lease
//!   window, non-empty human operator identity, and session attribution, plus append audit trail entries.
//! Exit Semantics & Design Rationale: Uses `fg_core::ct_eq_bytes` for constant-time nonce comparison
//!   (`STDLIB-CONST-001`) and fails closed on expired leases or anonymous sessions.
//!
//! Domain Governance Rules: FGT-TOP-001, FGT-COR-001, STDLIB-CONST-001.

use fg_core::ct_eq_bytes;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{ElevationAttestation, StagedPromotionRequest};
use std::sync::Mutex;

/// Trait abstraction for human elevation approval verification and audit recording.
pub trait ElevationAuthorizer: Send + Sync {
    /// Verifies that `proof` represents a valid, non-forged physical human click
    /// corresponding to the active `request` challenge nonce within its lease period.
    fn verify_elevation_proof(
        &self,
        request: &StagedPromotionRequest,
        proof: &ElevationAttestation,
    ) -> FractalResult<bool>;

    /// Records an immutable elevation entry into the audit trail.
    fn record_audit_entry(
        &self,
        request_id: &str,
        action: &str,
        operator: &str,
    ) -> FractalResult<()>;
}

/// Standard cryptographic nonce verifier and in-memory audit recorder.
pub struct StandardNonceAuthorizer {
    audit_log: Mutex<Vec<String>>,
}

impl Default for StandardNonceAuthorizer {
    fn default() -> Self {
        Self::new()
    }
}

impl StandardNonceAuthorizer {
    /// Constructs a standard nonce authorizer with an empty audit log.
    pub fn new() -> Self {
        Self {
            audit_log: Mutex::new(Vec::new()),
        }
    }

    /// Access the audit history entries.
    pub fn audit_entries(&self) -> Vec<String> {
        self.audit_log
            .lock()
            .unwrap_or_else(|poison_err| poison_err.into_inner())
            .clone()
    }
}

impl ElevationAuthorizer for StandardNonceAuthorizer {
    fn verify_elevation_proof(
        &self,
        request: &StagedPromotionRequest,
        proof: &ElevationAttestation,
    ) -> FractalResult<bool> {
        // 1. Request ID match
        if proof.request_id != request.request_id {
            return Err(FractalError::AuthProofInvalid(format!(
                "Elevation request ID mismatch: expected {}, got {}",
                request.request_id, proof.request_id
            )));
        }

        // 2. Constant-time cryptographic nonce equality check
        if !ct_eq_bytes(&proof.signed_nonce, &request.challenge_nonce) {
            return Err(FractalError::AuthProofInvalid(
                "Elevation challenge nonce mismatch: proof contains invalid cryptographic nonce".into(),
            ));
        }

        // 3. Lease expiry check (1-hour window)
        if request.is_expired(proof.timestamp_ms) {
            return Err(FractalError::LeaseExpired(
                "Elevation approval rejected: lease expired (exceeded 1-hour window)".into(),
            ));
        }

        // 4. Operator presence check
        if proof.operator_name.trim().is_empty() {
            return Err(FractalError::AuthProofInvalid(
                "Elevation approval rejected: operator name cannot be empty".into(),
            ));
        }

        // 5. Session attribution check: an anonymous session cannot witness a click
        if proof.approval_session_token.trim().is_empty() {
            return Err(FractalError::AuthProofInvalid(
                "Elevation approval rejected: approval session token cannot be empty".into(),
            ));
        }

        Ok(true)
    }

    fn record_audit_entry(
        &self,
        request_id: &str,
        action: &str,
        operator: &str,
    ) -> FractalResult<()> {
        let entry = format!(
            "[{}] Action: {} | Request: {} | Operator: {}",
            chrono::Utc::now().to_rfc3339(),
            action,
            request_id,
            operator
        );
        let mut log = self
            .audit_log
            .lock()
            .unwrap_or_else(|poison_err| poison_err.into_inner());
        log.push(entry);
        Ok(())
    }
}
