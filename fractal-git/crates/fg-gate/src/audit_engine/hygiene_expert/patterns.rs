//! Module: fg-gate — Physical Hygiene Pattern Matchers & Secret Guards
//! File Path: crates/fg-gate/src/audit_engine/hygiene_expert/patterns.rs
//! Architecture Role: Per-line static checks for merge conflicts, forbidden indentation, local path
//!   leaks, credential token patterns, and banned sprint markers inside comments.
//! Dependencies & Triggers: Called by `hygiene_expert::scan_lines_hygiene`.
//! Responsibilities: Group line scan arguments cleanly (`LineScanContext`) and avoid raw pattern
//!   literals that self-trigger `PATH-LEAK` or `SECRET-LEAK` scanners.
//! Exit Semantics & Design Rationale: Zero transient loop allocations; checks drive letters and
//!   prefix tokens deterministically.

use crate::audit_engine::rule_registry::{
    record_finding, AuditFinding, AuditSeverity, SourceLanguage,
};
use fg_core::error::FractalResult;

pub(crate) struct LineScanContext<'a> {
    pub(crate) rel_path: &'a str,
    pub(crate) line: &'a str,
    pub(crate) trimmed: &'a str,
    pub(crate) line_num: usize,
    pub(crate) language: SourceLanguage,
    pub(crate) skip_path_checks: bool,
}

pub(crate) fn is_pure_comment_line(trimmed: &str) -> bool {
    trimmed.starts_with("//")
        || trimmed.starts_with("/*")
        || trimmed.starts_with('*')
        || trimmed.starts_with('#')
}

pub(crate) fn inspect_single_line_patterns(
    ctx: &LineScanContext<'_>,
    findings: &mut Vec<AuditFinding>,
) -> FractalResult<()> {
    if is_conflict_marker(ctx.trimmed) {
        record_finding(
            findings,
            "FGT-GAT-001",
            "hygiene",
            AuditSeverity::Error,
            ctx.rel_path,
            ctx.line_num,
            String::from("Unresolved Git merge conflict marker detected"),
        )?;
    }
    if ctx.line.starts_with('\t') && ctx.language != SourceLanguage::Other {
        record_finding(
            findings,
            "HYG-IND-001",
            "hygiene",
            AuditSeverity::Warning,
            ctx.rel_path,
            ctx.line_num,
            String::from("Tab indentation forbidden (spaces only)"),
        )?;
    }
    if !ctx.skip_path_checks && contains_forbidden_absolute_path(ctx.trimmed) {
        record_finding(
            findings,
            "HC-ABS-PATH",
            "hygiene",
            AuditSeverity::Warning,
            ctx.rel_path,
            ctx.line_num,
            String::from("Hardcoded drive letter or absolute local filesystem path detected"),
        )?;
    }
    if !ctx.skip_path_checks && contains_credential_leak(ctx.trimmed) {
        record_finding(
            findings,
            "HC-SECRET",
            "secrets",
            AuditSeverity::Error,
            ctx.rel_path,
            ctx.line_num,
            String::from("Potential hardcoded secret, API token, or private key literal detected"),
        )?;
    }
    if !ctx.skip_path_checks && is_pure_comment_line(ctx.trimmed) && contains_banned_marker(ctx.trimmed) {
        record_finding(
            findings,
            "CMT-TRM-001",
            "comments",
            AuditSeverity::Warning,
            ctx.rel_path,
            ctx.line_num,
            String::from("Banned placeholder or unfinished sprint marker inside comment"),
        )?;
    }
    Ok(())
}

fn is_conflict_marker(trimmed: &str) -> bool {
    trimmed.starts_with("<<<<<<<") || trimmed == "=======" || trimmed.starts_with(">>>>>>>")
}

fn contains_forbidden_absolute_path(trimmed: &str) -> bool {
    let file_uri = concat!("file", ":///");
    let users_prefix = concat!("/Us", "ers/");
    if trimmed.contains(file_uri) || trimmed.contains(users_prefix) {
        return true;
    }
    let bytes = trimmed.as_bytes();
    bytes.windows(3).any(|win| {
        win[0].is_ascii_alphabetic() && win[1] == b':' && (win[2] == b'\\' || win[2] == b'/')
    })
}

fn contains_credential_leak(trimmed: &str) -> bool {
    if is_pure_comment_line(trimmed) {
        return false;
    }
    let priv_hdr = concat!("-----BEG", "IN ");
    let priv_ftr = concat!("PRIVATE KE", "Y-----");
    if trimmed.contains(priv_hdr) && trimmed.contains(priv_ftr) {
        return true;
    }
    let prefixes = [
        concat!("ghp", "_"),
        concat!("gho", "_"),
        concat!("sk_", "live_"),
        concat!("AK", "IA"),
    ];
    prefixes.iter().any(|marker| {
        trimmed.find(marker).is_some_and(|pos| {
            let tail = &trimmed[pos + marker.len()..];
            tail.len() >= 12 && tail.chars().take(12).all(|ch| ch.is_ascii_alphanumeric())
        })
    })
}

fn contains_banned_marker(trimmed: &str) -> bool {
    const TOKENS: [&str; 4] = [
        concat!("TO", "DO"),
        concat!("FIX", "ME"),
        concat!("HA", "CK"),
        concat!("XX", "X"),
    ];
    let raw = trimmed.as_bytes();
    TOKENS.iter().any(|token| {
        trimmed.find(token).is_some_and(|pos| {
            let before_ok = pos == 0 || (!raw[pos - 1].is_ascii_alphanumeric() && raw[pos - 1] != b'_');
            let end = pos + token.len();
            let after_ok = end >= raw.len() || (!raw[end].is_ascii_alphanumeric() && raw[end] != b'_');
            before_ok && after_ok
        })
    })
}
