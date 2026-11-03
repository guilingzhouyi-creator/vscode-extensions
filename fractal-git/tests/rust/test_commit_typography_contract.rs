//! Test Suite: Commit Typography, Rule Citation and Rewrite Message Contracts
//! File Path: tests/rust/test_commit_typography_contract.rs
//!
//! Pins the guards that keep a commit message machine-readable: invisible characters, decorative
//! emoji, mis-set header separators, and rule identifiers that do not exist. It also pins the
//! rewrite-path contract, where inherited text must survive and authored text must not.

use fg_gate::commit_guard::rewrite::{
    merge_exemption_applies, verify_rewrite_message, MessageOrigin,
};
use fg_gate::PolicyFloor;
use fractal_git::CommitMessageGuard;
use fractal_git::TaxisPolicy;

/// A message that satisfies the workspace contract.
fn compliant_message() -> String {
    r#"feat(core): 新增提交信息排版与规则引用校验

[Project] fractal-git

[Why]
- 提交信息是长期技术档案，隐形字符与虚构规则标识都必须拦截。

[Added]
- 新增排版校验与规则标识闭包校验能力。

[Verification]
- 断言隐形字符与虚构规则标识均被拒绝。
"#
    .to_string()
}

#[test]
fn compliant_message_passes() {
    let policy = TaxisPolicy::workspace_strict();
    let result = CommitMessageGuard::parse_and_verify(&compliant_message(), &policy, None);
    assert!(result.is_ok(), "baseline must pass: {:?}", result.err());
}

#[test]
fn fabricated_rule_identifier_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = compliant_message().replace("长期技术档案", "ABC-XYZ-999 无法解析的技术档案");
    let error = CommitMessageGuard::parse_and_verify(&message, &policy, None)
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-012"),
        "a fabricated rule identifier must be rejected: {error}"
    );
}

#[test]
fn registered_rule_citation_survives() {
    let policy = TaxisPolicy::workspace_strict();
    let message = compliant_message().replace("长期技术档案", "FGT-MSG-002 规定的技术档案");
    let result = CommitMessageGuard::parse_and_verify(&message, &policy, None);
    assert!(
        result.is_ok(),
        "citing a registered kernel rule must pass: {:?}",
        result.err()
    );
}

#[test]
fn external_standard_citation_survives() {
    let policy = TaxisPolicy::workspace_strict();
    let message = compliant_message().replace("长期技术档案", "RFC-3629 规定的技术档案");
    let result = CommitMessageGuard::parse_and_verify(&message, &policy, None);
    assert!(
        result.is_ok(),
        "an external standard is a citation, not a workspace rule: {:?}",
        result.err()
    );
}

#[test]
fn decorative_emoji_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = compliant_message().replace("技术档案", "技术档案 🚀");
    let error = CommitMessageGuard::parse_and_verify(&message, &policy, None)
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-001"),
        "a decorative emoji must be rejected: {error}"
    );
}

#[test]
fn zero_width_character_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = compliant_message().replace("技术档案", "技术\u{200B}档案");
    let error = CommitMessageGuard::parse_and_verify(&message, &policy, None)
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-001"),
        "an invisible formatting character must be rejected: {error}"
    );
}

#[test]
fn inherited_rewrite_message_survives_the_light_contract() {
    let floor = PolicyFloor::governed_default();
    let policy = TaxisPolicy::workspace_strict();
    let inherited = "feat(core): 新增槽位解析\n\n[Project] fractal-git\n";
    let result = verify_rewrite_message(&policy, &floor, inherited, MessageOrigin::Inherited, None);
    assert!(
        result.is_ok(),
        "text that already passed a gate must not be re-judged against the full contract: {:?}",
        result.err()
    );
}

#[test]
fn inherited_rewrite_message_with_marker_is_rejected() {
    let floor = PolicyFloor::governed_default();
    let policy = TaxisPolicy::workspace_strict();
    let inherited = "feat(core): 新增槽位解析 TODO 待补充\n";
    let result = verify_rewrite_message(&policy, &floor, inherited, MessageOrigin::Inherited, None);
    assert!(
        result.is_err(),
        "an unresolved marker is unacceptable in a permanent record regardless of origin"
    );
}

#[test]
fn synthesized_stash_subject_is_not_rejected_for_containing_wip() {
    let floor = PolicyFloor::governed_default();
    let policy = TaxisPolicy::workspace_strict();
    let synthesized = "WIP on main: abc1234 feat(core): 新增槽位解析";
    let result = verify_rewrite_message(
        &policy,
        &floor,
        synthesized,
        MessageOrigin::Synthesized,
        None,
    );
    assert!(
        result.is_ok(),
        "Git's own stash subject spells WIP; rejecting it would make stash unusable: {:?}",
        result.err()
    );
}

#[test]
fn merge_exemption_requires_two_parents() {
    assert!(
        !merge_exemption_applies(1),
        "a single-parent commit is not a merge"
    );
    assert!(merge_exemption_applies(2), "a two-parent commit is a merge");
    assert!(merge_exemption_applies(3), "an octopus merge is a merge");
}

#[test]
fn downgrade_below_the_floor_is_refused() {
    let floor = PolicyFloor::governed_default();
    let native = TaxisPolicy::git_native();
    let error = verify_rewrite_message(&native, &floor, "wip", MessageOrigin::Authored, None)
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-011"),
        "a policy below the floor must be refused before any message check: {error}"
    );
}
