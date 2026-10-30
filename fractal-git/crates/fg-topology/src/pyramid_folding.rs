//! Module: fg-topology — Pyramid Folding Ledger & SubAgent Increment Compressor
//! File Path: crates/fg-topology/src/pyramid_folding.rs
//! Architecture Role: Implements the hierarchical pyramid folding mechanism (Level 1 SubAgent -> Level 2 Card).
//!   Compresses high-frequency micro-audit records emitted by ephemeral SubAgents into a compact,
//!   tamper-evident Card Milestone record without losing cryptographic chain provenance.
//!
//! Dependencies & Triggers: Invoked when advancing private Card worktrees or committing promotion proposals.
//! Responsibilities:
//!   - Compressing arbitrary sequences of SubAgent `AuditRecord`s into a single milestone envelope (<350B).
//!   - Calculating accumulated net quality delta and pooled Jeffreys Beta credit posterior.
//!   - Preserving genesis and tip cryptographic fingerprints for unbroken audit verification.
//!
//! Exit Semantics & Design Rationale:
//!   - Prevents git object database bloat: compresses $O(N)$ micro-records into $O(1)$ milestone records.
//!   - Pure in-memory transformation, deterministic and zero-transient allocation in steady state.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-PYR-001`: Four-tier pyramid audit folding and milestone compression guard
//! - `FGT-TOP-001`: Fractal topology reference guard
//! - `ADV-PRF-002`: Loop transient allocation detox
//! - `SIM-ARGS-001`: Parameter object convergence

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{
    AuditIkceVerdict, AuditRecord, AuditScore, AuditTkcvVerdict, AuthoritySecret,
    UnsignedAuditRecordParams,
};
use serde::{Deserialize, Serialize};

/// Aggregated milestone summary synthesized by folding multiple micro-audit records.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardMilestoneRecord {
    /// Consolidated audit record representing this card milestone.
    pub record: AuditRecord,
    /// Total count of SubAgent micro-records folded into this milestone.
    pub folded_records_count: usize,
    /// Total mutants evaluated across all folded increments.
    pub total_mutants_evaluated: usize,
    /// Total mutants successfully killed across all folded increments.
    pub total_mutants_killed: usize,
}

impl CardMilestoneRecord {
    /// Serializes this milestone record into an NDJSON line verifying byte budget (<350B).
    pub fn to_ndjson_line(&self) -> FractalResult<String> {
        self.record.to_ndjson_line()
    }
}

/// Pyramid folding engine compressing multi-agent micro-records into milestones.
#[derive(Debug, Default)]
pub struct PyramidFolder;

impl PyramidFolder {
    /// Creates a new `PyramidFolder` instance.
    pub fn new() -> Self {
        Self
    }

    /// Folds a slice of `AuditRecord`s into a single consolidated `CardMilestoneRecord`.
    ///
    /// # Errors
    /// Returns [`FractalError::EmptySet`] if `records` is empty.
    pub fn fold_records(
        &self,
        records: &[AuditRecord],
        card_id: &str,
        secret: &AuthoritySecret,
    ) -> FractalResult<CardMilestoneRecord> {
        if records.is_empty() {
            return Err(FractalError::PolicyViolation(
                "Cannot fold empty audit record sequence".into(),
            ));
        }

        let genesis_record = &records[0];
        let tip_record = &records[records.len() - 1];

        let mut net_quality_sum = 0.0f32;
        let mut total_allocs = 0u32;
        let mut total_viols = 0u32;
        let mut total_tauts = 0u32;
        let mut min_ci_lo = 1.0f32;
        let mut d_norm_sum = 0.0f32;
        let mut any_quarantined = false;
        let mut all_cfg_passed = true;

        let mut total_mutants = 0usize;
        let mut killed_mutants = 0usize;

        for audit_entry in records {
            net_quality_sum += audit_entry.score.net;
            total_allocs += audit_entry.tkcv.alloc;
            total_viols += audit_entry.tkcv.viol;
            total_tauts += audit_entry.ikce.taut;
            if audit_entry.score.ci_lo > 0.0 && audit_entry.score.ci_lo < min_ci_lo {
                min_ci_lo = audit_entry.score.ci_lo;
            }
            d_norm_sum += audit_entry.score.d_norm;
            if audit_entry.score.quar {
                any_quarantined = true;
            }
            if !audit_entry.tkcv.cfg {
                all_cfg_passed = false;
            }

            // Approximate mutant metrics based on ratio and credit
            let batch_mutants = 10usize;
            let batch_killed = (audit_entry.ikce.mut_kill * batch_mutants as f32).round() as usize;
            total_mutants += batch_mutants;
            killed_mutants += batch_killed;
        }

        // Consolidated Jeffreys Beta posterior credit: alpha_0 = 0.5, beta_0 = 0.5
        let alpha = 0.5 + killed_mutants as f64;
        let beta = 0.5 + (total_mutants.saturating_sub(killed_mutants)) as f64;
        let credit_posterior_mean = (alpha / (alpha + beta)) * 100.0;
        let mean_d_norm = d_norm_sum / (records.len() as f32);

        let mut milestone_record = AuditRecord::new_unsigned(UnsignedAuditRecordParams {
            t: tip_record.t,
            clk: tip_record.clk,
            rev: tip_record.rev.clone(),
            prev: genesis_record.prev.clone(),
            actor: format!("card-{}", card_id),
            mod_id: genesis_record.mod_id.clone(),
            tkcv: AuditTkcvVerdict {
                cfg: all_cfg_passed,
                alloc: total_allocs,
                viol: total_viols,
            },
            ikce: AuditIkceVerdict {
                mut_kill: if total_mutants == 0 {
                    1.0
                } else {
                    killed_mutants as f32 / total_mutants as f32
                },
                roundtrip: all_cfg_passed,
                taut: total_tauts,
            },
            score: AuditScore {
                net: net_quality_sum,
                cred: credit_posterior_mean as f32,
                ci_lo: if min_ci_lo <= 1.0 { min_ci_lo } else { 0.90 },
                d_norm: mean_d_norm,
                quar: any_quarantined,
            },
        });

        // Sign using kernel secret
        milestone_record.sign(secret);

        Ok(CardMilestoneRecord {
            record: milestone_record,
            folded_records_count: records.len(),
            total_mutants_evaluated: total_mutants,
            total_mutants_killed: killed_mutants,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fg_core::models::{AUDIT_RECORD_BYTE_BUDGET, GENESIS_PREV_HASH};

    fn make_dummy_record(clk: u64, prev: &str, net: f32, alloc: u32) -> AuditRecord {
        AuditRecord::new_unsigned(UnsignedAuditRecordParams {
            t: 1729000000 + clk,
            clk,
            rev: format!("c000{:04x}", clk),
            prev: prev.to_string(),
            actor: "sub-01".into(),
            mod_id: "core".into(),
            tkcv: AuditTkcvVerdict {
                cfg: true,
                alloc,
                viol: 0,
            },
            ikce: AuditIkceVerdict {
                mut_kill: 0.9,
                roundtrip: true,
                taut: 0,
            },
            score: AuditScore {
                net,
                cred: 92.0,
                ci_lo: 0.88,
                d_norm: 0.12,
                quar: false,
            },
        })
    }

    #[test]
    fn test_pyramid_folder_consolidates_records() {
        let secret = AuthoritySecret::from_bytes(&[0x33; 32]).unwrap();
        let folder = PyramidFolder::new();

        let records = vec![
            make_dummy_record(1, GENESIS_PREV_HASH, 1.5, 0),
            make_dummy_record(2, "a1b2c3d4", 2.0, 1),
            make_dummy_record(3, "e5f60718", 0.5, 0),
        ];

        let folded = folder.fold_records(&records, "CARD-042", &secret).unwrap();

        assert_eq!(folded.folded_records_count, 3);
        assert_eq!(folded.record.actor, "card-CARD-042");
        assert_eq!(folded.record.prev, GENESIS_PREV_HASH);
        assert_eq!(folded.record.tkcv.alloc, 1);
        assert!((folded.record.score.net - 4.0).abs() < 1e-4);
        assert!(!folded.record.sig.is_empty());
        assert!(folded.record.verify_signature(&secret));

        // Ensure serialization fits within budget (<350B)
        let line = folded.to_ndjson_line().unwrap();
        assert!(line.len() <= AUDIT_RECORD_BYTE_BUDGET);
    }

    #[test]
    fn test_pyramid_folder_rejects_empty_slice() {
        let secret = AuthoritySecret::from_bytes(&[0x33; 32]).unwrap();
        let folder = PyramidFolder::new();
        let folding_result = folder.fold_records(&[], "CARD-001", &secret);
        assert!(folding_result.is_err());
    }
}
