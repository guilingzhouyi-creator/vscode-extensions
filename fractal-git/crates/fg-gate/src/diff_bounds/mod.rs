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
    audit_commit_batch_envelope, has_cross_file_refactor_witness, BatchEnvelopeViolation,
    CommitBatchTotals, DELETION_TURNOVER_WEIGHT, MAX_COMMIT_BATCH_ADD_5D_ELOC,
    MAX_COMMIT_BATCH_DEL_5D_ELOC, MAX_COMMIT_BATCH_REFACTOR_ADD_5D_ELOC,
    TARGET_COMMIT_BATCH_ADD_5D_ELOC, TARGET_COMMIT_BATCH_DEL_5D_ELOC, TEST_BATCH_WEIGHT,
};
pub use micro_envelope::{
    audit_single_file_envelope, audit_single_file_envelope_with_batch, is_test_file_path,
    resolve_file_add_ceiling, MicroEnvelopeViolation, SingleFile5dBounds,
    CROSS_FILE_REFACTOR_DEL_RATIO, CROSS_FILE_REFACTOR_MIN_DEL_ELOC, MAX_EXISTING_FILE_ADD_5D_ELOC,
    MAX_FILE_DEL_5D_ELOC, MAX_NEW_FILE_5D_ELOC, MAX_REFACTOR_FILE_ADD_5D_ELOC,
    MAX_TEST_EXISTING_FILE_ADD_5D_ELOC, MAX_TEST_NEW_FILE_5D_ELOC,
    MAX_TEST_REFACTOR_FILE_ADD_5D_ELOC, MAX_WITNESSED_FILE_DEL_5D_ELOC, MIN_PHYS_ADD_SAMPLE_WIDTH,
    MIN_SUBSTANTIVE_RATIO, MIN_TSPR, REFACTOR_WITNESS_MIN_DEL_ELOC, SUBSTANTIVE_RATIO_FLOOR,
    TARGET_EXISTING_FILE_ADD_5D_ELOC, TARGET_FILE_DEL_5D_ELOC, TARGET_NEW_FILE_5D_ELOC,
    TARGET_REFACTOR_FILE_ADD_5D_ELOC, TARGET_TEST_EXISTING_FILE_ADD_5D_ELOC,
    TARGET_TEST_NEW_FILE_5D_ELOC, TARGET_TEST_REFACTOR_FILE_ADD_5D_ELOC,
    TARGET_WITNESSED_FILE_DEL_5D_ELOC, TSPR_FLOOR, TSPR_VOUCH_FOR_DENSITY, WITNESS_COVERAGE_RATIO,
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
        let has_batch_refactor = has_cross_file_refactor_witness(
            batch_totals.total_effective_lines_added,
            batch_totals.total_effective_lines_deleted,
        );
        let mut raw_files_add = 0.0f64;
        let mut weighted_files_add = 0.0f64;
        let mut file_violations = Vec::with_capacity(staged_files.len());

        for (file_path, file_envelope, file_has_witness) in staged_files {
            raw_files_add += file_envelope.effective_lines_added;
            let weight = if is_test_file_path(file_path) {
                TEST_BATCH_WEIGHT
            } else {
                1.0
            };
            weighted_files_add += file_envelope.effective_lines_added * weight;

            if let Err(violation) = audit_single_file_envelope_with_batch(
                file_path,
                file_envelope,
                *file_has_witness,
                has_batch_refactor,
            ) {
                file_violations.push(violation);
            }
        }

        let effective_totals = if !staged_files.is_empty()
            && (raw_files_add - batch_totals.total_effective_lines_added).abs() < 1e-6
        {
            batch_totals.with_weighted_add((weighted_files_add * 100.0).round() / 100.0)
        } else {
            *batch_totals
        };

        let batch_violation = audit_commit_batch_envelope(&effective_totals).err();

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
            SingleFile5dBounds::new(true, 270, 0, 250.0, 0.0, 0.9, 0.8),
        )];
        let totals = CommitBatchTotals::new(270, 0, 250.0, 0.0, 250.0);
        let verdict = DiffBoundsGovernor::evaluate(&files, &totals, &[], false);
        assert!(!verdict.is_admitted);
        assert_eq!(verdict.file_violations.len(), 1);
        assert_eq!(
            verdict.file_violations[0].rule_id,
            "BLOCK_FILE_ADD_OVERFLOW"
        );
    }

    #[test]
    fn test_governor_applies_test_batch_weight_and_cross_file_refactor_witness() {
        let weighted_test_files = [
            (
                "src/a.rs",
                SingleFile5dBounds::new(true, 200, 0, 190.0, 0.0, 0.9, 0.85),
            ),
            (
                "src/b.rs",
                SingleFile5dBounds::new(true, 200, 0, 190.0, 0.0, 0.9, 0.85),
            ),
            (
                "tests/rust/test_a.rs",
                SingleFile5dBounds::new(true, 340, 0, 320.0, 0.0, 0.9, 0.85),
            ),
        ];
        // Raw add = 700, weighted add = 190 + 190 + 320 * 0.5 = 540 <= 540
        let weighted_totals = CommitBatchTotals::new(740, 0, 700.0, 0.0, 700.0);
        let weighted_verdict =
            DiffBoundsGovernor::evaluate(&weighted_test_files, &weighted_totals, &[], false);
        assert!(weighted_verdict.is_admitted);

        // Cross-file refactor: split file (250 <= 260) + deleted monolith (360 >= 0.6 * 600)
        let refactor_files = [
            (
                "src/split_a.rs",
                SingleFile5dBounds::new(true, 260, 0, 250.0, 0.0, 0.9, 0.85),
            ),
            (
                "src/split_b.rs",
                SingleFile5dBounds::new(true, 260, 0, 250.0, 0.0, 0.9, 0.85),
            ),
            (
                "src/old_monolith.rs",
                SingleFile5dBounds::new(false, 110, 360, 100.0, 360.0, 0.9, 0.85),
            ),
        ];
        let refactor_totals = CommitBatchTotals::new(630, 360, 600.0, 360.0, 888.0);
        let refactor_inputs = [
            (refactor_files[0].0, refactor_files[0].1, false),
            (refactor_files[1].0, refactor_files[1].1, false),
            (refactor_files[2].0, refactor_files[2].1, true),
        ];
        let refactor_verdict =
            DiffBoundsGovernor::evaluate_with_witnesses(&refactor_inputs, &refactor_totals, &[]);
        assert!(refactor_verdict.is_admitted);
    }
}
