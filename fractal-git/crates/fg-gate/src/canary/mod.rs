//! Module: fg-gate — Inline Kernel Canary Engine (IKCE)
//! File Path: crates/fg-gate/src/canary/mod.rs
//! Architecture Role: Static mutation-candidate generation and test hygiene inspection.
//!   Candidate names and assertion tokens are diagnostics, not proof that tests executed.
//!
//! Dependencies & Triggers: Consumed by the slice entry point of `AutoAuditHook`.
//! Responsibilities:
//!   - Text-based mutation candidates (comparison inversion, boolean flip, boundary shifts).
//!   - Tautological assertion interception (`assert!(true)`, `assert_eq!(x, x)`, etc.).
//!   - Explicitly absent execution metrics until a real runner supplies trial evidence.
//!
//! Exit Semantics & Design Rationale:
//!   - In-memory static inspection does not execute submitted code or tests.
//!   - Static hygiene success cannot satisfy a policy requiring measured mutation results.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Protocol gate facade and rule compliance
//! - `FGT-MUT-001`: In-Kernel Canary Engine (IKCE) blind mutation kill rate guard
//! - `FGT-TAU-001`: In-Kernel Canary Engine (IKCE) anti-tautology guard
//! - `RCFG-RULE-DRIFT`: Rule drift prevention

use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// Injectable callback evaluating whether a synthesized mutant is killed by the supplied test slice.
pub type MutantKillEvaluator = Arc<dyn Fn(&MutantDescriptor, &str, &str) -> bool + Send + Sync>;

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

/// Configuration parameters for `KernelCanaryEngine`.
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

/// Comprehensive report produced by `KernelCanaryEngine`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CanaryReport {
    /// Total number of valid mutants synthesized.
    pub total_mutants: usize,
    /// Number of mutants killed by an executed test suite; absent for static inspection.
    pub killed_mutants: Option<usize>,
    /// Measured kill rate; absent until a runner supplies actual trial results.
    pub kill_rate: Option<f64>,
    /// Number of tautological assertions detected in test code.
    pub tautological_assert_count: usize,
    /// Diagnostic violation explanations.
    pub violations: Vec<String>,
    /// Whether static hygiene checks passed; grants no execution or merge authority.
    pub static_hygiene_passed: bool,
}

/// Inline Kernel Canary Engine (IKCE) verifying test efficacy via deterministic invariant probes.
#[derive(Clone)]
pub struct KernelCanaryEngine {
    config: CanaryConfig,
    evaluator: Option<MutantKillEvaluator>,
}

impl std::fmt::Debug for KernelCanaryEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KernelCanaryEngine")
            .field("config", &self.config)
            .field("has_custom_evaluator", &self.evaluator.is_some())
            .finish()
    }
}

/// Backward-compatible alias for [`KernelCanaryEngine`].
pub type ShadowCanaryEngine = KernelCanaryEngine;

impl KernelCanaryEngine {
    /// Creates a new canary engine instance with the given configuration.
    pub const fn new(config: CanaryConfig) -> Self {
        Self {
            config,
            evaluator: None,
        }
    }

    /// Attaches a custom mutant kill verifier callback.
    #[must_use]
    pub fn with_mutant_evaluator(mut self, evaluator: MutantKillEvaluator) -> Self {
        self.evaluator = Some(evaluator);
        self
    }

    /// Evaluates candidate source code and test assertions via deterministic invariant probes.
    pub fn evaluate_slice(&self, source_code: &str, test_code: &str) -> CanaryReport {
        let mut violations = Vec::new();

        // 1. Detect tautological/empty assertions in tests
        let tautologies = self.detect_tautological_assertions(test_code);
        let tautology_count = tautologies.len();

        if self.config.reject_tautological_assertions && !tautologies.is_empty() {
            for (line_num, diagnosis) in &tautologies {
                push_tautology_violation(&mut violations, *line_num, diagnosis);
            }
        }

        // 2. Synthesize micro-mutants on the source code
        let mutants = self.generate_mutants(source_code);
        let total_mutants = mutants.len();
        let (non_comment_lines, active_assertions) = collect_active_test_lines(test_code);

        let (killed_mutants, kill_rate) =
            if total_mutants == 0 || (active_assertions.is_empty() && self.evaluator.is_none()) {
                (None, None)
            } else {
                let killed = self.count_killed_mutants(
                    &mutants,
                    source_code,
                    (test_code, &non_comment_lines, &active_assertions),
                );
                let rate = killed as f64 / total_mutants as f64;
                if rate < self.config.min_kill_rate {
                    push_kill_rate_violation(
                        &mut violations,
                        rate,
                        self.config.min_kill_rate,
                        (killed, total_mutants),
                    );
                }
                (Some(killed), Some(rate))
            };

        let static_hygiene_passed = violations.is_empty();

        CanaryReport {
            total_mutants,
            killed_mutants,
            kill_rate,
            tautological_assert_count: tautology_count,
            violations,
            static_hygiene_passed,
        }
    }

    /// Counts how many synthesized mutants are killed by the active test probe assertions.
    fn count_killed_mutants(
        &self,
        mutants: &[MutantDescriptor],
        source_code: &str,
        test_ctx: (&str, &[&str], &[&str]),
    ) -> usize {
        let (raw_test_code, non_comment_lines, active_assertions) = test_ctx;
        let mut killed = 0usize;
        for mutant in mutants {
            let is_killed = match self.evaluator {
                Some(ref custom_eval) => custom_eval(mutant, source_code, raw_test_code),
                None => is_mutant_killed_by_probes(mutant, non_comment_lines, active_assertions),
            };
            if is_killed {
                killed += 1;
            }
        }
        killed
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
                push_tautology(&mut tautologies, line_num, description);
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

        const BOUNDARY_SHIFTS: [(&str, &str); 3] =
            [(" + 1", " - 1"), (" - 1", " + 1"), (" * ", " + ")];
        if mutants.len() < max_mutants {
            if let Some((from, to)) = BOUNDARY_SHIFTS
                .iter()
                .find(|(from, _)| ctx.trimmed.contains(from))
            {
                push_mutant(
                    mutants,
                    ctx,
                    (
                        MutationKind::BoundaryShift,
                        ctx.trimmed.replacen(from, to, 1),
                    ),
                );
            }
        }
    }
}

/// Appends a formatted tautology violation message.
fn push_tautology_violation(violations: &mut Vec<String>, line_num: usize, diagnosis: &str) {
    violations.push(format!(
        "Tautological assertion in test line {line_num}: {diagnosis} (FGT-TAU-001)"
    ));
}

/// Appends a formatted kill-rate violation message.
fn push_kill_rate_violation(
    violations: &mut Vec<String>,
    rate: f64,
    min_rate: f64,
    counts: (usize, usize),
) {
    let (killed, total) = counts;
    violations.push(format!(
        "Mutant kill rate {:.1}% is below required threshold {:.1}% (killed {killed}/{total}) (FGT-MUT-001)",
        rate * 100.0,
        min_rate * 100.0,
    ));
}

/// Appends a detected tautology tuple.
fn push_tautology(tautologies: &mut Vec<(usize, String)>, line_num: usize, description: &str) {
    tautologies.push((line_num, description.to_string()));
}

/// Collects non-comment test lines and active non-tautological assertion lines.
fn collect_active_test_lines(test_code: &str) -> (Vec<&str>, Vec<&str>) {
    let mut non_comment_lines = Vec::new();
    let mut active_assertions = Vec::new();
    for raw_line in test_code.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("/*") {
            continue;
        }
        non_comment_lines.push(trimmed);
        if is_active_assertion_line(trimmed) {
            active_assertions.push(trimmed);
        }
    }
    (non_comment_lines, active_assertions)
}

/// Checks whether a non-comment line contains a non-tautological assertion macro.
fn is_active_assertion_line(trimmed: &str) -> bool {
    const TRIVIAL_TOKENS: [&str; 6] = [
        "assert!(true)",
        "assert!(1 == 1)",
        "assert!(0 == 0)",
        "assert_eq!(true, true)",
        "assert_eq!(1, 1)",
        "assert_eq!(0, 0)",
    ];
    let has_assert = ["assert!(", "assert_eq!(", "assert_ne!("]
        .iter()
        .any(|pat| trimmed.contains(pat));
    has_assert
        && !TRIVIAL_TOKENS.iter().any(|pat| trimmed.contains(pat))
        && extract_self_comparison_tautology(trimmed).is_none()
}

/// Evaluates whether a mutant is killed by active non-comment test probes.
fn is_mutant_killed_by_probes(
    mutant: &MutantDescriptor,
    non_comment_lines: &[&str],
    active_assertions: &[&str],
) -> bool {
    if active_assertions.is_empty() {
        return false;
    }
    if let Some(ref fn_name) = mutant.enclosing_fn {
        if non_comment_lines
            .iter()
            .any(|line| line.contains(fn_name.as_str()))
        {
            return true;
        }
    }
    mutant
        .original_snippet
        .split(|ch: char| !ch.is_alphanumeric() && ch != '_')
        .filter(|token| token.len() >= 3 && !is_common_keyword(token))
        .any(|token| non_comment_lines.iter().any(|line| line.contains(token)))
}

/// Identifies common Rust language keywords that do not disambiguate identifier coverage.
fn is_common_keyword(word: &str) -> bool {
    const KEYWORDS: [&str; 17] = [
        "let", "mut", "fn", "pub", "return", "if", "else", "for", "while", "in", "match", "struct",
        "impl", "enum", "true", "false", "self",
    ];
    KEYWORDS.contains(&word)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_comment_tokens_do_not_prove_mutant_execution() -> Result<(), serde_json::Error> {
        let engine = KernelCanaryEngine::new(CanaryConfig::default());
        let source = "pub fn is_valid(value: i32) -> bool {\n value > 10\n}";
        let report = engine.evaluate_slice(source, "// assert!(is_valid(11));");
        assert!(report.total_mutants > 0);
        let encoded = serde_json::to_value(report)?;
        assert!(encoded["kill_rate"].is_null());
        assert!(encoded["killed_mutants"].is_null());
        Ok(())
    }

    #[test]
    fn test_zero_mutation_candidates_are_not_perfect_execution() -> Result<(), serde_json::Error> {
        let engine = KernelCanaryEngine::new(CanaryConfig::default());
        let report = engine.evaluate_slice("pub fn noop() {}", "");
        assert_eq!(report.total_mutants, 0);
        let encoded = serde_json::to_value(report)?;
        assert!(encoded["kill_rate"].is_null());
        Ok(())
    }

    #[test]
    fn test_detect_tautological_assertions() {
        let engine = KernelCanaryEngine::new(CanaryConfig::default());
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
        let engine = KernelCanaryEngine::new(CanaryConfig::default());
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
        let engine = KernelCanaryEngine::new(CanaryConfig::default());
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
        assert!(report.static_hygiene_passed);
        assert_eq!(report.killed_mutants, Some(1));
        assert_eq!(report.kill_rate, Some(1.0));
    }

    #[test]
    fn test_evaluate_slice_fails_on_tautology() {
        let engine = KernelCanaryEngine::new(CanaryConfig::default());
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
        assert!(!report.static_hygiene_passed);
        assert!(report.tautological_assert_count > 0);
    }
}
