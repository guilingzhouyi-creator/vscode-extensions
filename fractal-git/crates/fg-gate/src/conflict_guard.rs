//! Module: fg-gate — Fast Conflict & Hygiene Guard
//! File Path: crates/fg-gate/src/conflict_guard.rs
//! Architecture Role: Microsecond-latency content hygiene and conflict marker scanning
//!   prior to loose object creation, preventing corrupt or conflicted files from entering Git ODB.
//! Dependencies & Triggers: Consumed by PreReceiveGuard, staged file materializers, and CLI hooks.
//! Responsibilities: Intercept empty files (HYG-EMP-001) and raw Git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
//! Exit Semantics & Design Rationale: Fails immediately upon first marker detection, preventing dirty commits.
//!
//! Domain Governance Rules: FGT-GAT-001 (hygiene gating), FGT-COR-001, HYG-EMP-001.

use fg_core::error::{FractalError, FractalResult};
use fg_core::traits::{GateVerdict, GateVerifier, StagedCandidate};

/// Content hygiene and conflict marker scanning guard for staged candidate files.
pub struct ConflictGuard;

impl ConflictGuard {
    /// Scans a byte slice for unresolved Git conflict markers and empty file violations.
    pub fn assert_clean_content(file_path: &str, content: &[u8]) -> FractalResult<()> {
        if content.is_empty() {
            return Err(FractalError::GateRejection {
                score: 0.0,
                violations: vec![format!(
                    "HYG-EMP-001: Zero-byte empty file at {}",
                    file_path
                )],
            });
        }

        // Fast text search for conflict markers if content is valid UTF-8
        if let Ok(text) = std::str::from_utf8(content) {
            if text.trim().is_empty() {
                return Err(FractalError::GateRejection {
                    score: 0.0,
                    violations: vec![format!(
                        "HYG-EMP-002: Pure-whitespace empty file at {}",
                        file_path
                    )],
                });
            }

            if has_conflict_marker_line(text) {
                return Err(FractalError::GateRejection {
                    score: 20.0,
                    violations: vec![format!(
                        "{}: {} in {}",
                        fg_core::constants::rules::RULE_FGT_GAT_001,
                        fg_core::constants::errors::MSG_UNRESOLVED_CONFLICT_MARKER,
                        file_path
                    )],
                });
            }
        }

        Ok(())
    }
}

/// Checks whether any line in `text` starts with a standard Git 2-way or diff3 conflict marker.
///
/// Anchoring at line start and requiring an exact 7-character `=======` divider prevents false
/// positives on ASCII section banners (`// ==========`) or string literals mentioning markers.
fn has_conflict_marker_line(text: &str) -> bool {
    text.split('\n').any(|raw_line| {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        line == "<<<<<<<"
            || line.starts_with("<<<<<<< ")
            || line == "|||||||"
            || line.starts_with("||||||| ")
            || line == "======="
            || line == ">>>>>>>"
            || line.starts_with(">>>>>>> ")
    })
}

impl GateVerifier for ConflictGuard {
    fn verify_candidates(&self, candidates: &[StagedCandidate]) -> FractalResult<GateVerdict> {
        let mut violations = Vec::new();

        for candidate in candidates {
            if let Err(gate_err) = Self::assert_clean_content(&candidate.path, &candidate.payload) {
                if let FractalError::GateRejection {
                    violations: err_violations,
                    ..
                } = gate_err
                {
                    violations.extend(err_violations);
                } else {
                    violations.push(format!("{}: {}", candidate.path, gate_err));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_conflict_guard_rejects_git_conflict_markers() {
        let conflicted = format!(
            "fn main() {{\n{} HEAD\n    let x = 1;\n=======\n    let x = 2;\n{} feature\n}}\n",
            "<<<<<<<", ">>>>>>>"
        );
        assert!(ConflictGuard::assert_clean_content("src/main.rs", conflicted.as_bytes()).is_err());
    }

    #[test]
    fn test_conflict_guard_allows_ascii_section_banners_and_comments() {
        let clean = "// ============================================================\n\
                     // ======= Section Header =======\n\
                     fn main() {\n    println!(\"ok\");\n}\n";
        assert!(ConflictGuard::assert_clean_content("src/main.rs", clean.as_bytes()).is_ok());
    }
}
