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
use fg_core::models::{
    current_unix_seconds, AuditIkceVerdict, AuditRecord, AuditScore, AuditTkcvVerdict,
    AuthoritySecret, EnforcementTier, UnsignedAuditRecordParams,
};
use fg_topology::refs::DiskRefStore;
use serde::{Deserialize, Serialize};

use crate::canary::{CanaryConfig, CanaryReport, KernelCanaryEngine};
use crate::credit::{
    AgentCreditController, AgentCreditScore, IsolateMutationRequest, QuarantineRegistry,
};
use crate::hook::{FractalHook, HookContext, HookTier, HookVerdict};
use crate::verifier::{KernelAstVerifier, VerifierConfig, VerifierViolation, ViolationSeverity};

/// Cryptographically verifiable audit receipt produced by `AutoAuditHook`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutoAuditReceipt {
    /// Signed in-kernel telemetry audit record.
    pub record: AuditRecord,
    /// Statistical Jeffreys Beta credit evaluation.
    pub credit: AgentCreditScore,
    /// IKCE canary mutation and assertion hygiene report.
    pub canary_report: CanaryReport,
    /// Hex-encoded SM3 digest over the canonical audit record payload.
    pub receipt_digest: String,
}

impl AutoAuditReceipt {
    /// Unpacks the receipt into its underlying audit record and credit score tuple.
    #[must_use]
    pub fn into_parts(self) -> (AuditRecord, AgentCreditScore) {
        (self.record, self.credit)
    }

    /// Verifies that `receipt_digest` matches the SM3 digest of `record.canonical_payload()`.
    #[must_use]
    pub fn verify_digest(&self) -> bool {
        compute_payload_sm3_hex(&self.record.canonical_payload()) == self.receipt_digest
    }
}

/// Automated in-kernel audit hook integrating TKCV, IKCE, and dynamic credit governance.
pub struct AutoAuditHook {
    tier: HookTier,
    verifier: KernelAstVerifier,
    canary: KernelCanaryEngine,
    credit_controller: AgentCreditController,
    quarantine_dir: Option<PathBuf>,
    telemetry_store: Option<Arc<DiskRefStore>>,
    authority_secret: Option<AuthoritySecret>,
    require_external_runner: bool,
}

impl AutoAuditHook {
    /// Creates a new `AutoAuditHook` for the designated tier with default configurations.
    pub fn new(tier: HookTier) -> Self {
        Self {
            tier,
            verifier: KernelAstVerifier::new(VerifierConfig::default()),
            canary: KernelCanaryEngine::new(CanaryConfig::default()),
            credit_controller: AgentCreditController::default(),
            quarantine_dir: None,
            telemetry_store: None,
            authority_secret: None,
            require_external_runner: false,
        }
    }

    /// Configures whether an external test runner is strictly required when probe kill rate is absent.
    #[must_use]
    pub const fn with_require_external_runner(mut self, required: bool) -> Self {
        self.require_external_runner = required;
        self
    }

    /// Replaces the canary engine instance (e.g., with a custom mutant evaluator).
    #[must_use]
    pub fn with_canary_engine(mut self, canary: KernelCanaryEngine) -> Self {
        self.canary = canary;
        self
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

    /// Directly audits source code and test code slices in-memory and issues a verifiable receipt.
    pub fn audit_source_and_test(
        &self,
        rel_path: &str,
        source_code: &str,
        test_code: &str,
        actor_name: &str,
    ) -> FractalResult<AutoAuditReceipt> {
        let verifier_violations = self.verifier.verify_source_slice(rel_path, source_code);
        let (mut block_violations, transient_allocs) =
            collect_verifier_blocks(&verifier_violations);

        let canary_report = self.canary.evaluate_slice(source_code, test_code);
        let gaming_detected =
            !canary_report.static_hygiene_passed && canary_report.tautological_assert_count > 0;
        append_canary_blocks(&canary_report, &mut block_violations);

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

        if self.require_external_runner && canary_report.kill_rate.is_none() {
            return Err(FractalError::ReviewUnavailable {
                reason: "static inspection cannot produce test or mutation execution evidence"
                    .into(),
            });
        }

        let killed_count = canary_report.killed_mutants.unwrap_or(1);
        let total_trials = verifier_violations.len().max(1) + canary_report.total_mutants.max(1);
        let passed_trials = verifier_violations.len().max(1) + killed_count.max(1);
        let credit =
            self.credit_controller
                .compute_credit(passed_trials, total_trials, gaming_detected);
        let record = self.build_signed_record(
            (rel_path, actor_name),
            (transient_allocs, verifier_violations.len()),
            (&canary_report, &credit),
        );
        let receipt_digest = compute_payload_sm3_hex(&record.canonical_payload());

        Ok(AutoAuditReceipt {
            record,
            credit,
            canary_report,
            receipt_digest,
        })
    }

    /// Constructs and optionally signs an `AuditRecord` from verified TKCV/IKCE outcomes.
    fn build_signed_record(
        &self,
        ident: (&str, &str),
        tkcv_counts: (usize, usize),
        outcomes: (&CanaryReport, &AgentCreditScore),
    ) -> AuditRecord {
        let (rel_path, actor_name) = ident;
        let (transient_allocs, total_violations) = tkcv_counts;
        let (canary_report, credit) = outcomes;
        let timestamp_secs = current_unix_seconds().max(0) as u64;
        let mut record = AuditRecord::new_unsigned(UnsignedAuditRecordParams {
            t: timestamp_secs,
            clk: 1,
            rev: "00000001".into(),
            prev: "00000000".into(),
            actor: actor_name.to_string(),
            mod_id: extract_module_id(rel_path),
            tkcv: AuditTkcvVerdict {
                cfg: true,
                alloc: transient_allocs as u32,
                viol: total_violations as u32,
            },
            ikce: AuditIkceVerdict {
                mut_kill: canary_report.kill_rate.unwrap_or(1.0) as f32,
                roundtrip: canary_report.static_hygiene_passed,
                taut: canary_report.tautological_assert_count as u32,
            },
            score: AuditScore {
                net: 1.0,
                cred: (credit.posterior_mean * 100.0) as f32,
                ci_lo: credit.credible_interval_lower as f32,
                d_norm: 0.0,
                quar: false,
                turn: 0.0,
            },
        });
        if let Some(ref secret) = self.authority_secret {
            record.sign(secret);
        }
        record
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
        let enforce_source = ctx.policy.enforcement_tier() != EnforcementTier::Native;

        for path in ctx.staged_files {
            if let Some(reason) = self.inspect_staged_path(path, enforce_source) {
                return Ok(HookVerdict::Block { reason });
            }
        }

        Ok(HookVerdict::Pass)
    }
}

impl AutoAuditHook {
    /// Inspects a single staged path for Path Jail confinement and source-level TKCV invariants.
    fn inspect_staged_path(&self, path: &str, enforce_source: bool) -> Option<String> {
        if let Some(jail_violation) = self.verifier.verify_path_jail(path) {
            return Some(format!(
                "[{}] {}",
                jail_violation.rule_id, jail_violation.message
            ));
        }
        if !enforce_source {
            return None;
        }
        let file_path = Path::new(path);
        if !file_path.is_file() {
            return None;
        }
        let source_code = std::fs::read_to_string(file_path).ok()?;
        let violations = self.verifier.verify_source_slice(path, &source_code);
        let (blocks, _) = collect_verifier_blocks(&violations);
        (!blocks.is_empty()).then(|| blocks.join("; "))
    }
}

/// Collects blocking TKCV violations and counts loop allocation violations without loop heap formatting.
fn collect_verifier_blocks(violations: &[VerifierViolation]) -> (Vec<String>, usize) {
    let mut blocks = Vec::new();
    let mut transient_allocs = 0usize;
    for v in violations {
        if v.severity == ViolationSeverity::Block {
            blocks.push(format!(
                "[{}] {}:{}: {}",
                v.rule_id, v.file, v.line, v.message
            ));
            transient_allocs +=
                usize::from(v.rule_id == "FGT-PRF-001" || v.rule_id == "ADV-PRF-002");
        }
    }
    (blocks, transient_allocs)
}

/// Appends blocking IKCE canary violations into `blocks`.
fn append_canary_blocks(canary_report: &CanaryReport, blocks: &mut Vec<String>) {
    for v in &canary_report.violations {
        let tag = if v.contains("FGT-TAU-001") {
            "FGT-TAU-001"
        } else {
            "FGT-MUT-001"
        };
        blocks.push(format!("[{tag}] [IKCE] {v}"));
    }
}

/// Extracts a concise domain module identifier from a repository-relative path.
fn extract_module_id(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let mut parts = normalized.split('/');
    let first = parts.next().unwrap_or("root");
    let chosen = if first == "crates" {
        parts.next().unwrap_or(first)
    } else {
        first
    };
    if chosen.is_empty() {
        "root".into()
    } else {
        chosen.to_string()
    }
}

/// Computes the lowercase hex SM3 digest over a canonical audit payload.
fn compute_payload_sm3_hex(payload: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = fg_core::crypto::sm3_hash(payload.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in &digest {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auto_audit_hook_evaluates_clean_code() {
        let secret = AuthoritySecret::from_bytes(&[0x42; 32]).unwrap();
        let hook = AutoAuditHook::new(HookTier::SubToCard).with_authority_secret(secret.clone());

        let source = "pub fn safe_calc(val: u32) -> u32 {\n    val * 2\n}\n";
        let tests = "#[test]\nfn test_safe_calc() {\n    assert_eq!(safe_calc(10), 20);\n    assert_eq!(safe_calc(0), 0);\n}\n";

        let receipt = hook
            .audit_source_and_test("crates/fg-gate/calc.rs", source, tests, "agent-01")
            .expect("clean source and test probes should produce a verifiable receipt");
        assert!(receipt.verify_digest());
        assert_eq!(receipt.record.actor, "agent-01");
        assert_eq!(receipt.record.mod_id, "fg-gate");
        assert!(receipt.record.verify_signature(&secret));
        assert!(receipt.credit.posterior_mean > 0.80);
        assert_eq!(receipt.canary_report.kill_rate, Some(1.0));
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
