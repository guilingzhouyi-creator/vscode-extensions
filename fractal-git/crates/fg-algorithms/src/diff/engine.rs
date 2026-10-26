//! Module: fg-algorithms::diff::engine — Multi-Modal Adaptive Diff Engine
//! File Path: crates/fg-algorithms/src/diff/engine.rs
//! Architecture Role: Coordinates tiered diff algorithms (64-bit Bit-Parallel, Imara Histogram,
//!   and Git xdiff Myers) based on input size, language characteristics, and explicit user flags.
//! Dependencies & Triggers: Consumed by PatchGenerator, taxis diff, and CLI porcelain.
//! Responsibilities: Selects optimal diff algorithm, executes alignment, and returns uniform
//!   (old_changed, new_changed) vectors or UnifiedPatch.
//! Exit Semantics & Design Rationale:
//!   - Adaptive routing: <= 64 lines defaults to register-level bit-parallel Myers (zero heap alloc).
//!   - General files default to Imara Histogram diff, avoiding pathological O(ND) Myers behavior
//!     and semantic mismatches on closing delimiters.
//!   - Explicit Myers fallback preserves byte-for-byte Git xdiff compatibility when required.
//!
//! Domain Governance Rules: FGT-ALG-001 (diff engine), FGT-COR-001, FGT-PRF-001.

use imara_diff::{Algorithm, Diff, InternedInput};

use crate::diff::bit_parallel::{bit_parallel_diff, BIT_PARALLEL_MAX_LINES};
use crate::diff::compact::{Compaction, Side};
use crate::diff::patch::{
    split_lines, trim_common_tail, PatchGenerator, UnifiedPatchRef,
};
use crate::diff::xdiff::mark_changed;
use crate::diff::xdiff_prepare::prepare;

/// Strategy to select the diff algorithm.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DiffAlgorithm {
    /// Adaptive routing based on input size and characteristics.
    /// Uses Bit-Parallel for <= 64 lines, Histogram for larger inputs.
    #[default]
    Auto,
    /// Fast 64-bit register-level bit-parallel Myers (requires <= 64 lines).
    BitParallel,
    /// Imara Histogram diff (patience-style, semantic block alignment).
    Histogram,
    /// Traditional Myers O(ND) algorithm matching Git's xdiff.
    Myers,
}

/// Diff engine facade providing unified text comparison.
#[derive(Debug, Clone, Copy, Default)]
pub struct DiffEngine {
    algorithm: DiffAlgorithm,
}

impl DiffEngine {
    /// Creates a new diff engine with the default adaptive algorithm.
    pub fn new() -> Self {
        Self {
            algorithm: DiffAlgorithm::Auto,
        }
    }

    /// Creates a diff engine configured with a specific algorithm.
    pub fn with_algorithm(algorithm: DiffAlgorithm) -> Self {
        Self { algorithm }
    }

    /// Computes the change masks `(old_changed, new_changed)` for two texts.
    pub fn compute_change_flags(
        &self,
        old_text: &str,
        new_text: &str,
    ) -> (Vec<bool>, Vec<bool>) {
        if old_text == new_text {
            let old_count = split_lines(old_text).len();
            let new_count = split_lines(new_text).len();
            return (vec![false; old_count], vec![false; new_count]);
        }

        let old_lines = split_lines(old_text);
        let new_lines = split_lines(new_text);

        let selected_algorithm = match self.algorithm {
            DiffAlgorithm::Auto => {
                if old_lines.len() <= BIT_PARALLEL_MAX_LINES
                    && new_lines.len() <= BIT_PARALLEL_MAX_LINES
                {
                    DiffAlgorithm::BitParallel
                } else {
                    DiffAlgorithm::Histogram
                }
            }
            other => other,
        };

        match selected_algorithm {
            DiffAlgorithm::BitParallel => {
                if old_lines.len() <= BIT_PARALLEL_MAX_LINES
                    && new_lines.len() <= BIT_PARALLEL_MAX_LINES
                {
                    let old_records: Vec<&[u8]> = old_text
                        .split_inclusive('\n')
                        .map(str::as_bytes)
                        .collect();
                    let new_records: Vec<&[u8]> = new_text
                        .split_inclusive('\n')
                        .map(str::as_bytes)
                        .collect();
                    let (prepared_old, prepared_new) = prepare(&old_records, &new_records);
                    let (mut old_changed, mut new_changed) =
                        bit_parallel_diff(&prepared_old.classes, &prepared_new.classes);
                    Compaction::new(
                        Side {
                            hashes: &prepared_old.classes,
                            texts: &old_lines,
                        },
                        Side {
                            hashes: &prepared_new.classes,
                            texts: &new_lines,
                        },
                    )
                    .run(&mut old_changed, &mut new_changed);
                    (old_changed, new_changed)
                } else {
                    // Fall back to Histogram if lines exceeded 64
                    self.compute_imara_flags(old_text, new_text, Algorithm::Histogram)
                }
            }
            DiffAlgorithm::Histogram => {
                self.compute_imara_flags(old_text, new_text, Algorithm::Histogram)
            }
            DiffAlgorithm::Myers => {
                let old_records: Vec<&[u8]> = old_text
                    .split_inclusive('\n')
                    .map(str::as_bytes)
                    .collect();
                let new_records: Vec<&[u8]> = new_text
                    .split_inclusive('\n')
                    .map(str::as_bytes)
                    .collect();
                let (prepared_old, prepared_new) = prepare(&old_records, &new_records);
                let (mut old_changed, mut new_changed) =
                    mark_changed(&prepared_old, &prepared_new);
                Compaction::new(
                    Side {
                        hashes: &prepared_old.classes,
                        texts: &old_lines,
                    },
                    Side {
                        hashes: &prepared_new.classes,
                        texts: &new_lines,
                    },
                )
                .run(&mut old_changed, &mut new_changed);
                (old_changed, new_changed)
            }
            DiffAlgorithm::Auto => unreachable!(),
        }
    }

    fn compute_imara_flags(
        &self,
        old_text: &str,
        new_text: &str,
        algorithm: Algorithm,
    ) -> (Vec<bool>, Vec<bool>) {
        let input = InternedInput::new(old_text, new_text);
        let mut diff_result = Diff::compute(algorithm, &input);
        diff_result.postprocess_lines(&input);

        let old_changed: Vec<bool> = (0..input.before.len())
            .map(|line_idx_before| diff_result.is_removed(line_idx_before as u32))
            .collect();
        let new_changed: Vec<bool> = (0..input.after.len())
            .map(|line_idx_after| diff_result.is_added(line_idx_after as u32))
            .collect();

        (old_changed, new_changed)
    }

    /// Generates a UnifiedPatch using the configured diff algorithm.
    pub fn generate_patch<'a>(
        &self,
        file_path: &'a str,
        old_text: &'a str,
        new_text: &'a str,
        hunk_context: usize,
    ) -> UnifiedPatchRef<'a> {
        if old_text == new_text {
            return UnifiedPatchRef {
                file_path,
                hunks: Vec::new(),
            };
        }

        let (effective_old, effective_new) = if hunk_context == 0 {
            trim_common_tail(old_text, new_text)
        } else {
            (old_text, new_text)
        };

        let (old_changed, new_changed) = self.compute_change_flags(effective_old, effective_new);
        let old_lines = split_lines(effective_old);
        let new_lines = split_lines(effective_new);

        PatchGenerator::build_unified_patch_from_flags(
            file_path,
            &old_lines,
            &new_lines,
            &old_changed,
            &new_changed,
            hunk_context,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_engine_auto_routing() {
        let engine = DiffEngine::new();
        let old = "fn main() {\n    println!(\"hello\");\n}\n";
        let new = "fn main() {\n    println!(\"world\");\n}\n";
        let patch = engine.generate_patch("main.rs", old, new, 3);
        assert_eq!(patch.hunks.len(), 1);
        assert_eq!(patch.file_path, "main.rs");
    }

    #[test]
    fn test_diff_engine_histogram_vs_myers() {
        let old = r#"
fn calculate() -> i32 {
    let mut sum = 0;
    for i in 0..10 {
        sum += i;
    }
    sum
}

fn display() {
    println!("ready");
}
"#;
        let new = r#"
fn calculate() -> i32 {
    let mut sum = 0;
    for i in 0..10 {
        sum += i * 2;
    }
    sum
}

fn helper() {
    println!("helper");
}

fn display() {
    println!("ready");
}
"#;

        let histo_engine = DiffEngine::with_algorithm(DiffAlgorithm::Histogram);
        let myers_engine = DiffEngine::with_algorithm(DiffAlgorithm::Myers);

        let histo_patch = histo_engine.generate_patch("test.rs", old, new, 3);
        let myers_patch = myers_engine.generate_patch("test.rs", old, new, 3);

        assert!(!histo_patch.hunks.is_empty());
        assert!(!myers_patch.hunks.is_empty());
    }

    #[test]
    fn test_diff_engine_identical_and_empty() {
        let engine = DiffEngine::new();
        let patch = engine.generate_patch("empty.txt", "", "", 3);
        assert!(patch.hunks.is_empty());

        let same = "line1\nline2\n";
        let patch_same = engine.generate_patch("same.txt", same, same, 3);
        assert!(patch_same.hunks.is_empty());
    }
}
