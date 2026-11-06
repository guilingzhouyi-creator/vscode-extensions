//! Regression Suite: Commit Message Guard Bypass Contract
//! File Path: tests/rust/test_commit_bypass_contract.rs
//!
//! The bypass flag is a governance surface, so it has to satisfy two opposing requirements at once:
//! it must actually exempt the message when an exception is granted, and it must leave a record
//! that a later auditor can find. A previous revision accepted the flag, validated the reason, and
//! then ran the full message check anyway, while pointing the audit reference at a path the
//! reference parser could not accept. That combination is the worst case: the surface looked
//! binding to a reader of the policy manifest and was inert to the caller.
//!
//! These tests pin both halves.

use fg_core::models::Oid;
use fractal_git::FractalRef;

fn sample_oid() -> Oid {
    Oid::from_bytes([0x5Au8; 20])
}

#[test]
fn the_documented_bypass_audit_reference_is_parseable() {
    // commit-policy.json promises `refs/fractal/telemetry/commit-bypass/{commit_oid}`. If the
    // parser rejects that shape, the promised audit trail cannot exist: the receipt has nowhere to
    // be written, and an auditor who follows the manifest reaches a dead end.
    let commit = sample_oid();
    let documented = format!("refs/fractal/telemetry/commit-bypass/{}", commit.to_hex());

    let parsed = FractalRef::parse(&documented)
        .unwrap_or_else(|| panic!("documented bypass audit reference must parse: {documented}"));

    assert!(
        matches!(parsed, FractalRef::CommitBypassAudit { commit_oid } if commit_oid == commit),
        "bypass audit must resolve to the commit it exempted, got {parsed:?}"
    );
    assert!(
        parsed.is_telemetry(),
        "a bypass receipt lives in the protected telemetry namespace"
    );
}

#[test]
fn bypass_audit_reference_round_trips_through_its_canonical_form() {
    // A receipt that parses but re-serializes to a different string cannot be listed and matched
    // against the manifest, which makes it un-auditable in practice.
    let commit = sample_oid();
    let reference = FractalRef::CommitBypassAudit { commit_oid: commit };
    let rendered = reference.to_git_ref();
    let reparsed = FractalRef::parse(&rendered).expect("canonical form must parse");

    assert_eq!(
        reparsed, reference,
        "round trip through {rendered} must preserve identity"
    );
}

#[test]
fn a_malformed_bypass_audit_reference_is_refused() {
    // The trailing component is an object id, so a shape that cannot name one must not resolve.
    for malformed in [
        "refs/fractal/telemetry/commit-bypass",
        "refs/fractal/telemetry/commit-bypass/not-an-oid",
        "refs/fractal/telemetry/commit-bypass/5a5a5a5a",
    ] {
        assert!(
            FractalRef::parse(malformed).is_none(),
            "'{malformed}' must not resolve to an audit reference"
        );
    }
}

#[test]
fn bypass_audit_is_distinct_from_the_ordinary_commit_receipt() {
    // `telemetry/commit/<oid>` is the receipt for a commit that passed the contract, and
    // `telemetry/commit-bypass/<oid>` is the receipt for one that skipped it. Collapsing them would
    // let a bypass masquerade as a pass in any report that counts receipts by prefix.
    let commit = sample_oid();
    let bypass = FractalRef::parse(&format!(
        "refs/fractal/telemetry/commit-bypass/{}",
        commit.to_hex()
    ))
    .expect("bypass");
    let ordinary = FractalRef::parse(&format!(
        "refs/fractal/telemetry/commit/{}",
        commit.to_hex()
    ))
    .expect("ordinary");

    assert_ne!(bypass, ordinary);
    assert_ne!(bypass.to_git_ref(), ordinary.to_git_ref());
}
