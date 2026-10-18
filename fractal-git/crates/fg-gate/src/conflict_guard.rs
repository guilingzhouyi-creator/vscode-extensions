//! Module: fg-gate — Fast Conflict & Hygiene Guard
//! File Path: crates/fg-gate/src/conflict_guard.rs
//! Architecture Role: Microsecond-latency content hygiene and conflict marker scanning
//!   prior to loose object creation, preventing corrupt or conflicted files from entering Git ODB.

use fg_core::error::{FractalError, FractalResult};
use fg_core::traits::{GateVerdict, GateVerifier, StagedCandidate};

pub struct ConflictGuard;

impl ConflictGuard {
    /// Scans a byte slice for unresolved Git conflict markers and empty file violations.
    pub fn assert_clean_content(file_path: &str, content: &[u8]) -> FractalResult<()> {
        if content.is_empty() {
            return Err(FractalError::GateRejection {
                score: 0.0,
                violations: vec![format!("HYG-EMP-001: Zero-byte empty file at {}", file_path)],
            });
        }

        // Fast text search for conflict markers if content is valid UTF-8
        if let Ok(text) = std::str::from_utf8(content) {
            if text.trim().is_empty() {
                return Err(FractalError::GateRejection {
                    score: 0.0,
                    violations: vec![format!("HYG-EMP-002: Pure-whitespace empty file at {}", file_path)],
                });
            }

            if text.contains("<<<<<<<") || text.contains("=======") || text.contains(">>>>>>>") {
                return Err(FractalError::GateRejection {
                    score: 20.0,
                    violations: vec![format!(
                        "L3-CONFLICT: Unresolved Git conflict marker detected in {}",
                        file_path
                    )],
                });
            }
        }

        Ok(())
    }
}

impl GateVerifier for ConflictGuard {
    fn verify_candidates(&self, candidates: &[StagedCandidate]) -> FractalResult<GateVerdict> {
        let mut violations = Vec::new();

        for candidate in candidates {
            if let Err(e) = Self::assert_clean_content(&candidate.path, &candidate.payload) {
                if let FractalError::GateRejection { violations: v, .. } = e {
                    violations.extend(v);
                } else {
                    violations.push(format!("{}: {}", candidate.path, e));
                }
            }
        }

        let passed = violations.is_empty();
        let score = if passed { 100.0 } else { 0.0 };

        Ok(GateVerdict {
            passed,
            score,
            violations,
        })
    }
}
