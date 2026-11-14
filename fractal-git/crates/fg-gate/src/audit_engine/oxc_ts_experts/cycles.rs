//! Module: fg-gate — Cross-File TS/JS Import Graph & Cycle Expert
//! File Path: crates/fg-gate/src/audit_engine/oxc_ts_experts/cycles.rs
//! Architecture Role: Resolves relative ES/TS import paths across snapshot files and invokes
//!   `ops_graph::run_analyze_dependency_graph` to emit verified `import-cycle` findings.
//! Dependencies & Triggers: Uses `auto_refactor_engine::ops_graph::run_analyze_dependency_graph`.
//! Responsibilities: Group TS internal imports cleanly and detect circular dependency SCCs.
//! Exit Semantics & Design Rationale: Operates strictly over immutable snapshot maps in memory.

use std::collections::{BTreeMap, HashSet};

use auto_refactor_engine::ops_graph::run_analyze_dependency_graph;
use fg_core::error::FractalResult;

use crate::audit_engine::rule_registry::{
    build_registered_finding, AuditFinding, AuditSeverity, FileAuditOutcome, SourceLanguage,
};

/// Evaluates cross-file TypeScript/JS circular imports using `ops_graph::run_analyze_dependency_graph`.
///
/// # Errors
///
/// Propagates [`fg_core::error::FractalError::PolicyViolation`] if rule closure fails.
pub fn analyze_ts_dependency_cycles(
    file_imports: &[(&str, &[String])],
) -> FractalResult<Vec<AuditFinding>> {
    let mut known_files = HashSet::with_capacity(file_imports.len());
    for &(path, _) in file_imports {
        known_files.insert(path);
    }

    let mut edge_list = Vec::with_capacity(file_imports.len() * 2);
    for &(source_file, imports) in file_imports {
        collect_resolved_edges(source_file, imports, &known_files, &mut edge_list);
    }

    let analysis = run_analyze_dependency_graph(&edge_list);
    if analysis.is_acyclic || analysis.cycles.is_empty() {
        return Ok(Vec::new());
    }

    let mut findings = Vec::with_capacity(analysis.cycles.len());
    for cycle in &analysis.cycles {
        append_cycle_finding(cycle, &mut findings)?;
    }
    Ok(findings)
}

fn collect_resolved_edges(
    source_file: &str,
    imports: &[String],
    known_files: &HashSet<&str>,
    edge_list: &mut Vec<Vec<String>>,
) {
    for specifier in imports {
        if let Some(target_file) = resolve_relative_ts_import(source_file, specifier, known_files) {
            push_resolved_edge(source_file, target_file, edge_list);
        }
    }
}

fn push_resolved_edge(source_file: &str, target_file: &str, edge_list: &mut Vec<Vec<String>>) {
    edge_list.push(vec![String::from(source_file), String::from(target_file)]);
}

fn append_cycle_finding(cycle: &[String], findings: &mut Vec<AuditFinding>) -> FractalResult<()> {
    if let Some(root_file) = cycle.first() {
        findings.push(build_registered_finding(
            "import-cycle",
            "dependency-graph",
            AuditSeverity::Warning,
            root_file,
            1,
            format!(
                "Circular module dependency cycle detected: {}",
                cycle.join(" -> ")
            ),
        )?);
    }
    Ok(())
}

fn resolve_relative_ts_import<'a>(
    from_file: &str,
    specifier: &str,
    known_files: &HashSet<&'a str>,
) -> Option<&'a str> {
    if !specifier.starts_with('.') {
        return None;
    }
    let parent_dir = from_file.rsplit_once('/').map_or("", |(dir, _)| dir);
    let mut parts: Vec<&str> = if parent_dir.is_empty() {
        Vec::new()
    } else {
        parent_dir.split('/').collect()
    };
    for segment in specifier.split('/') {
        if segment == ".." {
            parts.pop();
        } else if segment != "." && !segment.is_empty() {
            parts.push(segment);
        }
    }
    let base = parts.join("/");
    let candidates = [
        base.clone(),
        format!("{base}.ts"),
        format!("{base}.tsx"),
        format!("{base}.js"),
        format!("{base}/index.ts"),
        format!("{base}/index.js"),
    ];
    candidates
        .iter()
        .find_map(|candidate| known_files.get(candidate.as_str()).copied())
}

/// Builds a deterministic per-file import map entry slice for cycle checking.
#[must_use]
pub fn group_ts_imports(outcomes: &[FileAuditOutcome]) -> BTreeMap<&str, &[String]> {
    let mut map = BTreeMap::new();
    for entry in outcomes {
        if entry.language == SourceLanguage::TypeScript {
            map.insert(entry.file.as_str(), entry.internal_imports.as_slice());
        }
    }
    map
}
