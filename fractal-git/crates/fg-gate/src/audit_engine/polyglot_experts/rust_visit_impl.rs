//! Module: fg-gate — Rust `syn::Visit` AST Trait Implementation
//! File Path: crates/fg-gate/src/audit_engine/polyglot_experts/rust_visit_impl.rs
//! Architecture Role: Implements `syn::visit::Visit` hooks for [`RustSynVisitor`] to inspect
//!   functions, control flow, unsafe blocks, macros, and transient loop heap allocations.
//! Dependencies & Triggers: Emits `RSM-UNWRAP-001`, `RSM-PNC-001`, `RSM-SAF-001`,
//!   `FGT-PRF-001`, `CMT-DOC-001`, `SIM-ARGS-001`, `high-complexity`, and `CPX-NEST-001`.
//! Responsibilities: Traverse AST items/expressions while respecting test-scope exemptions.
//! Exit Semantics & Design Rationale: Keeps complexity and parameter caps uniform across Rust.

use syn::visit::{self, Visit};
use syn::{
    ExprBinary, ExprForLoop, ExprIf, ExprLoop, ExprMatch, ExprMethodCall, ExprUnsafe, ExprWhile,
    ItemEnum, ItemFn, ItemMod, ItemStruct, Macro,
};

use crate::audit_engine::rule_registry::AuditSeverity;

use super::rust_visitor::RustSynVisitor;

impl<'ast, 'a> Visit<'ast> for RustSynVisitor<'a> {
    fn visit_item_mod(&mut self, item_mod: &'ast ItemMod) {
        let prev_test = self.in_test_scope;
        if Self::is_cfg_test(&item_mod.attrs) || item_mod.ident == "tests" {
            self.in_test_scope = true;
        }
        visit::visit_item_mod(self, item_mod);
        self.in_test_scope = prev_test;
    }

    fn visit_item_struct(&mut self, item_struct: &'ast ItemStruct) {
        let ident = item_struct.ident.to_string();
        self.record_pub_item_doc(&item_struct.vis, &item_struct.attrs, &ident, "struct");
        visit::visit_item_struct(self, item_struct);
    }

    fn visit_item_enum(&mut self, item_enum: &'ast ItemEnum) {
        let ident = item_enum.ident.to_string();
        self.record_pub_item_doc(&item_enum.vis, &item_enum.attrs, &ident, "enum");
        visit::visit_item_enum(self, item_enum);
    }

    fn visit_item_fn(&mut self, item_fn: &'ast ItemFn) {
        let prev_test = self.in_test_scope;
        if Self::has_attr(&item_fn.attrs, "test") || Self::is_cfg_test(&item_fn.attrs) {
            self.in_test_scope = true;
        }
        let fn_ident = item_fn.sig.ident.to_string();
        self.record_pub_item_doc(&item_fn.vis, &item_fn.attrs, &fn_ident, "function");
        let non_self_params = item_fn
            .sig
            .inputs
            .iter()
            .filter(|arg| matches!(arg, syn::FnArg::Typed(_)))
            .count();
        if !self.in_test_scope && non_self_params > 4 {
            let line = self.find_pattern_line(&fn_ident);
            self.emit(
                "SIM-ARGS-001",
                "simplify",
                AuditSeverity::Warning,
                line,
                "Function declares > 4 positional parameters (use parameter struct)",
            );
        }
        self.cc_stack.push(1);
        visit::visit_item_fn(self, item_fn);
        let cc = self.cc_stack.pop().unwrap_or(1);
        self.function_complexities.push(f64::from(cc));
        if !self.in_test_scope && cc > 15 {
            let line = self.find_pattern_line(&fn_ident);
            self.emit(
                "high-complexity",
                "complexity",
                AuditSeverity::Warning,
                line,
                &format!("Rust function cyclomatic complexity {cc} exceeds ceiling 15"),
            );
        }
        self.in_test_scope = prev_test;
    }

    fn visit_expr_method_call(&mut self, call: &'ast ExprMethodCall) {
        if !self.in_test_scope {
            let name = call.method.to_string();
            if name == "unwrap" || name == "expect" {
                let line = self.find_pattern_line(&format!(".{name}("));
                self.emit(
                    "RSM-UNWRAP-001",
                    "rust-modern",
                    AuditSeverity::Error,
                    line,
                    "Forbidden bare unwrap or expect call in production Rust path",
                );
            } else if self.loop_depth > 0
                && (name == "to_string" || name == "to_owned" || name == "to_vec")
            {
                let line = self.find_pattern_line(&format!(".{name}("));
                self.emit(
                    "FGT-PRF-001",
                    "performance",
                    AuditSeverity::Warning,
                    line,
                    "Transient heap allocation method call inside Rust loop",
                );
            }
        }
        visit::visit_expr_method_call(self, call);
    }

    fn visit_macro(&mut self, mac: &'ast Macro) {
        if !self.in_test_scope {
            let macro_name = mac
                .path
                .segments
                .last()
                .map(|seg| seg.ident.to_string())
                .unwrap_or_default();
            if macro_name == "panic" || macro_name == "todo" || macro_name == "unimplemented" {
                let line = self.find_pattern_line(&format!("{macro_name}!("));
                self.emit(
                    "RSM-PNC-001",
                    "rust-modern",
                    AuditSeverity::Error,
                    line,
                    "Explicit panic!/todo!/unimplemented! macro forbidden in production Rust",
                );
            } else if self.loop_depth > 0 && (macro_name == "format" || macro_name == "vec") {
                let line = self.find_pattern_line(&format!("{macro_name}!"));
                self.emit(
                    "FGT-PRF-001",
                    "performance",
                    AuditSeverity::Warning,
                    line,
                    "Transient macro allocation inside Rust loop body",
                );
            }
        }
        visit::visit_macro(self, mac);
    }

    fn visit_expr_unsafe(&mut self, expr: &'ast ExprUnsafe) {
        if !self.in_test_scope {
            let line = self.find_pattern_line("unsafe");
            if !self.has_safety_comment_near(line) {
                self.emit(
                    "RSM-SAF-001",
                    "security",
                    AuditSeverity::Error,
                    line,
                    "Unsafe block missing preceding // SAFETY: invariant proof",
                );
            }
        }
        visit::visit_expr_unsafe(self, expr);
    }

    fn visit_expr_if(&mut self, expr: &'ast ExprIf) {
        self.bump_cc();
        self.enter_control(1);
        visit::visit_expr_if(self, expr);
        self.exit_control();
    }

    fn visit_expr_match(&mut self, expr: &'ast ExprMatch) {
        if let Some(current) = self.cc_stack.last_mut() {
            *current += u32::try_from(expr.arms.len()).unwrap_or(1);
        }
        self.enter_control(1);
        visit::visit_expr_match(self, expr);
        self.exit_control();
    }

    fn visit_expr_for_loop(&mut self, expr: &'ast ExprForLoop) {
        self.bump_cc();
        self.loop_depth += 1;
        self.enter_control(1);
        visit::visit_expr_for_loop(self, expr);
        self.exit_control();
        self.loop_depth = self.loop_depth.saturating_sub(1);
    }

    fn visit_expr_while(&mut self, expr: &'ast ExprWhile) {
        self.bump_cc();
        self.loop_depth += 1;
        self.enter_control(1);
        visit::visit_expr_while(self, expr);
        self.exit_control();
        self.loop_depth = self.loop_depth.saturating_sub(1);
    }

    fn visit_expr_loop(&mut self, expr: &'ast ExprLoop) {
        self.bump_cc();
        self.loop_depth += 1;
        self.enter_control(1);
        visit::visit_expr_loop(self, expr);
        self.exit_control();
        self.loop_depth = self.loop_depth.saturating_sub(1);
    }

    fn visit_expr_binary(&mut self, expr: &'ast ExprBinary) {
        if matches!(expr.op, syn::BinOp::And(_) | syn::BinOp::Or(_)) {
            self.bump_cc();
        }
        visit::visit_expr_binary(self, expr);
    }
}
