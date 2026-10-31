//! Module: fg-gate — Dynamic Agent Credit Controller & Anti-Gaming Circuit Breaker
//! File Path: crates/fg-gate/src/credit.rs
//! Architecture Role: Manages Agent dynamic credit ratings using objective statistical Bayesian inference
//!   (Jeffreys Beta(0.5, 0.5) prior) and enforces the `BLOCK_GAMING_DETECTED` circuit breaker.
//!   Upon detecting deceptive test claims, empty assertions, or critical invariant breaches, it halts
//!   promotion and safely isolates the unapproved modifications into `.taxis/quarantine/`.
//!
//! Dependencies & Triggers: Consumed by `AutoAuditHook` and staging gates.
//! Responsibilities:
//!   - Calculating conjugate Beta posterior credit scores without subjective bias.
//!   - Intercepting gaming behaviors (Goodhart's law exploitation).
//!   - Routing unapproved modifications into elastic quarantine without cross-crate coupling.
//!
//! Exit Semantics & Design Rationale:
//!   - Fails closed on gaming detection, preserving work in quarantine with zero tree pollution.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Protocol gate facade and rule compliance
//! - `FGT-STO-001`: Storage crash safety and zero work loss

use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
pub use fg_core::models::quarantine::{
    IsolateMutationRequest, QuarantineLedger, QuarantineRecord, QuarantineStatus,
};
use serde::{Deserialize, Serialize};

/// Statistical Jeffreys Beta credit evaluation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentCreditScore {
    /// Total invariant tests attempted.
    pub total_trials: usize,
    /// Invariant tests successfully passed.
    pub passed_trials: usize,
    /// Calculated Jeffreys posterior mean: $\hat{\mu} = (\alpha_0 + s) / (\alpha_0 + \beta_0 + n)$.
    pub posterior_mean: f64,
    /// Lower bound of the 95% Bayesian credible interval.
    pub credible_interval_lower: f64,
    /// Upper bound of the 95% Bayesian credible interval.
    pub credible_interval_upper: f64,
    /// Whether anti-gaming circuit breaker was tripped.
    pub gaming_detected: bool,
}

/// Agent Credit Controller evaluating objective fidelity and enforcing quarantine.
#[derive(Debug, Clone)]
pub struct AgentCreditController {
    min_credit_threshold: f64,
}

impl Default for AgentCreditController {
    fn default() -> Self {
        Self {
            min_credit_threshold: 0.65,
        }
    }
}

/// Consolidated parameter object for isolating a rejected or gaming mutation into quarantine.
#[derive(Debug, Clone)]
pub struct QuarantineRequestParams<'a> {
    /// Evaluated agent credit score snapshot.
    pub credit: &'a AgentCreditScore,
    /// Target quarantine directory on disk.
    pub quarantine_dir: &'a Path,
    /// SubAgent identifier.
    pub agent_id: &'a str,
    /// Project identifier.
    pub project_id: &'a str,
    /// Repository-relative file path.
    pub rel_path: &'a str,
    /// Source content or unified diff patch.
    pub patch_or_content: &'a str,
    /// Current Unix timestamp in seconds.
    pub now_secs: u64,
}

impl AgentCreditController {
    /// Creates a controller with the specified minimum credit threshold.
    pub const fn new(min_credit_threshold: f64) -> Self {
        Self {
            min_credit_threshold,
        }
    }

    /// Evaluates objective Bayesian credit from trial outcomes using Jeffreys prior Beta(0.5, 0.5).
    pub fn compute_credit(
        &self,
        passed_trials: usize,
        total_trials: usize,
        gaming_signals: bool,
    ) -> AgentCreditScore {
        let posterior = fg_core::jeffreys_beta_trials(passed_trials as u64, total_trials as u64);

        AgentCreditScore {
            total_trials,
            passed_trials,
            posterior_mean: posterior.mean,
            credible_interval_lower: posterior.ci95_lower,
            credible_interval_upper: posterior.ci95_upper,
            gaming_detected: gaming_signals,
        }
    }

    /// Asserts that the agent passes credit requirements; if gaming is detected,
    /// immediately routes unapproved modifications into quarantine.
    pub fn assert_credit_or_quarantine(
        &self,
        params: QuarantineRequestParams<'_>,
    ) -> FractalResult<()> {
        if params.credit.gaming_detected {
            let reason = "BLOCK_GAMING_DETECTED: Deceptive test evasion or tautological assertion intercepted";

            QuarantineLedger::isolate_mutation(IsolateMutationRequest {
                quarantine_dir: params.quarantine_dir,
                project_id: params.project_id,
                agent_id: params.agent_id,
                rel_path: params.rel_path,
                file_uid: None,
                patch_or_content: params.patch_or_content,
                reason,
                current_time: params.now_secs,
                nonce: 0,
            })?;

            return Err(FractalError::GateRejection {
                score: params.credit.posterior_mean,
                violations: vec![format!(
                    "[{reason}] Isolated unapproved modification for agent '{}' to quarantine",
                    params.agent_id
                )],
            });
        }

        if params.credit.posterior_mean < self.min_credit_threshold {
            return Err(FractalError::GateRejection {
                score: params.credit.posterior_mean,
                violations: vec![format!(
                    "Agent credit score {:.2} is below required threshold {:.2}",
                    params.credit.posterior_mean, self.min_credit_threshold
                )],
            });
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jeffreys_beta_credit_calculation() {
        let controller = AgentCreditController::default();

        // 10 trials, 10 passes: alpha = 10.5, beta = 0.5 -> mean = 10.5 / 11.0 ≈ 0.9545
        let score = controller.compute_credit(10, 10, false);
        assert!(score.posterior_mean > 0.90);
        assert!(!score.gaming_detected);

        // 10 trials, 0 passes: alpha = 0.5, beta = 10.5 -> mean = 0.5 / 11.0 ≈ 0.0454
        let low_score = controller.compute_credit(0, 10, false);
        assert!(low_score.posterior_mean < 0.10);
    }

    #[test]
    fn test_gaming_circuit_breaker_routes_to_quarantine() {
        let controller = AgentCreditController::default();
        let score = controller.compute_credit(10, 10, true); // gaming detected!

        let quarantine_scratch_dir = std::path::PathBuf::from("target/test_tmp/credit_quarantine");
        let _ = std::fs::remove_dir_all(&quarantine_scratch_dir);
        std::fs::create_dir_all(&quarantine_scratch_dir).unwrap();

        let quarantine_result = controller.assert_credit_or_quarantine(QuarantineRequestParams {
            credit: &score,
            quarantine_dir: &quarantine_scratch_dir,
            agent_id: "subagent-test-1",
            project_id: "vscode-extensions",
            rel_path: "crates/fg-gate/test.rs",
            patch_or_content: "fake content",
            now_secs: 1729000000,
        });

        assert!(quarantine_result.is_err());
        let index_payload =
            std::fs::read(quarantine_scratch_dir.join("quarantine_index.json")).unwrap();
        let ledger: QuarantineLedger = serde_json::from_slice(&index_payload).unwrap();
        assert_eq!(ledger.records.len(), 1);
        assert_eq!(ledger.records[0].agent_id, "subagent-test-1");
        assert!(ledger.records[0].reason.contains("BLOCK_GAMING_DETECTED"));
    }
}
