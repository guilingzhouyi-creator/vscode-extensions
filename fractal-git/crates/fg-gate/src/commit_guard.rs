//! Module: fg-gate — Rust-Grade Commit Message Governance & Semantic Diff Guard
//! File Path: crates/fg-gate/src/commit_guard.rs
//! Architecture Role: Implements compile-time strictness verification for commit messages,
//!   enforcing Conventional Commit formats, qualitative verification contracts,
//!   diff-to-scope coherence borrow checks, and anti-inflation forbidden patterns.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{DiffCoherenceMode, TaxisPolicy, ValidatedCommitWitness};
use std::collections::HashMap;

/// High-integrity commit message and semantic diff guard.
pub struct CommitMessageGuard;

impl CommitMessageGuard {
    /// Parses a raw commit message against a generalized `TaxisPolicy`
    /// and optional tree diff paths, returning a typed `ValidatedCommitWitness` on success
    /// or a `FractalError::GateRejection` on failure.
    pub fn parse_and_verify(
        raw_message: &str,
        policy: &TaxisPolicy,
        touched_paths: Option<&[String]>,
    ) -> FractalResult<ValidatedCommitWitness> {
        let trimmed = raw_message.trim();
        if trimmed.is_empty() {
            return Err(FractalError::GateRejection {
                score: 0.0,
                violations: vec![format!(
                    "{}: {}",
                    fg_core::constants::rules::RULE_FGT_GAT_001,
                    fg_core::constants::errors::MSG_COMMIT_MESSAGE_CANNOT_BE_EMPTY
                )],
            });
        }

        let lines: Vec<&str> = raw_message.lines().collect();
        let header = lines[0].trim();

        // Native Git Permissive bypass
        if policy.allowed_types.is_empty() && policy.min_header_chars <= 1 {
            return Ok(ValidatedCommitWitness::new(
                "custom",
                None,
                header,
                trimmed.len(),
                HashMap::new(),
                raw_message,
            ));
        }

        let mut violations = Vec::new();

        // 1. Header length and trailing dot check
        if header.len() < policy.min_header_chars || header.len() > policy.max_header_chars {
            violations.push(format!(
                "GUARD-MSG-001: Header length {} is outside bounds [{}..{}]",
                header.len(),
                policy.min_header_chars,
                policy.max_header_chars
            ));
        }
        if policy.disallow_header_period && (header.ends_with('.') || header.ends_with('。')) {
            violations
                .push("GUARD-MSG-001: Header summary must not end with a trailing period".into());
        }

        // 2. Conventional Commit header structure parsing
        let (commit_type, scope, summary) = Self::parse_header(header, &mut violations, policy);

        // 3. Blank line check between header and body
        if policy.require_blank_line && lines.len() > 1 {
            let second_line = lines[1].trim();
            if !second_line.is_empty() {
                violations.push(
                    "GUARD-MSG-001: Line 2 must be an empty blank line separating header and body"
                        .into(),
                );
            }
        }

        // 4. Parse structured body sections and compute substantive character count
        let (sections, substantive_chars) = Self::parse_sections(&lines[1..]);

        // 5. Production type checks (Why, Changed, Verification, min body length)
        let is_production = policy
            .production_types
            .iter()
            .any(|prod_type| prod_type.eq_ignore_ascii_case(&commit_type));
        if is_production {
            if substantive_chars < policy.min_body_chars {
                violations.push(format!(
                    "GUARD-MSG-001: Production commit '{}' has only {} substantive chars; \
                     minimum required is {}",
                    commit_type, substantive_chars, policy.min_body_chars
                ));
            }

            for required_sec in &policy.required_sections {
                let found = sections
                    .keys()
                    .any(|sec_key| sec_key.eq_ignore_ascii_case(required_sec));
                if !found {
                    violations.push(format!(
                        concat!(
                            "GUARD-MSG-001: Missing required structured section ",
                            "[{}] for production commit"
                        ),
                        required_sec
                    ));
                }
            }
        }

        // 6. Project tag check if configured
        if policy.require_project_tag {
            let found_project = sections
                .iter()
                .find(|(sec_key, _)| sec_key.to_lowercase().contains("project"));
            match found_project {
                None => violations.push("CMG-PRJ-001: Missing mandatory [Project] section".into()),
                Some((_, header_value)) => {
                    if !policy.allowed_projects.is_empty() {
                        let matches_allowed = policy.allowed_projects.iter().any(|allowed| {
                            header_value
                                .to_lowercase()
                                .contains(&allowed.to_lowercase())
                        });
                        if !matches_allowed {
                            violations.push(format!(
                                "CMG-PRJ-001: Project '{}' not in allowed list: {:?}",
                                header_value, policy.allowed_projects
                            ));
                        }
                    }
                }
            }
        }

        // 7. Forbidden terms filter (Anti-slang / Anti-hype)
        for forbidden in &policy.forbidden_terms {
            let lower_msg = raw_message.to_lowercase();
            let lower_term = forbidden.to_lowercase();
            if lower_msg.contains(&lower_term) {
                violations.push(format!(
                    "CMG-STY-001: Commit message contains forbidden term '{}'",
                    forbidden
                ));
            }
        }

        // 8. Qualitative Verification Check (No raw execution telemetry numbers)
        if policy.qualitative_verification_only {
            if let Some((_, ver_content)) = sections.iter().find(|(sec_key, _)| {
                sec_key.to_lowercase().contains("verification") || sec_key.contains("验证")
            }) {
                if Self::contains_execution_telemetry_numbers(ver_content) {
                    violations.push(
                        "CMG-STY-006: [Verification] must contain qualitative logic assertions; \
                         raw execution telemetry numbers/percentages are forbidden"
                            .into(),
                    );
                }
            }
        }

        // 9. Semantic Diff Borrow Check (Diff-to-Scope coherence)
        if policy.diff_coherence == DiffCoherenceMode::Strict {
            if let Some(paths) = touched_paths {
                if is_production && paths.is_empty() {
                    violations.push(
                        concat!(
                            "FGT-GAT-001: Semantic dangling pointer; ",
                            "production commit touches zero files"
                        )
                        .into(),
                    );
                }

                if let Some(ref sc) = scope {
                    let norm_scope = sc.to_lowercase();
                    // Each touched path should have affinity to the declared scope
                    for path in paths {
                        let norm_path = path.to_lowercase();
                        let is_broad_scope = norm_scope.contains("root")
                            || norm_scope.contains("all")
                            || norm_scope.contains("core");
                        if !norm_path.contains(&norm_scope) && !is_broad_scope {
                            violations.push(format!(
                                "FGT-GAT-001: Out-of-scope mutation: path '{}' \
                                 does not match declared scope '{}'",
                                path, sc
                            ));
                            break;
                        }
                    }
                }
            }
        }

        if !violations.is_empty() {
            return Err(FractalError::GateRejection {
                score: 0.0,
                violations,
            });
        }

        Ok(ValidatedCommitWitness::new(
            commit_type,
            scope,
            summary,
            substantive_chars,
            sections,
            raw_message,
        ))
    }

    fn parse_header(
        header: &str,
        violations: &mut Vec<String>,
        policy: &TaxisPolicy,
    ) -> (String, Option<String>, String) {
        let colon_idx = match header.find(':') {
            Some(idx) => idx,
            None => {
                violations.push(
                    concat!(
                        "GUARD-MSG-001: Header missing ':' separator ",
                        "(expected '<type>(<scope>): <summary>')"
                    )
                    .into(),
                );
                return ("unknown".into(), None, header.to_string());
            }
        };

        let type_and_scope = header[..colon_idx].trim();
        let summary = header[colon_idx + 1..].trim().to_string();

        let (commit_type, scope) = if let Some(open_paren) = type_and_scope.find('(') {
            if type_and_scope.ends_with(')') {
                let parsed_type = type_and_scope[..open_paren].trim().to_lowercase();
                let parsed_scope = type_and_scope[open_paren + 1..type_and_scope.len() - 1]
                    .trim()
                    .to_string();
                (parsed_type, Some(parsed_scope))
            } else {
                violations.push(
                    "GUARD-MSG-001: Malformed scope in header (unmatched parentheses)".into(),
                );
                (type_and_scope.to_lowercase(), None)
            }
        } else {
            (type_and_scope.to_lowercase(), None)
        };

        if !policy.allowed_types.is_empty()
            && !policy
                .allowed_types
                .iter()
                .any(|allowed_type| allowed_type.eq_ignore_ascii_case(&commit_type))
        {
            violations.push(format!(
                "GUARD-MSG-001: Commit type '{}' is not in allowed list: {:?}",
                commit_type, policy.allowed_types
            ));
        }

        (commit_type, scope, summary)
    }

    fn parse_sections(body_lines: &[&str]) -> (HashMap<String, String>, usize) {
        let mut sections = HashMap::new();
        let mut current_section: Option<String> = None;
        let mut current_content = Vec::new();
        let mut substantive_chars = 0;

        for line in body_lines {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            // Check for section header like `[Why]` or `[Project: foo]`
            if trimmed.starts_with('[') && trimmed.contains(']') {
                if let Some(sec_name) = current_section.take() {
                    sections.insert(sec_name, current_content.join("\n"));
                    current_content.clear();
                }

                let close_bracket = match trimmed.find(']') {
                    Some(idx) => idx,
                    None => continue,
                };
                let inside = &trimmed[1..close_bracket];

                if let Some(colon) = inside.find(':') {
                    let sec_key = inside[..colon].trim().to_string();
                    let sec_val = inside[colon + 1..].trim().to_string();
                    sections.insert(sec_key, sec_val);
                    current_section = None;
                } else {
                    current_section = Some(inside.trim().to_string());
                }
            } else {
                substantive_chars += trimmed
                    .chars()
                    .filter(|char_val| !char_val.is_whitespace())
                    .count();
                current_content.push(trimmed);
            }
        }

        if let Some(sec_name) = current_section {
            sections.insert(sec_name, current_content.join("\n"));
        }

        (sections, substantive_chars)
    }

    fn contains_execution_telemetry_numbers(text: &str) -> bool {
        let lower = text.to_lowercase();
        // Check for common telemetry stream patterns like "100%", "exit code 0",
        // "15 tests passed", "0.04s"
        lower.contains("exit code 0")
            || lower.contains("100% pass")
            || lower.contains("all tests pass")
            || lower.contains("tests passed")
            || lower.contains("suites passed")
            || (lower.contains("tests") && lower.chars().any(|char_val| char_val.is_ascii_digit()))
    }
}
