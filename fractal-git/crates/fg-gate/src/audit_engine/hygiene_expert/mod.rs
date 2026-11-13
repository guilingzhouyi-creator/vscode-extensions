//! Module: fg-gate — Cross-Language Physical Hygiene, Secret & Volume Expert
//! File Path: crates/fg-gate/src/audit_engine/hygiene_expert/mod.rs
//! Architecture Role: Pure-Rust static evaluator enforcing UTF-8 / BOM / EOL / indentation
//!   hygiene, conflict marker guards, local path bans, secret leakage, and ELOC/LOC budgets.
//! Dependencies & Triggers: Uses `auto_refactor_engine::ops_math::compute_shannon_entropy` and
//!   `crate::audit_engine::rule_registry`.
//! Responsibilities: Produce SSOT-verified hygiene/volume/secret findings and basic line counts.
//! Exit Semantics & Design Rationale: Zero filesystem access, zero transient loop allocations.

mod patterns;
#[cfg(test)]
mod unit_tests;

use crate::audit_engine::rule_registry::{
    is_test_or_fixture_path, record_finding, AuditFinding, AuditSeverity, SnapshotFileSlice,
    SourceLanguage,
};
use auto_refactor_engine::ops_math::compute_shannon_entropy;
use fg_core::error::FractalResult;
use patterns::{inspect_single_line_patterns, is_pure_comment_line, LineScanContext};

/// Summary counts derived during single-pass byte & line scanning.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HygieneMeasurement {
    /// Physical line count.
    pub lines: usize,
    /// Non-blank line count.
    pub non_blank_lines: usize,
    /// Approximate semantic code lines excluding pure blank/comment lines.
    pub eloc: usize,
    /// Shannon entropy H(X) over non-whitespace UTF-8 content.
    pub shannon_entropy: f64,
    /// Validated UTF-8 check flag.
    pub valid_utf8: bool,
}

/// Evaluates UTF-8, BOM, conflict markers, EOL, tabs, paths, secrets, placeholders, and volume.
///
/// # Errors
///
/// Propagates [`fg_core::error::FractalError::PolicyViolation`] if a rule ID fails registry closure.
pub fn inspect_file_hygiene(
    slice: &SnapshotFileSlice<'_>,
    language: SourceLanguage,
    findings: &mut Vec<AuditFinding>,
) -> FractalResult<HygieneMeasurement> {
    if slice.content.is_empty() {
        record_finding(
            findings, "HYG-EMP-001", "hygiene", AuditSeverity::Error, slice.rel_path, 1,
            String::from("Empty file violates zero-empty-file physical hygiene contract"),
        )?;
        return Ok(HygieneMeasurement {
            lines: 0, non_blank_lines: 0, eloc: 0, shannon_entropy: 0.0, valid_utf8: true,
        });
    }
    if slice.content.starts_with(&[0xEF, 0xBB, 0xBF]) {
        record_finding(
            findings, "HYG-BOM-001", "hygiene", AuditSeverity::Error, slice.rel_path, 1,
            String::from("UTF-8 BOM header is forbidden across workspace source files"),
        )?;
    }
    let Ok(text) = std::str::from_utf8(slice.content) else {
        record_finding(
            findings, "HYG-BOM-001", "hygiene", AuditSeverity::Error, slice.rel_path, 1,
            String::from("Non-UTF8 binary or corrupted encoding detected in source slice"),
        )?;
        return Ok(HygieneMeasurement {
            lines: 0, non_blank_lines: 0, eloc: 0, shannon_entropy: 0.0, valid_utf8: false,
        });
    };
    if text.trim().is_empty() {
        record_finding(
            findings, "HYG-EMP-001", "hygiene", AuditSeverity::Error, slice.rel_path, 1,
            String::from("Whitespace-only file violates HYG-EMP-001"),
        )?;
    }
    check_eol_and_trailing_newline(slice.rel_path, text, findings)?;
    let (lines, non_blank_lines, eloc) = scan_lines_hygiene(slice.rel_path, text, language, findings)?;
    let shannon_entropy = compute_shannon_entropy(text);
    check_volume_budgets(slice.rel_path, lines, eloc, findings)?;
    Ok(HygieneMeasurement { lines, non_blank_lines, eloc, shannon_entropy, valid_utf8: true })
}

fn check_volume_budgets(
    rel_path: &str,
    lines: usize,
    eloc: usize,
    findings: &mut Vec<AuditFinding>,
) -> FractalResult<()> {
    if is_test_or_fixture_path(rel_path) {
        return Ok(());
    }
    if lines > 1400 {
        record_finding(
            findings, "VOL-LOC-001", "large-file", AuditSeverity::Warning, rel_path, 1,
            format!("Physical line count {lines} exceeds 1400-line budget"),
        )?;
    }
    if eloc > 900 {
        record_finding(
            findings, "VOL-ELOC-001", "large-file", AuditSeverity::Warning, rel_path, 1,
            format!("Effective semantic LOC {eloc} exceeds 900-line budget"),
        )?;
    }
    Ok(())
}

fn check_eol_and_trailing_newline(
    rel_path: &str,
    text: &str,
    findings: &mut Vec<AuditFinding>,
) -> FractalResult<()> {
    let is_ps1 = rel_path.ends_with(".ps1") || rel_path.ends_with(".psm1") || rel_path.ends_with(".psd1");
    let has_crlf = text.contains("\r\n");
    if is_ps1 && text.contains('\n') && !has_crlf {
        record_finding(
            findings, "HYG-EOL-001", "hygiene", AuditSeverity::Warning, rel_path, 1,
            String::from("PowerShell script should use CRLF line endings"),
        )?;
    } else if !is_ps1 && has_crlf {
        record_finding(
            findings, "HYG-EOL-001", "hygiene", AuditSeverity::Warning, rel_path, 1,
            String::from("CRLF line endings detected outside PowerShell scripts (expected LF)"),
        )?;
    }
    if !text.ends_with('\n') || text.ends_with("\n\n") || text.ends_with("\r\n\r\n") {
        record_finding(
            findings, "HYG-EOL-001", "hygiene", AuditSeverity::Info, rel_path, 1,
            String::from("File must end with a single trailing newline"),
        )?;
    }
    Ok(())
}

fn scan_lines_hygiene(
    rel_path: &str,
    text: &str,
    language: SourceLanguage,
    findings: &mut Vec<AuditFinding>,
) -> FractalResult<(usize, usize, usize)> {
    let skip_path_checks = is_test_or_fixture_path(rel_path);
    let (mut total_lines, mut non_blank, mut eloc) = (0usize, 0usize, 0usize);
    for (line_num, raw_line) in (1usize..).zip(text.split('\n')) {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if line_num == 1 || !line.is_empty() || !text.ends_with('\n') {
            total_lines += 1;
        }
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            non_blank += 1;
            if !is_pure_comment_line(trimmed) {
                eloc += 1;
            }
        }
        let ctx = LineScanContext { rel_path, line, trimmed, line_num, language, skip_path_checks };
        inspect_single_line_patterns(&ctx, findings)?;
    }
    Ok((total_lines.max(1), non_blank, eloc))
}
