//! Module: fg-gate — Oxc TS/JS AST Walker State & Visitor Impl
//! File Path: crates/fg-gate/src/audit_engine/oxc_ts_experts/visitor.rs
//! Architecture Role: Maintains per-file AST traversal accumulators (cyclomatic complexity stack,
//!   nesting depth, symbol/import counters) and implements `oxc_ast_visit::Visit`.
//! Dependencies & Triggers: Delegates semantic rule checks to `oxc_ts_experts::checks`.
//! Responsibilities: Walk Oxc AST nodes in a single pass and record complexity and style defects.
//! Exit Semantics & Design Rationale: Shared `visit_branch_nested` helper flattens loop handlers.

use oxc_ast::ast::{
    ArrowFunctionBody, ArrowFunctionExpression, CallExpression, CatchClause, DoWhileStatement,
    ExportDeclaration, ExportDefaultDeclaration, ExportNamedDeclaration, Expression,
    ForInStatement, ForOfStatement, ForStatement, Function, IfStatement, ImportDeclaration,
    LogicalExpression, NewExpression, Program, SwitchStatement, TSAnyKeyword, TryStatement,
    VariableDeclaration, VariableDeclarationKind, WhileStatement,
};
use oxc_ast_visit::{walk, Visit};
use oxc_syntax::scope::ScopeFlags;

use super::checks::{
    check_tautology_binary, check_trampoline_function, classify_import_specifier,
    inspect_call_expression, inspect_export_declaration,
};
use crate::audit_engine::rule_registry::{build_registered_finding, AuditFinding, AuditSeverity};

pub(crate) struct OxcTsVisitor<'s> {
    pub(crate) rel_path: &'s str,
    pub(crate) source: &'s str,
    pub(crate) line_starts: &'s [usize],
    pub(crate) is_ts: bool,
    pub(crate) is_daemon_path: bool,
    pub(crate) is_test_file: bool,
    pub(crate) control_depth: usize,
    pub(crate) max_nesting_depth: usize,
    pub(crate) exported_symbols: usize,
    pub(crate) trivial_forwarders: usize,
    pub(crate) cc_stack: Vec<u32>,
    pub(crate) function_complexities: Vec<f64>,
    pub(crate) internal_imports: Vec<String>,
    pub(crate) external_packages: Vec<String>,
    pub(crate) findings: Vec<AuditFinding>,
    pub(crate) deferred_error: Option<fg_core::error::FractalError>,
}

impl<'s> OxcTsVisitor<'s> {
    pub(crate) fn line_of(&self, byte_offset: u32) -> usize {
        match self.line_starts.binary_search(&(byte_offset as usize)) {
            Ok(idx) => idx + 1,
            Err(idx) => idx.max(1),
        }
    }

    pub(crate) fn emit(
        &mut self,
        rule_id: &str,
        analyzer: &str,
        severity: AuditSeverity,
        span_start: u32,
        msg: &str,
    ) {
        if self.deferred_error.is_some() {
            return;
        }
        let line = self.line_of(span_start);
        match build_registered_finding(rule_id, analyzer, severity, self.rel_path, line, String::from(msg)) {
            Ok(finding) => self.findings.push(finding),
            Err(gate_err) => self.deferred_error = Some(gate_err),
        }
    }

    pub(crate) fn has_leading_jsdoc(&self, decl_start: u32) -> bool {
        let start = (decl_start as usize).min(self.source.len());
        let prefix = &self.source[start.saturating_sub(400)..start];
        if let Some(open) = prefix.rfind("/**") {
            if let Some(close) = prefix[open..].find("*/") {
                let between = prefix[open + close + 2..].trim();
                return between.is_empty() || between.starts_with("export");
            }
        }
        false
    }

    fn bump_cc(&mut self, delta: u32) {
        if let Some(current) = self.cc_stack.last_mut() {
            *current += delta;
        }
    }

    fn enter_nesting(&mut self, span_start: u32) {
        self.control_depth += 1;
        if self.control_depth > self.max_nesting_depth {
            self.max_nesting_depth = self.control_depth;
        }
        if self.control_depth == 5 {
            self.emit(
                "CPX-NEST-001", "complexity", AuditSeverity::Warning, span_start,
                "Control-flow nesting depth exceeds budget (> 4)",
            );
        }
    }

    fn exit_nesting(&mut self) {
        self.control_depth = self.control_depth.saturating_sub(1);
    }

    fn finish_function_cc(&mut self, span_start: u32, label: &str) {
        let cc = self.cc_stack.pop().unwrap_or(1);
        self.function_complexities.push(f64::from(cc));
        if cc > 15 {
            self.emit(
                "high-complexity", "complexity", AuditSeverity::Warning, span_start,
                &format!("{label} cyclomatic complexity {cc} exceeds ceiling 15"),
            );
        }
    }
}

impl<'a, 's> Visit<'a> for OxcTsVisitor<'s> {
    fn visit_program(&mut self, program: &Program<'a>) { walk::walk_program(self, program); }
    fn visit_import_declaration(&mut self, decl: &ImportDeclaration<'a>) {
        if let Some(specifier) = decl.source.value.as_str() { classify_import_specifier(self, specifier); }
        walk::walk_import_declaration(self, decl);
    }
    fn visit_export_declaration(&mut self, decl: &ExportDeclaration<'a>) {
        inspect_export_declaration(self, decl);
        walk::walk_export_declaration(self, decl);
    }
    fn visit_export_named_declaration(&mut self, decl: &ExportNamedDeclaration<'a>) {
        self.exported_symbols += decl.specifiers.len().max(1);
        walk::walk_export_named_declaration(self, decl);
    }
    fn visit_export_default_declaration(&mut self, decl: &ExportDefaultDeclaration<'a>) {
        self.exported_symbols += 1;
        walk::walk_export_default_declaration(self, decl);
    }
    fn visit_function(&mut self, func: &Function<'a>, flags: ScopeFlags) {
        if let Some(ref body) = func.body {
            self.cc_stack.push(1);
            check_trampoline_function(self, func.span.start, func.span.end, &body.statements);
            walk::walk_function(self, func, flags);
            self.finish_function_cc(func.span.start, "Function");
        } else {
            walk::walk_function(self, func, flags);
        }
    }
    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        self.cc_stack.push(1);
        if let ArrowFunctionBody::FunctionBody(ref body) = arrow.body {
            check_trampoline_function(self, arrow.span.start, arrow.span.end, &body.statements);
        }
        walk::walk_arrow_function_expression(self, arrow);
        self.finish_function_cc(arrow.span.start, "Arrow function");
    }
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        inspect_call_expression(self, call);
        walk::walk_call_expression(self, call);
    }
    fn visit_new_expression(&mut self, expr: &NewExpression<'a>) {
        if let Expression::Identifier(ident) = &expr.callee {
            if ident.name.as_str() == "Function" {
                self.emit("SEC-VUL-001", "security", AuditSeverity::Error, expr.span.start, "Dynamic `new Function(...)` execution detected");
            }
        }
        walk::walk_new_expression(self, expr);
    }
    fn visit_variable_declaration(&mut self, decl: &VariableDeclaration<'a>) {
        if decl.kind == VariableDeclarationKind::Var {
            self.emit("TSM-VAR-001", "typescript-modern", AuditSeverity::Warning, decl.span.start, "Obsolete `var` declaration detected; replace with `const` or `let`");
        }
        walk::walk_variable_declaration(self, decl);
    }
    fn visit_ts_any_keyword(&mut self, kw: &TSAnyKeyword) {
        if self.is_ts && !self.is_test_file {
            self.emit("TSM-ANY-001", "typescript-modern", AuditSeverity::Warning, kw.span.start, "Explicit `any` escape hatch undermines strict TypeScript type safety");
        }
    }
    fn visit_catch_clause(&mut self, clause: &CatchClause<'a>) {
        self.bump_cc(1);
        if clause.body.body.is_empty() {
            self.emit("ERR-FLT-001", "governance", AuditSeverity::Warning, clause.span.start, "Empty catch block silently swallows exceptions");
        }
        walk::walk_catch_clause(self, clause);
    }
    fn visit_if_statement(&mut self, s: &IfStatement<'a>) { self.bump_cc(1); self.enter_nesting(s.span.start); walk::walk_if_statement(self, s); self.exit_nesting(); }
    fn visit_for_statement(&mut self, s: &ForStatement<'a>) { self.bump_cc(1); self.enter_nesting(s.span.start); walk::walk_for_statement(self, s); self.exit_nesting(); }
    fn visit_for_in_statement(&mut self, s: &ForInStatement<'a>) { self.bump_cc(1); self.enter_nesting(s.span.start); walk::walk_for_in_statement(self, s); self.exit_nesting(); }
    fn visit_for_of_statement(&mut self, s: &ForOfStatement<'a>) { self.bump_cc(1); self.enter_nesting(s.span.start); walk::walk_for_of_statement(self, s); self.exit_nesting(); }
    fn visit_while_statement(&mut self, s: &WhileStatement<'a>) { self.bump_cc(1); self.enter_nesting(s.span.start); walk::walk_while_statement(self, s); self.exit_nesting(); }
    fn visit_do_while_statement(&mut self, s: &DoWhileStatement<'a>) { self.bump_cc(1); self.enter_nesting(s.span.start); walk::walk_do_while_statement(self, s); self.exit_nesting(); }
    fn visit_switch_statement(&mut self, s: &SwitchStatement<'a>) {
        self.bump_cc(u32::try_from(s.cases.len()).unwrap_or(1));
        self.enter_nesting(s.span.start);
        walk::walk_switch_statement(self, s);
        self.exit_nesting();
    }
    fn visit_try_statement(&mut self, s: &TryStatement<'a>) { self.enter_nesting(s.span.start); walk::walk_try_statement(self, s); self.exit_nesting(); }
    fn visit_logical_expression(&mut self, e: &LogicalExpression<'a>) { self.bump_cc(1); walk::walk_logical_expression(self, e); }
    fn visit_conditional_expression(&mut self, e: &oxc_ast::ast::ConditionalExpression<'a>) { self.bump_cc(1); walk::walk_conditional_expression(self, e); }
    fn visit_binary_expression(&mut self, e: &oxc_ast::ast::BinaryExpression<'a>) { check_tautology_binary(self, e); walk::walk_binary_expression(self, e); }
}
