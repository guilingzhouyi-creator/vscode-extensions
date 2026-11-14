//! Module: fg-gate — Rust `syn` Visitor State & Diagnostic Helpers
//! File Path: crates/fg-gate/src/audit_engine/polyglot_experts/rust_visitor.rs
//! Architecture Role: Holds traversal accumulators and helper predicates for [`RustSynVisitor`].
//! Dependencies & Triggers: Emits SSOT findings via [`build_registered_finding`].
//! Responsibilities: Track nesting depth, loop scope, cyclomatic complexity, and doc checks.
//! Exit Semantics & Design Rationale: Defers first registry error instead of panicking in Visit.

use syn::{Attribute, Visibility};

use crate::audit_engine::rule_registry::{build_registered_finding, AuditFinding, AuditSeverity};

pub(super) struct RustSynVisitor<'a> {
    pub(super) rel_path: &'a str,
    pub(super) lines: &'a [&'a str],
    pub(super) in_test_scope: bool,
    pub(super) loop_depth: usize,
    pub(super) control_depth: usize,
    pub(super) max_nesting_depth: usize,
    pub(super) exported_symbols: usize,
    pub(super) cc_stack: Vec<u32>,
    pub(super) function_complexities: Vec<f64>,
    pub(super) findings: Vec<AuditFinding>,
    pub(super) deferred_error: Option<fg_core::error::FractalError>,
}

impl<'a> RustSynVisitor<'a> {
    pub(super) fn new(rel_path: &'a str, lines: &'a [&'a str], in_test_scope: bool) -> Self {
        Self {
            rel_path,
            lines,
            in_test_scope,
            loop_depth: 0,
            control_depth: 0,
            max_nesting_depth: 0,
            exported_symbols: 0,
            cc_stack: Vec::with_capacity(8),
            function_complexities: Vec::with_capacity(16),
            findings: Vec::with_capacity(8),
            deferred_error: None,
        }
    }

    pub(super) fn emit(
        &mut self,
        rule_id: &str,
        analyzer: &str,
        severity: AuditSeverity,
        line: usize,
        msg: &str,
    ) {
        if self.deferred_error.is_some() {
            return;
        }
        match build_registered_finding(
            rule_id,
            analyzer,
            severity,
            self.rel_path,
            line,
            msg.to_owned(),
        ) {
            Ok(finding) => self.findings.push(finding),
            Err(gate_err) => self.deferred_error = Some(gate_err),
        }
    }

    pub(super) fn record_pub_item_doc(
        &mut self,
        vis: &Visibility,
        attrs: &[Attribute],
        ident: &str,
        kind_label: &str,
    ) {
        if self.in_test_scope || !matches!(vis, Visibility::Public(_)) {
            return;
        }
        self.exported_symbols += 1;
        if !Self::has_doc_comment(attrs) {
            let line = self.find_pattern_line(ident);
            let message = format!("Public Rust {kind_label} missing Rustdoc comment (///)");
            self.emit(
                "CMT-DOC-001",
                "comments",
                AuditSeverity::Warning,
                line,
                &message,
            );
        }
    }

    pub(super) fn find_pattern_line(&self, needle: &str) -> usize {
        for (idx, line) in self.lines.iter().enumerate() {
            if line.contains(needle) {
                return idx + 1;
            }
        }
        1
    }

    pub(super) fn has_attr(attrs: &[Attribute], name: &str) -> bool {
        attrs.iter().any(|attr| attr.path().is_ident(name))
    }

    pub(super) fn is_cfg_test(attrs: &[Attribute]) -> bool {
        attrs.iter().any(|attr| {
            if !attr.path().is_ident("cfg") {
                return false;
            }
            attr.meta
                .require_list()
                .map(|meta_list| meta_list.tokens.to_string().contains("test"))
                .unwrap_or(false)
        })
    }

    pub(super) fn has_doc_comment(attrs: &[Attribute]) -> bool {
        attrs.iter().any(|attr| attr.path().is_ident("doc"))
    }

    pub(super) fn bump_cc(&mut self) {
        if let Some(current) = self.cc_stack.last_mut() {
            *current += 1;
        }
    }

    pub(super) fn enter_control(&mut self, approx_line: usize) {
        self.control_depth += 1;
        if self.control_depth > self.max_nesting_depth {
            self.max_nesting_depth = self.control_depth;
        }
        if self.control_depth == 5 {
            self.emit(
                "CPX-NEST-001",
                "complexity",
                AuditSeverity::Warning,
                approx_line,
                "Rust control-flow nesting depth exceeds budget (> 4)",
            );
        }
    }

    pub(super) fn exit_control(&mut self) {
        self.control_depth = self.control_depth.saturating_sub(1);
    }

    pub(super) fn has_safety_comment_near(&self, unsafe_line_hint: usize) -> bool {
        let start = unsafe_line_hint.saturating_sub(5);
        let end = (unsafe_line_hint + 2).min(self.lines.len());
        self.lines[start..end]
            .iter()
            .any(|line| line.contains("SAFETY:"))
    }
}
