//! Module: fg-gate::diff_bounds::micro_envelope — Single-File Micro Bounds
//! File Path: crates/fg-gate/src/diff_bounds/micro_envelope.rs
//! Architecture Role: Evaluates per-file 5D ELOC addition/deletion envelopes and substance density.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

/// Single-file addition target for brand new files (5D ELOC).
pub const TARGET_NEW_FILE_5D_ELOC: f64 = 120.0;
/// Single-file envelope ceiling for newly created files.
pub const MAX_NEW_FILE_5D_ELOC: f64 = 180.0;
/// Single-file addition target for edits to existing files (5D ELOC).
pub const TARGET_EXISTING_FILE_ADD_5D_ELOC: f64 = 60.0;
/// Single-file envelope ceiling for additions to existing files.
pub const MAX_EXISTING_FILE_ADD_5D_ELOC: f64 = 120.0;
/// Single-file addition target when a verified refactoring witness exists.
pub const TARGET_REFACTOR_FILE_ADD_5D_ELOC: f64 = 90.0;
/// Single-file envelope ceiling for additions on existing files with refactor witness.
pub const MAX_REFACTOR_FILE_ADD_5D_ELOC: f64 = 180.0;
/// Single-file envelope ceiling for deletions without explicit refactor witness.
pub const MAX_FILE_DEL_5D_ELOC: f64 = 100.0;
/// Single-file envelope ceiling for deletions covered by a verified refactor witness.
pub const MAX_WITNESSED_FILE_DEL_5D_ELOC: f64 = 280.0;
/// Deleted 5D ELOC threshold above which existing file additions receive refactor headroom.
pub const REFACTOR_WITNESS_MIN_DEL_ELOC: f64 = 10.0;
/// Minimum coverage fraction required from batch or HEAD additions to witness large deletions.
pub const WITNESS_COVERAGE_RATIO: f64 = 0.70;
/// Minimum added physical line sample width before density checks engage.
pub const MIN_PHYS_ADD_SAMPLE_WIDTH: usize = 10;
/// Rigid floor on substantive line ratio (substantive / physical added).
pub const SUBSTANTIVE_RATIO_FLOOR: f64 = 0.45;
/// Minimum substantive line ratio target (substantive / (substantive + blank + comment)).
pub const MIN_SUBSTANTIVE_RATIO: f64 = 0.60;
/// Rigid floor on Technical Substance Preservation Ratio (TSPR).
pub const TSPR_FLOOR: f64 = 0.30;
/// Minimum Technical Substance Preservation Ratio (TSPR) target.
pub const MIN_TSPR: f64 = 0.40;
/// TSPR threshold above which dense payload vouches for the substantive ratio down to floor.
pub const TSPR_VOUCH_FOR_DENSITY: f64 = 0.85;

/// Metric snapshot of a single candidate file in the staging zone.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SingleFile5dBounds {
    pub is_new_file: bool,
    pub physical_lines_added: usize,
    pub physical_lines_deleted: usize,
    pub effective_lines_added: f64,
    pub effective_lines_deleted: f64,
    pub substantive_ratio_added: f64,
    pub preservation_ratio_added: f64,
    /// Backward-compatible aliases:
    pub phys_add: usize,
    pub phys_del: usize,
    pub eloc_5d_add: f64,
    pub eloc_5d_del: f64,
    pub substantive_ratio_add: f64,
    pub tspr_add: f64,
}

impl SingleFile5dBounds {
    /// Creates a new single-file differential envelope snapshot.
    pub fn new(
        is_new_file: bool,
        physical_lines_added: usize,
        physical_lines_deleted: usize,
        effective_lines_added: f64,
        effective_lines_deleted: f64,
        substantive_ratio_added: f64,
        preservation_ratio_added: f64,
    ) -> Self {
        Self {
            is_new_file,
            physical_lines_added,
            physical_lines_deleted,
            effective_lines_added,
            effective_lines_deleted,
            substantive_ratio_added,
            preservation_ratio_added,
            phys_add: physical_lines_added,
            phys_del: physical_lines_deleted,
            eloc_5d_add: effective_lines_added,
            eloc_5d_del: effective_lines_deleted,
            substantive_ratio_add: substantive_ratio_added,
            tspr_add: preservation_ratio_added,
        }
    }
}

/// A structured violation of the single-file micro envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicroEnvelopeViolation {
    pub rule_id: &'static str,
    pub file_path: String,
    pub message: String,
}

/// Audits a single file against the micro envelope constraints.
pub fn audit_single_file_envelope(
    file_path: &str,
    file_envelope: &SingleFile5dBounds,
    has_refactor_witness: bool,
) -> Result<(), MicroEnvelopeViolation> {
    let addition_ceiling = if file_envelope.is_new_file {
        MAX_NEW_FILE_5D_ELOC
    } else if has_refactor_witness
        || file_envelope.effective_lines_deleted > REFACTOR_WITNESS_MIN_DEL_ELOC
    {
        MAX_REFACTOR_FILE_ADD_5D_ELOC
    } else {
        MAX_EXISTING_FILE_ADD_5D_ELOC
    };

    if file_envelope.effective_lines_added > addition_ceiling {
        return Err(MicroEnvelopeViolation {
            rule_id: "BLOCK_FILE_ADD_OVERFLOW",
            file_path: file_path.to_string(),
            message: format!(
                "File addition volume ({:.1} 5D ELOC) exceeds single-file envelope ({:.1} 5D ELOC)",
                file_envelope.effective_lines_added, addition_ceiling
            ),
        });
    }

    let deletion_ceiling = if has_refactor_witness {
        MAX_WITNESSED_FILE_DEL_5D_ELOC
    } else {
        MAX_FILE_DEL_5D_ELOC
    };
    if file_envelope.effective_lines_deleted > deletion_ceiling {
        return Err(MicroEnvelopeViolation {
            rule_id: "BLOCK_CAPABILITY_EROSION",
            file_path: file_path.to_string(),
            message: format!(
                "File deletion volume ({:.1} 5D ELOC) exceeds envelope ({:.1} 5D ELOC){}",
                file_envelope.effective_lines_deleted,
                deletion_ceiling,
                if has_refactor_witness {
                    ""
                } else {
                    " without verified refactoring witness"
                }
            ),
        });
    }

    if file_envelope.physical_lines_added >= MIN_PHYS_ADD_SAMPLE_WIDTH {
        let substantive_target = if file_envelope.preservation_ratio_added >= TSPR_VOUCH_FOR_DENSITY
        {
            SUBSTANTIVE_RATIO_FLOOR
        } else {
            MIN_SUBSTANTIVE_RATIO
        };
        if file_envelope.substantive_ratio_added < substantive_target {
            return Err(MicroEnvelopeViolation {
                rule_id: "BLOCK_SUBSTANTIVE_DEFICIT",
                file_path: file_path.to_string(),
                message: format!(
                    "Substantive line ratio ({:.2}) is below required minimum ({:.2})",
                    file_envelope.substantive_ratio_added, substantive_target
                ),
            });
        }

        if file_envelope.preservation_ratio_added < MIN_TSPR {
            return Err(MicroEnvelopeViolation {
                rule_id: "BLOCK_CODE_DILUTION",
                file_path: file_path.to_string(),
                message: format!(
                    "Technical Substance Payload Ratio TSPR ({:.2}) is below floor ({:.2})",
                    file_envelope.preservation_ratio_added, MIN_TSPR
                ),
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_file_within_envelope() {
        let bounds = SingleFile5dBounds::new(true, 150, 0, 140.0, 0.0, 0.85, 0.70);
        assert!(audit_single_file_envelope("src/foo.rs", &bounds, false).is_ok());
    }

    #[test]
    fn test_new_file_overflow_blocked() {
        let bounds = SingleFile5dBounds::new(true, 250, 0, 195.0, 0.0, 0.85, 0.70);
        let err = audit_single_file_envelope("src/foo.rs", &bounds, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_FILE_ADD_OVERFLOW");
    }

    #[test]
    fn test_existing_file_overflow_blocked() {
        let bounds = SingleFile5dBounds::new(false, 150, 0, 130.0, 0.0, 0.85, 0.70);
        let err = audit_single_file_envelope("src/existing.rs", &bounds, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_FILE_ADD_OVERFLOW");
    }

    #[test]
    fn test_existing_file_refactor_widens_add_ceiling_to_180() {
        let bounds = SingleFile5dBounds::new(false, 170, 25, 160.0, 20.0, 0.85, 0.75);
        assert!(audit_single_file_envelope("src/refactored.rs", &bounds, false).is_ok());
    }

    #[test]
    fn test_deletion_erosion_blocked_without_witness_and_capped_with_witness() {
        let bounds = SingleFile5dBounds::new(false, 5, 120, 5.0, 110.0, 0.9, 0.8);
        let err = audit_single_file_envelope("src/core.rs", &bounds, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_CAPABILITY_EROSION");
        assert!(audit_single_file_envelope("src/core.rs", &bounds, true).is_ok());

        let extreme = SingleFile5dBounds::new(false, 10, 320, 10.0, 290.0, 0.9, 0.8);
        let extreme_err = audit_single_file_envelope("src/core.rs", &extreme, true).unwrap_err();
        assert_eq!(extreme_err.rule_id, "BLOCK_CAPABILITY_EROSION");
    }

    #[test]
    fn test_tspr_vouch_relaxes_substantive_target_to_floor() {
        let high_tspr = SingleFile5dBounds::new(false, 20, 0, 10.0, 0.0, 0.50, 0.90);
        assert!(audit_single_file_envelope("src/documented.rs", &high_tspr, false).is_ok());

        let floor_breach = SingleFile5dBounds::new(false, 20, 0, 8.0, 0.0, 0.40, 0.95);
        let err = audit_single_file_envelope("src/prose.rs", &floor_breach, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_SUBSTANTIVE_DEFICIT");
    }

    #[test]
    fn test_micro_envelope_matches_ssot_json_contract() {
        let raw = include_str!("../../../../../scripts/common/diff-bounds-contract.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).expect("valid SSOT json");
        assert_eq!(
            parsed["fileAddBands"]["newFile"]["target"].as_f64(),
            Some(TARGET_NEW_FILE_5D_ELOC)
        );
        assert_eq!(
            parsed["fileAddBands"]["newFile"]["ceiling"].as_f64(),
            Some(MAX_NEW_FILE_5D_ELOC)
        );
        assert_eq!(
            parsed["fileAddBands"]["existingFile"]["target"].as_f64(),
            Some(TARGET_EXISTING_FILE_ADD_5D_ELOC)
        );
        assert_eq!(
            parsed["fileAddBands"]["existingFile"]["ceiling"].as_f64(),
            Some(MAX_EXISTING_FILE_ADD_5D_ELOC)
        );
        assert_eq!(
            parsed["fileAddBands"]["refactorWitness"]["target"].as_f64(),
            Some(TARGET_REFACTOR_FILE_ADD_5D_ELOC)
        );
        assert_eq!(
            parsed["fileAddBands"]["refactorWitness"]["ceiling"].as_f64(),
            Some(MAX_REFACTOR_FILE_ADD_5D_ELOC)
        );
        assert_eq!(
            parsed["fileDelBands"]["plain"]["ceiling"].as_f64(),
            Some(MAX_FILE_DEL_5D_ELOC)
        );
        assert_eq!(
            parsed["fileDelBands"]["witnessed"]["ceiling"].as_f64(),
            Some(MAX_WITNESSED_FILE_DEL_5D_ELOC)
        );
        assert_eq!(
            parsed["expansionPolicy"]["refactorWitnessMinDelEloc"].as_f64(),
            Some(REFACTOR_WITNESS_MIN_DEL_ELOC)
        );
        assert_eq!(
            parsed["expansionPolicy"]["witnessCoverageRatio"].as_f64(),
            Some(WITNESS_COVERAGE_RATIO)
        );
        assert_eq!(
            parsed["densityBands"]["minPhysAddSampleWidth"].as_u64(),
            Some(MIN_PHYS_ADD_SAMPLE_WIDTH as u64)
        );
        assert_eq!(
            parsed["densityBands"]["substantiveRatio"]["floor"].as_f64(),
            Some(SUBSTANTIVE_RATIO_FLOOR)
        );
        assert_eq!(
            parsed["densityBands"]["substantiveRatio"]["target"].as_f64(),
            Some(MIN_SUBSTANTIVE_RATIO)
        );
        assert_eq!(
            parsed["densityBands"]["tspr"]["floor"].as_f64(),
            Some(TSPR_FLOOR)
        );
        assert_eq!(
            parsed["densityBands"]["tspr"]["target"].as_f64(),
            Some(MIN_TSPR)
        );
        assert_eq!(
            parsed["densityBands"]["tsprVouchForDensity"].as_f64(),
            Some(TSPR_VOUCH_FOR_DENSITY)
        );
    }
}
