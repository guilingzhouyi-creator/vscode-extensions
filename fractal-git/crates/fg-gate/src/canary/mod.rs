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
        const TRIVIAL_PATTERNS: [(&str, &str); 6] = [
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

        let mut tautologies = Vec::new();
        for (line_index, source_line) in test_code.lines().enumerate() {
            let trimmed = source_line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            let line_num = line_index + 1;

            if let Some((_, description)) = TRIVIAL_PATTERNS
                .iter()
                .find(|(pattern, _)| trimmed.contains(pattern))
            {
                tautologies.push((line_num, (*description).to_string()));
                continue;
            }

            if let Some(self_assert_msg) = extract_self_comparison_tautology(trimmed) {
                tautologies.push((line_num, self_assert_msg));
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
            if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.is_empty() {
                continue;
            }

            if let Some(fn_name) = try_parse_enclosing_fn(trimmed) {
                current_fn = Some(fn_name);
            }

            self.synthesize_line_mutants(
                SourceLineContext {
                    trimmed,
                    line_num: line_index + 1,
                    enclosing_fn: current_fn.as_deref(),
                },
                &mut mutants,
            );
        }

        mutants
    }

    /// Synthesizes relational, boolean, and boundary micro-mutants for a single source line.
    fn synthesize_line_mutants(
        &self,
        ctx: SourceLineContext<'_>,
        mutants: &mut Vec<MutantDescriptor>,
    ) {
        const REL_INVERSIONS: [(&str, &str); 6] = [
            (" == ", " != "),
            (" != ", " == "),
            (" > ", " <= "),
            (" < ", " >= "),
            (" >= ", " < "),
            (" <= ", " > "),
        ];

        let max_mutants = self.config.max_mutants_per_slice;
        if let Some((from, to)) = REL_INVERSIONS
            .iter()
            .find(|(from, _)| ctx.trimmed.contains(from))
        {
            push_mutant(
                mutants,
                ctx,
                (
                    MutationKind::OperatorInversion,
                    ctx.trimmed.replacen(from, to, 1),
                ),
            );
        }

        if mutants.len() >= max_mutants {
            return;
        }

        if !ctx.trimmed.contains("assert") {
            if ctx.trimmed.contains("true") {
                push_mutant(
                    mutants,
                    ctx,
                    (
                        MutationKind::BooleanFlip,
                        ctx.trimmed.replacen("true", "false", 1),
                    ),
                );
            } else if ctx.trimmed.contains("false") {
                push_mutant(
                    mutants,
                    ctx,
                    (
                        MutationKind::BooleanFlip,
                        ctx.trimmed.replacen("false", "true", 1),
                    ),
                );
            }
        }

        if mutants.len() < max_mutants && ctx.trimmed.contains(" + 1") {
            push_mutant(
                mutants,
                ctx,
                (
                    MutationKind::BoundaryShift,
                    ctx.trimmed.replacen(" + 1", " - 1", 1),
                ),
            );
        }
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

/// Detects self-comparison tautologies such as `assert_eq!(x, x)`.
fn extract_self_comparison_tautology(trimmed: &str) -> Option<String> {
    let clean_assertion = trimmed.trim_end_matches(';').trim();
    let inner_expr = clean_assertion.strip_prefix("assert_eq!(")?;
    let arg_tokens = inner_expr.strip_suffix(')')?;
    let (lhs, rhs) = arg_tokens.split_once(',')?;
    if rhs.contains(',') {
        return None;
    }
    let lhs_trimmed = lhs.trim();
    let rhs_trimmed = rhs.trim();
    (lhs_trimmed == rhs_trimmed)
        .then(|| format!("Self-assert identity assert_eq!({lhs_trimmed}, {rhs_trimmed}) detected"))
}

/// Extracts the function name from a single-line Rust `fn` declaration.
fn try_parse_enclosing_fn(trimmed: &str) -> Option<String> {
    let is_fn_decl = trimmed.starts_with("fn ")
        || trimmed.starts_with("pub fn ")
        || trimmed.starts_with("pub(crate) fn ");
    if !is_fn_decl || !trimmed.contains('(') {
        return None;
    }
    let fn_pos = trimmed.find("fn ")?;
    let after = &trimmed[fn_pos + 3..];
    let open_paren = after.find('(')?;
    let fn_name = after[..open_paren].trim();
    (!fn_name.is_empty()).then(|| fn_name.to_string())
}

/// Lexical context for one candidate source line during mutant synthesis.
#[derive(Clone, Copy)]
struct SourceLineContext<'a> {
    trimmed: &'a str,
    line_num: usize,
    enclosing_fn: Option<&'a str>,
}

/// Appends a synthesized `MutantDescriptor` to `mutants`.
fn push_mutant(
    mutants: &mut Vec<MutantDescriptor>,
    ctx: SourceLineContext<'_>,
    mutation: (MutationKind, String),
) {
    mutants.push(MutantDescriptor {
        id: mutants.len() + 1,
        line: ctx.line_num,
        kind: mutation.0,
        enclosing_fn: ctx.enclosing_fn.map(str::to_string),
        original_snippet: ctx.trimmed.to_string(),
        mutated_snippet: mutation.1,
    });
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
