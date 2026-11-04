//! Module: fg-core — Diagnostic Privacy & Rule Identifier Sanitizer
//! File Path: crates/fg-core/src/sanitizer.rs
//! Architecture Role: Separates internal governance rule codes and debug badges from human messages.
//! Dependencies & Triggers: Consumed by `fg_core::error::FractalError::user_display` and CLI formatters.
//! Responsibilities: Detect and extract rule codes, strip internal jargon badges for commercial users,
//!   and format structured diagnostics for developers.
//! Exit Semantics & Design Rationale: Centralizes rule-id stripping so no porcelain command
//!   leaks internal governance codes to general terminal end-users.
//!
//! Domain Governance Rules: FGT-COR-001 (core domain foundation), FGT-PRF-001 (zero allocation).

/// Separates an internal rule ID prefix (e.g. "FGT-MSG-001", "GUARD-MSG-001") from a violation message.
///
/// Returns `(Some(rule_id), clean_message)` if a recognized rule ID prefix is present,
/// or `(None, original_message)` otherwise.
pub fn split_rule_id(violation: &str) -> (Option<&str>, &str) {
    let trimmed = violation.trim();
    if let Some((prefix, rest)) = trimmed.split_once(':') {
        let candidate = prefix.trim();
        if is_rule_id_candidate(candidate) {
            return (Some(candidate), rest.trim());
        }
    }
    (None, trimmed)
}

/// Helper detecting whether a string conforms to workspace SSOT rule identifier naming conventions.
///
/// Identifiers follow uppercase hyphenated naming topologies (e.g. `FGT-MSG-001`, `GUARD-JAIL-001`).
pub fn is_rule_id_candidate(token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    let parts: Vec<&str> = token.split('-').collect();
    if parts.len() >= 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        })
    {
        return true;
    }
    false
}

/// Cleans a violation string for formal terminal end users, stripping internal rule identifiers
/// and debug bracket badges.
pub fn sanitize_violation_for_user(violation: &str) -> String {
    let (_, mut clean) = split_rule_id(violation);
    clean = clean.trim();
    if clean.starts_with('[') {
        if let Some(close) = clean.find(']') {
            let tag = &clean[1..close];
            if tag.chars().all(|c| c.is_ascii_uppercase() || c == '_') {
                clean = clean[close + 1..].trim_start();
            }
        }
    }
    clean.to_string()
}

/// Formats a violation string for developer diagnostics, ensuring the rule ID is clearly enclosed.
pub fn format_violation_diagnostic(violation: &str) -> String {
    let (rule_opt, clean) = split_rule_id(violation);
    match rule_opt {
        Some(rule_id) => format!("[{rule_id}] {clean}"),
        None => violation.trim().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_rule_id_recognition() {
        let (rule_opt, msg) = split_rule_id(
            "FGT-MSG-001: Header length must be at least 15 characters (actual: 10)",
        );
        assert_eq!(rule_opt, Some("FGT-MSG-001"));
        assert_eq!(
            msg,
            "Header length must be at least 15 characters (actual: 10)"
        );

        let (rule_guard, msg_guard) = split_rule_id("GUARD-MSG-001: Header missing ':' separator");
        assert_eq!(rule_guard, Some("GUARD-MSG-001"));
        assert_eq!(msg_guard, "Header missing ':' separator");

        let (no_rule, msg_plain) = split_rule_id("file.txt: not found");
        assert_eq!(no_rule, None);
        assert_eq!(msg_plain, "file.txt: not found");
    }

    #[test]
    fn test_sanitize_violation_for_user() {
        let raw = "FGT-MSG-001: Header length must be at least 15 characters (actual: 10)";
        assert_eq!(
            sanitize_violation_for_user(raw),
            "Header length must be at least 15 characters (actual: 10)"
        );

        let raw_bracket = "[AUTHORITY_BREACH] human 'alice' carries no credential; set secret";
        assert_eq!(
            sanitize_violation_for_user(raw_bracket),
            "human 'alice' carries no credential; set secret"
        );
    }
}
