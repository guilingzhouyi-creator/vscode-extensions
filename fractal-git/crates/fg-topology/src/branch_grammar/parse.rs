//! Module: fg-topology — Strict Branch Grammar Parsing & Segment Guards
//! File Path: crates/fg-topology/src/branch_grammar/parse.rs
//! Architecture Role: Implements fail-closed `from_git_ref_checked` parsing with strict
//!   cell whitelist verification, lowercase kebab-case checks, scratch-prefix blocking,
//!   and D/F-colliding 4-segment card rejection on creation paths.
//! Dependencies & Triggers: Uses `fg_core::models::BranchPolicySpec` and `crate::refs`.
//! Responsibilities: Validate individual segments and classify five-tier or facade refs.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::BranchPolicySpec;

use crate::refs::{split_ref_segments, FractalRef};

use super::{validate_strict_cell, validate_strict_segment};

impl FractalRef {
    /// Strictly parses and validates a branch name against `policy`, rejecting ad-hoc names,
    /// non-kebab segments, unknown domain cells, and (when `allow_four_segment_card == false`)
    /// D/F-colliding 4-segment card branches.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::TopologyBreach`] with an actionable remediation message.
    pub fn from_git_ref_checked(
        ref_str: &str,
        policy: &BranchPolicySpec,
        allow_four_segment_card: bool,
    ) -> FractalResult<Self> {
        let trimmed = ref_str.trim();
        let bare = trimmed
            .strip_prefix("refs/heads/")
            .or_else(|| trimmed.strip_prefix("refs/fractal/"))
            .unwrap_or(trimmed);
        if bare.is_empty() || bare.starts_with('/') || bare.ends_with('/') || bare.contains("//") {
            return Err(FractalError::TopologyBreach {
                source_ref: trimmed.to_owned(),
                target_ref: "canonical-branch".to_owned(),
                reason: "branch name is empty or contains malformed slashes".to_owned(),
            });
        }
        if policy.is_forbidden_prefix(bare) {
            return Err(FractalError::TopologyBreach {
                source_ref: bare.to_owned(),
                target_ref: "canonical-branch".to_owned(),
                reason: format!("branch '{bare}' uses a prohibited scratch prefix (temp/tmp/wip)"),
            });
        }
        if bare == "main" || bare == "master" {
            return Ok(Self::SystemTrunk { branch: bare.to_owned() });
        }
        if bare == "integration" || bare == "trunk" {
            return Ok(Self::Trunk);
        }
        let Some((parts_buf, parts_len)) = split_ref_segments(bare) else {
            return Err(FractalError::TopologyBreach {
                source_ref: bare.to_owned(),
                target_ref: "canonical-branch".to_owned(),
                reason: format!("branch '{bare}' exceeds maximum hierarchical segment depth"),
            });
        };
        parse_structured_segments(bare, &parts_buf[..parts_len], policy, allow_four_segment_card)
    }
}

fn parse_structured_segments(
    bare: &str,
    parts: &[&str],
    policy: &BranchPolicySpec,
    allow_four_segment_card: bool,
) -> FractalResult<FractalRef> {
    if parts.len() == 3 && parts[0] == "cell" && parts[2] == "main" {
        validate_strict_cell(bare, parts[1], policy)?;
        return Ok(FractalRef::CellMain { cell_id: parts[1].to_owned() });
    }
    if parts.len() == 5 && parts[0] == "cell" && parts[2] == "card" && parts[4] == policy.card_canonical_leaf {
        validate_strict_cell(bare, parts[1], policy)?;
        validate_strict_segment(bare, "card", parts[3], policy)?;
        return Ok(FractalRef::CardWorktree { cell_id: parts[1].to_owned(), card_id: parts[3].to_owned() });
    }
    if parts.len() == 4 && parts[0] == "cell" && parts[2] == "card" {
        validate_strict_cell(bare, parts[1], policy)?;
        validate_strict_segment(bare, "card", parts[3], policy)?;
        if allow_four_segment_card && policy.allow_legacy_card_read {
            return Ok(FractalRef::CardWorktree { cell_id: parts[1].to_owned(), card_id: parts[3].to_owned() });
        }
        return Err(FractalError::TopologyBreach {
            source_ref: bare.to_owned(),
            target_ref: format!("cell/{}/card/{}/{}", parts[1], parts[3], policy.card_canonical_leaf),
            reason: format!(
                "4-segment card branch '{bare}' collides on disk with '/sub/<agent>' directories; use canonical 'cell/{}/card/{}/{}' or a '<type>/{}/<desc>' facade",
                parts[1], parts[3], policy.card_canonical_leaf, parts[1]
            ),
        });
    }
    if parts.len() == 6 && parts[0] == "cell" && parts[2] == "card" && parts[4] == "sub" {
        validate_strict_cell(bare, parts[1], policy)?;
        validate_strict_segment(bare, "card", parts[3], policy)?;
        validate_strict_segment(bare, "subagent", parts[5], policy)?;
        return Ok(FractalRef::SubAgentWorktree {
            cell_id: parts[1].to_owned(),
            card_id: parts[3].to_owned(),
            subagent_id: parts[5].to_owned(),
        });
    }
    if parts.len() == 3 && policy.is_allowed_facade(parts[0]) {
        validate_strict_cell(bare, parts[1], policy)?;
        validate_strict_segment(bare, "facade-desc", parts[2], policy)?;
        return Ok(FractalRef::CardWorktree {
            cell_id: parts[1].to_owned(),
            card_id: format!("{}-{}", parts[0], parts[2]),
        });
    }
    Err(FractalError::TopologyBreach {
        source_ref: bare.to_owned(),
        target_ref: "canonical-branch".to_owned(),
        reason: format!(
            "branch '{bare}' does not match any governed 5-tier shape: 'integration', 'cell/<cell>/main', 'cell/<cell>/card/<card>/{}', '<type>/<cell>/<desc>', or 'cell/<cell>/card/<card>/sub/<agent>'",
            policy.card_canonical_leaf
        ),
    })
}
