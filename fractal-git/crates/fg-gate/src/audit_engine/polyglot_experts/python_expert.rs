//! Module: fg-gate — Python Slice Security & Hygiene Expert
//! File Path: crates/fg-gate/src/audit_engine/polyglot_experts/python_expert.rs
//! Architecture Role: Pure-Rust line scanner enforcing Python safety and file-encoding rules.
//! Dependencies & Triggers: Emits `SEC-VUL-001`, `ERR-FLT-001`, and `PYM-OPEN-001`.
//! Responsibilities: Track `def` export counts, indentation nesting, and unsafe calls.
//! Exit Semantics & Design Rationale: Avoids requiring a Python interpreter inside sandboxed gates.

use fg_core::error::FractalResult;

use crate::audit_engine::rule_registry::{record_finding, AuditSeverity};

use super::{empty_polyglot_analysis, PolyglotAstAnalysis};

const DYNAMIC_EVAL_CALL: &str = concat!("ev", "al(");
const DYNAMIC_EXEC_CALL: &str = concat!("ex", "ec(");

pub(super) fn analyze_python_slice(
    rel_path: &str,
    source: &str,
) -> FractalResult<PolyglotAstAnalysis> {
    let mut analysis = empty_polyglot_analysis();
    for (line_num, raw_line) in (1usize..).zip(source.split('\n')) {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        let trimmed = line.trim();
        if trimmed.starts_with("def ") {
            analysis.exported_symbols += 1;
        }
        let indent_depth = line
            .len()
            .saturating_sub(line.trim_start_matches(' ').len())
            / 4;
        if indent_depth > analysis.max_nesting_depth {
            analysis.max_nesting_depth = indent_depth;
        }
        inspect_python_line(rel_path, trimmed, line_num, &mut analysis)?;
    }
    Ok(analysis)
}

fn inspect_python_line(
    rel_path: &str,
    trimmed: &str,
    line_num: usize,
    analysis: &mut PolyglotAstAnalysis,
) -> FractalResult<()> {
    if trimmed.starts_with('#') {
        return Ok(());
    }
    if trimmed.contains(DYNAMIC_EVAL_CALL) || trimmed.contains(DYNAMIC_EXEC_CALL) {
        record_finding(
            &mut analysis.findings,
            "SEC-VUL-001",
            "security",
            AuditSeverity::Error,
            rel_path,
            line_num,
            String::from("Dynamic eval()/exec() execution forbidden in Python source"),
        )?;
    }
    if trimmed == "except:" || trimmed.starts_with("except :") {
        record_finding(
            &mut analysis.findings,
            "ERR-FLT-001",
            "governance",
            AuditSeverity::Warning,
            rel_path,
            line_num,
            String::from("Bare `except:` clause catches system exits indiscriminately"),
        )?;
    }
    if trimmed.contains("open(")
        && !trimmed.contains("encoding=")
        && !trimmed.contains("'rb'")
        && !trimmed.contains("\"rb\"")
    {
        record_finding(
            &mut analysis.findings,
            "PYM-OPEN-001",
            "python-modern",
            AuditSeverity::Warning,
            rel_path,
            line_num,
            String::from("Text open() call missing explicit encoding='utf-8'"),
        )?;
    }
    Ok(())
}
