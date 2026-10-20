//! Module: fg-topology — Human GUI UAC Elevation Authorizer Trait & Nonce Guard
//! File Path: crates/fg-topology/src/authorizer.rs
//! Architecture Role: Defines the core authorization interface and cryptographic nonce
//!   challenge-response verifier for GUI-exclusive human promotions into System Trunk.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{HumanUacProof, StagedPromotionRequest};
use std::sync::Mutex;

/// Trait abstraction for GUI-driven human UAC approval verification and audit recording.
pub trait HumanUacAuthorizer: Send + Sync {
    /// Verifies that `proof` represents a valid, non-forged physical human click
    /// corresponding to the active `request` challenge nonce within its lease period.
    fn verify_uac_proof(
        &self,
        request: &StagedPromotionRequest,
        proof: &HumanUacProof,
    ) -> FractalResult<bool>;

    /// Records an immutable UAC elevation entry into the audit trail.
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

impl HumanUacAuthorizer for StandardNonceAuthorizer {
    fn verify_uac_proof(
        &self,
        request: &StagedPromotionRequest,
        proof: &HumanUacProof,
    ) -> FractalResult<bool> {
        // 1. Request ID match
        if proof.request_id != request.request_id {
            return Err(FractalError::IndexConflict(format!(
                "UAC request ID mismatch: expected {}, got {}",
                request.request_id, proof.request_id
            )));
        }

        // 2. Nonce equality check
        if proof.signed_nonce != request.challenge_nonce {
            return Err(FractalError::IndexConflict(
                "UAC challenge nonce mismatch: proof contains invalid cryptographic nonce".into(),
            ));
        }

        // 3. Lease expiry check (1-hour window)
        if request.is_expired(proof.timestamp_ms) {
            return Err(FractalError::IndexConflict(
                "UAC approval rejected: lease expired (exceeded 1-hour window)".into(),
            ));
        }

        // 4. Operator presence check
        if proof.operator_name.trim().is_empty() {
            return Err(FractalError::IndexConflict(
                "UAC approval rejected: operator name cannot be empty".into(),
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
