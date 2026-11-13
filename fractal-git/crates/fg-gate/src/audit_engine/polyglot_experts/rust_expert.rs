//! Module: fg-gate — Rust `syn` Entry & Import Collector
//! File Path: crates/fg-gate/src/audit_engine/polyglot_experts/rust_expert.rs
//! Architecture Role: Parses in-memory Rust source files with `syn::parse_file`, runs
//!   [`RustSynVisitor`], and extracts internal/external `use` target roots.
//! Dependencies & Triggers: Uses `auto_refactor_engine::ops_mask::mask_source_code`.
//! Responsibilities: Populate [`PolyglotAstAnalysis`] metrics and dependency targets for `.rs`.
//! Exit Semantics & Design Rationale: Graceful empty fallback on unparseable partial Rust.

use auto_refactor_engine::ops_mask::{mask_source_code, MaskConfig};
use fg_core::error::FractalResult;
use syn::visit::Visit;

use crate::audit_engine::rule_registry::is_test_code_path;

use super::rust_visitor::RustSynVisitor;
use super::{empty_polyglot_analysis, PolyglotAstAnalysis};

pub(super) fn analyze_rust_syn_ast(
    rel_path: &str,
    source: &str,
) -> FractalResult<PolyglotAstAnalysis> {
    let Ok(syntax_file) = syn::parse_file(source) else {
        return Ok(empty_polyglot_analysis());
    };
    let lines: Vec<&str> = source.split('\n').collect();
    let is_test_path = is_test_code_path(rel_path);
    let mut visitor = RustSynVisitor::new(rel_path, &lines, is_test_path);
    visitor.visit_file(&syntax_file);
    if let Some(gate_err) = visitor.deferred_error {
        return Err(gate_err);
    }

    let mut internal_imports = Vec::with_capacity(8);
    let mut external_packages = Vec::with_capacity(8);
    collect_rust_use_targets(source, &mut internal_imports, &mut external_packages);

    Ok(PolyglotAstAnalysis {
        max_nesting_depth: visitor.max_nesting_depth,
        exported_symbols: visitor.exported_symbols,
        function_complexities: visitor.function_complexities,
        internal_imports,
        external_packages,
        findings: visitor.findings,
    })
}

fn collect_rust_use_targets(source: &str, internal: &mut Vec<String>, external: &mut Vec<String>) {
    let mask_cfg = MaskConfig {
        line_comment: String::from("//"),
        block_comment: Some((String::from("/*"), String::from("*/"))),
        quote_chars: String::from("\""),
        multiline_templates: false,
        regex_literals: false,
        html_comment: false,
    };
    let masked = mask_source_code(source, &mask_cfg);
    for line in &masked.masked {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix("use ") else {
            continue;
        };
        let root_pkg = rest
            .split("::")
            .next()
            .unwrap_or("")
            .trim()
            .trim_end_matches(';');
        if root_pkg == "crate"
            || root_pkg == "super"
            || root_pkg == "self"
            || root_pkg.starts_with("fg_")
        {
            push_unique_string(internal, root_pkg);
        } else if root_pkg != "std" && root_pkg != "core" && !root_pkg.is_empty() {
            push_unique_string(external, root_pkg);
        }
    }
}

fn push_unique_string(bucket: &mut Vec<String>, candidate: &str) {
    if !bucket.iter().any(|existing| existing == candidate) {
        bucket.push(candidate.to_owned());
    }
}
