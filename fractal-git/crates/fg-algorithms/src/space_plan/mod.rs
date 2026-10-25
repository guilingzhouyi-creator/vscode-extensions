//! Module: fg-algorithms — SpacePlan Preflight Simulation and Discrete Event Disk Model
//! File Path: crates/fg-algorithms/src/space_plan/mod.rs
//! Architecture Role: Simulates reverse tail-truncation and forward stream decompression
//!   against local disk headroom. Projects trough water levels to guarantee zero ENOSPC aborts.
//!
//! Domain Governance Rules: FGT-ALG-001, FGT-PRF-001, FGT-COR-001.

use fg_core::{FractalError, FractalResult};
use serde::{Deserialize, Serialize};

/// Default disk headroom threshold reserved for OS safety and journal writing (100 MB).
pub const DEFAULT_SAFETY_HEADROOM_BYTES: u64 = 100 * 1024 * 1024;

/// Default batch window threshold for coalescing tail truncations (16 MB).
pub const DEFAULT_BATCH_WINDOW_BYTES: u64 = 16 * 1024 * 1024;

/// Minimum allowable batch window to prevent filesystem metadata churn (1 MB).
pub const MIN_BATCH_WINDOW_BYTES: u64 = 1024 * 1024;

/// Maximum allowable batch window to bound memory and uncommitted free space delay (64 MB).
pub const MAX_BATCH_WINDOW_BYTES: u64 = 64 * 1024 * 1024;

/// A discrete unit of archive decompression and corresponding space release.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtractionUnit {
    /// Relative logical identifier or archive member path.
    pub name: String,
    /// Byte size that will be written into target storage or worktree.
    pub extracted_bytes: u64,
    /// Byte size that can be safely reclaimed/truncated from the source archive.
    pub truncated_bytes: u64,
    /// Byte offset within the source archive.
    pub offset: u64,
}

impl ExtractionUnit {
    /// Creates a new extraction unit description.
    pub fn new(
        name: impl Into<String>,
        extracted_bytes: u64,
        truncated_bytes: u64,
        offset: u64,
    ) -> Self {
        Self {
            name: name.into(),
            extracted_bytes,
            truncated_bytes,
            offset,
        }
    }
}

/// Configuration parameters for the preflight SpacePlan simulation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpacePlanConfig {
    /// Minimum free space in bytes that must remain available on the volume at all times.
    pub safety_headroom_bytes: u64,
    /// Accumulated reclaim threshold before issuing physical truncation/hole punching.
    pub batch_window_bytes: u64,
}

impl Default for SpacePlanConfig {
    fn default() -> Self {
        Self {
            safety_headroom_bytes: DEFAULT_SAFETY_HEADROOM_BYTES,
            batch_window_bytes: DEFAULT_BATCH_WINDOW_BYTES,
        }
    }
}

impl SpacePlanConfig {
    /// Creates a new configuration with explicit headroom and batch window.
    pub fn new(safety_headroom_bytes: u64, batch_window_bytes: u64) -> Self {
        Self {
            safety_headroom_bytes,
            batch_window_bytes,
        }
    }

    /// Derives an adaptive configuration tailored to the total archive file size.
    pub fn adaptive_for_archive_size(
        archive_size: u64,
        safety_headroom_bytes: Option<u64>,
    ) -> Self {
        let batch_window = compute_adaptive_batch_window(archive_size);
        let headroom = safety_headroom_bytes.unwrap_or(DEFAULT_SAFETY_HEADROOM_BYTES);
        Self {
            safety_headroom_bytes: headroom,
            batch_window_bytes: batch_window,
        }
    }
}

/// Dynamically chooses a batch window to balance syscall overhead against free-space lag.
pub fn compute_adaptive_batch_window(archive_size: u64) -> u64 {
    if archive_size < 64 * 1024 * 1024 {
        // Archives < 64MB use smaller 4MB-8MB windows.
        8 * 1024 * 1024
    } else if archive_size < 1024 * 1024 * 1024 {
        // Archives < 1GB use 16MB standard window.
        16 * 1024 * 1024
    } else if archive_size < 8 * 1024 * 1024 * 1024 {
        // Archives 1GB - 8GB use 32MB window.
        32 * 1024 * 1024
    } else {
        // Massive archives >= 8GB cap at 64MB.
        MAX_BATCH_WINDOW_BYTES
    }
}

/// Record of an individual simulated event in the discrete execution log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpacePlanStep {
    /// Sequential index of the unit.
    pub unit_index: usize,
    /// Member path or identification name.
    pub unit_name: String,
    /// Bytes extracted in this step.
    pub extracted_bytes: u64,
    /// Bytes made eligible for truncation by completing this unit.
    pub truncated_bytes: u64,
    /// Indicates whether a physical batch truncation flush triggered on this step.
    pub batch_flush_occurred: bool,
    /// Total bytes physically truncated in this step (0 if not flushed).
    pub flushed_truncated_bytes: u64,
    /// Projected available disk free space immediately after this step.
    pub free_space_after_step: u64,
}

/// Final outcome and audit report of the SpacePlan discrete event simulation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpacePlanReport {
    /// Initial measured free space on the target volume.
    pub initial_free_space: u64,
    /// Lowest water level of available free space projected during the run.
    pub trough_free_space: u64,
    /// Expected final available free space after complete extraction and source truncation.
    pub final_free_space: u64,
    /// Total bytes extracted into the worktree or object database.
    pub total_extracted_bytes: u64,
    /// Total bytes truncated from the archive.
    pub total_truncated_bytes: u64,
    /// Whether the extraction can proceed without violating safety headroom.
    pub is_viable: bool,
    /// Additional free bytes required to satisfy the safety headroom constraint.
    pub required_additional_bytes: u64,
    /// Chronological step-by-step projection log.
    pub steps: Vec<SpacePlanStep>,
}

/// Simulates extraction and truncation steps across time, computing the exact space trough.
///
/// Uses signed wide integers (`i128`) to prevent unsigned integer underflow panics when
/// initial free space is smaller than extracted data, and computes exact deficits.
pub fn simulate_space_plan(
    initial_free_space: u64,
    units: &[ExtractionUnit],
    config: &SpacePlanConfig,
) -> SpacePlanReport {
    if units.is_empty() {
        let is_viable = initial_free_space >= config.safety_headroom_bytes;
        let required_additional_bytes = config
            .safety_headroom_bytes
            .saturating_sub(initial_free_space);

        return SpacePlanReport {
            initial_free_space,
            trough_free_space: initial_free_space,
            final_free_space: initial_free_space,
            total_extracted_bytes: 0,
            total_truncated_bytes: 0,
            is_viable,
            required_additional_bytes,
            steps: Vec::new(),
        };
    }

    let mut current_level: i128 = initial_free_space as i128;
    let mut min_level: i128 = current_level;
    let mut pending_truncate: u64 = 0;
    let mut total_extracted: u64 = 0;
    let mut total_truncated: u64 = 0;

    let mut steps = Vec::with_capacity(units.len());
    let total_units = units.len();

    for (idx, unit) in units.iter().enumerate() {
        // 1. Decompress/extract data onto disk: free space decreases.
        current_level -= unit.extracted_bytes as i128;
        min_level = min_level.min(current_level);

        pending_truncate = pending_truncate.saturating_add(unit.truncated_bytes);
        total_extracted = total_extracted.saturating_add(unit.extracted_bytes);
        total_truncated = total_truncated.saturating_add(unit.truncated_bytes);

        // 2. Determine if batch window or final unit triggers physical truncation.
        let is_last_unit = idx + 1 == total_units;
        let should_flush =
            (pending_truncate >= config.batch_window_bytes || is_last_unit) && pending_truncate > 0;

        let flushed_bytes = if should_flush {
            let flushed = pending_truncate;
            pending_truncate = 0;
            current_level += flushed as i128;
            flushed
        } else {
            0
        };

        // 3. Snapshot step state.
        let free_space_after_step = if current_level < 0 {
            0
        } else {
            current_level as u64
        };

        steps.push(SpacePlanStep {
            unit_index: idx,
            unit_name: unit.name.clone(),
            extracted_bytes: unit.extracted_bytes,
            truncated_bytes: unit.truncated_bytes,
            batch_flush_occurred: should_flush,
            flushed_truncated_bytes: flushed_bytes,
            free_space_after_step,
        });
    }

    let trough_free_space = if min_level < 0 { 0 } else { min_level as u64 };
    let final_free_space = if current_level < 0 {
        0
    } else {
        current_level as u64
    };

    let is_viable = min_level >= (config.safety_headroom_bytes as i128);
    let required_additional_bytes = if is_viable {
        0
    } else {
        (config.safety_headroom_bytes as i128 - min_level) as u64
    };

    SpacePlanReport {
        initial_free_space,
        trough_free_space,
        final_free_space,
        total_extracted_bytes: total_extracted,
        total_truncated_bytes: total_truncated,
        is_viable,
        required_additional_bytes,
        steps,
    }
}

impl SpacePlanReport {
    /// Asserts that the simulated run did not breach the safety headroom.
    pub fn check_headroom(&self) -> FractalResult<()> {
        if self.is_viable {
            Ok(())
        } else {
            Err(FractalError::InsufficientDiskSpace {
                required_bytes: self.required_additional_bytes,
                trough_bytes: self.trough_free_space,
                initial_free_bytes: self.initial_free_space,
            })
        }
    }
}

/// Verifies whether the simulation meets safety headroom constraints.
///
/// Returns `Err(FractalError::InsufficientDiskSpace)` if the projected trough breaches headroom.
pub fn check_headroom(report: &SpacePlanReport) -> FractalResult<()> {
    report.check_headroom()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_units() {
        let config = SpacePlanConfig::new(50, 10);
        let report = simulate_space_plan(100, &[], &config);

        assert!(report.is_viable);
        assert_eq!(report.trough_free_space, 100);
        assert_eq!(report.final_free_space, 100);
        assert_eq!(report.required_additional_bytes, 0);
        assert!(check_headroom(&report).is_ok());
        assert!(report.check_headroom().is_ok());

        let unviable_report = simulate_space_plan(30, &[], &config);
        assert!(!unviable_report.is_viable);
        assert_eq!(unviable_report.required_additional_bytes, 20);
        assert!(check_headroom(&unviable_report).is_err());
        assert!(unviable_report.check_headroom().is_err());
    }

    #[test]
    fn test_single_unit_flush() {
        let config = SpacePlanConfig::new(20, 100);
        let units = vec![ExtractionUnit::new("file.bin", 50, 40, 0)];

        // Initial free space: 60.
        // Extraction consumes 50 -> level 10.
        // Final unit triggers flush of 40 -> level 50.
        // Min level is 10.
        // Safety headroom is 20, so 10 < 20 => not viable!
        let report = simulate_space_plan(60, &units, &config);
        assert!(!report.is_viable);
        assert_eq!(report.trough_free_space, 10);
        assert_eq!(report.final_free_space, 50);
        assert_eq!(report.required_additional_bytes, 10); // needs 20 - 10 = 10 more

        // With initial free space 70:
        // Level after extraction: 20 (equals headroom).
        // Level after flush: 60.
        // Min level is 20. Viable!
        let report2 = simulate_space_plan(70, &units, &config);
        assert!(report2.is_viable);
        assert_eq!(report2.trough_free_space, 20);
        assert_eq!(report2.final_free_space, 60);
        assert_eq!(report2.required_additional_bytes, 0);
        assert!(check_headroom(&report2).is_ok());
        assert!(report2.check_headroom().is_ok());
    }

    #[test]
    fn test_batch_window_coalescing() {
        // Headroom 10, batch window 30
        let config = SpacePlanConfig::new(10, 30);
        let units = vec![
            ExtractionUnit::new("chunk1", 20, 10, 0),
            ExtractionUnit::new("chunk2", 20, 15, 100),
            ExtractionUnit::new("chunk3", 20, 10, 200),
            ExtractionUnit::new("chunk4", 10, 5, 300),
        ];

        // Initial = 100.
        // Unit 1: extract 20 -> 80. Pending truncate: 10 (< 30). No flush. Free = 80.
        // Unit 2: extract 20 -> 60. Pending truncate: 25 (< 30). No flush. Free = 60.
        // Unit 3: extract 20 -> 40. Pending truncate: 35 (>= 30). FLUSH 35 -> 75! Free = 75.
        // Unit 4 (last): extract 10 -> 65. Pending truncate: 5. FLUSH 5 -> 70. Free = 70.
        let report = simulate_space_plan(100, &units, &config);
        assert!(report.is_viable);
        assert_eq!(report.steps.len(), 4);

        assert!(!report.steps[0].batch_flush_occurred);
        assert_eq!(report.steps[0].free_space_after_step, 80);

        assert!(!report.steps[1].batch_flush_occurred);
        assert_eq!(report.steps[1].free_space_after_step, 60);

        assert!(report.steps[2].batch_flush_occurred);
        assert_eq!(report.steps[2].flushed_truncated_bytes, 35);
        assert_eq!(report.steps[2].free_space_after_step, 75);

        assert!(report.steps[3].batch_flush_occurred);
        assert_eq!(report.steps[3].flushed_truncated_bytes, 5);
        assert_eq!(report.steps[3].free_space_after_step, 70);

        assert_eq!(report.trough_free_space, 40);
        assert_eq!(report.final_free_space, 70);
    }

    #[test]
    fn test_high_compression_ratio_expansion_fails() {
        // If an archive has a massive expansion ratio (e.g., zip bomb or 10x expansion):
        // 1MB compressed produces 10MB uncompressed, only 1MB freed.
        let config = SpacePlanConfig::new(20 * 1024 * 1024, 4 * 1024 * 1024);
        let units = vec![ExtractionUnit::new(
            "huge_expanded",
            100 * 1024 * 1024,
            10 * 1024 * 1024,
            0,
        )];

        // Initial free space 30MB.
        // Extraction needs 100MB, initial only 30MB.
        let report = simulate_space_plan(30 * 1024 * 1024, &units, &config);
        assert!(!report.is_viable);
        // Min level is 30 - 100 = -70 MB.
        // Required additional = 20 MB - (-70 MB) = 90 MB.
        assert_eq!(report.required_additional_bytes, 90 * 1024 * 1024);
        let err = check_headroom(&report).unwrap_err();
        match err {
            FractalError::InsufficientDiskSpace { required_bytes, .. } => {
                assert_eq!(required_bytes, 90 * 1024 * 1024);
            }
            _ => panic!("Expected InsufficientDiskSpace"),
        }
    }

    #[test]
    fn test_adaptive_batch_window() {
        assert_eq!(
            compute_adaptive_batch_window(10 * 1024 * 1024),
            8 * 1024 * 1024
        );
        assert_eq!(
            compute_adaptive_batch_window(500 * 1024 * 1024),
            16 * 1024 * 1024
        );
        assert_eq!(
            compute_adaptive_batch_window(2 * 1024 * 1024 * 1024),
            32 * 1024 * 1024
        );
        assert_eq!(
            compute_adaptive_batch_window(10 * 1024 * 1024 * 1024),
            64 * 1024 * 1024
        );
    }
}
