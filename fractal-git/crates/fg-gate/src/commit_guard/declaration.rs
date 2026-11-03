//! Module: fg-gate — Declaration Anchor Guard
//! File Path: crates/fg-gate/src/commit_guard/declaration.rs
//! Architecture Role: Cross-checks what the `[Verification]` section claims against what the
//!   staged diff actually contains.
//! Dependencies & Triggers: Consumed by `commit_guard::verify` when a policy asks for declaration
//!   anchoring, which is the strictest tier of the workspace contract.
//! Responsibilities: Extract candidate symbols from added diff lines, extract the identifiers the
//!   verification section cites, and require a non-empty intersection.
//! Exit Semantics & Design Rationale: A verification conclusion that names nothing the diff touched
//!   is the cheapest possible way to satisfy a "must say what you verified" rule while verifying
//!   nothing, so an empty intersection is a rejection rather than a warning. Path fragments do not
//!   count: naming a directory is not evidence of anything. Symbol extraction is pattern-based
//!   because the kernel carries no parser dependency, so the patterns are limited to declaration
//!   forms that are unambiguous across the languages this repository contains.
//!
//! Domain Governance Rules: FGT-MSG-010 (declaration anchors).

/// A symbol name discovered in added diff lines.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateSymbol {
    /// Name as written in the source.
    pub name: String,
    /// Declaration keyword that produced it, for diagnostics.
    pub kind: &'static str,
}

/// Declaration openings recognized across Rust, TypeScript and GDScript.
///
/// Each entry is `(prefix, keywords)`; a token following a keyword is a candidate symbol. The list
/// is deliberately narrow: a broad pattern such as "any identifier" would match every prose word
/// and make the intersection meaningless.
const DECLARATION_KEYWORDS: &[&str] = &[
    "fn",
    "func",
    "function",
    "struct",
    "enum",
    "trait",
    "impl",
    "class",
    "class_name",
    "interface",
    "type",
    "const",
    "static",
    "let",
    "mod",
    "pub",
];

/// Extracts candidate symbols from the added lines of a unified diff.
///
/// Only lines beginning with `+` are considered, and the leading marker is stripped first so a
/// removal cannot contribute a symbol that no longer exists.
pub fn extract_candidate_symbols(diff_text: &str) -> Vec<CandidateSymbol> {
    let mut symbols: Vec<CandidateSymbol> = Vec::new();
    for line in diff_text.lines() {
        let Some(added) = line.strip_prefix('+') else {
            continue;
        };
        if added.starts_with("+++") {
            continue;
        }
        for symbol in symbols_in_line(added) {
            if !symbols.iter().any(|existing| existing.name == symbol.name) {
                symbols.push(symbol);
            }
        }
    }
    symbols
}

/// Extracts candidate symbols from a list of plain source lines.
///
/// Used when the caller has new file content rather than a diff, which is the shape a staged entry
/// has before any comparison has been made.
pub fn extract_candidate_symbols_from_lines(lines: &[&str]) -> Vec<CandidateSymbol> {
    let mut symbols: Vec<CandidateSymbol> = Vec::new();
    for line in lines {
        for symbol in symbols_in_line(line) {
            if !symbols.iter().any(|existing| existing.name == symbol.name) {
                symbols.push(symbol);
            }
        }
    }
    symbols
}

/// Finds declaration symbols in one source line.
fn symbols_in_line(line: &str) -> Vec<CandidateSymbol> {
    let mut found = Vec::new();
    let tokens: Vec<&str> = line
        .split(|character: char| {
            character.is_whitespace()
                || matches!(character, '(' | ')' | '{' | '}' | ';' | ',' | '<' | '>')
        })
        .filter(|token| !token.is_empty())
        .collect();
    for (index, token) in tokens.iter().enumerate() {
        if !DECLARATION_KEYWORDS.contains(token) {
            continue;
        }
        let Some(next) = tokens.get(index + 1) else {
            continue;
        };
        let name =
            next.trim_matches(|character: char| !character.is_alphanumeric() && character != '_');
        if name.is_empty() || name.chars().count() < 3 {
            continue;
        }
        if !name
            .chars()
            .next()
            .is_some_and(|character| character.is_alphabetic())
        {
            continue;
        }
        found.push(CandidateSymbol {
            name: name.to_string(),
            kind: keyword_kind(token),
        });
    }
    found
}

/// Maps a declaration keyword to a readable kind.
fn keyword_kind(keyword: &str) -> &'static str {
    match keyword {
        "fn" | "func" | "function" => "function",
        "struct" | "class" | "class_name" | "interface" => "type",
        "enum" => "enum",
        "trait" => "trait",
        "const" | "static" | "let" => "value",
        _ => "declaration",
    }
}

/// Extracts the identifiers a verification section cites.
///
/// A citation is an identifier written in backticks, which is how this repository's commit
/// convention marks code, or a bare identifier that also happens to be a candidate symbol. The
/// second form is handled by the intersection test rather than here, because the author may cite a
/// symbol without quoting it.
pub fn extract_citations(verification_content: &str) -> Vec<String> {
    let mut citations = Vec::new();
    let mut in_code = false;
    let mut current = String::new();
    for character in verification_content.chars() {
        if character == '`' {
            if in_code {
                let trimmed = current.trim();
                if !trimmed.is_empty() && is_identifier(trimmed) {
                    citations.push(trimmed.to_string());
                }
                current.clear();
            }
            in_code = !in_code;
            continue;
        }
        if in_code {
            current.push(character);
        }
    }
    citations
}

/// Whether a backticked span is a single identifier rather than a command line.
fn is_identifier(span: &str) -> bool {
    !span.is_empty()
        && span.chars().count() <= 80
        && !span.contains(char::is_whitespace)
        && span
            .chars()
            .all(|character| character.is_alphanumeric() || "_-:.$/".contains(character))
}

/// Whether any cited identifier or bare symbol name appears in the candidate set.
///
/// The comparison is intentionally bidirectional: the author may write the symbol name plainly, or
/// the candidate may be a fully qualified path whose leaf the author cited.
pub fn has_anchor(verification_content: &str, candidates: &[CandidateSymbol]) -> bool {
    if candidates.is_empty() {
        return false;
    }
    let citations = extract_citations(verification_content);
    for citation in &citations {
        let leaf = citation.rsplit(['/', ':']).next().unwrap_or(citation);
        if candidates
            .iter()
            .any(|candidate| candidate.name == *citation || candidate.name == leaf)
        {
            return true;
        }
    }
    // A plain mention without backticks still counts when it names a real candidate symbol.
    candidates.iter().any(|candidate| {
        verification_content.contains(&candidate.name) && candidate.name.chars().count() >= 4
    })
}
