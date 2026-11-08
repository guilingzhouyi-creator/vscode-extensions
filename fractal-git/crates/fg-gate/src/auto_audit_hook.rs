//! Module: fg-gate — Automated Quality & Invariant Audit Hook
//! File Path: crates/fg-gate/src/auto_audit_hook.rs
//! Architecture Role: Static source and test hygiene inspection with explicit rejection of
//!   unsupported execution claims. Gaming diagnostics can preserve the submitted source in quarantine.
//!
//! Dependencies & Triggers: The hook pipeline currently checks path confinement; slice auditing
//!   is a separate entry point pending snapshot-backed review integration.
//! Responsibilities: Static invariant diagnostics, tautology detection, and quarantine preservation.
//!
//! Exit Semantics & Design Rationale:
//!   - Static slices cannot produce signed execution receipts or measured quality credit.
//!   - Work preservation: quarantined mutations remain retrievable via the quarantine registry.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Protocol gate facade and rule compliance
//! - `FGT-VRF-001`: TKCV formal AST invariant verifier guard
//! - `FGT-MUT-001`: IKCE blind mutation kill rate guard
//! - `FGT-TAU-001`: IKCE anti-tautology assertion guard
//! - `FGT-QRN-001`: Quarantine isolation and Bayesian credit circuit-breaker guard
//! - `FGT-STO-001`: Storage crash safety and zero work loss

use std::path::{Path, PathBuf};
use std::sync::Arc;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{current_unix_seconds, AuditRecord, AuthoritySecret};
use fg_topology::refs::DiskRefStore;

use crate::canary::{CanaryConfig, KernelCanaryEngine};
use crate::credit::{AgentCreditScore, IsolateMutationRequest, QuarantineRegistry};
use crate::hook::{FractalHook, HookContext, HookTier, HookVerdict};
use crate::verifier::{KernelAstVerifier, VerifierConfig, ViolationSeverity};

/// Automated in-kernel audit hook integrating TKCV, IKCE, and dynamic credit governance.
pub struct AutoAuditHook {
    tier: HookTier,
    verifier: KernelAstVerifier,
    canary: KernelCanaryEngine,
    quarantine_dir: Option<PathBuf>,
    telemetry_store: Option<Arc<DiskRefStore>>,
    authority_secret: Option<AuthoritySecret>,
}

impl AutoAuditHook {
    /// Creates a new `AutoAuditHook` for the designated tier with default configurations.
    pub fn new(tier: HookTier) -> Self {
        Self {
            tier,
            verifier: KernelAstVerifier::new(VerifierConfig::default()),
            canary: KernelCanaryEngine::new(CanaryConfig::default()),
            quarantine_dir: None,
            telemetry_store: None,
            authority_secret: None,
        }
    }

    /// Sets the quarantine directory for isolating rejected/gaming mutations.
    #[must_use]
    pub fn with_quarantine_dir(mut self, path: impl AsRef<Path>) -> Self {
        self.quarantine_dir = Some(path.as_ref().to_path_buf());
        self
    }

    /// Attaches an authority secret for signing telemetry audit records.
    #[must_use]
    pub fn with_authority_secret(mut self, secret: AuthoritySecret) -> Self {
        self.authority_secret = Some(secret);
        self
    }

    /// Attaches a ref store for persisting telemetry records.
    #[must_use]
    pub fn with_telemetry_store(mut self, store: Arc<DiskRefStore>) -> Self {
        self.telemetry_store = Some(store);
        self
    }

    /// Directly audits source code and test code slices in-memory.
    pub fn audit_source_and_test(
        &self,
        rel_path: &str,
        source_code: &str,
        test_code: &str,
        actor_name: &str,
    ) -> FractalResult<(AuditRecord, AgentCreditScore)> {
        // 1. Run TKCV static verifier on source code
        let verifier_violations = self.verifier.verify_source_slice(rel_path, source_code);
        let mut block_violations = Vec::new();

        for violation in &verifier_violations {
            if violation.severity == ViolationSeverity::Block {
                block_violations.push(format!(
                    "[{}] {}:{}: {}",
                    violation.rule_id, violation.file, violation.line, violation.message
                ));
            }
        }

        // 2. Run IKCE canary blind mutation on source & tests
        let canary_report = self.canary.evaluate_slice(source_code, test_code);
        let gaming_detected =
            !canary_report.static_hygiene_passed && canary_report.tautological_assert_count > 0;

        for canary_violation in &canary_report.violations {
            let rule_tag = if canary_violation.contains("FGT-TAU-001") {
                "FGT-TAU-001"
            } else {
                "FGT-MUT-001"
            };
            block_violations.push(format!("[{rule_tag}] [IKCE] {canary_violation}"));
        }

        if !block_violations.is_empty() {
            if let Some(quarantine_dir) = self.quarantine_dir.as_ref().filter(|_| gaming_detected) {
                QuarantineRegistry::isolate_mutation(IsolateMutationRequest {
                    quarantine_dir,
                    project_id: "taxis",
                    agent_id: actor_name,
                    rel_path,
                    file_uid: None,
                    patch_or_content: source_code,
                    reason: "BLOCK_GAMING_DETECTED: static tautological assertion intercepted",
                    current_time: current_unix_seconds().max(0) as u64,
                    nonce: 0,
                })?;
            }

            return Err(FractalError::PolicyViolation(block_violations.join("; ")));
        }

        Err(FractalError::ReviewUnavailable {
            reason: "static inspection cannot produce test or mutation execution evidence".into(),
        })
    }
}

impl FractalHook for AutoAuditHook {
    fn id(&self) -> &'static str {
        "fgt-hook-auto-audit"
    }

    fn tier(&self) -> HookTier {
        self.tier
    }

    fn evaluate(&self, ctx: &HookContext<'_>) -> FractalResult<HookVerdict> {
        if ctx.staged_files.is_empty() {
            return Ok(HookVerdict::Pass);
        }

        for path in ctx.staged_files {
            // Verify path jail directly on staged path
            if let Some(jail_violation) = self.verifier.verify_path_jail(path) {
                return Ok(HookVerdict::Block {
                    reason: format!("[{}] {}", jail_violation.rule_id, jail_violation.message),
                });
            }
        }

        Ok(HookVerdict::Pass)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auto_audit_hook_evaluates_clean_code() {
        let secret = AuthoritySecret::from_bytes(&[0x42; 32]).unwrap();
        let hook = AutoAuditHook::new(HookTier::SubToCard).with_authority_secret(secret);

        let source = r#"
            pub fn safe_calc(val: u32) -> u32 {
                val * 2
            }
        "#;
        let tests = r#"
            #[test]
            fn test_safe_calc() {
                assert_eq!(safe_calc(10), 20);
                assert_eq!(safe_calc(0), 0);
            }
        "#;

        let audit_result =
            hook.audit_source_and_test("crates/fg-gate/calc.rs", source, tests, "agent-01");
        assert!(audit_result.is_err());
        let error = audit_result.err().unwrap();
        assert!(error.to_string().starts_with("Review unavailable:"));
        assert!(error.to_string().contains("execution evidence"));
    }

    #[test]
    fn test_auto_audit_hook_blocks_and_quarantines_gaming() {
        let quarantine_test_dir = std::path::PathBuf::from("target/test_tmp/auto_audit_quarantine");
        let _ = std::fs::remove_dir_all(&quarantine_test_dir);
        std::fs::create_dir_all(&quarantine_test_dir).unwrap();

        let hook =
            AutoAuditHook::new(HookTier::SubToCard).with_quarantine_dir(&quarantine_test_dir);

        let source = r#"
            pub fn tricky_calc(val: u32) -> u32 {
                val + 1
            }
        "#;
        let tautology_tests = r#"
            #[test]
            fn test_tricky() {
                assert!(true);
            }
        "#;

        let audit_result = hook.audit_source_and_test(
            "crates/fg-gate/tricky.rs",
            source,
            tautology_tests,
            "agent-gaming",
        );

        assert!(audit_result.is_err());
        let rejection_error = audit_result.err().unwrap();
        match rejection_error {
            FractalError::PolicyViolation(reason) => {
                assert!(reason.contains("IKCE"));
            }
            _ => panic!("Expected PolicyViolation"),
        }
    }
}
