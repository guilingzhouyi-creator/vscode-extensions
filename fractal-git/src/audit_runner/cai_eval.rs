//! Module: Fractal Git — CAI Inputs, Manifest SM3 Digest & Debt Yields
//! File Path: src/audit_runner/cai_eval.rs
//! Architecture Role: Computes CAI 2.0 inputs, anti-gaming pattern penalties, ADR-Q yield pairs,
//!   severity counts, and canonical manifest digests for snapshot slices.
//! Dependencies & Triggers: Consumed by `audit_runner::eval`.
//! Responsibilities: Preserve deterministic SHA1/SM3 manifest hashing and zero-panic counts.
//! Exit Semantics & Design Rationale: Keeps `eval.rs` short and focused on orchestration.

use std::collections::BTreeSet;

use fg_algorithms::scoring::CaiInputs;
use fg_core::crypto::sm3_hash;
use fg_gate::audit_engine::{
    is_test_code_path, AuditFinding, AuditSeverity, SnapshotAuditBundle, SnapshotFileSlice,
};
use sha1::{Digest as Sha1Digest, Sha1};

use super::hex_codec;

pub(super) fn compute_adrq_yield_pair(
    has_prev_sqale: bool,
    net_debt_eliminated: f64,
) -> (Option<f64>, Option<f64>) {
    if !has_prev_sqale {
        return (None, None);
    }
    if net_debt_eliminated >= 0.0 {
        (Some(net_debt_eliminated), Some(0.0))
    } else {
        (Some(0.0), Some(-net_debt_eliminated))
    }
}

pub(super) fn compute_pattern_penalty(findings: &[AuditFinding]) -> f64 {
    findings
        .iter()
        .filter(|finding| finding.rule_id == "GOV-GAM-001" || finding.rule_id == "ARCH-ABS-001")
        .map(|finding| {
            if finding.rule_id == "GOV-GAM-001" {
                20.0
            } else {
                5.0
            }
        })
        .sum()
}

pub(super) fn build_cai_inputs(
    bundle: &SnapshotAuditBundle,
    findings: &[AuditFinding],
    total_eloc: usize,
) -> CaiInputs {
    let mut internal_calls = 0usize;
    let mut external_calls = 0usize;
    let mut domain_eloc = 0usize;
    let mut crit_int = 0usize;
    let mut crit_ext = 0usize;
    let mut unique_pkgs = BTreeSet::new();

    for outcome in &bundle.file_outcomes {
        internal_calls += outcome.internal_imports.len();
        external_calls += outcome.external_packages.len();
        for pkg in &outcome.external_packages {
            unique_pkgs.insert(pkg.as_str());
        }
        let lower = outcome.file.as_str();
        if !is_test_code_path(lower) {
            domain_eloc += outcome.eloc;
        }
        if lower.contains("auth")
            || lower.contains("crypto")
            || lower.contains("security")
            || lower.contains("gate")
        {
            crit_int += outcome.internal_imports.len();
            crit_ext += outcome.external_packages.len();
        }
    }
    let clone_findings = findings
        .iter()
        .filter(|finding| finding.rule_id == "HYG-CLN-001")
        .count();

    CaiInputs {
        proprietary_eloc: total_eloc,
        vendor_eloc: 0,
        generated_eloc: 0,
        domain_kernel_eloc: domain_eloc,
        internal_calls,
        external_calls,
        external_packages: unique_pkgs.len(),
        critical_internal_calls: crit_int,
        critical_external_calls: crit_ext,
        clone_findings,
        dependency_count: unique_pkgs.len(),
    }
}

pub(super) fn compute_manifest_sm3_hex(slices: &[SnapshotFileSlice<'_>]) -> String {
    let mut entries: Vec<(&str, String)> = Vec::with_capacity(slices.len());
    for slice in slices {
        let mut sha = Sha1::new();
        sha.update(format!("blob {}\0", slice.content.len()).as_bytes());
        sha.update(slice.content);
        entries.push((slice.rel_path, hex_codec::encode(sha.finalize())));
    }
    entries.sort_by(|left, right| left.0.cmp(right.0));
    let mut buf = String::with_capacity(entries.len() * 64);
    for (rel, oid_hex) in entries {
        buf.push_str(rel);
        buf.push(':');
        buf.push_str(&oid_hex);
        buf.push('\n');
    }
    hex_sm3(buf.as_bytes())
}

pub(super) fn hex_sm3(bytes: &[u8]) -> String {
    hex_codec::encode(sm3_hash(bytes))
}

pub(super) fn count_severities(findings: &[AuditFinding]) -> (usize, usize, usize) {
    let mut errors = 0usize;
    let mut warnings = 0usize;
    let mut infos = 0usize;
    for finding in findings {
        match finding.severity {
            AuditSeverity::Error => errors += 1,
            AuditSeverity::Warning => warnings += 1,
            AuditSeverity::Info => infos += 1,
        }
    }
    (errors, warnings, infos)
}
