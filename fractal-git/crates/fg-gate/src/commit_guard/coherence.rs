//! Module: fg-gate — Semantic Diff Coherence Guard
//! File Path: crates/fg-gate/src/commit_guard/coherence.rs
//! Architecture Role: Verifies borrow coherence between commit header scope and touched tree paths.
//! Dependencies & Triggers: Consumed by `commit_guard::verify_message` during semantic gate pass.
//! Responsibilities: Validate broad scopes, enforce production mutations non-empty, and ensure
//!   all mutated file paths are subsumed under declared scope prefix.
//! Exit Semantics & Design Rationale: Fails closed on out-of-scope mutations when Strict coherence
//!   is requested, preventing semantic dangling commits.
//!
//! Domain Governance Rules: FGT-GAT-001 (gate governance).

use fg_core::models::{DiffCoherenceMode, TaxisPolicy};

/// Semantic diff borrow check: the declared scope must cover every touched path.
///
/// A broad scope (`all`, `root`, `core`) is accepted because a cross-cutting change legitimately
/// touches many areas; a narrow scope that no path matches indicates the message describes work
/// the diff does not contain.
pub fn validate_diff_coherence(
    policy: &TaxisPolicy,
    touched_paths: Option<&[String]>,
    is_production: bool,
    scope: Option<&str>,
    violations: &mut Vec<String>,
) {
    if policy.diff_coherence != DiffCoherenceMode::Strict {
        return;
    }
    let Some(paths) = touched_paths else {
        return;
    };
    if is_production && paths.is_empty() {
        violations.push(
            concat!(
                "FGT-GAT-001: Semantic dangling pointer; ",
                "production commit touches zero files"
            )
            .into(),
        );
        return;
    }
    let Some(declared_scope) = scope else {
        return;
    };
    let normalized_scope = declared_scope.to_lowercase();
    if is_broad_scope(&normalized_scope) {
        return;
    }
    for path in paths {
        if !path.to_lowercase().contains(&normalized_scope) {
            violations.push(format!(
                "FGT-GAT-001: Out-of-scope mutation: path '{}' does not match declared scope '{}'",
                path, declared_scope
            ));
            break;
        }
    }
}

/// Whether a declared scope intentionally covers more than one area.
fn is_broad_scope(normalized_scope: &str) -> bool {
    ["root", "all", "core", "workspace", "repo", "monorepo"]
        .iter()
        .any(|broad| normalized_scope.contains(broad))
}
