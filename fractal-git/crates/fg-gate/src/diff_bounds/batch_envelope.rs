//! Module: fg-gate::diff_bounds::batch_envelope — Commit Batch Macro Bounds
//! File Path: crates/fg-gate/src/diff_bounds/batch_envelope.rs
//! Architecture Role: Evaluates commit-batch aggregate weighted ELOC addition and deletion totals.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

use super::micro_envelope::{CROSS_FILE_REFACTOR_DEL_RATIO, CROSS_FILE_REFACTOR_MIN_DEL_ELOC};

/// Macro batch target for total weighted ELOC additions per commit.
pub const TARGET_COMMIT_BATCH_ADD_5D_ELOC: f64 = 360.0;
/// Macro batch ceiling for total weighted ELOC additions per pure-growth commit.
pub const MAX_COMMIT_BATCH_ADD_5D_ELOC: f64 = 540.0;
/// Macro batch ceiling for total weighted ELOC additions when cross-file refactor conservation holds.
pub const MAX_COMMIT_BATCH_REFACTOR_ADD_5D_ELOC: f64 = 720.0;
/// Macro batch target for total weighted ELOC deletions per commit.
pub const TARGET_COMMIT_BATCH_DEL_5D_ELOC: f64 = 180.0;
/// Macro batch ceiling for total weighted ELOC deletions per commit.
pub const MAX_COMMIT_BATCH_DEL_5D_ELOC: f64 = 360.0;
/// Weight applied to deleted weighted ELOC in net batch turnover.
pub const DELETION_TURNOVER_WEIGHT: f64 = 0.8;
/// Weight applied to test-file additions when checking the macro batch addition ceiling.
pub const TEST_BATCH_WEIGHT: f64 = 0.5;

/// Reports whether batch-level deletions witness cross-file refactor conservation.
pub fn has_cross_file_refactor_witness(
    total_effective_lines_added: f64,
    total_effective_lines_deleted: f64,
) -> bool {
    if !total_effective_lines_added.is_finite() || !total_effective_lines_deleted.is_finite() {
        return false;
    }
    total_effective_lines_deleted >= CROSS_FILE_REFACTOR_MIN_DEL_ELOC
        && total_effective_lines_deleted
            >= total_effective_lines_added * CROSS_FILE_REFACTOR_DEL_RATIO
}

/// Aggregate totals across all staged files in a candidate commit batch.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CommitBatchTotals {
    pub total_physical_lines_added: usize,
    pub total_physical_lines_deleted: usize,
    pub total_effective_lines_added: f64,
    pub total_weighted_effective_lines_added: f64,
    pub total_effective_lines_deleted: f64,
    pub total_net_turnover: f64,
    /// Backward-compatible aliases:
    pub total_phys_add: usize,
    pub total_phys_del: usize,
    pub total_eloc_5d_add: f64,
    pub total_eloc_5d_del: f64,
    pub total_net_5d_turnover: f64,
}

impl CommitBatchTotals {
    /// Creates a new commit batch totals snapshot.
    pub fn new(
        total_physical_lines_added: usize,
        total_physical_lines_deleted: usize,
        total_effective_lines_added: f64,
        total_effective_lines_deleted: f64,
        total_net_turnover: f64,
    ) -> Self {
        Self {
            total_physical_lines_added,
            total_physical_lines_deleted,
            total_effective_lines_added,
            total_weighted_effective_lines_added: total_effective_lines_added,
            total_effective_lines_deleted,
            total_net_turnover,
            total_phys_add: total_physical_lines_added,
            total_phys_del: total_physical_lines_deleted,
            total_eloc_5d_add: total_effective_lines_added,
            total_eloc_5d_del: total_effective_lines_deleted,
            total_net_5d_turnover: total_net_turnover,
        }
    }

    /// Returns a copy with an explicit test-weighted effective addition total.
    pub const fn with_weighted_add(mut self, weighted_add: f64) -> Self {
        self.total_weighted_effective_lines_added = weighted_add;
        self
    }
}

/// A structured violation of the commit batch macro bounds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchEnvelopeViolation {
    pub rule_id: &'static str,
    pub message: String,
}

/// Audits a commit batch aggregate totals against macro envelope bounds.
pub fn audit_commit_batch_envelope(
    batch_totals: &CommitBatchTotals,
) -> Result<(), BatchEnvelopeViolation> {
    let add_ceiling = if has_cross_file_refactor_witness(
        batch_totals.total_effective_lines_added,
        batch_totals.total_effective_lines_deleted,
    ) {
        MAX_COMMIT_BATCH_REFACTOR_ADD_5D_ELOC
    } else {
        MAX_COMMIT_BATCH_ADD_5D_ELOC
    };

    if batch_totals.total_weighted_effective_lines_added > add_ceiling {
        return Err(BatchEnvelopeViolation {
            rule_id: "BLOCK_BATCH_ADD_OVERFLOW",
            message: format!(
                "Commit batch additions ({:.1} weighted ELOC) exceed macro batch ceiling ({:.1} weighted ELOC). Split into multiple atomic commits.",
                batch_totals.total_weighted_effective_lines_added, add_ceiling
            ),
        });
    }

    if batch_totals.total_effective_lines_deleted > MAX_COMMIT_BATCH_DEL_5D_ELOC {
        return Err(BatchEnvelopeViolation {
            rule_id: "BLOCK_BATCH_DEL_OVERFLOW",
            message: format!(
                "Commit batch deletions ({:.1} weighted ELOC) exceed macro batch ceiling ({:.1} weighted ELOC). Decompose decommissioning into phased commits.",
                batch_totals.total_effective_lines_deleted, MAX_COMMIT_BATCH_DEL_5D_ELOC
            ),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_within_envelope() {
        let totals = CommitBatchTotals::new(500, 100, 480.0, 90.0, 552.0);
        assert!(audit_commit_batch_envelope(&totals).is_ok());
    }

    #[test]
    fn test_batch_add_overflow_blocked() {
        let totals = CommitBatchTotals::new(600, 10, 560.0, 5.0, 564.0);
        let err = audit_commit_batch_envelope(&totals).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_BATCH_ADD_OVERFLOW");
    }

    #[test]
    fn test_batch_cross_file_refactor_witness_unlocks_720_ceiling() {
        let totals = CommitBatchTotals::new(650, 360, 600.0, 360.0, 888.0);
        assert!(audit_commit_batch_envelope(&totals).is_ok());

        let over_refactor = CommitBatchTotals::new(800, 360, 740.0, 360.0, 1028.0);
        assert_eq!(
            audit_commit_batch_envelope(&over_refactor)
                .unwrap_err()
                .rule_id,
            "BLOCK_BATCH_ADD_OVERFLOW"
        );
    }

    #[test]
    fn test_batch_del_overflow_blocked() {
        let totals = CommitBatchTotals::new(10, 420, 10.0, 380.0, 314.0);
        let err = audit_commit_batch_envelope(&totals).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_BATCH_DEL_OVERFLOW");
    }

    #[test]
    fn test_batch_matches_ssot_json_contract() {
        let raw = include_str!("../../../../../scripts/common/diff-bounds-contract.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).expect("valid SSOT json");
        let batch = &parsed["batchBands"];
        assert_eq!(
            batch["add"]["target"].as_f64(),
            Some(TARGET_COMMIT_BATCH_ADD_5D_ELOC)
        );
        assert_eq!(
            batch["add"]["ceiling"].as_f64(),
            Some(MAX_COMMIT_BATCH_ADD_5D_ELOC)
        );
        assert_eq!(
            batch["refactorWitnessAddCeiling"].as_f64(),
            Some(MAX_COMMIT_BATCH_REFACTOR_ADD_5D_ELOC)
        );
        assert_eq!(
            batch["del"]["target"].as_f64(),
            Some(TARGET_COMMIT_BATCH_DEL_5D_ELOC)
        );
        assert_eq!(
            batch["del"]["ceiling"].as_f64(),
            Some(MAX_COMMIT_BATCH_DEL_5D_ELOC)
        );
        assert_eq!(
            batch["deletionTurnoverWeight"].as_f64(),
            Some(DELETION_TURNOVER_WEIGHT)
        );
        assert_eq!(batch["testBatchWeight"].as_f64(), Some(TEST_BATCH_WEIGHT));
    }
}
