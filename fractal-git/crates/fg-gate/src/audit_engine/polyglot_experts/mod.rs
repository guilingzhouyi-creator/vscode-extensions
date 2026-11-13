//! Module: fg-gate — Polyglot Audit Experts Entry Facade
//! File Path: crates/fg-gate/src/audit_engine/polyglot_experts/mod.rs
//! Architecture Role: Pure-Rust multi-language AST & structural quality dispatcher over
//!   in-memory snapshot slices for Rust (`syn`), Python, PowerShell/Bash, and GDScript.
//! Dependencies & Triggers: Dispatches to `rust_expert`, `python_expert`, and
//!   `shell_gdscript_experts` based on [`SourceLanguage`].
//! Responsibilities: Define [`PolyglotAstAnalysis`] and dispatch `analyze_polyglot_slice`.
//! Exit Semantics & Design Rationale: Zero filesystem mutation and zero child processes.

mod python_expert;
mod rust_expert;
mod rust_visit_impl;
mod rust_visitor;
mod shell_gdscript_experts;

#[cfg(test)]
mod unit_tests;

use fg_core::error::FractalResult;

use crate::audit_engine::rule_registry::{AuditFinding, SnapshotFileSlice, SourceLanguage};

/// Structural metrics and findings emitted by polyglot experts.
#[derive(Debug, Clone, PartialEq)]
pub struct PolyglotAstAnalysis {
    /// Maximum observed nesting depth.
    pub max_nesting_depth: usize,
    /// Publicly exported symbol count (`pub` items / top-level `def`/`func`).
    pub exported_symbols: usize,
    /// Function cyclomatic complexities.
    pub function_complexities: Vec<f64>,
    /// Internal workspace module imports.
    pub internal_imports: Vec<String>,
    /// External crate/package dependencies.
    pub external_packages: Vec<String>,
    /// Verified SSOT findings.
    pub findings: Vec<AuditFinding>,
}

/// Dispatches snapshot slice analysis by [`SourceLanguage`] for non-TS languages.
///
/// # Errors
///
/// Propagates [`fg_core::error::FractalError::Gate`] if a rule ID fails registry validation.
pub fn analyze_polyglot_slice(
    slice: &SnapshotFileSlice<'_>,
    language: SourceLanguage,
) -> FractalResult<PolyglotAstAnalysis> {
    let source = std::str::from_utf8(slice.content).unwrap_or("");
    match language {
        SourceLanguage::Rust => rust_expert::analyze_rust_syn_ast(slice.rel_path, source),
        SourceLanguage::Python => python_expert::analyze_python_slice(slice.rel_path, source),
        SourceLanguage::Shell => {
            shell_gdscript_experts::analyze_shell_slice(slice.rel_path, source)
        }
        SourceLanguage::GdScript => {
            shell_gdscript_experts::analyze_gdscript_slice(slice.rel_path, source)
        }
        _ => Ok(empty_polyglot_analysis()),
    }
}

pub(super) fn empty_polyglot_analysis() -> PolyglotAstAnalysis {
    PolyglotAstAnalysis {
        max_nesting_depth: 0,
        exported_symbols: 0,
        function_complexities: Vec::new(),
        internal_imports: Vec::new(),
        external_packages: Vec::new(),
        findings: Vec::new(),
    }
}
