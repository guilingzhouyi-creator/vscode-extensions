//! Module: fg-gate — Commit Typography Guard
//! File Path: crates/fg-gate/src/commit_guard/typography.rs
//! Architecture Role: Rejects characters that should never reach a commit message: zero-width
//!   formatting characters, decorative emoji, full-width punctuation standing in for ASCII
//!   structure, and rule identifiers that do not exist.
//! Dependencies & Triggers: Consumed by `commit_guard::verify` for the header and the whole body.
//! Responsibilities: Detect invisible characters, emoji, mis-set separators, and fabricated rule
//!   identifiers, naming the offending token and line.
//! Exit Semantics & Design Rationale: A commit message is permanent text that every later reader and
//!   diff viewer has to parse. An invisible character makes it searchable in one place and not
//!   another, and a fabricated rule identifier turns into a citation that resolves to nothing, so
//!   both are rejected rather than normalized away silently.
//!
//! Domain Governance Rules: FGT-MSG-001 (header form), FGT-MSG-012 (rule identifiers).

use fg_core::constants::rules::ALL_FGT_RULES;

/// A detected typography or citation violation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypographyFinding {
    /// Rule identifier the finding attributes to.
    pub rule_id: &'static str,
    /// Offending token, or a description when the token is invisible.
    pub token: String,
    /// One-based line number.
    pub line: usize,
    /// Explanation aimed at the author.
    pub message: String,
}

/// Scans a whole message for typography and rule-citation violations.
pub fn scan(message: &str) -> Vec<TypographyFinding> {
    let mut findings = Vec::new();
    for (index, line) in message.lines().enumerate() {
        scan_typography_line(index + 1, line, &mut findings);
    }
    findings
}

/// Scans one commit message line outside loop-allocation constraints.
fn scan_typography_line(line_number: usize, line: &str, findings: &mut Vec<TypographyFinding>) {
    if !line.is_ascii() {
        if let Some(invisible) = find_zero_width(line) {
            findings.push(TypographyFinding {
                rule_id: fg_core::constants::rules::RULE_FGT_MSG_001,
                token: invisible,
                line: line_number,
                message: "Commit message contains an invisible formatting character".to_string(),
            });
        }
        if let Some(emoji) = find_decorative_emoji(line) {
            findings.push(TypographyFinding {
                rule_id: fg_core::constants::rules::RULE_FGT_MSG_001,
                token: emoji,
                line: line_number,
                message: "Commit message contains a decorative emoji".to_string(),
            });
        }
    }
    if line_number == 1 {
        if let Some(separator) = find_mis_set_separator(line) {
            findings.push(TypographyFinding {
                rule_id: fg_core::constants::rules::RULE_FGT_MSG_001,
                token: separator,
                line: line_number,
                message: "Header must use an ASCII colon followed by exactly one space".to_string(),
            });
        }
    }
    if line.contains('-') {
        if let Some(citation) = find_unregistered_rule_id(line) {
            findings.push(TypographyFinding {
                rule_id: fg_core::constants::rules::RULE_FGT_MSG_012,
                token: citation,
                line: line_number,
                message: "Commit message cites a rule identifier that is not registered"
                    .to_string(),
            });
        }
    }
}

/// Finds the first zero-width or bidirectional control character.
fn find_zero_width(line: &str) -> Option<String> {
    for character in line.chars() {
        let code = character as u32;
        let is_invisible = matches!(
            code,
            0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0xFEFF
        );
        if is_invisible {
            return Some(format!("U+{code:04X}"));
        }
    }
    None
}

/// Finds the first decorative emoji outside the ASCII and CJK ranges.
fn find_decorative_emoji(line: &str) -> Option<String> {
    line.chars()
        .find(|character| {
            let code = *character as u32;
            (0x1F300..=0x1FAFF).contains(&code)
                || (0x2600..=0x27BF).contains(&code)
                || (0xFE0F..=0xFE0F).contains(&code)
        })
        .map(|character| character.to_string())
}

/// Finds a full-width colon or a mis-spaced ASCII colon in a conventional header.
///
/// Only the `type(scope):` prefix is inspected, because a colon inside the subject is ordinary
/// prose and rejecting it would make every sentence with a list invalid.
fn find_mis_set_separator(line: &str) -> Option<String> {
    let rest = line.strip_prefix(|character: char| character.is_ascii_alphabetic())?;
    let close = rest.find(')')?;
    let after_scope = rest[close + 1..].trim_start_matches('!');
    if after_scope.starts_with('：') {
        return Some("：".to_string());
    }
    if after_scope.starts_with(":  ") {
        return Some(":  ".to_string());
    }
    if after_scope.starts_with(':') && !after_scope.starts_with(": ") {
        return Some(format!(":{}", after_scope.chars().nth(1).unwrap_or(' ')));
    }
    None
}

/// Finds a token that looks like a rule identifier but is not registered.
fn find_unregistered_rule_id(line: &str) -> Option<String> {
    for word in line.split(|character: char| {
        character.is_whitespace() || matches!(character, ',' | ';' | '(' | ')' | '[' | ']')
    }) {
        let candidate = word
            .trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '-');
        if !looks_like_rule_id(candidate) || is_two_digit_pair_code(candidate) {
            continue;
        }
        if has_external_prefix(candidate) {
            continue;
        }
        if !is_registered(candidate) {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Whether a rule identifier is registered, kernel or workspace.
fn is_registered(candidate: &str) -> bool {
    ALL_FGT_RULES.binary_search(&candidate).is_ok()
        || crate::commit_guard::is_registered_workspace_rule(candidate)
}

/// Exempts PC and PP references with two digit-pair suffixes, matching the JS contract.
fn is_two_digit_pair_code(token: &str) -> bool {
    let bytes = token.as_bytes();
    bytes.len() == 8
        && (bytes.starts_with(b"PC-") || bytes.starts_with(b"PP-"))
        && bytes[3].is_ascii_digit()
        && bytes[4].is_ascii_digit()
        && bytes[5] == b'-'
        && bytes[6].is_ascii_digit()
        && bytes[7].is_ascii_digit()
}

/// Checks whether a segment consists strictly of ASCII uppercase letters and digits.
fn is_upper_alnum_segment(seg: &str) -> bool {
    !seg.is_empty()
        && seg
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

/// Checks whether `token` matches registered catalog rule shapes without allocating.
///
/// Recognized shapes (in parity with `validate-commit-msg.js`):
/// - `^[A-Z]{2,6}(?:-[A-Z0-9]+){2,}$` (e.g. `FGT-MSG-001`, `STDLIB-ALLOC-001`, `RES-TOPO-NAMING-DEPTH`)
/// - `^(?:LAY|HC|RCFG|SCR|TB)(?:-[A-Z0-9]+)+$` (e.g. `LAY-CYCLE`, `HC-ABS-PATH`, `RCFG-RULE-DRIFT`)
/// - `^L[0-5](?:-[A-Z0-9]+)+$` (e.g. `L0-COMPILE`, `L3-DOC-LAYOUT`)
fn looks_like_rule_id(token: &str) -> bool {
    let mut segments = token.split('-');
    let Some(head) = segments.next() else {
        return false;
    };
    let Some(second) = segments.next() else {
        return false;
    };
    if !is_upper_alnum_segment(head) || !is_upper_alnum_segment(second) {
        return false;
    }

    let mut segment_count = 2usize;
    for seg in segments {
        if !is_upper_alnum_segment(seg) {
            return false;
        }
        segment_count += 1;
    }

    if matches!(head, "LAY" | "HC" | "RCFG" | "SCR" | "TB") {
        return true;
    }
    let head_bytes = head.as_bytes();
    if head_bytes.len() == 2 && head_bytes[0] == b'L' && (b'0'..=b'5').contains(&head_bytes[1]) {
        return true;
    }
    segment_count >= 3
        && (2..=6).contains(&head.len())
        && head.bytes().all(|byte| byte.is_ascii_uppercase())
}

/// Whether a well-formed identifier is an external standard rather than a workspace rule.
fn has_external_prefix(token: &str) -> bool {
    const EXTERNAL: &[&str] = &[
        "UTF-", "SHA-", "RFC-", "CVE-", "ISO-", "IEEE-", "ECMA-", "ANSI-", "HTTP-", "TLS-", "AES-",
    ];
    EXTERNAL.iter().any(|prefix| token.starts_with(prefix))
}
