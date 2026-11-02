//! Module: fg-gate::diff_bounds — Two-Tier Decoupled Clamping & Admission Governor
//! File Path: crates/fg-gate/src/diff_bounds/mod.rs
//! Architecture Role: Coordinates single-file micro-envelopes and commit batch macro-bounds.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

pub mod admission;
pub mod batch_envelope;
pub mod micro_envelope;

pub use admission::{
    calculate_empirical_admission_threshold, verify_admission_turnover, AdmissionViolation,
    ADMISSION_TURNOVER_CAP, ADMISSION_TURNOVER_FLOOR,
};
pub use batch_envelope::{
    audit_commit_batch_envelope, BatchEnvelopeViolation, CommitBatchTotals,
    MAX_COMMIT_BATCH_ADD_5D_ELOC, MAX_COMMIT_BATCH_DEL_5D_ELOC,
};
pub use micro_envelope::{
    audit_single_file_envelope, MicroEnvelopeViolation, SingleFile5dBounds,
    MAX_EXISTING_FILE_ADD_5D_ELOC, MAX_FILE_DEL_5D_ELOC, MAX_NEW_FILE_5D_ELOC,
    MIN_SUBSTANTIVE_RATIO, MIN_TSPR,
};

/// Composite report emitted by the unified differential bounds governor.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffBoundsVerdict {
    pub micro_violations: Vec<MicroEnvelopeViolation>,
    pub batch_violation: Option<BatchEnvelopeViolation>,
    pub admission_violation: Option<AdmissionViolation>,
    pub admitted_threshold: f64,
    pub is_passed: bool,
}

/// Unified governor evaluating two-tier decoupled clamping and empirical admission.
pub struct DiffBoundsGovernor;

impl DiffBoundsGovernor {
    /// Evaluates all staged files and batch totals against the two-tier envelopes.
    pub fn evaluate(
        files: &[(&str, SingleFile5dBounds)],
        batch_totals: &CommitBatchTotals,
        recent_turnovers: &[f64],
        has_refactor_witness: bool,
    ) -> DiffBoundsVerdict {
        let mut micro_violations = Vec::new();
        for (path, bounds) in files {
            if let Err(violation) = audit_single_file_envelope(path, bounds, has_refactor_witness) {
                micro_violations.push(violation);
            }
        }

        let batch_violation = audit_commit_batch_envelope(batch_totals).err();

        let (admission_violation, admitted_threshold) =
            match verify_admission_turnover(batch_totals.total_net_5d_turnover, recent_turnovers) {
                Ok(thresh) => (None, thresh),
                Err(violation) => {
                    let thresh = calculate_empirical_admission_threshold(recent_turnovers);
                    (Some(violation), thresh)
                }
            };

        let is_passed = micro_violations.is_empty()
            && batch_violation.is_none()
            && admission_violation.is_none();

        DiffBoundsVerdict {
            micro_violations,
            batch_violation,
            admission_violation,
            admitted_threshold,
            is_passed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_bounds_governor_clean_pass() {
        let files = [("src/lib.rs", SingleFile5dBounds {
            is_new_file: false,
            phys_add: 50,
            phys_del: 10,
            eloc_5d_add: 45.0,
            eloc_5d_del: 8.0,
            substantive_ratio_add: 0.9,
            tspr_add: 0.8,
        })];
        let totals = CommitBatchTotals {
            total_phys_add: 50,
            total_phys_del: 10,
            total_eloc_5d_add: 45.0,
            total_eloc_5d_del: 8.0,
            total_net_5d_turnover: 51.4,
        };
        let verdict = DiffBoundsGovernor::evaluate(&files, &totals, &[10.0, 15.0, 12.0], false);
        assert!(verdict.is_passed);
        assert!(verdict.micro_violations.is_empty());
        assert!(verdict.batch_violation.is_none());
        assert!(verdict.admission_violation.is_none());
    }

    #[test]
    fn test_diff_bounds_governor_catches_overflow() {
        let files = [("src/oversize.rs", SingleFile5dBounds {
            is_new_file: true,
            phys_add: 250,
            phys_del: 0,
            eloc_5d_add: 210.0,
            eloc_5d_del: 0.0,
            substantive_ratio_add: 0.9,
            tspr_add: 0.8,
        })];
        let totals = CommitBatchTotals {
            total_phys_add: 250,
            total_phys_del: 0,
            total_eloc_5d_add: 210.0,
            total_eloc_5d_del: 0.0,
            total_net_5d_turnover: 210.0,
        };
        let verdict = DiffBoundsGovernor::evaluate(&files, &totals, &[], false);
        assert!(!verdict.is_passed);
        assert_eq!(verdict.micro_violations.len(), 1);
        assert_eq!(verdict.micro_violations[0].rule_id, "BLOCK_FILE_ADD_OVERFLOW");
    }
}
