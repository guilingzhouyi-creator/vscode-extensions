//! Test Suite: Commit Header Length Metrics — Unicode Character Counting Contract
//! File Path: tests/rust/test_commit_header_metrics.rs
//!
//! The header length bound is a property of the text a human reads, not of its transport
//! encoding. Measuring `&str::len()` reports UTF-8 bytes, so a Chinese header of 30 characters
//! measures 90 and is rejected by an 80-unit bound that was always meant to be 80 characters.
//! The reference implementation (`scripts/common/commit-structure-contract.js`) counts UTF-16
//! code units, which equals the character count for everything outside the astral plane.
//!
//! These tests pin the character-count contract at the exact boundaries so a future refactor
//! cannot quietly reintroduce byte counting.

use fractal_git::{CommitMessageGuard, TaxisPolicy};

/// Builds a policy whose header bound is exactly `min`..=max characters, with every other
/// obligation relaxed so a failure can only come from the header length predicate.
fn bounds_policy(min: usize, max: usize) -> TaxisPolicy {
    let mut policy = TaxisPolicy::conventional_semantic();
    policy.min_header_chars = min;
    policy.max_header_chars = max;
    policy.require_scope = false;
    policy.min_body_chars = 0;
    policy.min_non_critical_body_chars = 0;
    policy.required_sections.clear();
    policy.non_critical_required_sections.clear();
    policy.forbidden_terms.clear();
    policy.require_project_tag = false;
    policy.qualitative_verification_only = false;
    policy.require_falsifiable_verification = false;
    policy.disallow_header_period = false;
    policy
}

/// Header length rejection must report the character count, not the byte count.
#[test]
fn header_length_is_measured_in_characters_not_bytes() {
    let policy = bounds_policy(1, 80);
    // 33 CJK characters appended to a 12-character ASCII prefix: 45 characters, 111 bytes.
    let header = format!("feat(core): {}", "验".repeat(33));
    assert_eq!(header.chars().count(), 45, "fixture must be 45 characters");
    assert_eq!(header.len(), 111, "fixture must be 111 UTF-8 bytes");

    let message = format!("{header}\n");
    let result = CommitMessageGuard::parse_and_verify(&message, &policy, None);
    assert!(
        result.is_ok(),
        "a 33-character CJK header must pass an 80-character bound even though it is 69 bytes: {:?}",
        result.err()
    );
}

/// A pure-CJK header longer than the bound must still be rejected.
#[test]
fn over_long_cjk_header_is_rejected() {
    let policy = bounds_policy(1, 80);
    // 100 characters, 276 UTF-8 bytes.
    let header = format!("feat(core): {}", "验".repeat(88));
    assert_eq!(header.chars().count(), 100);
    assert_eq!(header.len(), 276);

    let message = format!("{header}\n");
    let result = CommitMessageGuard::parse_and_verify(&message, &policy, None);
    assert!(
        result.is_err(),
        "a 100-character header must be rejected by an 80-character bound"
    );
}

/// The boundary is inclusive on both ends and exclusive one past each end.
#[test]
fn header_bound_is_inclusive_at_both_ends() {
    let policy = bounds_policy(20, 40);

    // "feat(core): " is 12 characters, so the CJK tail sets the total.
    let at_min = format!("feat(core): {}\n", "验".repeat(8));
    assert_eq!(at_min.trim_end().chars().count(), 20);
    assert!(
        CommitMessageGuard::parse_and_verify(&at_min, &policy, None).is_ok(),
        "exactly min characters must pass"
    );

    let one_below_min = format!("feat(core): {}\n", "验".repeat(7));
    assert_eq!(one_below_min.trim_end().chars().count(), 19);
    assert!(
        CommitMessageGuard::parse_and_verify(&one_below_min, &policy, None).is_err(),
        "one character below min must fail"
    );

    let at_max = format!("feat(core): {}\n", "验".repeat(28));
    assert_eq!(at_max.trim_end().chars().count(), 40);
    assert!(
        CommitMessageGuard::parse_and_verify(&at_max, &policy, None).is_ok(),
        "exactly max characters must pass"
    );

    let one_above_max = format!("feat(core): {}\n", "验".repeat(29));
    assert_eq!(one_above_max.trim_end().chars().count(), 41);
    assert!(
        CommitMessageGuard::parse_and_verify(&one_above_max, &policy, None).is_err(),
        "one character above max must fail"
    );
}

/// The rejection diagnostic must quote the character count, so the author can act on it.
#[test]
fn rejection_diagnostic_reports_character_count() {
    let policy = bounds_policy(1, 20);
    let header = format!("feat(core): {}", "验".repeat(98));
    assert_eq!(header.chars().count(), 110);
    assert_eq!(header.len(), 306);

    let message = format!("{header}\n");
    let error = CommitMessageGuard::parse_and_verify(&message, &policy, None)
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();

    assert!(
        error.contains("110"),
        "diagnostic must report the 110-character length, got: {error}"
    );
    assert!(
        !error.contains("330"),
        "diagnostic must not report the 330-byte length, got: {error}"
    );
}

/// ASCII behaviour is unchanged: 80 bytes and 80 characters coincide.
#[test]
fn ascii_bound_behaviour_is_unchanged() {
    let policy = bounds_policy(1, 80);

    let ascii_at_max = format!("feat(core): {}\n", "a".repeat(68));
    assert_eq!(ascii_at_max.trim_end().len(), 80);
    assert!(
        CommitMessageGuard::parse_and_verify(&ascii_at_max, &policy, None).is_ok(),
        "80 ASCII characters must pass"
    );

    let ascii_over = format!("feat(core): {}\n", "a".repeat(69));
    assert_eq!(ascii_over.trim_end().len(), 81);
    assert!(
        CommitMessageGuard::parse_and_verify(&ascii_over, &policy, None).is_err(),
        "81 ASCII characters must fail"
    );
}
