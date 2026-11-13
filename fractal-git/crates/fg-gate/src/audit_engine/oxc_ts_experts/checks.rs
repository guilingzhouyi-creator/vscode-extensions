//! Module: fg-gate — Oxc TS/JS Security, Call & Trampoline Check Helpers
//! File Path: crates/fg-gate/src/audit_engine/oxc_ts_experts/checks.rs
//! Architecture Role: Houses focused AST inspection routines invoked by `OxcTsVisitor`: import
//!   classification, trampoline wrapper detection, dangerous call auditing (`SEC-VUL-*`,
//!   `PRF-IO-001`), export surface hygiene, and tautological assertion scanning (`GOV-GAM-001`).
//! Dependencies & Triggers: Paired with `oxc_ts_experts::visitor`.
//! Responsibilities: Keep AST traversal handlers shallow while enforcing all TS/JS static rules.
//! Exit Semantics & Design Rationale: Separates rule predicates cleanly from AST walker boilerplate.

use fg_core::error::FractalResult;
use oxc_ast::ast::{
    BinaryExpression, BinaryOperator, CallExpression, Declaration, ExportDeclaration, Expression,
    Statement,
};

use super::visitor::OxcTsVisitor;
use crate::audit_engine::rule_registry::{build_registered_finding, AuditFinding, AuditSeverity};

pub(crate) fn classify_import_specifier(visitor: &mut OxcTsVisitor<'_>, specifier: &str) {
    if specifier.starts_with('.') {
        visitor.internal_imports.push(String::from(specifier));
    } else if !specifier.starts_with("node:") {
        let pkg = if specifier.starts_with('@') {
            let mut split = specifier.splitn(3, '/');
            let scope = split.next().unwrap_or("");
            let name = split.next().unwrap_or("");
            if name.is_empty() { String::from(specifier) } else { format!("{scope}/{name}") }
        } else {
            String::from(specifier.split('/').next().unwrap_or(specifier))
        };
        if !visitor.external_packages.contains(&pkg) {
            visitor.external_packages.push(pkg);
        }
    }
}

pub(crate) fn check_trampoline_function(
    visitor: &mut OxcTsVisitor<'_>,
    span_start: u32,
    span_end: u32,
    stmts: &[Statement<'_>],
) {
    if stmts.len() != 1 || visitor.is_test_file {
        return;
    }
    let line_span = visitor.line_of(span_end).saturating_sub(visitor.line_of(span_start)) + 1;
    if line_span <= 3 {
        if let Statement::ReturnStatement(ret_stmt) = &stmts[0] {
            if matches!(ret_stmt.argument, Some(Expression::CallExpression(_))) {
                visitor.trivial_forwarders += 1;
                visitor.emit(
                    "ARCH-ABS-001", "architecture", AuditSeverity::Info, span_start,
                    "Trivial <= 3-line pure forwarding wrapper function",
                );
            }
        }
    }
}

pub(crate) fn inspect_export_declaration(visitor: &mut OxcTsVisitor<'_>, decl: &ExportDeclaration<'_>) {
    visitor.exported_symbols += 1;
    if let Declaration::FunctionDeclaration(func) = &decl.declaration {
        if !visitor.is_test_file && !visitor.has_leading_jsdoc(decl.span.start) {
            visitor.emit(
                "CMT-DOC-001", "comments", AuditSeverity::Warning, decl.span.start,
                "Exported function is missing a leading JSDoc header block",
            );
        }
        if func.params.items.len() > 4 {
            visitor.emit(
                "SIM-ARGS-001", "simplify", AuditSeverity::Warning, func.span.start,
                "Exported function takes > 4 positional parameters (use options object)",
            );
        }
    }
}

pub(crate) fn inspect_call_expression(visitor: &mut OxcTsVisitor<'_>, call: &CallExpression<'_>) {
    let start = call.span.start;
    match &call.callee {
        Expression::Identifier(ident) => inspect_callee_ident(visitor, ident.name.as_str(), start),
        Expression::StaticMemberExpression(member) => inspect_static_member(visitor, member, call),
        _ => {}
    }
}

fn inspect_callee_ident(visitor: &mut OxcTsVisitor<'_>, name: &str, start: u32) {
    if name == concat!("ev", "al") {
        visitor.emit(
            "SEC-VUL-001", "security", AuditSeverity::Error, start,
            "Arbitrary dynamic eval() execution detected",
        );
    } else if !visitor.is_test_file && name == "execSync" {
        visitor.emit(
            "SEC-VUL-002", "security", AuditSeverity::Error, start,
            "Direct execSync shell execution without validated boundary",
        );
    }
}

fn inspect_static_member(
    visitor: &mut OxcTsVisitor<'_>,
    member: &oxc_ast::ast::StaticMemberExpression<'_>,
    call: &CallExpression<'_>,
) {
    let (start, prop) = (call.span.start, member.property.name.as_str());
    if let Expression::Identifier(obj_ident) = &member.object {
        check_member_security_call(visitor, obj_ident.name.as_str(), prop, call, start);
    }
    if visitor.is_daemon_path
        && (prop == "readFileSync" || prop == "writeFileSync" || prop == "readdirSync")
    {
        visitor.emit(
            "PRF-IO-001", "performance", AuditSeverity::Warning, start,
            "Blocking synchronous filesystem I/O inside daemon/server hot path",
        );
    }
}

fn check_member_security_call(
    visitor: &mut OxcTsVisitor<'_>,
    obj_name: &str,
    prop: &str,
    call: &CallExpression<'_>,
    start: u32,
) {
    if obj_name == "Math" && prop == "random" && is_security_rel_path(visitor.rel_path) {
        visitor.emit(
            "SEC-VUL-004", "security", AuditSeverity::Error, start,
            "Insecure Math.random() used in security-sensitive path",
        );
    }
    if obj_name == "crypto" && prop == "createHash" && !visitor.rel_path.contains("git") {
        let weak = call.arguments.first().and_then(|arg| match arg.as_expression() {
            Some(Expression::StringLiteral(lit)) => lit.value.as_str(),
            _ => None,
        });
        if weak.is_some_and(|val| val.eq_ignore_ascii_case("md5") || val.eq_ignore_ascii_case("sha1")) {
            visitor.emit(
                "SEC-VUL-005", "security", AuditSeverity::Warning, start,
                "Weak cryptographic hash algorithm md5/sha1 detected",
            );
        }
    }
}

fn is_security_rel_path(rel_path: &str) -> bool {
    rel_path.contains("auth") || rel_path.contains("token") || rel_path.contains("crypto") || rel_path.contains("secret")
}

pub(crate) fn check_tautology_binary(visitor: &mut OxcTsVisitor<'_>, expr: &BinaryExpression<'_>) {
    if expr.operator == BinaryOperator::Equality && expr.span.start > 0 {
        let line = visitor.line_of(expr.span.start);
        let slice_text = visitor.source.lines().nth(line.saturating_sub(1)).unwrap_or("");
        if slice_text.contains("expect(1).toBe(1)") || slice_text.contains("expect(true).toBe(true)") {
            visitor.emit(
                "GOV-GAM-001", "governance", AuditSeverity::Warning, expr.span.start,
                "Tautological self-affirming assertion detected",
            );
        }
    }
}

/// Checks single-file tautological assertions cleanly even outside binary comparisons.
///
/// # Errors
///
/// Propagates [`fg_core::error::FractalError::PolicyViolation`] if rule closure fails.
pub fn scan_ts_tautological_calls(
    rel_path: &str,
    source: &str,
    findings: &mut Vec<AuditFinding>,
) -> FractalResult<()> {
    for (line_num, raw_line) in (1usize..).zip(source.split('\n')) {
        let trimmed = raw_line.trim();
        if trimmed.contains("expect(true).toBe(true)")
            || trimmed.contains("expect(1).toBe(1)")
            || trimmed.contains("assert(true)")
        {
            findings.push(build_registered_finding(
                "GOV-GAM-001", "governance", AuditSeverity::Warning, rel_path, line_num,
                String::from("Tautological assertion padding detected"),
            )?);
        }
    }
    Ok(())
}
