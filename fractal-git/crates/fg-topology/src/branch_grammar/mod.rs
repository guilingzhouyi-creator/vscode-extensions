//! Module: fg-topology — Strict Branch Grammar & Segment Validators
//! File Path: crates/fg-topology/src/branch_grammar/mod.rs
//! Architecture Role: Organizes fail-closed branch lexical/domain parsing and cascading
//!   child derivation while providing shared strict segment/cell validation primitives.

mod derive;
mod parse;
#[cfg(test)]
mod tests;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::BranchPolicySpec;

pub(super) fn validate_strict_cell(
    full_branch: &str,
    raw_cell: &str,
    policy: &BranchPolicySpec,
) -> FractalResult<()> {
    if let Err(seg_err) = policy.validate_segment("cell", raw_cell) {
        return Err(FractalError::TopologyBreach {
            source_ref: full_branch.to_owned(),
            target_ref: "canonical-cell".to_owned(),
            reason: seg_err.to_string(),
        });
    }
    if policy.recognized_cells.iter().any(|allowed| allowed == raw_cell) {
        return Ok(());
    }
    let normalized = policy.normalize_cell(raw_cell);
    let hint = if normalized != raw_cell
        && policy.recognized_cells.iter().any(|allowed| allowed == normalized)
    {
        format!("use canonical cell '{normalized}' instead of alias '{raw_cell}'")
    } else {
        format!(
            "unrecognized domain cell '{raw_cell}'; permitted: {}",
            policy.recognized_cells.join(", ")
        )
    };
    Err(FractalError::TopologyBreach {
        source_ref: full_branch.to_owned(),
        target_ref: "recognized-cell".to_owned(),
        reason: hint,
    })
}

pub(super) fn validate_strict_segment(
    full_branch: &str,
    role: &str,
    segment: &str,
    policy: &BranchPolicySpec,
) -> FractalResult<()> {
    policy.validate_segment(role, segment).map_err(|seg_err| FractalError::TopologyBreach {
        source_ref: full_branch.to_owned(),
        target_ref: format!("canonical-{role}"),
        reason: seg_err.to_string(),
    })
}
