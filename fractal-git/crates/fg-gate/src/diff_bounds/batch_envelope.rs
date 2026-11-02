//! Module: fg-gate::diff_bounds::batch_envelope — Commit Batch Macro Bounds
//! File Path: crates/fg-gate/src/diff_bounds/batch_envelope.rs
//! Architecture Role: Evaluates commit-batch aggregate 5D ELOC addition and deletion totals.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

/// Macro batch ceiling for total 5D ELOC additions per commit.
pub const MAX_COMMIT_BATCH_ADD_5D_ELOC: f64 = 360.0;
/// Macro batch ceiling for total 5D ELOC deletions per commit.
pub const MAX_COMMIT_BATCH_DEL_5D_ELOC: f64 = 280.0;

/// Aggregate totals across all staged files in a candidate commit batch.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CommitBatchTotals {
    pub total_phys_add: usize,
    pub total_phys_del: usize,
    pub total_eloc_5d_add: f64,
    pub total_eloc_5d_del: f64,
    pub total_net_5d_turnover: f64,
}

/// A structured violation of the commit batch macro bounds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchEnvelopeViolation {
    pub rule_id: &'static str,
    pub message: String,
}

/// Audits a commit batch aggregate totals against macro envelope bounds.
pub fn audit_commit_batch_envelope(totals: &CommitBatchTotals) -> Result<(), BatchEnvelopeViolation> {
    if totals.total_eloc_5d_add > MAX_COMMIT_BATCH_ADD_5D_ELOC {
        return Err(BatchEnvelopeViolation {
            rule_id: "BLOCK_BATCH_ADD_OVERFLOW",
            message: format!(
                "Commit batch additions ({:.1} 5D ELOC) exceed macro batch ceiling ({:.1} 5D ELOC). Split into multiple atomic commits.",
                totals.total_eloc_5d_add, MAX_COMMIT_BATCH_ADD_5D_ELOC
            ),
        });
    }

    if totals.total_eloc_5d_del > MAX_COMMIT_BATCH_DEL_5D_ELOC {
        return Err(BatchEnvelopeViolation {
            rule_id: "BLOCK_BATCH_DEL_OVERFLOW",
            message: format!(
                "Commit batch deletions ({:.1} 5D ELOC) exceed macro batch ceiling ({:.1} 5D ELOC). Decompose decommissioning into phased commits.",
                totals.total_eloc_5d_del, MAX_COMMIT_BATCH_DEL_5D_ELOC
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
        let totals = CommitBatchTotals {
            total_phys_add: 300,
            total_phys_del: 100,
            total_eloc_5d_add: 280.0,
            total_eloc_5d_del: 90.0,
            total_net_5d_turnover: 352.0,
        };
        assert!(audit_commit_batch_envelope(&totals).is_ok());
    }

    #[test]
    fn test_batch_add_overflow_blocked() {
        let totals = CommitBatchTotals {
            total_phys_add: 500,
            total_phys_del: 10,
            total_eloc_5d_add: 385.0,
            total_eloc_5d_del: 5.0,
            total_net_5d_turnover: 389.0,
        };
        let err = audit_commit_batch_envelope(&totals).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_BATCH_ADD_OVERFLOW");
    }

    #[test]
    fn test_batch_del_overflow_blocked() {
        let totals = CommitBatchTotals {
            total_phys_add: 10,
            total_phys_del: 400,
            total_eloc_5d_add: 10.0,
            total_eloc_5d_del: 310.0,
            total_net_5d_turnover: 258.0,
        };
        let err = audit_commit_batch_envelope(&totals).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_BATCH_DEL_OVERFLOW");
    }
}
