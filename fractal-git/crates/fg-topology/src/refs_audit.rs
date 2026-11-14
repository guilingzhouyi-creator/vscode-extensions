//! Module: fg-topology — Worktree-Free Fractal Audit Tree Reference Helpers
//! File Path: crates/fg-topology/src/refs_audit.rs
//! Architecture Role: Implements canonical serialization, parsing, and worktree-to-audit
//!   counterpart mapping for `refs/fractal/audit/...` variants of [`FractalRef`].
//! Dependencies & Triggers: Extends `crate::refs::FractalRef` using `fg_core::constants::refs`.
//! Responsibilities: Keep audit ref formatting, lookup, and tests decoupled from `refs.rs` volume.
//! Exit Semantics & Design Rationale: Identical fast-forward policy enforcement as telemetry refs.

use fg_core::constants::refs::{REF_AUDIT_PREFIX, REF_AUDIT_TRUNK};

use crate::refs::FractalRef;

impl FractalRef {
    pub(crate) fn format_audit_ref(&self) -> String {
        match self {
            Self::AuditTrunk => REF_AUDIT_TRUNK.to_string(),
            Self::AuditCellMain { cell_id } => {
                format!("{REF_AUDIT_PREFIX}cell/{cell_id}/main")
            }
            Self::AuditCard { cell_id, card_id } => {
                format!("{REF_AUDIT_PREFIX}cell/{cell_id}/card/{card_id}/main")
            }
            Self::AuditSubAgent {
                cell_id,
                card_id,
                subagent_id,
            } => format!("{REF_AUDIT_PREFIX}cell/{cell_id}/card/{card_id}/sub/{subagent_id}"),
            _ => String::new(),
        }
    }

    pub(crate) fn parse_fractal_audit_ref(parts: &[&str]) -> Option<Self> {
        if parts.len() == 4 && parts[3] == "trunk" {
            return Some(Self::AuditTrunk);
        }
        if parts.len() == 6 && parts[3] == "cell" && parts[5] == "main" {
            return Some(Self::AuditCellMain {
                cell_id: parts[4].to_string(),
            });
        }
        if parts.len() == 8 && parts[3] == "cell" && parts[5] == "card" && parts[7] == "main" {
            return Some(Self::AuditCard {
                cell_id: parts[4].to_string(),
                card_id: parts[6].to_string(),
            });
        }
        if parts.len() == 9 && parts[3] == "cell" && parts[5] == "card" && parts[7] == "sub" {
            return Some(Self::AuditSubAgent {
                cell_id: parts[4].to_string(),
                card_id: parts[6].to_string(),
                subagent_id: parts[8].to_string(),
            });
        }
        None
    }

    /// Returns true if this reference belongs to the dedicated worktree-free Fractal Audit Tree.
    #[must_use]
    pub fn is_audit_tree(&self) -> bool {
        matches!(
            self,
            Self::AuditTrunk
                | Self::AuditCellMain { .. }
                | Self::AuditCard { .. }
                | Self::AuditSubAgent { .. }
        )
    }

    /// Maps any worktree, trunk, or audit reference to its corresponding `refs/fractal/audit/...` counterpart.
    #[must_use]
    pub fn audit_counterpart(&self) -> Option<Self> {
        match self {
            Self::SystemTrunk { .. } | Self::Trunk => Some(Self::AuditTrunk),
            Self::CellMain { cell_id } => Some(Self::AuditCellMain {
                cell_id: cell_id.clone(),
            }),
            Self::CardWorktree { cell_id, card_id } => Some(Self::AuditCard {
                cell_id: cell_id.clone(),
                card_id: card_id.clone(),
            }),
            Self::SubAgentWorktree {
                cell_id,
                card_id,
                subagent_id,
            } => Some(Self::AuditSubAgent {
                cell_id: cell_id.clone(),
                card_id: card_id.clone(),
                subagent_id: subagent_id.clone(),
            }),
            other if other.is_audit_tree() => Some(other.clone()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fg_core::models::Oid;

    #[test]
    fn test_audit_tree_ref_roundtrip_and_policy() {
        let sub_work = FractalRef::SubAgentWorktree {
            cell_id: "cell-a".into(),
            card_id: "card-9".into(),
            subagent_id: "sub-2".into(),
        };
        let sub_audit = sub_work.audit_counterpart().expect("audit sub counterpart");
        assert!(sub_audit.is_audit_tree());
        assert!(!sub_audit.is_telemetry());
        assert_eq!(
            sub_audit.to_git_ref(),
            "refs/fractal/audit/cell/cell-a/card/card-9/sub/sub-2"
        );
        assert_eq!(
            FractalRef::parse(&sub_audit.to_git_ref()),
            Some(sub_audit.clone())
        );

        let card_audit = sub_audit.parent().expect("card audit parent");
        assert_eq!(
            card_audit.to_git_ref(),
            "refs/fractal/audit/cell/cell-a/card/card-9/main"
        );
        assert_eq!(
            FractalRef::parse(&card_audit.to_git_ref()),
            Some(card_audit.clone())
        );

        let cell_audit = card_audit.parent().expect("cell audit parent");
        assert_eq!(
            cell_audit.to_git_ref(),
            "refs/fractal/audit/cell/cell-a/main"
        );
        assert_eq!(
            FractalRef::parse(&cell_audit.to_git_ref()),
            Some(cell_audit.clone())
        );

        let trunk_audit = cell_audit.parent().expect("trunk audit parent");
        assert_eq!(trunk_audit, FractalRef::AuditTrunk);
        assert_eq!(trunk_audit.to_git_ref(), "refs/fractal/audit/trunk");
        assert_eq!(
            FractalRef::parse("refs/fractal/audit/trunk"),
            Some(FractalRef::AuditTrunk)
        );

        let oid1 = Oid::from_bytes([0x55; 20]);
        assert!(trunk_audit
            .verify_telemetry_update_policy(None, Some(oid1), false)
            .is_ok());
        assert!(trunk_audit
            .verify_telemetry_update_policy(None, Some(oid1), true)
            .is_err());
        assert!(trunk_audit
            .verify_telemetry_update_policy(Some(oid1), None, false)
            .is_err());
    }
}
