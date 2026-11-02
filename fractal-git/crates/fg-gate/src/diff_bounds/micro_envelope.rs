//! Module: fg-gate::diff_bounds::micro_envelope — Single-File Micro Bounds
//! File Path: crates/fg-gate/src/diff_bounds/micro_envelope.rs
//! Architecture Role: Evaluates per-file 5D ELOC addition/deletion envelopes and substance density.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

/// Single-file envelope ceiling for newly created files.
pub const MAX_NEW_FILE_5D_ELOC: f64 = 180.0;
/// Single-file envelope ceiling for additions to existing files.
pub const MAX_EXISTING_FILE_ADD_5D_ELOC: f64 = 120.0;
/// Single-file envelope ceiling for deletions without explicit refactor witness.
pub const MAX_FILE_DEL_5D_ELOC: f64 = 100.0;
/// Minimum substantive line ratio (substantive / (substantive + blank + comment)).
pub const MIN_SUBSTANTIVE_RATIO: f64 = 0.60;
/// Minimum Tangible Substance Preservation Ratio (TSPR).
pub const MIN_TSPR: f64 = 0.40;

/// Metric snapshot of a single candidate file in the staging zone.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SingleFile5dBounds {
    pub is_new_file: bool,
    pub phys_add: usize,
    pub phys_del: usize,
    pub eloc_5d_add: f64,
    pub eloc_5d_del: f64,
    pub substantive_ratio_add: f64,
    pub tspr_add: f64,
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
    bounds: &SingleFile5dBounds,
    has_refactor_witness: bool,
) -> Result<(), MicroEnvelopeViolation> {
    let add_cap = if bounds.is_new_file {
        MAX_NEW_FILE_5D_ELOC
    } else {
        MAX_EXISTING_FILE_ADD_5D_ELOC
    };

    if bounds.eloc_5d_add > add_cap {
        return Err(MicroEnvelopeViolation {
            rule_id: "BLOCK_FILE_ADD_OVERFLOW",
            file_path: file_path.to_string(),
            message: format!(
                "File addition volume ({:.1} 5D ELOC) exceeds single-file envelope ({:.1} 5D ELOC)",
                bounds.eloc_5d_add, add_cap
            ),
        });
    }

    if bounds.eloc_5d_del > MAX_FILE_DEL_5D_ELOC && !has_refactor_witness {
        return Err(MicroEnvelopeViolation {
            rule_id: "BLOCK_CAPABILITY_EROSION",
            file_path: file_path.to_string(),
            message: format!(
                "File deletion volume ({:.1} 5D ELOC) exceeds envelope ({:.1} 5D ELOC) without verified refactoring witness",
                bounds.eloc_5d_del, MAX_FILE_DEL_5D_ELOC
            ),
        });
    }

    if bounds.phys_add >= 10 {
        if bounds.substantive_ratio_add < MIN_SUBSTANTIVE_RATIO {
            return Err(MicroEnvelopeViolation {
                rule_id: "BLOCK_SUBSTANTIVE_DEFICIT",
                file_path: file_path.to_string(),
                message: format!(
                    "Substantive line ratio ({:.2}) is below required minimum ({:.2})",
                    bounds.substantive_ratio_add, MIN_SUBSTANTIVE_RATIO
                ),
            });
        }

        if bounds.tspr_add < MIN_TSPR {
            return Err(MicroEnvelopeViolation {
                rule_id: "BLOCK_CODE_DILUTION",
                file_path: file_path.to_string(),
                message: format!(
                    "Technical Substance Payload Ratio TSPR ({:.2}) is below floor ({:.2})",
                    bounds.tspr_add, MIN_TSPR
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
        let bounds = SingleFile5dBounds {
            is_new_file: true,
            phys_add: 150,
            phys_del: 0,
            eloc_5d_add: 140.0,
            eloc_5d_del: 0.0,
            substantive_ratio_add: 0.85,
            tspr_add: 0.70,
        };
        assert!(audit_single_file_envelope("src/foo.rs", &bounds, false).is_ok());
    }

    #[test]
    fn test_new_file_overflow_blocked() {
        let bounds = SingleFile5dBounds {
            is_new_file: true,
            phys_add: 250,
            phys_del: 0,
            eloc_5d_add: 195.0,
            eloc_5d_del: 0.0,
            substantive_ratio_add: 0.85,
            tspr_add: 0.70,
        };
        let err = audit_single_file_envelope("src/foo.rs", &bounds, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_FILE_ADD_OVERFLOW");
    }

    #[test]
    fn test_existing_file_overflow_blocked() {
        let bounds = SingleFile5dBounds {
            is_new_file: false,
            phys_add: 150,
            phys_del: 0,
            eloc_5d_add: 130.0,
            eloc_5d_del: 0.0,
            substantive_ratio_add: 0.85,
            tspr_add: 0.70,
        };
        let err = audit_single_file_envelope("src/existing.rs", &bounds, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_FILE_ADD_OVERFLOW");
    }

    #[test]
    fn test_deletion_erosion_blocked_without_witness() {
        let bounds = SingleFile5dBounds {
            is_new_file: false,
            phys_add: 5,
            phys_del: 120,
            eloc_5d_add: 5.0,
            eloc_5d_del: 110.0,
            substantive_ratio_add: 0.9,
            tspr_add: 0.8,
        };
        let err = audit_single_file_envelope("src/core.rs", &bounds, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_CAPABILITY_EROSION");
        assert!(audit_single_file_envelope("src/core.rs", &bounds, true).is_ok());
    }
}
