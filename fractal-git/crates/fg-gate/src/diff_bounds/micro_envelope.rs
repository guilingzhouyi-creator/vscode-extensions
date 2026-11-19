//! Module: fg-gate::diff_bounds::micro_envelope — Single-File Micro Bounds
//! File Path: crates/fg-gate/src/diff_bounds/micro_envelope.rs
//! Architecture Role: Evaluates per-file weighted ELOC addition/deletion envelopes and substance density.
//! Domain Governance Rules: FGT-GAT-001, FGT-PRF-001.

/// Single-file addition target for brand new production files (weighted ELOC).
pub const TARGET_NEW_FILE_5D_ELOC: f64 = 160.0;
/// Single-file envelope ceiling for newly created production files.
pub const MAX_NEW_FILE_5D_ELOC: f64 = 240.0;
/// Single-file addition target for edits to existing production files (weighted ELOC).
pub const TARGET_EXISTING_FILE_ADD_5D_ELOC: f64 = 90.0;
/// Single-file envelope ceiling for additions to existing production files.
pub const MAX_EXISTING_FILE_ADD_5D_ELOC: f64 = 180.0;
/// Single-file addition target when a verified refactoring witness exists.
pub const TARGET_REFACTOR_FILE_ADD_5D_ELOC: f64 = 140.0;
/// Single-file envelope ceiling for additions on production files with refactor witness.
pub const MAX_REFACTOR_FILE_ADD_5D_ELOC: f64 = 260.0;
/// Single-file addition target for brand new test files (weighted ELOC).
pub const TARGET_TEST_NEW_FILE_5D_ELOC: f64 = 240.0;
/// Single-file envelope ceiling for newly created test files.
pub const MAX_TEST_NEW_FILE_5D_ELOC: f64 = 360.0;
/// Single-file addition target for edits to existing test files (weighted ELOC).
pub const TARGET_TEST_EXISTING_FILE_ADD_5D_ELOC: f64 = 150.0;
/// Single-file envelope ceiling for additions to existing test files.
pub const MAX_TEST_EXISTING_FILE_ADD_5D_ELOC: f64 = 260.0;
/// Single-file addition target for refactor-witnessed test files (weighted ELOC).
pub const TARGET_TEST_REFACTOR_FILE_ADD_5D_ELOC: f64 = 240.0;
/// Single-file envelope ceiling for refactor-witnessed test files.
pub const MAX_TEST_REFACTOR_FILE_ADD_5D_ELOC: f64 = 380.0;
/// Single-file deletion target without explicit refactor witness (weighted ELOC).
pub const TARGET_FILE_DEL_5D_ELOC: f64 = 60.0;
/// Single-file envelope ceiling for deletions without explicit refactor witness.
pub const MAX_FILE_DEL_5D_ELOC: f64 = 120.0;
/// Single-file deletion target covered by a verified refactor witness (weighted ELOC).
pub const TARGET_WITNESSED_FILE_DEL_5D_ELOC: f64 = 180.0;
/// Single-file envelope ceiling for deletions covered by a verified refactor witness.
pub const MAX_WITNESSED_FILE_DEL_5D_ELOC: f64 = 360.0;
/// Deleted weighted ELOC threshold above which existing file additions receive refactor headroom.
pub const REFACTOR_WITNESS_MIN_DEL_ELOC: f64 = 10.0;
/// Minimum batch deleted weighted ELOC required for cross-file refactor conservation witness.
pub const CROSS_FILE_REFACTOR_MIN_DEL_ELOC: f64 = 30.0;
/// Minimum deletion-to-addition ratio required for cross-file refactor conservation witness.
pub const CROSS_FILE_REFACTOR_DEL_RATIO: f64 = 0.6;
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

/// Checks whether any directory segment equals `test`, `tests`, or `__tests__`.
fn has_test_dir_segment(path: &str) -> bool {
    let mut start = 0usize;
    for (idx, byte) in path.bytes().enumerate() {
        if byte == b'/' || byte == b'\\' {
            let segment = &path[start..idx];
            if matches!(segment, "test" | "tests" | "__tests__") {
                return true;
            }
            start = idx + 1;
        }
    }
    false
}

fn file_name_slice(path: &str) -> &str {
    match path.rfind(['/', '\\']) {
        Some(idx) => &path[idx + 1..],
        None => path,
    }
}

fn strip_js_ts_extension(file_name: &str) -> Option<&str> {
    const EXTENSIONS: [&str; 12] = [
        ".mtsx", ".ctsx", ".mjsx", ".cjsx", ".tsx", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".ts",
        ".js",
    ];
    for ext in EXTENSIONS {
        if let Some(stem) = file_name.strip_suffix(ext) {
            return Some(stem);
        }
    }
    None
}

fn is_prefixed_test_script_or_module(path: &str) -> bool {
    let name = file_name_slice(path);
    if name.starts_with("test_")
        && (name.ends_with(".rs") || name.ends_with(".gd") || name.ends_with(".py"))
        && name.len() > 8
    {
        return true;
    }

    let mut parts = path.split(['/', '\\']);
    let (Some(first), Some(second), Some(third), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    (first == "scripts"
        && second == "common"
        && third.starts_with("test-")
        && third.ends_with(".js")
        && third.len() > 8)
        || (first == "auto-refactor"
            && second == "scripts"
            && third.starts_with("validate-")
            && third.ends_with(".js")
            && third.len() > 12)
}

/// Classifies whether a repository-relative path belongs to the dedicated test-file track.
pub fn is_test_file_path(file_path: &str) -> bool {
    let mut normalized = file_path.trim();
    while let Some(rest) = normalized
        .strip_prefix("./")
        .or_else(|| normalized.strip_prefix(".\\"))
    {
        normalized = rest;
    }
    if normalized.is_empty() {
        return false;
    }
    if has_test_dir_segment(normalized) {
        return true;
    }
    let name = file_name_slice(normalized);
    if let Some(stem) = strip_js_ts_extension(name) {
        if stem.ends_with(".test") || stem.ends_with(".spec") {
            return true;
        }
    }
    is_prefixed_test_script_or_module(normalized)
}

/// Resolves the single-file addition ceiling across production and test tracks.
pub fn resolve_file_add_ceiling(
    file_path: &str,
    is_new_file: bool,
    effective_lines_deleted: f64,
    has_refactor_witness: bool,
    has_batch_refactor_witness: bool,
) -> f64 {
    let (new_ceiling, existing_ceiling, refactor_ceiling) = if is_test_file_path(file_path) {
        (
            MAX_TEST_NEW_FILE_5D_ELOC,
            MAX_TEST_EXISTING_FILE_ADD_5D_ELOC,
            MAX_TEST_REFACTOR_FILE_ADD_5D_ELOC,
        )
    } else {
        (
            MAX_NEW_FILE_5D_ELOC,
            MAX_EXISTING_FILE_ADD_5D_ELOC,
            MAX_REFACTOR_FILE_ADD_5D_ELOC,
        )
    };

    if has_batch_refactor_witness {
        return refactor_ceiling;
    }
    if is_new_file {
        return new_ceiling;
    }
    if has_refactor_witness || effective_lines_deleted > REFACTOR_WITNESS_MIN_DEL_ELOC {
        return refactor_ceiling;
    }
    existing_ceiling
}

/// Audits a single file against the micro envelope constraints with optional batch refactor witness.
pub fn audit_single_file_envelope_with_batch(
    file_path: &str,
    file_envelope: &SingleFile5dBounds,
    has_refactor_witness: bool,
    has_batch_refactor_witness: bool,
) -> Result<(), MicroEnvelopeViolation> {
    let addition_ceiling = resolve_file_add_ceiling(
        file_path,
        file_envelope.is_new_file,
        file_envelope.effective_lines_deleted,
        has_refactor_witness,
        has_batch_refactor_witness,
    );

    if file_envelope.effective_lines_added > addition_ceiling {
        return Err(MicroEnvelopeViolation {
            rule_id: "BLOCK_FILE_ADD_OVERFLOW",
            file_path: file_path.to_string(),
            message: format!(
                "File addition volume ({:.1} weighted ELOC) exceeds single-file envelope ({:.1} weighted ELOC)",
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
                "File deletion volume ({:.1} weighted ELOC) exceeds envelope ({:.1} weighted ELOC){}",
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

/// Audits a single file against the micro envelope constraints.
pub fn audit_single_file_envelope(
    file_path: &str,
    file_envelope: &SingleFile5dBounds,
    has_refactor_witness: bool,
) -> Result<(), MicroEnvelopeViolation> {
    audit_single_file_envelope_with_batch(file_path, file_envelope, has_refactor_witness, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_file_within_envelope() {
        let bounds = SingleFile5dBounds::new(true, 220, 0, 200.0, 0.0, 0.85, 0.70);
        assert!(audit_single_file_envelope("src/foo.rs", &bounds, false).is_ok());
    }

    #[test]
    fn test_new_file_overflow_blocked() {
        let bounds = SingleFile5dBounds::new(true, 260, 0, 250.0, 0.0, 0.85, 0.70);
        let err = audit_single_file_envelope("src/foo.rs", &bounds, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_FILE_ADD_OVERFLOW");
    }

    #[test]
    fn test_existing_file_overflow_blocked() {
        let bounds = SingleFile5dBounds::new(false, 200, 0, 190.0, 0.0, 0.85, 0.70);
        let err = audit_single_file_envelope("src/existing.rs", &bounds, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_FILE_ADD_OVERFLOW");
    }

    #[test]
    fn test_existing_file_refactor_widens_add_ceiling_to_260() {
        let bounds = SingleFile5dBounds::new(false, 250, 25, 240.0, 20.0, 0.85, 0.75);
        assert!(audit_single_file_envelope("src/refactored.rs", &bounds, false).is_ok());
    }

    #[test]
    fn test_test_file_track_classification_and_ceilings() {
        assert!(is_test_file_path("auto-refactor/tests/unit/foo.test.ts"));
        assert!(is_test_file_path("src\\__tests__\\bar.spec.mts"));
        assert!(is_test_file_path("fractal-git/tests/rust/test_gate.rs"));
        assert!(is_test_file_path("scripts/common/test-gate-guards.js"));
        assert!(is_test_file_path("auto-refactor/scripts/validate-diff.js"));
        assert!(!is_test_file_path("src/core/scoring/governor.ts"));

        let new_test = SingleFile5dBounds::new(true, 360, 0, 340.0, 0.0, 0.85, 0.75);
        assert!(audit_single_file_envelope("tests/unit/new.test.ts", &new_test, false).is_ok());

        let junk_test = SingleFile5dBounds::new(true, 20, 0, 2.0, 0.0, 0.10, 0.20);
        let err =
            audit_single_file_envelope("tests/unit/junk.test.ts", &junk_test, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_SUBSTANTIVE_DEFICIT");
    }

    #[test]
    fn test_batch_refactor_witness_unlocks_split_new_file_ceiling() {
        let split_file = SingleFile5dBounds::new(true, 260, 0, 250.0, 0.0, 0.90, 0.85);
        assert!(audit_single_file_envelope_with_batch(
            "src/split_part.rs",
            &split_file,
            false,
            false
        )
        .is_err());
        assert!(audit_single_file_envelope_with_batch(
            "src/split_part.rs",
            &split_file,
            false,
            true
        )
        .is_ok());
    }

    #[test]
    fn test_deletion_erosion_blocked_without_witness_and_capped_with_witness() {
        let bounds = SingleFile5dBounds::new(false, 5, 140, 5.0, 130.0, 0.9, 0.8);
        let err = audit_single_file_envelope("src/core.rs", &bounds, false).unwrap_err();
        assert_eq!(err.rule_id, "BLOCK_CAPABILITY_EROSION");
        assert!(audit_single_file_envelope("src/core.rs", &bounds, true).is_ok());

        let extreme = SingleFile5dBounds::new(false, 10, 400, 10.0, 370.0, 0.9, 0.8);
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
            parsed["testFileAddBands"]["newFile"]["target"].as_f64(),
            Some(TARGET_TEST_NEW_FILE_5D_ELOC)
        );
        assert_eq!(
            parsed["testFileAddBands"]["newFile"]["ceiling"].as_f64(),
            Some(MAX_TEST_NEW_FILE_5D_ELOC)
        );
        assert_eq!(
            parsed["testFileAddBands"]["existingFile"]["target"].as_f64(),
            Some(TARGET_TEST_EXISTING_FILE_ADD_5D_ELOC)
        );
        assert_eq!(
            parsed["testFileAddBands"]["existingFile"]["ceiling"].as_f64(),
            Some(MAX_TEST_EXISTING_FILE_ADD_5D_ELOC)
        );
        assert_eq!(
            parsed["testFileAddBands"]["refactorWitness"]["target"].as_f64(),
            Some(TARGET_TEST_REFACTOR_FILE_ADD_5D_ELOC)
        );
        assert_eq!(
            parsed["testFileAddBands"]["refactorWitness"]["ceiling"].as_f64(),
            Some(MAX_TEST_REFACTOR_FILE_ADD_5D_ELOC)
        );
        assert_eq!(
            parsed["fileDelBands"]["plain"]["target"].as_f64(),
            Some(TARGET_FILE_DEL_5D_ELOC)
        );
        assert_eq!(
            parsed["fileDelBands"]["plain"]["ceiling"].as_f64(),
            Some(MAX_FILE_DEL_5D_ELOC)
        );
        assert_eq!(
            parsed["fileDelBands"]["witnessed"]["target"].as_f64(),
            Some(TARGET_WITNESSED_FILE_DEL_5D_ELOC)
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
            parsed["expansionPolicy"]["crossFileRefactorMinDelEloc"].as_f64(),
            Some(CROSS_FILE_REFACTOR_MIN_DEL_ELOC)
        );
        assert_eq!(
            parsed["expansionPolicy"]["crossFileRefactorDelRatio"].as_f64(),
            Some(CROSS_FILE_REFACTOR_DEL_RATIO)
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
