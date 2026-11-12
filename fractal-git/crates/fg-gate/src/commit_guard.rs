//! Module: fg-gate — Rust-Grade Commit Message Governance & Semantic Diff Guard
//! File Path: crates/fg-gate/src/commit_guard.rs
//! Architecture Role: Implements compile-time strictness verification for commit messages,
//!   enforcing Conventional Commit formats, qualitative verification contracts,
//!   diff-to-scope coherence borrow checks, and anti-inflation forbidden patterns.
//! Dependencies & Triggers: Consumed by Taxis CLI commit pipeline and pre-commit gate hooks.
//! Responsibilities: Validate conventional header syntax, required multi-line sections,
//!   forbidden buzzword patterns, and path scope congruence.
//! Exit Semantics & Design Rationale: Fails closed with structured GateRejection; produces
//!   non-forgeable ValidatedCommitWitness only on complete verification.
//!
//! Domain Governance Rules: FGT-GAT-001 (gate governance), FGT-COR-001.

pub mod coherence;
pub mod declaration;
pub mod lexicon;
pub mod project;
pub mod rewrite;
pub mod rule_ids;
pub mod sections;
pub mod style;
pub mod typography;
pub mod verification;

pub(crate) use rule_ids::is_registered as is_registered_workspace_rule;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{TaxisPolicy, ValidatedCommitWitness};
use std::collections::HashMap;

/// Parsed sections and metrics extracted from the commit body lines.
#[derive(Debug, Clone)]
pub struct SectionParseResult {
    /// Case-insensitive section mapping (e.g. "Why" -> content).
    pub sections: HashMap<String, String>,
    /// Number of substantive non-whitespace technical characters excluding metadata.
    pub substantive_chars: usize,
    /// Headings encountered in physical document order: `(normalized_name, raw_heading)`.
    pub headings: Vec<(String, String)>,
}

#[derive(Clone, Copy)]
struct CommitMeta<'a> {
    commit_type: &'a str,
    is_breaking: bool,
    is_production: bool,
}

/// High-integrity commit message and semantic diff guard.
pub struct CommitMessageGuard;

impl CommitMessageGuard {
    /// Parses a raw commit message against a generalized `TaxisPolicy`
    /// and optional tree diff paths, returning a typed `ValidatedCommitWitness` on success
    /// or a `FractalError::GateRejection` on failure.
    ///
    /// This entry point has no access to the changed source, so it cannot check declaration
    /// anchoring. Call [`Self::parse_and_verify_with_symbols`] when the staged content is available
    /// and the policy asks for anchors.
    pub fn parse_and_verify(
        raw_message: &str,
        policy: &TaxisPolicy,
        touched_paths: Option<&[String]>,
    ) -> FractalResult<ValidatedCommitWitness> {
        Self::verify_message(raw_message, policy, touched_paths, &[])
    }

    /// Parses and verifies a commit message with the symbols the diff actually introduced.
    ///
    /// Declaration anchoring is only meaningful when the candidate set is known, so the strictest
    /// policy tier requires this entry point rather than the path-only one.
    pub fn parse_and_verify_with_symbols(
        raw_message: &str,
        policy: &TaxisPolicy,
        touched_paths: Option<&[String]>,
        candidates: &[declaration::CandidateSymbol],
    ) -> FractalResult<ValidatedCommitWitness> {
        Self::verify_message(raw_message, policy, touched_paths, candidates)
    }

    fn verify_message(
        raw_message: &str,
        policy: &TaxisPolicy,
        touched_paths: Option<&[String]>,
        candidates: &[declaration::CandidateSymbol],
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
            // The witness records a character count so every witness field means the same thing
            // regardless of which policy produced it; a byte count here would make two witnesses
            // incomparable whenever the message contains non-ASCII text.
            let trimmed_chars = trimmed.chars().count();
            return Ok(ValidatedCommitWitness::new(
                "custom",
                None,
                header,
                trimmed_chars,
                HashMap::new(),
                raw_message,
            ));
        }

        let mut violations = Vec::new();

        // 1. Header length and trailing dot check
        Self::validate_header_bounds(header, policy, &mut violations);

        // 2. Conventional Commit header structure parsing
        let (commit_type, scope, summary, is_breaking) =
            Self::parse_header(header, &mut violations, policy);

        // 2b. Imperative subject contract: a version history reads as a list of actions.
        if let Some(finding) = style::check_imperative_subject(&summary) {
            violations.push(format!(
                "{}: {} (token '{}')",
                finding.rule_id, finding.message, finding.token
            ));
        }

        // 3. Body sections & substantive character count
        let parsed_sections = Self::parse_sections(&lines[1..]);
        let section_scan = sections::SectionScan::parse(&lines[1..]);
        let is_production = policy
            .production_types
            .iter()
            .any(|prod_type| prod_type == &commit_type);

        // 4. Blank line, production/non-critical sections, ordering, deduplication, and project tag checks
        let meta = CommitMeta {
            commit_type: &commit_type,
            is_breaking,
            is_production,
        };
        Self::validate_body_spacing_and_trailers(
            &lines,
            policy,
            meta,
            &parsed_sections,
            &section_scan,
            &mut violations,
        );

        // 5. Anti-inflation forbidden terms and verification telemetry check
        Self::validate_anti_inflation_telemetry(
            raw_message,
            &lines,
            policy,
            &parsed_sections.sections,
            &mut violations,
        );

        // 5b. Typography and rule-citation integrity.
        for finding in typography::scan(raw_message) {
            violations.push(format!(
                "{}: {} (line {}, token '{}')",
                finding.rule_id, finding.message, finding.line, finding.token
            ));
        }

        // 5c. Declaration anchoring: what the verification section claims must be traceable to
        // something the diff introduced. Only the strict tier demands it, and only when the caller
        // supplied the candidate set, because a check with no evidence to compare would fail every
        // commit regardless of its content.
        if policy.require_declaration_anchor && is_production && !candidates.is_empty() {
            if let Some(verification_section) = section_scan
                .find(sections::SectionSlot::Verification)
                .map(|section| section.lines.join("\n"))
            {
                if !declaration::has_anchor(&verification_section, candidates) {
                    violations.push(format!(
                        "{}: The verification section cites no symbol or test name that the diff introduced; \
                         name what was actually demonstrated",
                        fg_core::constants::rules::RULE_FGT_MSG_010
                    ));
                }
            }
        }

        fg_core::diag_trace!(
            "commit_guard",
            "policy={} type={} production={} candidates={} violations={}",
            policy.name,
            commit_type,
            is_production,
            candidates.len(),
            violations.len()
        );
        for violation in &violations {
            fg_core::diag_debug!("commit_guard", "violation: {violation}");
        }

        // 6. Semantic Diff Borrow Check (Diff-to-Scope coherence)
        coherence::validate_diff_coherence(
            policy,
            touched_paths,
            is_production,
            scope.as_deref(),
            &mut violations,
        );

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
            parsed_sections.substantive_chars,
            parsed_sections.sections,
            raw_message,
        ))
    }

    fn validate_header_bounds(header: &str, policy: &TaxisPolicy, violations: &mut Vec<String>) {
        // Length bounds are expressed in characters, not bytes.
        //
        // `str::len()` reports UTF-8 bytes, so a 30-character Chinese header measured 90 and was
        // rejected by a bound that always meant 90 characters. The reference implementation in
        // `scripts/common/commit-structure-contract.js` counts characters too, so byte counting
        // made the two sides disagree on every non-ASCII subject.
        let header_chars = header.chars().count();
        if header_chars < policy.min_header_chars || header_chars > policy.max_header_chars {
            violations.push(format!(
                "GUARD-MSG-001: Header length {} is outside bounds [{}..{}] characters",
                header_chars, policy.min_header_chars, policy.max_header_chars
            ));
        }
        if policy.disallow_header_period && (header.ends_with('.') || header.ends_with('。')) {
            violations
                .push("GUARD-MSG-001: Header summary must not end with a trailing period".into());
        }
    }

    fn parse_header(
        header: &str,
        violations: &mut Vec<String>,
        policy: &TaxisPolicy,
    ) -> (String, Option<String>, String, bool) {
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
                return ("unknown".into(), None, header.to_string(), false);
            }
        };

        let type_and_scope = header[..colon_idx].trim();
        let summary = header[colon_idx + 1..].trim().to_string();

        let (commit_type, scope, is_breaking) = if let Some(open_paren) = type_and_scope.find('(') {
            let ends_with_bang = type_and_scope.ends_with(")!");
            if ends_with_bang || type_and_scope.ends_with(')') {
                let scope_end = if ends_with_bang {
                    type_and_scope.len() - 2
                } else {
                    type_and_scope.len() - 1
                };
                let mut raw_type = type_and_scope[..open_paren].trim();
                let mut breaking = ends_with_bang;
                if let Some(stripped) = raw_type.strip_suffix('!') {
                    raw_type = stripped.trim();
                    breaking = true;
                }
                let parsed_scope = type_and_scope[open_paren + 1..scope_end].trim().to_string();
                (raw_type.to_string(), Some(parsed_scope), breaking)
            } else {
                violations.push(
                    "GUARD-MSG-001: Malformed scope in header (unmatched parentheses)".into(),
                );
                let (raw_type, breaking) = match type_and_scope.strip_suffix('!') {
                    Some(stripped) => (stripped.trim().to_string(), true),
                    None => (type_and_scope.to_string(), false),
                };
                (raw_type, None, breaking)
            }
        } else {
            let (raw_type, breaking) = match type_and_scope.strip_suffix('!') {
                Some(stripped) => (stripped.trim().to_string(), true),
                None => (type_and_scope.to_string(), false),
            };
            (raw_type, None, breaking)
        };

        if policy.require_scope {
            match &scope {
                None => {
                    violations.push(
                        "GUARD-MSG-001: Mandatory scope is missing in header (expected '<type>(<scope>): <summary>')".into(),
                    );
                }
                Some(scope_text)
                    if scope_text.is_empty() || scope_text.chars().any(char::is_whitespace) =>
                {
                    violations.push(
                        "GUARD-MSG-001: Mandatory scope is empty or contains whitespace".into(),
                    );
                }
                _ => {}
            }
        }

        if !policy.allowed_types.is_empty()
            && !policy
                .allowed_types
                .iter()
                .any(|allowed_type| allowed_type == &commit_type)
        {
            violations.push(format!(
                "GUARD-MSG-001: Commit type '{}' is not in allowed list: {:?}",
                commit_type, policy.allowed_types
            ));
        }

        (commit_type, scope, summary, is_breaking)
    }

    fn parse_sections(body_lines: &[&str]) -> SectionParseResult {
        let mut sections = HashMap::new();
        let mut headings = Vec::new();
        let mut current_section: Option<String> = None;
        let mut current_content = Vec::new();
        let mut substantive_chars = 0;

        for line in body_lines {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if trimmed.starts_with('[') {
                if let Some(close_bracket) = trimmed.find(']') {
                    let inside = trimmed[1..close_bracket].trim();
                    let after = trimmed[close_bracket + 1..].trim();

                    if let Some(sec_name) = current_section.take() {
                        sections.insert(sec_name, current_content.join("\n"));
                        current_content.clear();
                    }

                    let (sec_name, inline_content) = if let Some(colon) = inside.find(':') {
                        let name = inside[..colon].trim();
                        let inline_payload = inside[colon + 1..].trim();
                        (name, inline_payload)
                    } else {
                        (inside, after)
                    };

                    let norm_sec = sec_name.trim().to_string();
                    headings.push((norm_sec.clone(), trimmed.to_string()));

                    let payload_text = inline_content.trim_start_matches(':').trim();
                    if !payload_text.is_empty() {
                        current_content.push(payload_text.to_string());
                        if !norm_sec.eq_ignore_ascii_case("project") && !norm_sec.contains("项目")
                        {
                            substantive_chars +=
                                payload_text.chars().filter(|c| !c.is_whitespace()).count();
                        }
                    }

                    current_section = Some(norm_sec);
                    continue;
                }
            }

            let is_in_project = current_section
                .as_ref()
                .is_some_and(|sec| sec.eq_ignore_ascii_case("project") || sec.contains("项目"));

            if !is_in_project {
                substantive_chars += trimmed.chars().filter(|c| !c.is_whitespace()).count();
            }
            current_content.push(trimmed.to_string());
        }

        if let Some(sec_name) = current_section {
            sections.insert(sec_name, current_content.join("\n"));
        }

        SectionParseResult {
            sections,
            substantive_chars,
            headings,
        }
    }

    fn get_section_rank(name: &str) -> u8 {
        let lower = name.trim().to_lowercase();
        if lower == "project" || lower == "项目" || lower == "项目归属" {
            1
        } else if lower == "why" || lower == "动机" || lower == "背景" || lower == "动机背景"
        {
            2
        } else if matches!(
            lower.as_str(),
            "added"
                | "changed"
                | "fixed"
                | "removed"
                | "新增"
                | "新增内容"
                | "新增功能"
                | "变更"
                | "变更调整"
                | "修改"
                | "调整"
                | "重构"
                | "修复"
                | "修复缺陷"
                | "删除"
                | "移除"
        ) {
            3
        } else if matches!(
            lower.as_str(),
            "breaking changes" | "breaking change" | "破坏性变更"
        ) {
            4
        } else if lower == "verification" || lower == "验证" || lower == "验证结论" {
            5
        } else {
            99
        }
    }

    fn check_blank_line(lines: &[&str], require_blank_line: bool, violations: &mut Vec<String>) {
        if require_blank_line && lines.len() > 1 && !lines[1].trim().is_empty() {
            violations.push(
                "GUARD-MSG-001: Line 2 must be an empty blank line separating header and body"
                    .into(),
            );
        }
    }

    fn check_section_duplicates(
        headings: &[(String, String)],
        disallow_duplicate: bool,
        violations: &mut Vec<String>,
    ) {
        if !disallow_duplicate {
            return;
        }
        let mut seen = std::collections::HashSet::new();
        for (sec_name, _) in headings {
            let lower = sec_name.to_lowercase();
            if !seen.insert(lower) {
                violations.push(format!(
                    "GUARD-MSG-001: Duplicate structured section '[{}]' found in commit body",
                    sec_name
                ));
            }
        }
    }

    fn check_section_topology(
        headings: &[(String, String)],
        enforce_ordering: bool,
        violations: &mut Vec<String>,
    ) {
        if !enforce_ordering {
            return;
        }
        let mut max_rank = 0u8;
        let mut last_sec_name = "";
        for (sec_name, _) in headings {
            let rank = Self::get_section_rank(sec_name);
            if rank == 99 {
                continue;
            }
            if rank < max_rank {
                violations.push(format!(
                    "GUARD-MSG-001: Sections violate topological order: '[{}]' must appear before '[{}]'",
                    sec_name, last_sec_name
                ));
            } else {
                max_rank = rank;
                last_sec_name = sec_name.as_str();
            }
        }
    }

    fn check_type_specific_sections(
        commit_type: &str,
        is_breaking: bool,
        scan: &sections::SectionScan,
        sections: &HashMap<String, String>,
        policy: &TaxisPolicy,
        violations: &mut Vec<String>,
    ) {
        if commit_type == "fix" {
            let has_fixed = sections.keys().any(|section_key| {
                let lower = section_key.to_lowercase();
                lower == "fixed" || lower == "修复" || lower == "修复缺陷"
            });
            if !has_fixed {
                violations.push(
                    "GUARD-MSG-001: Fix commits must use '[Fixed]' section instead of '[Changed]'"
                        .into(),
                );
            }
        }

        if !policy.required_sections.is_empty() {
            if commit_type == "feat" && !scan.has_slot(sections::SectionSlot::Added) {
                violations.push(format!(
                    "{}: Commit type 'feat' requires structured section [Added]",
                    fg_core::constants::rules::RULE_FGT_MSG_002
                ));
            }
            if (commit_type == "refactor" || commit_type == "perf")
                && !scan.has_slot(sections::SectionSlot::Changed)
            {
                violations.push(format!(
                    "{}: Commit type '{}' requires structured section [Changed]",
                    fg_core::constants::rules::RULE_FGT_MSG_002,
                    commit_type
                ));
            }
            if is_breaking && !scan.has_slot(sections::SectionSlot::Breaking) {
                violations.push(format!(
                    "{}: Breaking commit (header contains '!') requires structured section [Breaking Changes]",
                    fg_core::constants::rules::RULE_FGT_MSG_002
                ));
            }
        }
    }

    fn check_body_volume_and_required_sections(
        commit_type: &str,
        is_production: bool,
        parsed: &SectionParseResult,
        scan: &sections::SectionScan,
        policy: &TaxisPolicy,
        violations: &mut Vec<String>,
    ) {
        if is_production {
            if parsed.substantive_chars < policy.min_body_chars {
                violations.push(format!(
                    "{}: Production commit '{}' has only {} substantive chars; minimum required is {}",
                    fg_core::constants::rules::RULE_FGT_MSG_003,
                    commit_type,
                    parsed.substantive_chars,
                    policy.min_body_chars
                ));
            }

            // Required sections are matched by semantic slot, so `[动机]`, `[Project / 项目归属]`
            // and `[Added]` all satisfy the obligation the template asks for. Matching literal
            // heading text rejected the very spelling the authoring guide recommends.
            for required in &policy.required_sections {
                if let Some(slot) = sections::resolve_required_slot(required) {
                    if scan.has_slot(slot) {
                        continue;
                    }
                    if slot.is_change_group() && scan.has_change_slot() {
                        continue;
                    }
                    violations.push(format!(
                        "{}: Missing required structured section [{}] for production commit",
                        fg_core::constants::rules::RULE_FGT_MSG_002,
                        slot.canonical_name()
                    ));
                    continue;
                }
                let found = parsed.sections.keys().any(|section_key| {
                    section_key.eq_ignore_ascii_case(required)
                        || section_key.contains(required.as_str())
                });
                if !found {
                    violations.push(format!(
                        "{}: Missing required structured section [{}] for production commit",
                        fg_core::constants::rules::RULE_FGT_MSG_002,
                        required
                    ));
                }
            }
        } else {
            if policy.min_non_critical_body_chars > 0
                && parsed.substantive_chars < policy.min_non_critical_body_chars
            {
                violations.push(format!(
                    "{}: Non-critical commit '{}' has only {} substantive chars; minimum required is {}",
                    fg_core::constants::rules::RULE_FGT_MSG_003,
                    commit_type,
                    parsed.substantive_chars,
                    policy.min_non_critical_body_chars
                ));
            }

            for required in &policy.non_critical_required_sections {
                if let Some(slot) = sections::resolve_required_slot(required) {
                    if scan.has_slot(slot) {
                        continue;
                    }
                    if slot.is_change_group() && scan.has_change_slot() {
                        continue;
                    }
                    violations.push(format!(
                        "{}: Missing required structured section [{}] for non-critical commit",
                        fg_core::constants::rules::RULE_FGT_MSG_002,
                        slot.canonical_name()
                    ));
                    continue;
                }
                if !parsed
                    .sections
                    .keys()
                    .any(|section_key| section_key.eq_ignore_ascii_case(required))
                {
                    violations.push(format!(
                        "{}: Missing required structured section [{}] for non-critical commit",
                        fg_core::constants::rules::RULE_FGT_MSG_002,
                        required
                    ));
                }
            }
        }
    }

    fn validate_body_spacing_and_trailers(
        lines: &[&str],
        policy: &TaxisPolicy,
        meta: CommitMeta<'_>,
        parsed: &SectionParseResult,
        scan: &sections::SectionScan,
        violations: &mut Vec<String>,
    ) {
        Self::check_blank_line(lines, policy.require_blank_line, violations);
        sections::check_body_formatting(lines, violations);
        Self::check_section_duplicates(
            &parsed.headings,
            policy.disallow_duplicate_sections,
            violations,
        );
        Self::check_section_topology(
            &parsed.headings,
            policy.enforce_section_ordering,
            violations,
        );
        Self::check_type_specific_sections(
            meta.commit_type,
            meta.is_breaking,
            scan,
            &parsed.sections,
            policy,
            violations,
        );
        sections::check_empty_sections(scan, violations);
        sections::check_section_floors(scan, violations);
        Self::check_body_volume_and_required_sections(
            meta.commit_type,
            meta.is_production,
            parsed,
            scan,
            policy,
            violations,
        );
        project::check_project_tag(&parsed.sections, scan, policy, violations);
    }

    /// Checks vocabulary, style, and verification quality.
    ///
    /// Lexical and stylistic findings come from the dedicated guards, which mask code spans and
    /// subtract the shared whitelist. The policy's own term list is still consulted so a caller can
    /// add repository-specific words without editing the shared tables.
    fn validate_anti_inflation_telemetry(
        raw_message: &str,
        lines: &[&str],
        policy: &TaxisPolicy,
        sections: &HashMap<String, String>,
        violations: &mut Vec<String>,
    ) {
        // The lexical pass also returns the masked, whitelist-subtracted text, so the
        // policy-specific term check below reuses it instead of redoing the whole scan.
        let (lexicon_findings, prepared) = lexicon::scan(raw_message);
        for finding in lexicon_findings {
            violations.push(format!(
                "{}: {} (line {}, token '{}')",
                finding.rule_id, finding.message, finding.line, finding.token
            ));
        }

        for finding in style::scan_body_lines(lines) {
            violations.push(format!(
                "{}: {} (token '{}')",
                finding.rule_id, finding.message, finding.token
            ));
        }

        for forbidden in &policy.forbidden_terms {
            if lexicon::contains_whole_term(&prepared, &forbidden.to_lowercase()) {
                violations.push(format!(
                    "{}: Commit message contains forbidden term '{}'",
                    fg_core::constants::rules::RULE_FGT_MSG_004,
                    forbidden
                ));
            }
        }

        let ver_entry = sections.iter().find(|(key, _)| {
            let lower = key.to_lowercase();
            lower.contains("verification") || key.contains("验证")
        });

        let Some((_, ver_content)) = ver_entry else {
            return;
        };
        if policy.qualitative_verification_only
            && verification::contains_execution_telemetry_numbers(ver_content)
        {
            violations.push(format!(
                "{}: [Verification] must contain qualitative logic assertions; raw execution telemetry numbers/percentages are forbidden",
                rule_ids::RULE_CMG_STY_006
            ));
        }
        if policy.require_falsifiable_verification
            && !verification::has_falsifiable_assertion(ver_content)
        {
            violations.push(format!(
                "{}: [Verification] must contain at least one substantive falsifiable technical assertion (not a raw shell command or placeholder)",
                rule_ids::RULE_CMG_STY_006
            ));
        }
    }
}
