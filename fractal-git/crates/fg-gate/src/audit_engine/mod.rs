//! Module: fg-gate — Unified Pure-Rust In-Memory Snapshot Audit Engine
//! File Path: crates/fg-gate/src/audit_engine/mod.rs
//! Architecture Role: Coordinates physical hygiene experts, Oxc AST TypeScript/JavaScript experts,
//!   Rust `syn` AST experts, Python/GDScript/Shell experts, and cross-file dependency cycle graphs
//!   strictly over immutable in-memory `(rel_path, bytes)` slices.
//! Dependencies & Triggers: Orchestrates `rule_registry`, `hygiene_expert`, `oxc_ts_experts`,
//!   and `polyglot_experts`; consumed by `fractal-git` scoring & Taxis daemon async review.
//! Responsibilities: Produce per-file metrics, structural findings, import inventories, and
//!   project-wide cycle findings in a single thread-safe pure-Rust pass.
//! Exit Semantics & Design Rationale: Zero filesystem writes, zero child process spawning (`node`),
//!   100% SSOT rule ID closure (`RCFG-RULE-DRIFT` clean).

pub mod hygiene_expert;
pub mod oxc_ts_experts;
pub mod polyglot_experts;
pub mod rule_registry;

use fg_core::error::FractalResult;

pub use hygiene_expert::{inspect_file_hygiene, HygieneMeasurement};
pub use oxc_ts_experts::{
    analyze_ts_dependency_cycles, analyze_typescript_ast, group_ts_imports,
    scan_ts_tautological_calls, TsAstAnalysis,
};
pub use polyglot_experts::{analyze_polyglot_slice, PolyglotAstAnalysis};
pub use rule_registry::{
    build_registered_finding, is_test_code_path, is_test_or_fixture_path, record_finding,
    AuditFinding, AuditSeverity, FileAuditOutcome, SnapshotFileSlice, SourceLanguage,
};

/// Project-wide snapshot audit output uniting per-file outcomes and cross-file graph defects.
#[derive(Debug, Clone, PartialEq)]
pub struct SnapshotAuditBundle {
    /// Per-file measurements and local findings sorted identically to input order.
    pub file_outcomes: Vec<FileAuditOutcome>,
    /// Cross-file structural defects (such as TypeScript `import-cycle` SCCs).
    pub cross_file_findings: Vec<AuditFinding>,
}

/// Runs all pure-Rust snapshot experts across an immutable slice of candidate files.
///
/// # Errors
///
/// Propagates [`fg_core::error::FractalError::Gate`] if any rule fails SSOT registry closure.
pub fn audit_snapshot_slices(
    slices: &[SnapshotFileSlice<'_>],
) -> FractalResult<SnapshotAuditBundle> {
    let mut file_outcomes = Vec::with_capacity(slices.len());
    let mut idx = 0;
    while idx < slices.len() {
        let outcome = audit_single_slice(&slices[idx])?;
        file_outcomes.push(outcome);
        idx += 1;
    }

    let import_map = group_ts_imports(&file_outcomes);
    let import_pairs: Vec<(&str, &[String])> = import_map.into_iter().collect();
    let cross_file_findings = analyze_ts_dependency_cycles(&import_pairs)?;

    Ok(SnapshotAuditBundle {
        file_outcomes,
        cross_file_findings,
    })
}

fn audit_single_slice(slice: &SnapshotFileSlice<'_>) -> FractalResult<FileAuditOutcome> {
    let language = SourceLanguage::detect(slice.rel_path);
    let mut findings = Vec::with_capacity(8);
    let hygiene = inspect_file_hygiene(slice, language, &mut findings)?;

    if !hygiene.valid_utf8 {
        return Ok(FileAuditOutcome {
            file: slice.rel_path.to_owned(),
            language,
            lines: hygiene.lines,
            non_blank_lines: hygiene.non_blank_lines,
            eloc: hygiene.eloc,
            max_nesting_depth: 0,
            exported_symbols: 0,
            function_complexities: Vec::new(),
            internal_imports: Vec::new(),
            external_packages: Vec::new(),
            shannon_entropy: hygiene.shannon_entropy,
            trivial_forwarders: 0,
            findings,
        });
    }

    match language {
        SourceLanguage::TypeScript => {
            let source = std::str::from_utf8(slice.content).unwrap_or("");
            let ts = analyze_typescript_ast(slice)?;
            findings.extend(ts.findings);
            scan_ts_tautological_calls(slice.rel_path, source, &mut findings)?;
            Ok(FileAuditOutcome {
                file: slice.rel_path.to_owned(),
                language,
                lines: hygiene.lines,
                non_blank_lines: hygiene.non_blank_lines,
                eloc: hygiene.eloc,
                max_nesting_depth: ts.max_nesting_depth,
                exported_symbols: ts.exported_symbols,
                function_complexities: ts.function_complexities,
                internal_imports: ts.internal_imports,
                external_packages: ts.external_packages,
                shannon_entropy: hygiene.shannon_entropy,
                trivial_forwarders: ts.trivial_forwarders,
                findings,
            })
        }
        SourceLanguage::Rust
        | SourceLanguage::Python
        | SourceLanguage::Shell
        | SourceLanguage::GdScript => {
            let poly = analyze_polyglot_slice(slice, language)?;
            findings.extend(poly.findings);
            Ok(FileAuditOutcome {
                file: slice.rel_path.to_owned(),
                language,
                lines: hygiene.lines,
                non_blank_lines: hygiene.non_blank_lines,
                eloc: hygiene.eloc,
                max_nesting_depth: poly.max_nesting_depth,
                exported_symbols: poly.exported_symbols,
                function_complexities: poly.function_complexities,
                internal_imports: poly.internal_imports,
                external_packages: poly.external_packages,
                shannon_entropy: hygiene.shannon_entropy,
                trivial_forwarders: 0,
                findings,
            })
        }
        SourceLanguage::Go | SourceLanguage::Other => Ok(FileAuditOutcome {
            file: slice.rel_path.to_owned(),
            language,
            lines: hygiene.lines,
            non_blank_lines: hygiene.non_blank_lines,
            eloc: hygiene.eloc,
            max_nesting_depth: 0,
            exported_symbols: 0,
            function_complexities: Vec::new(),
            internal_imports: Vec::new(),
            external_packages: Vec::new(),
            shannon_entropy: hygiene.shannon_entropy,
            trivial_forwarders: 0,
            findings,
        }),
    }
}
