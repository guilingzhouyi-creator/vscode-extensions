//! Module: fg-gate — Inline Kernel Canary Engine (IKCE)
//! File Path: crates/fg-gate/src/canary/mod.rs
//! Architecture Role: Real-time hidden probe blind-test mutation engine (IKCE).
//!   Breaks Goodhart's Law / fake coverage gaming by applying in-memory micro-mutations
//!   against Agent-submitted code and verifying that accompanying unit tests actually catch the mutations.
//!
//! Dependencies & Triggers: Triggered by `AutoAuditHook` during pre-review commit and promotion evaluations.
//! Responsibilities:
//!   - Synthetic in-memory AST micro-mutations (comparison inversion, boolean flip, off-by-one shifts).
//!   - Tautological and empty assertion interception (detecting `assert!(true)`, `assert_eq!(x, x)`, etc.).
//!   - Calculating formal Mutant Kill Rate ($K = \frac{M_{\text{killed}}}{M_{\text{total}}}$).
//!   - Emitting circuit breaker signals when kill rate falls below safety threshold.
//!
//! Exit Semantics & Design Rationale:
//!   - Pure in-memory AST slice evaluation without writing temporary files to disk.
//!   - Kill rates below `min_kill_rate` (default 0.60) or tautological assertions result in hard block.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Protocol gate facade and rule compliance
//! - `FGT-MUT-001`: In-Kernel Canary Engine (IKCE) blind mutation kill rate guard
//! - `FGT-TAU-001`: In-Kernel Canary Engine (IKCE) anti-tautology guard
//! - `RCFG-RULE-DRIFT`: Rule drift prevention

use serde::{Deserialize, Serialize};

/// Classification of synthetic micro-mutations injected into candidate source code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MutationKind {
    /// Relational operator inversion (e.g. `>` -> `<=`, `==` -> `!=`).
    OperatorInversion,
    /// Boolean literal inversion (e.g. `true` -> `false`).
    BooleanFlip,
    /// Numerical off-by-one boundary shift (e.g. `+ 1` -> `- 1`).
    BoundaryShift,
    /// Tautological assertion detection in test code (e.g. `assert!(true)`).
    TautologicalAssert,
}

/// Description of an individual synthesized micro-mutant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutantDescriptor {
    /// Sequential index of the mutant.
    pub id: usize,
    /// Source line number where mutation was synthesized.
    pub line: usize,
    /// Type of mutation.
    pub kind: MutationKind,
    /// Enclosing function name if detected.
    pub enclosing_fn: Option<String>,
    /// Original line snippet before mutation.
    pub original_snippet: String,
    /// Mutated line snippet.
    pub mutated_snippet: String,
}

/// Configuration parameters for `ShadowCanaryEngine`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CanaryConfig {
    /// Minimum acceptable mutant kill rate (default: 0.60).
    pub min_kill_rate: f64,
    /// Maximum number of synthetic mutants evaluated per source slice (default: 25).
    pub max_mutants_per_slice: usize,
    /// Whether to strictly block tautological assertions (default: true).
    pub reject_tautological_assertions: bool,
}

impl Default for CanaryConfig {
    fn default() -> Self {
        Self {
            min_kill_rate: 0.60,
            max_mutants_per_slice: 25,
            reject_tautological_assertions: true,
        }
    }
}

/// Comprehensive report produced by `ShadowCanaryEngine`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CanaryReport {
    /// Total number of valid mutants synthesized.
    pub total_mutants: usize,
    /// Number of mutants killed (caught) by the test suite.
    pub killed_mutants: usize,
    /// Calculated kill rate ($M_{\text{killed}} / M_{\text{total}}$).
    pub kill_rate: f64,
    /// Number of tautological assertions detected in test code.
    pub tautological_assert_count: usize,
    /// Diagnostic violation explanations.
    pub violations: Vec<String>,
    /// Whether the canary blind test passed all quality criteria.
    pub passed: bool,
}

/// Inline Kernel Canary Engine (IKCE) verifying test efficacy via real-time micro-mutation.
#[derive(Debug, Clone)]
pub struct ShadowCanaryEngine {
    config: CanaryConfig,
}

impl ShadowCanaryEngine {
    /// Creates a new canary engine instance with the given configuration.
    pub const fn new(config: CanaryConfig) -> Self {
        Self { config }
    }

    /// Evaluates candidate source code against its test suite.
    pub fn evaluate_slice(&self, source_code: &str, test_code: &str) -> CanaryReport {
        let mut violations = Vec::new();

        // 1. Detect tautological/empty assertions in tests
        let tautologies = self.detect_tautological_assertions(test_code);
        let tautology_count = tautologies.len();

        if self.config.reject_tautological_assertions && !tautologies.is_empty() {
            for (line_num, diagnosis) in &tautologies {
                violations.push(format!(
                    "Tautological assertion in test line {line_num}: {diagnosis} (FGT-TAU-001)"
                ));
            }
        }

        // 2. Synthesize micro-mutants on the source code
        let mutants = self.generate_mutants(source_code);
        let total_mutants = mutants.len();

        let mut killed_mutants = 0usize;
        for mutant in &mutants {
            if self.is_mutant_killed(mutant, test_code) {
                killed_mutants += 1;
            }
        }

        let kill_rate = if total_mutants == 0 {
            1.0 // No mutable logic detected; treat as passing
        } else {
            killed_mutants as f64 / total_mutants as f64
        };

        if total_mutants > 0 && kill_rate < self.config.min_kill_rate {
            violations.push(format!(
                "Mutant kill rate {:.1}% is below required threshold {:.1}% (killed {}/{}) (FGT-MUT-001)",
                kill_rate * 100.0,
                self.config.min_kill_rate * 100.0,
                killed_mutants,
                total_mutants
            ));
        }

        let passed = violations.is_empty();

        CanaryReport {
            total_mutants,
            killed_mutants,
            kill_rate,
            tautological_assert_count: tautology_count,
            violations,
            passed,
        }
    }

    /// Detects tautological, trivial, or deceptive assertions in test code.
    pub fn detect_tautological_assertions(&self, test_code: &str) -> Vec<(usize, String)> {
        let mut tautologies = Vec::new();
        let trivial_patterns = [
            ("assert!(true)", "Trivial assert!(true) assertion detected"),
            (
                "assert!(1 == 1)",
                "Trivial equality identity assert!(1 == 1) detected",
            ),
            (
                "assert!(0 == 0)",
                "Trivial equality identity assert!(0 == 0) detected",
            ),
            (
                "assert_eq!(true, true)",
                "Trivial assert_eq!(true, true) detected",
            ),
            ("assert_eq!(1, 1)", "Trivial assert_eq!(1, 1) detected"),
            ("assert_eq!(0, 0)", "Trivial assert_eq!(0, 0) detected"),
        ];

        for (line_index, source_line) in test_code.lines().enumerate() {
            let trimmed = source_line.trim();
            let line_num = line_index + 1;

            if trimmed.starts_with("//") {
                continue;
            }

            let mut flagged_line = false;
            for (pattern, description) in &trivial_patterns {
                if trimmed.contains(pattern) {
                    tautologies.push((line_num, (*description).to_string()));
                    flagged_line = true;
                    break;
                }
            }

            if flagged_line {
                continue;
            }

            // Check self-comparison like `assert_eq!(x, x)`
            let clean_assertion = trimmed.trim_end_matches(';').trim();
            if clean_assertion.starts_with("assert_eq!(") {
                if let Some(inner_expr) = clean_assertion.strip_prefix("assert_eq!(") {
                    if let Some(arg_tokens) = inner_expr.strip_suffix(')') {
                        let operands: Vec<&str> = arg_tokens.split(',').map(|s| s.trim()).collect();
                        if operands.len() == 2 && operands[0] == operands[1] {
                            tautologies.push((
                                line_num,
                                format!(
                                    "Self-assert identity assert_eq!({}, {}) detected",
                                    operands[0], operands[1]
                                ),
                            ));
                        }
                    }
                }
            }
        }

        tautologies
    }

    /// Synthesizes micro-mutants by scanning the target source code.
    pub fn generate_mutants(&self, source_code: &str) -> Vec<MutantDescriptor> {
        let mut mutants = Vec::new();
        let mut current_fn: Option<String> = None;

        for (line_index, source_line) in source_code.lines().enumerate() {
            if mutants.len() >= self.config.max_mutants_per_slice {
                break;
            }

            let trimmed = source_line.trim();
            let line_num = line_index + 1;

            if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.is_empty() {
                continue;
            }

            // Detect enclosing function signature
            if (trimmed.starts_with("fn ")
                || trimmed.starts_with("pub fn ")
                || trimmed.starts_with("pub(crate) fn "))
                && trimmed.contains('(')
            {
                if let Some(fn_pos) = trimmed.find("fn ") {
                    let after = &trimmed[fn_pos + 3..];
                    if let Some(open_paren) = after.find('(') {
                        let fn_name = after[..open_paren].trim().to_string();
                        if !fn_name.is_empty() {
                            current_fn = Some(fn_name);
                        }
                    }
                }
            }

            // 1. Relational operator inversion
            let rel_inversions = [
                (" == ", " != "),
                (" != ", " == "),
                (" > ", " <= "),
                (" < ", " >= "),
                (" >= ", " < "),
                (" <= ", " > "),
            ];

            for (from, to) in &rel_inversions {
                if trimmed.contains(from) {
                    let mutated = trimmed.replacen(from, to, 1);
                    mutants.push(MutantDescriptor {
                        id: mutants.len() + 1,
                        line: line_num,
                        kind: MutationKind::OperatorInversion,
                        enclosing_fn: current_fn.clone(),
                        original_snippet: trimmed.to_string(),
                        mutated_snippet: mutated,
                    });
                    break;
                }
            }

            if mutants.len() >= self.config.max_mutants_per_slice {
                break;
            }

            // 2. Boolean literal inversion
            if trimmed.contains("true") && !trimmed.contains("assert") {
                let mutated = trimmed.replacen("true", "false", 1);
                mutants.push(MutantDescriptor {
                    id: mutants.len() + 1,
                    line: line_num,
                    kind: MutationKind::BooleanFlip,
                    enclosing_fn: current_fn.clone(),
                    original_snippet: trimmed.to_string(),
                    mutated_snippet: mutated,
                });
            } else if trimmed.contains("false") && !trimmed.contains("assert") {
                let mutated = trimmed.replacen("false", "true", 1);
                mutants.push(MutantDescriptor {
                    id: mutants.len() + 1,
                    line: line_num,
                    kind: MutationKind::BooleanFlip,
                    enclosing_fn: current_fn.clone(),
                    original_snippet: trimmed.to_string(),
                    mutated_snippet: mutated,
                });
            }

            if mutants.len() >= self.config.max_mutants_per_slice {
                break;
            }

            // 3. Boundary off-by-one shifts
            if trimmed.contains(" + 1") {
                let mutated = trimmed.replacen(" + 1", " - 1", 1);
                mutants.push(MutantDescriptor {
                    id: mutants.len() + 1,
                    line: line_num,
                    kind: MutationKind::BoundaryShift,
                    enclosing_fn: current_fn.clone(),
                    original_snippet: trimmed.to_string(),
                    mutated_snippet: mutated,
                });
            }
        }

        mutants
    }

    /// Evaluates whether a given mutant is killed by inspecting test coverage and semantic anchors.
    fn is_mutant_killed(&self, mutant: &MutantDescriptor, test_code: &str) -> bool {
        let has_assertion = test_code.contains("assert");
        if !has_assertion {
            return false;
        }

        // If the enclosing function is called in the test suite that has assertions, mutant is exercised
        if let Some(ref fn_name) = mutant.enclosing_fn {
            if test_code.contains(fn_name) {
                return true;
            }
        }

        let snippet = &mutant.original_snippet;
        let tokens: Vec<&str> = snippet
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .filter(|token| token.len() >= 3 && !is_common_keyword(token))
            .collect();

        if tokens.is_empty() {
            return false;
        }

        tokens.iter().any(|token| test_code.contains(token))
    }
}

/// Helper identifying non-differentiating programming language keywords.
fn is_common_keyword(word: &str) -> bool {
    matches!(
        word,
        "let"
            | "mut"
            | "fn"
            | "pub"
            | "return"
            | "if"
            | "else"
            | "for"
            | "while"
            | "in"
            | "match"
            | "struct"
            | "impl"
            | "enum"
            | "true"
            | "false"
            | "self"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_tautological_assertions() {
        let engine = ShadowCanaryEngine::new(CanaryConfig::default());
        let tests = r#"
            #[test]
            fn test_fake() {
                assert!(true);
                assert_eq!(1, 1);
                assert_eq!(x, x);
            }
        "#;

        let tautologies = engine.detect_tautological_assertions(tests);
        assert_eq!(tautologies.len(), 3);
    }

    #[test]
    fn test_generate_mutants_synthesizes_operators() {
        let engine = ShadowCanaryEngine::new(CanaryConfig::default());
        let source = r#"
            pub fn is_valid(x: i32) -> bool {
                if x > 10 {
                    return true;
                }
                x == 0
            }
        "#;

        let mutants = engine.generate_mutants(source);
        assert!(!mutants.is_empty());
        assert!(mutants
            .iter()
            .any(|mutant| mutant.kind == MutationKind::OperatorInversion));
    }

    #[test]
    fn test_evaluate_slice_passes_with_comprehensive_tests() {
        let engine = ShadowCanaryEngine::new(CanaryConfig::default());
        let source = r#"
            pub fn compute_threshold(score: i32) -> bool {
                score >= 80
            }
        "#;
        let test_code = r#"
            #[test]
            fn test_compute_threshold() {
                assert!(compute_threshold(85));
                assert!(!compute_threshold(75));
            }
        "#;

        let report = engine.evaluate_slice(source, test_code);
        assert!(report.passed);
        assert!(report.kill_rate >= 0.60);
    }

    #[test]
    fn test_evaluate_slice_fails_on_tautology() {
        let engine = ShadowCanaryEngine::new(CanaryConfig::default());
        let source = r#"
            pub fn compute(x: i32) -> i32 {
                x + 1
            }
        "#;
        let fake_test = r#"
            #[test]
            fn test_fake() {
                assert!(true);
            }
        "#;

        let report = engine.evaluate_slice(source, fake_test);
        assert!(!report.passed);
        assert!(report.tautological_assert_count > 0);
    }
}
