//! Module: fg-gate — Oxc AST TypeScript / JavaScript Quality Expert Facade
//! File Path: crates/fg-gate/src/audit_engine/oxc_ts_experts/mod.rs
//! Architecture Role: Pure-Rust syntactic analyzer for `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`
//!   files powered by `oxc_parser v0.158.0` operating strictly over immutable in-memory slices.
//! Dependencies & Triggers: Coordinates `cycles`, `checks`, and `visitor`; consumed by `audit_engine`.
//! Responsibilities: Parse TS/JS files in zero-copy arenas and return metrics and SSOT findings.
//! Exit Semantics & Design Rationale: Zero filesystem writes or external Node.js subprocess calls.

mod checks;
mod cycles;
#[cfg(test)]
mod unit_tests;
mod visitor;

pub use checks::scan_ts_tautological_calls;
pub use cycles::{analyze_ts_dependency_cycles, group_ts_imports};

use fg_core::error::FractalResult;
use oxc_allocator::Allocator;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::audit_engine::rule_registry::{is_test_code_path, AuditFinding, SnapshotFileSlice};
use visitor::OxcTsVisitor;

/// Structural metrics and findings extracted by Oxc AST analysis of one TS/JS snapshot slice.
#[derive(Debug, Clone, PartialEq)]
pub struct TsAstAnalysis {
    /// Maximum nested control-flow block depth across the file.
    pub max_nesting_depth: usize,
    /// Number of exported functions, variables, classes, and types.
    pub exported_symbols: usize,
    /// Cyclomatic complexity for each concrete function body.
    pub function_complexities: Vec<f64>,
    /// Internal relative import paths resolved from the current file.
    pub internal_imports: Vec<String>,
    /// External third-party package imports outside workspace files.
    pub external_packages: Vec<String>,
    /// Count of trivial <= 3-line forwarding wrapper functions.
    pub trivial_forwarders: usize,
    /// Verified AST findings collected for this file.
    pub findings: Vec<AuditFinding>,
}

/// Evaluates TypeScript or JavaScript source bytes using `oxc_parser` without Node.js.
///
/// # Errors
///
/// Propagates [`fg_core::error::FractalError::PolicyViolation`] if rule closure fails.
pub fn analyze_typescript_ast(slice: &SnapshotFileSlice<'_>) -> FractalResult<TsAstAnalysis> {
    let source = std::str::from_utf8(slice.content).unwrap_or("");
    let source_type = SourceType::from_path(slice.rel_path).unwrap_or_else(|_| SourceType::ts());
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();

    let mut line_starts = Vec::with_capacity(64);
    line_starts.push(0usize);
    collect_line_starts(source.as_bytes(), &mut line_starts);

    let mut visitor = OxcTsVisitor {
        rel_path: slice.rel_path,
        source,
        line_starts: &line_starts,
        is_ts: slice.rel_path.ends_with(".ts") || slice.rel_path.ends_with(".tsx"),
        is_daemon_path: slice.rel_path.contains("/daemon") || slice.rel_path.contains("server."),
        is_test_file: is_test_code_path(slice.rel_path),
        control_depth: 0,
        max_nesting_depth: 0,
        exported_symbols: 0,
        trivial_forwarders: 0,
        cc_stack: Vec::with_capacity(8),
        function_complexities: Vec::with_capacity(16),
        internal_imports: Vec::with_capacity(8),
        external_packages: Vec::with_capacity(8),
        findings: Vec::with_capacity(8),
        deferred_error: None,
    };

    visitor.visit_program(&parsed.program);
    if let Some(gate_err) = visitor.deferred_error {
        return Err(gate_err);
    }

    Ok(TsAstAnalysis {
        max_nesting_depth: visitor.max_nesting_depth,
        exported_symbols: visitor.exported_symbols,
        function_complexities: visitor.function_complexities,
        internal_imports: visitor.internal_imports,
        external_packages: visitor.external_packages,
        trivial_forwarders: visitor.trivial_forwarders,
        findings: visitor.findings,
    })
}

fn collect_line_starts(bytes: &[u8], starts: &mut Vec<usize>) {
    let mut idx = 0;
    while idx < bytes.len() {
        if bytes[idx] == b'\n' {
            starts.push(idx + 1);
        }
        idx += 1;
    }
}
