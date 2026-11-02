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
    pub file_violations: Vec<MicroEnvelopeViolation>,
    pub batch_violation: Option<BatchEnvelopeViolation>,
    pub admission_violation: Option<AdmissionViolation>,
    pub admission_threshold: f64,
    pub is_admitted: bool,
    /// Backward-compatible alias for `file_violations`.
    pub micro_violations: Vec<MicroEnvelopeViolation>,
    /// Backward-compatible alias for `admission_threshold`.
    pub admitted_threshold: f64,
    /// Backward-compatible alias for `is_admitted`.
    pub is_passed: bool,
}

/// Unified governor evaluating two-tier decoupled clamping and empirical admission.
pub struct DiffBoundsGovernor;

/// Architectural alias for `DiffBoundsGovernor`.
pub type DifferentialEnvelopeGovernor = DiffBoundsGovernor;

impl DiffBoundsGovernor {
    /// Evaluates all staged files and batch totals against the two-tier envelopes.
    pub fn evaluate(
        staged_files: &[(&str, SingleFile5dBounds)],
        batch_totals: &CommitBatchTotals,
        recent_turnovers: &[f64],
        has_refactor_witness: bool,
    ) -> DiffBoundsVerdict {
        let mut file_violations = Vec::new();
        for (file_path, file_envelope) in staged_files {
            if let Err(violation) =
                audit_single_file_envelope(file_path, file_envelope, has_refactor_witness)
            {
                file_violations.push(violation);
            }
        }

        let batch_violation = audit_commit_batch_envelope(batch_totals).err();

        let (admission_violation, admission_threshold) =
            match verify_admission_turnover(batch_totals.total_net_turnover, recent_turnovers) {
                Ok(threshold_value) => (None, threshold_value),
                Err(violation) => {
                    let threshold_value =
                        calculate_empirical_admission_threshold(recent_turnovers);
                    (Some(violation), threshold_value)
                }
            };

        let is_admitted = file_violations.is_empty()
            && batch_violation.is_none()
            && admission_violation.is_none();

        DiffBoundsVerdict {
            micro_violations: file_violations.clone(),
            file_violations,
            batch_violation,
            admission_violation,
            admitted_threshold: admission_threshold,
            admission_threshold,
            is_passed: is_admitted,
            is_admitted,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_bounds_governor_clean_pass() {
        let files = [(
            "src/lib.rs",
            SingleFile5dBounds::new(false, 50, 10, 45.0, 8.0, 0.9, 0.8),
        )];
        let totals = CommitBatchTotals::new(50, 10, 45.0, 8.0, 51.4);
        let verdict = DiffBoundsGovernor::evaluate(&files, &totals, &[10.0, 15.0, 12.0], false);
        assert!(verdict.is_admitted);
        assert!(verdict.is_passed);
        assert_eq!(verdict.file_violations.len(), 0);
    }

    #[test]
    fn test_diff_bounds_governor_detects_overflow() {
        let files = [(
            "src/big.rs",
            SingleFile5dBounds::new(true, 250, 0, 210.0, 0.0, 0.9, 0.8),
        )];
        let totals = CommitBatchTotals::new(250, 0, 210.0, 0.0, 210.0);
        let verdict = DiffBoundsGovernor::evaluate(&files, &totals, &[], false);
        assert!(!verdict.is_admitted);
        assert_eq!(verdict.file_violations.len(), 1);
        assert_eq!(
            verdict.file_violations[0].rule_id,
            "BLOCK_FILE_ADD_OVERFLOW"
        );
    }
}
