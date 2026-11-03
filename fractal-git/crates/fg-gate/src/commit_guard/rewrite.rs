//! Module: fg-gate — History Rewrite Message Guard
//! File Path: crates/fg-gate/src/commit_guard/rewrite.rs
//! Architecture Role: Applies the commit-message contract to the commands that author history
//!   rather than a fresh checkpoint: merge, rebase, cherry-pick, revert and stash.
//! Dependencies & Triggers: Consumed by the corresponding Taxis CLI dispatchers.
//! Responsibilities: Select the right validation strength for each command and reject an
//!   inheriting message only when it carries something no message may carry.
//! Exit Semantics & Design Rationale: Inherited messages get the light contract, authored messages
//!   get the full one. Re-validating a message that already passed a strict gate would reject
//!   legitimate history on a rule change, which trains authors to bypass the gate entirely; but
//!   letting an authored message through unchecked leaves the largest source of commits unguarded.
//!   The distinction is therefore *who wrote the text now*, not *which command is running*.
//!
//! Domain Governance Rules: FGT-MSG-001 (header), FGT-MSG-004 (vocabulary),
//!   FGT-MSG-005 (markers), FGT-MSG-008 (batch codenames), FGT-MSG-009 (merge exemption).

use fg_core::error::{FractalError, FractalResult};

use super::{lexicon, style, CommitMessageGuard};
use crate::policy_floor::PolicyFloor;
use fg_core::models::{TaxisPolicy, ValidatedCommitWitness};

/// How much of the contract applies to one message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageOrigin {
    /// The author is writing this text now; the full contract applies.
    Authored,
    /// The text is copied from an earlier commit that already passed the gate.
    Inherited,
    /// The text is synthesized by the tool (revert notice, stash subject).
    Synthesized,
}

/// Validates a message produced by a history-rewriting command.
///
/// # Errors
///
/// Returns [`FractalError::GateRejection`] when the message violates the contract that applies to
/// `origin`, or when the requested policy sits below the repository floor.
pub fn verify_rewrite_message(
    policy: &TaxisPolicy,
    floor: &PolicyFloor,
    message: &str,
    origin: MessageOrigin,
    touched_paths: Option<&[String]>,
) -> FractalResult<Option<ValidatedCommitWitness>> {
    floor.assert_permits(policy)?;
    match origin {
        MessageOrigin::Authored => {
            CommitMessageGuard::parse_and_verify(message, policy, touched_paths).map(Some)
        }
        MessageOrigin::Inherited => {
            reject_universal_violations(message)?;
            Ok(None)
        }
        MessageOrigin::Synthesized => {
            reject_universal_markers_only(message)?;
            Ok(None)
        }
    }
}

/// Rejects the violations that apply to any message regardless of who wrote it.
///
/// An inherited message is exempt from the section contract because it already satisfied one, but
/// unresolved markers and template residue are never acceptable in a permanent record.
fn reject_universal_violations(message: &str) -> FractalResult<()> {
    let mut violations = Vec::new();
    for finding in lexicon::scan(message).0 {
        if finding.rule_id == fg_core::constants::rules::RULE_FGT_MSG_005
            || finding.rule_id == fg_core::constants::rules::RULE_FGT_MSG_008
        {
            violations.push(format!(
                "{}: {} (line {}, token '{}')",
                finding.rule_id, finding.message, finding.line, finding.token
            ));
        }
    }
    if let Some(header) = message.lines().next() {
        let subject = header
            .split_once(':')
            .map(|(_, rest)| rest)
            .unwrap_or(header)
            .trim();
        if let Some(finding) = style::check_imperative_subject(subject) {
            violations.push(format!("{}: {}", finding.rule_id, finding.message));
        }
    }
    if violations.is_empty() {
        return Ok(());
    }
    Err(FractalError::GateRejection {
        score: 0.0,
        violations,
    })
}

/// Rejects unresolved markers in a tool-synthesized message.
///
/// A generated notice such as `Revert "..."` is not prose the author chose, so only the markers
/// that indicate an unfinished thought are checked.
fn reject_universal_markers_only(message: &str) -> FractalResult<()> {
    let violations: Vec<String> = lexicon::scan(message)
        .0
        .into_iter()
        .filter(|finding| finding.rule_id == fg_core::constants::rules::RULE_FGT_MSG_005)
        .map(|finding| {
            format!(
                "{}: {} (line {}, token '{}')",
                finding.rule_id, finding.message, finding.line, finding.token
            )
        })
        .collect();
    if violations.is_empty() {
        return Ok(());
    }
    Err(FractalError::GateRejection {
        score: 0.0,
        violations,
    })
}

/// Whether a merge message may be exempted from the section contract.
///
/// The exemption is granted on structural evidence: a commit with two or more parents is a real
/// merge. Matching the header text alone was forgeable by anyone able to type `Merge branch`, so
/// the text is only used to decide whether the exemption is *reported*, never whether it applies.
pub fn merge_exemption_applies(parent_count: usize) -> bool {
    parent_count >= 2
}
