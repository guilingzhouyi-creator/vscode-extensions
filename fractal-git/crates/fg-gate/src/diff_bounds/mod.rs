//! Module: fg-gate::diff_bounds — Two-Tier Decoupled Clamping & Admission Governor
//! File Path: crates/fg-gate/src/diff_bounds/mod.rs
//! Architecture Role: Coordinates single-file micro-envelopes and commit batch macro-bounds.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

pub mod admission;
pub mod batch_envelope;
pub mod micro_envelope;

pub use admission::{
    calculate_empirical_admission_threshold, calculate_empirical_admission_threshold_samples,
    verify_admission_turnover, verify_admission_turnover_samples, AdmissionSample,
    AdmissionViolation, ADMISSION_TURNOVER_CAP, ADMISSION_TURNOVER_FLOOR,
    DEFAULT_TRAJECTORY_WINDOW_SIZE, JEFFREYS_PRIOR_ALPHA, JEFFREYS_PRIOR_BETA, MAX_NOISE_CEILING,
    MIN_TRAJECTORY_SAMPLES, STANDARD_DEVIATION_DISCOUNT_FACTOR,
};
pub use batch_envelope::{
    audit_commit_batch_envelope, BatchEnvelopeViolation, CommitBatchTotals,
    DELETION_TURNOVER_WEIGHT, MAX_COMMIT_BATCH_ADD_5D_ELOC, MAX_COMMIT_BATCH_DEL_5D_ELOC,
};
pub use micro_envelope::{
    audit_single_file_envelope, MicroEnvelopeViolation, SingleFile5dBounds,
    MAX_EXISTING_FILE_ADD_5D_ELOC, MAX_FILE_DEL_5D_ELOC, MAX_NEW_FILE_5D_ELOC,
    MAX_REFACTOR_FILE_ADD_5D_ELOC, MAX_WITNESSED_FILE_DEL_5D_ELOC, MIN_PHYS_ADD_SAMPLE_WIDTH,
    MIN_SUBSTANTIVE_RATIO, MIN_TSPR, REFACTOR_WITNESS_MIN_DEL_ELOC, SUBSTANTIVE_RATIO_FLOOR,
    TARGET_EXISTING_FILE_ADD_5D_ELOC, TARGET_NEW_FILE_5D_ELOC, TARGET_REFACTOR_FILE_ADD_5D_ELOC,
    TSPR_FLOOR, TSPR_VOUCH_FOR_DENSITY, WITNESS_COVERAGE_RATIO,
};

/// Composite report emitted by the unified differential bounds governor.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffBoundsVerdict {
    /// Per-file micro envelope violations detected in the candidate batch.
    pub file_violations: Vec<MicroEnvelopeViolation>,
    /// Macro batch envelope violation if additions or deletions exceed commit caps.
    pub batch_violation: Option<BatchEnvelopeViolation>,
    /// Empirical admission deficit violation when net turnover is below floor.
    pub admission_violation: Option<AdmissionViolation>,
    /// Derived empirical admission turnover threshold.
    pub admission_threshold: f64,
    /// True when all file, batch, and admission checks succeeded.
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
    /// Evaluates staged files with per-file refactor witnesses and structured Jeffreys samples.
    pub fn evaluate_with_witnesses(
        staged_files: &[(&str, SingleFile5dBounds, bool)],
        batch_totals: &CommitBatchTotals,
        recent_samples: &[AdmissionSample],
    ) -> DiffBoundsVerdict {
        let mut file_violations = Vec::with_capacity(staged_files.len());
        for (file_path, file_envelope, file_has_witness) in staged_files {
            if let Err(violation) =
                audit_single_file_envelope(file_path, file_envelope, *file_has_witness)
            {
                file_violations.push(violation);
            }
        }

        let batch_violation = audit_commit_batch_envelope(batch_totals).err();

        let (admission_violation, admission_threshold) = match verify_admission_turnover_samples(
            batch_totals.total_net_turnover,
            recent_samples,
            0.0,
            1.0,
        ) {
            Ok(threshold_value) => (None, threshold_value),
            Err(violation) => (Some(violation.clone()), violation.required_threshold),
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

    /// Evaluates all staged files and batch totals against the two-tier envelopes.
    pub fn evaluate(
        staged_files: &[(&str, SingleFile5dBounds)],
        batch_totals: &CommitBatchTotals,
        recent_turnovers: &[f64],
        has_refactor_witness: bool,
    ) -> DiffBoundsVerdict {
        let mut file_witnesses = Vec::with_capacity(staged_files.len());
        for (file_path, file_envelope) in staged_files {
            file_witnesses.push((*file_path, *file_envelope, has_refactor_witness));
        }
        let mut samples = Vec::with_capacity(recent_turnovers.len());
        for &turnover_val in recent_turnovers {
            samples.push(AdmissionSample::new(
                turnover_val,
                turnover_val >= ADMISSION_TURNOVER_FLOOR,
            ));
        }
        Self::evaluate_with_witnesses(&file_witnesses, batch_totals, &samples)
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
