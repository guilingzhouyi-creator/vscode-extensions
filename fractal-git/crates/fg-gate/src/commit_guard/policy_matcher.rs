//! Module: fg-gate — Cached Policy Forbidden Term DFA Matcher
//! File Path: crates/fg-gate/src/commit_guard/policy_matcher.rs
//! Architecture Role: Evaluates `TaxisPolicy.forbidden_terms` against commit bodies using
//!   a digest-validated `OnceLock<CachedPolicyMatcher>` Aho-Corasick byte DFA.
//! Dependencies & Triggers: Uses `ac_matcher::AcMatcher` and `lexicon::contains_whole_term`;
//!   invoked by `CommitMessageGuard` during commit body evaluation.
//! Responsibilities: Compute FNV digests for policy term tables, compile lowercase DFAs once,
//!   and emit matched forbidden terms in exact slice order with stack-first flag storage.
//! Exit Semantics & Design Rationale: Zero heap allocation for `<= 128` terms and zero panics.
//!
//! Domain Governance Rules: FGT-PRF-001 (zero loop heap allocation), FGT-ERR-001, CMT-DOC-001.

use super::ac_matcher::AcMatcher;
use super::lexicon::contains_whole_term;
use std::sync::OnceLock;

struct CachedPolicyMatcher {
    terms: Vec<String>,
    digest: u64,
    matcher: AcMatcher,
}

fn compute_terms_digest(terms: &[String]) -> (u64, usize) {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut total_bytes = 0usize;
    for entry in terms {
        total_bytes = total_bytes.saturating_add(entry.len());
        for &byte in entry.as_bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    (hash, total_bytes)
}

fn compile_policy_terms_matcher(
    terms: &[String],
    total_bytes: usize,
    digest: u64,
) -> CachedPolicyMatcher {
    let mut lower_arena = String::with_capacity(total_bytes);
    let mut spans = Vec::with_capacity(terms.len());
    for term in terms {
        let start = lower_arena.len();
        if term.is_ascii() {
            for &byte in term.as_bytes() {
                lower_arena.push(byte.to_ascii_lowercase() as char);
            }
        } else {
            for ch in term.chars() {
                for lower_ch in ch.to_lowercase() {
                    lower_arena.push(lower_ch);
                }
            }
        }
        spans.push((start, lower_arena.len()));
    }
    let matcher = AcMatcher::compile(
        spans
            .iter()
            .enumerate()
            .map(|(idx, &(start, end))| (idx, &lower_arena[start..end])),
        total_bytes.saturating_add(16),
    );
    CachedPolicyMatcher {
        terms: terms.to_vec(),
        digest,
        matcher,
    }
}

fn emit_flagged_terms<'a, F: FnMut(&'a str)>(
    policy_terms: &'a [String],
    flags: &[bool],
    on_match: &mut F,
) {
    for (idx, flag) in flags.iter().enumerate() {
        if *flag {
            on_match(&policy_terms[idx]);
        }
    }
}

/// Evaluates `policy_terms` against `prepared` using a lock-free compiled DFA matching term order.
pub(crate) fn for_each_matching_policy_term<'a, F: FnMut(&'a str)>(
    prepared: &str,
    policy_terms: &'a [String],
    mut on_match: F,
) {
    if policy_terms.is_empty() || prepared.is_empty() {
        return;
    }
    static PRIMARY: OnceLock<CachedPolicyMatcher> = OnceLock::new();
    let (digest, total_bytes) = compute_terms_digest(policy_terms);
    let primary =
        PRIMARY.get_or_init(|| compile_policy_terms_matcher(policy_terms, total_bytes, digest));

    if primary.digest == digest && primary.terms.as_slice() == policy_terms {
        let term_count = policy_terms.len();
        if term_count <= 128 {
            let mut stack_flags = [false; 128];
            let matched_slice = &mut stack_flags[..term_count];
            primary
                .matcher
                .mark_whole_term_matches(prepared, matched_slice);
            emit_flagged_terms(policy_terms, matched_slice, &mut on_match);
            return;
        }
        let mut heap_flags = vec![false; term_count];
        primary
            .matcher
            .mark_whole_term_matches(prepared, &mut heap_flags);
        emit_flagged_terms(policy_terms, &heap_flags, &mut on_match);
        return;
    }

    for term in policy_terms {
        let matched = if term.bytes().any(|byte| byte.is_ascii_uppercase()) || !term.is_ascii() {
            contains_whole_term(prepared, &term.to_lowercase())
        } else {
            contains_whole_term(prepared, term)
        };
        if matched {
            on_match(term);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ac_policy_matcher_matches_linear_reference() {
        let policy = fg_core::models::TaxisPolicy::workspace_strict();
        let cases = [
            "refactor(fg-gate): reuse cached automaton without copying",
            "attempt template matching for quick fixup without errors",
            "apply quick fix and hack before exit code 0 check",
            "使用临时文件验证后移除临时补丁",
            "all tests passed and 100% safe without error",
            "check `temp_buffer` and wip-flag with oracle hint",
        ];
        for sample in cases {
            let masked = sample.to_lowercase();
            let mut actual = Vec::new();
            for_each_matching_policy_term(&masked, &policy.forbidden_terms, |term| {
                actual.push(term.to_string());
            });
            let mut expected = Vec::new();
            for term in &policy.forbidden_terms {
                if contains_whole_term(&masked, &term.to_lowercase()) {
                    expected.push(term.clone());
                }
            }
            assert_eq!(actual, expected, "policy matcher diverged on {sample:?}");
        }
    }
}
