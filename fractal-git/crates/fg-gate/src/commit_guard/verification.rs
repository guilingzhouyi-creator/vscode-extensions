//! Module: fg-gate — Verification Section Assertion Quality
//! File Path: crates/fg-gate/src/commit_guard/verification.rs
//! Architecture Role: Decides whether a `[Verification]` section states something falsifiable or
//!   merely asserts that work happened.
//! Dependencies & Triggers: Consumed by `commit_guard::verify` when a policy demands a real
//!   verification conclusion.
//! Responsibilities: Extract bullet or prose assertions, reject mere completions, hedges and bare
//!   command invocations, and report whether anything actionable remains.
//! Exit Semantics & Design Rationale: The section exists so a reader can tell what was actually
//!   demonstrated. `ok`, `done` and a bare `cargo test` demonstrate nothing, and hedging phrases
//!   signal the author has not checked, so all three are rejected rather than scored.
//!
//! Domain Governance Rules: FGT-MSG-003 (density), FGT-MSG-004 (vocabulary).

/// Tokens that state completion without stating an observation.
const TRIVIAL_COMPLETIONS: &[&str] = &[
    "ok",
    "done",
    "pass",
    "passed",
    "yes",
    "已完成",
    "已经完成",
    "已修复",
    "已经修复",
    "已改好",
    "没问题",
    "无问题",
    "通过",
];

/// Phrases that signal an unchecked assumption.
const HEDGE_PHRASES: &[&str] = &[
    "应该",
    "大概",
    "基本上没问题",
    "基本没问题",
    "不出意外",
    "按理",
    "后续再看",
    "待处理",
];

/// Command prefixes whose bare invocation carries no assertion.
const CLI_PREFIXES: &[&str] = &[
    "npm ", "npx ", "node ", "pwsh ", "bash ", "git ", "cargo ", "tsc ", "vitest ", "python ",
];

/// Minimum substantive characters for an assertion to count.
const MIN_ASSERTION_CHARS: usize = 8;

/// Extracts bullet items from the verification content, falling back to prose lines.
pub fn extract_assertions(verification_content: &str) -> Vec<String> {
    let mut bullets = Vec::new();
    let mut prose = Vec::new();
    for line in verification_content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('-') || trimmed.starts_with('*') {
            let bullet = trimmed.trim_start_matches(['-', '*', ' ']).trim();
            if !bullet.is_empty() {
                bullets.push(bullet.to_string());
            }
        } else {
            prose.push(trimmed);
        }
    }
    if bullets.is_empty() && !prose.is_empty() {
        bullets.push(prose.join(" "));
    }
    bullets
}

/// Whether the section contains at least one falsifiable assertion.
pub fn has_falsifiable_assertion(verification_content: &str) -> bool {
    extract_assertions(verification_content)
        .iter()
        .any(|assertion| is_falsifiable(assertion))
}

/// Whether one assertion states something a reader could check.
pub fn is_falsifiable(assertion: &str) -> bool {
    let plain = strip_code_spans(assertion);
    let plain = plain.trim();
    if plain.is_empty() {
        return false;
    }
    let lower = plain.to_lowercase();
    let without_trailing = lower.trim_end_matches(['.', '!', '。', '！', ';', '；']);

    if TRIVIAL_COMPLETIONS.contains(&without_trailing) {
        return false;
    }
    if HEDGE_PHRASES.iter().any(|phrase| lower.contains(phrase)) {
        return false;
    }
    if CLI_PREFIXES.iter().any(|prefix| lower.starts_with(prefix)) {
        let states_outcome = [
            "pass", "fail", "成功", "通过", "绿色", ";", "；", "->", "=>",
        ]
        .iter()
        .any(|marker| lower.contains(marker));
        if !states_outcome {
            return false;
        }
    }
    substantive_char_count(plain) >= MIN_ASSERTION_CHARS
}

/// Removes inline code spans so quoted commands do not count as prose.
fn strip_code_spans(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_code = false;
    for character in input.chars() {
        if character == '`' {
            in_code = !in_code;
        } else if !in_code {
            output.push(character);
        }
    }
    output
}

/// Counts characters that carry meaning rather than layout.
fn substantive_char_count(text: &str) -> usize {
    text.chars()
        .filter(|character| {
            !character.is_whitespace()
                && !matches!(
                    character,
                    '。' | '，'
                        | ','
                        | '、'
                        | '；'
                        | ';'
                        | '：'
                        | ':'
                        | '!'
                        | '！'
                        | '-'
                        | '*'
                        | '`'
                        | '('
                        | ')'
                        | '（'
                        | '）'
                )
        })
        .count()
}

/// Checks for common execution telemetry stream patterns in text.
pub fn contains_execution_telemetry_numbers(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("exit code 0")
        || lower.contains("100% pass")
        || lower.contains("all tests pass")
        || lower.contains("tests passed")
        || lower.contains("suites passed")
        || (lower.contains("tests") && lower.chars().any(|char_val| char_val.is_ascii_digit()))
}
