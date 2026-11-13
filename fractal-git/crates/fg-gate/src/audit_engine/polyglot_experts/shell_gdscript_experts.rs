//! Module: fg-gate — Shell & GDScript Snapshot Experts
//! File Path: crates/fg-gate/src/audit_engine/polyglot_experts/shell_gdscript_experts.rs
//! Architecture Role: Pure-Rust analyzers for PowerShell/Bash headers/destructive ops and
//!   GDScript typing and frame-loop allocation hygiene.
//! Dependencies & Triggers: Emits `PS-ERROR-001`, `SH-INIT-001`, `GUARD-DESTR-001`,
//!   `ADV-TYP-001`, and `ADV-PRF-002`.
//! Responsibilities: Enforce workspace shell and WebGames GDScript contracts deterministically.
//! Exit Semantics & Design Rationale: Preserves exact parity without invoking shells or Godot.

use fg_core::error::FractalResult;

use crate::audit_engine::rule_registry::{record_finding, AuditSeverity};

use super::{empty_polyglot_analysis, PolyglotAstAnalysis};

pub(super) fn analyze_shell_slice(
    rel_path: &str,
    source: &str,
) -> FractalResult<PolyglotAstAnalysis> {
    let mut analysis = empty_polyglot_analysis();
    let is_ps1 = rel_path.ends_with(".ps1") || rel_path.ends_with(".psm1");
    if is_ps1 && !source.contains("ErrorActionPreference") {
        record_finding(
            &mut analysis.findings,
            "PS-ERROR-001",
            "shell-safety",
            AuditSeverity::Warning,
            rel_path,
            1,
            String::from("PowerShell script missing $ErrorActionPreference = 'Stop'"),
        )?;
    }
    if rel_path.ends_with(".sh") && !source.contains("set -euo pipefail") {
        record_finding(
            &mut analysis.findings,
            "SH-INIT-001",
            "shell-lint",
            AuditSeverity::Warning,
            rel_path,
            1,
            String::from("POSIX/Bash script missing strict `set -euo pipefail` header"),
        )?;
    }
    for (line_num, raw_line) in (1usize..).zip(source.split('\n')) {
        let trimmed = raw_line.trim();
        if !trimmed.starts_with('#')
            && (trimmed.contains("rm -rf /")
                || (trimmed.contains("Remove-Item")
                    && trimmed.contains("-Recurse")
                    && !trimmed.contains("Test-Path")))
        {
            emit_destructive_finding(rel_path, line_num, &mut analysis)?;
        }
    }
    Ok(analysis)
}

fn emit_destructive_finding(
    rel_path: &str,
    line_num: usize,
    analysis: &mut PolyglotAstAnalysis,
) -> FractalResult<()> {
    record_finding(
        &mut analysis.findings,
        "GUARD-DESTR-001",
        "security",
        AuditSeverity::Error,
        rel_path,
        line_num,
        String::from("Unbounded recursive delete detected"),
    )
}

pub(super) fn analyze_gdscript_slice(
    rel_path: &str,
    source: &str,
) -> FractalResult<PolyglotAstAnalysis> {
    let mut analysis = empty_polyglot_analysis();
    let mut in_frame_callback = false;
    for (line_num, raw_line) in (1usize..).zip(source.split('\n')) {
        let trimmed = raw_line.trim();
        inspect_gdscript_line(
            rel_path,
            trimmed,
            line_num,
            &mut in_frame_callback,
            &mut analysis,
        )?;
    }
    Ok(analysis)
}

fn inspect_gdscript_line(
    rel_path: &str,
    trimmed: &str,
    line_num: usize,
    in_frame_callback: &mut bool,
    analysis: &mut PolyglotAstAnalysis,
) -> FractalResult<()> {
    if trimmed.starts_with("func ") {
        analysis.exported_symbols += 1;
        *in_frame_callback =
            trimmed.starts_with("func _process(") || trimmed.starts_with("func _physics_process(");
        if !trimmed.contains("->") {
            record_finding(
                &mut analysis.findings,
                "ADV-TYP-001",
                "gdscript-modern",
                AuditSeverity::Warning,
                rel_path,
                line_num,
                String::from("GDScript function missing explicit return type annotation"),
            )?;
        }
    } else if *in_frame_callback
        && !trimmed.starts_with('#')
        && (trimmed.contains(".new(") || trimmed.contains("preload("))
    {
        record_finding(
            &mut analysis.findings,
            "ADV-PRF-002",
            "gdscript-game",
            AuditSeverity::Error,
            rel_path,
            line_num,
            String::from("Dynamic allocation inside per-frame _process/_physics_process loop"),
        )?;
    }
    Ok(())
}
