//! Module: fg-gate — Snapshot Path Exemptions & SSOT Rule Closure Bridge
//! File Path: crates/fg-gate/src/audit_engine/rule_registry/helpers.rs
//! Architecture Role: Classifies test/fixture exclusions consistently and constructs findings only
//!   when the rule identifier passes `is_registered` (`RCFG-RULE-DRIFT` closure).
//! Dependencies & Triggers: Uses `crate::commit_guard::rule_ids::is_registered`.
//! Responsibilities: Expose `SnapshotFileSlice`, path predicates, and validated finding builders.
//! Exit Semantics & Design Rationale: Fail-closed error rejects any unregistered synthetic rule ID.

use super::{AuditFinding, AuditSeverity};
use crate::commit_guard::rule_ids::is_registered;
use fg_core::error::{FractalError, FractalResult};

const TEST_PREFIX_MARKERS: &[&str] = &["tests/", "__tests__/", "benches/"];
const TEST_SLASH_MARKERS: &[&str] = &["/tests/", "/__tests__/", "/benches/"];
const TEST_FILE_MARKERS: &[&str] = &[".test.", ".spec."];

/// Returns `true` when `rel_path` belongs to test suites, benchmarks, or test specs.
#[must_use]
pub fn is_test_code_path(rel_path: &str) -> bool {
    let dir_match = TEST_PREFIX_MARKERS.iter().any(|m| rel_path.starts_with(m))
        || TEST_SLASH_MARKERS.iter().any(|m| rel_path.contains(m));
    let suffix_match = TEST_FILE_MARKERS.iter().any(|m| rel_path.contains(m));
    dir_match
        || suffix_match
        || rel_path.starts_with("tests.")
        || rel_path == "tests.rs"
        || rel_path.ends_with("/tests.rs")
}

/// Returns `true` when `rel_path` is a test, fixture, benchmark, or markdown specification path.
#[must_use]
pub fn is_test_or_fixture_path(rel_path: &str) -> bool {
    is_test_code_path(rel_path)
        || rel_path.starts_with("fixtures/")
        || rel_path.contains("/fixtures/")
        || rel_path.ends_with(".md")
}

/// Repository snapshot file slice presented to the pure-Rust audit engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotFileSlice<'a> {
    /// Repository-relative normalized path using forward slashes.
    pub rel_path: &'a str,
    /// Raw file bytes read directly from ODB blob or snapshot payload.
    pub content: &'a [u8],
}

/// Verifies `rule_id` against the SSOT catalog and constructs a validated [`AuditFinding`].
///
/// # Errors
///
/// Returns [`FractalError::PolicyViolation`] if `rule_id` is absent from registered SSOT catalogs.
pub fn build_registered_finding(
    rule_id: &str,
    analyzer: &str,
    severity: AuditSeverity,
    file: &str,
    line: usize,
    message: String,
) -> FractalResult<AuditFinding> {
    if !is_registered(rule_id) {
        return Err(FractalError::PolicyViolation(format!(
            "RCFG-RULE-DRIFT: attempt to emit unregistered rule ID '{rule_id}' for '{file}'"
        )));
    }
    Ok(AuditFinding {
        rule_id: String::from(rule_id),
        analyzer: String::from(analyzer),
        severity,
        file: String::from(file),
        line: line.max(1),
        message,
    })
}

/// Pushes a validated finding if `rule_id` is registered, returning any drift error.
///
/// # Errors
///
/// Propagates [`FractalError::PolicyViolation`] on unregistered rule identifiers.
pub fn record_finding(
    findings: &mut Vec<AuditFinding>,
    rule_id: &str,
    analyzer: &str,
    severity: AuditSeverity,
    file: &str,
    line: usize,
    message: String,
) -> FractalResult<()> {
    findings.push(build_registered_finding(
        rule_id, analyzer, severity, file, line, message,
    )?);
    Ok(())
}
