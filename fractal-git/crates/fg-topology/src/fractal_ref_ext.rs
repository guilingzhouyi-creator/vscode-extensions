//! Module: fg-topology — Fractal Reference Hierarchy & Compatibility Codecs
//! File Path: crates/fg-topology/src/fractal_ref_ext.rs
//! Architecture Role: Implements hierarchy tier inspection, strict parent traversal,
//!   Git short/heads ref formatting, protected-trunk checks, and permissive read parsing
//!   for [`FractalRef`].
//! Dependencies & Triggers: Extends `crate::refs::FractalRef` using `fg_core::constants::branch`.

use fg_core::constants::branch::{CARD_CANONICAL_LEAF, FACADE_TYPES};
use fg_core::constants::git::REF_HEADS_PREFIX;

use crate::refs::{split_ref_segments, FractalRef};

impl FractalRef {
    /// Returns the tier level in the fractal hierarchy (`0`=SystemTrunk, `1`=Trunk, `2`=CellMain, `3`=Card, `4`=SubAgent).
    #[must_use]
    pub fn tier(&self) -> u8 {
        match self {
            Self::SystemTrunk { .. } => 0,
            Self::Trunk => 1,
            Self::CellMain { .. } => 2,
            Self::CardWorktree { .. } => 3,
            Self::SubAgentWorktree { .. } => 4,
            _ => 99,
        }
    }

    /// Returns the mathematically unique legitimate parent in the fractal hierarchy.
    #[must_use]
    pub fn parent(&self) -> Option<Self> {
        match self {
            Self::SystemTrunk { .. } => None,
            Self::Trunk => Some(Self::SystemTrunk {
                branch: "main".to_string(),
            }),
            Self::CellMain { .. } => Some(Self::Trunk),
            Self::CardWorktree { cell_id, .. } => Some(Self::CellMain {
                cell_id: cell_id.clone(),
            }),
            Self::SubAgentWorktree {
                cell_id, card_id, ..
            } => Some(Self::CardWorktree {
                cell_id: cell_id.clone(),
                card_id: card_id.clone(),
            }),
            _ => None,
        }
    }

    /// Formats the reference into its standard Git heads representation (`refs/heads/...`).
    #[must_use]
    pub fn to_head_ref(&self) -> String {
        match self {
            Self::SystemTrunk { branch } => format!("{REF_HEADS_PREFIX}{branch}"),
            Self::Trunk => format!("{REF_HEADS_PREFIX}integration"),
            Self::CellMain { cell_id } => format!("{REF_HEADS_PREFIX}cell/{cell_id}/main"),
            Self::CardWorktree { cell_id, card_id } => {
                format!("{REF_HEADS_PREFIX}cell/{cell_id}/card/{card_id}/{CARD_CANONICAL_LEAF}")
            }
            Self::SubAgentWorktree {
                cell_id,
                card_id,
                subagent_id,
            } => format!("{REF_HEADS_PREFIX}cell/{cell_id}/card/{card_id}/sub/{subagent_id}"),
            other => other.to_git_ref(),
        }
    }

    /// Formats a branch coordinate as its short Git branch name without `refs/heads/`.
    #[must_use]
    pub fn to_short_branch_name(&self) -> Option<String> {
        match self {
            Self::SystemTrunk { branch } => Some(branch.clone()),
            Self::Trunk => Some("integration".to_owned()),
            Self::CellMain { cell_id } => Some(format!("cell/{cell_id}/main")),
            Self::CardWorktree { cell_id, card_id } => {
                Some(format!("cell/{cell_id}/card/{card_id}/{CARD_CANONICAL_LEAF}"))
            }
            Self::SubAgentWorktree {
                cell_id,
                card_id,
                subagent_id,
            } => Some(format!("cell/{cell_id}/card/{card_id}/sub/{subagent_id}")),
            _ => None,
        }
    }

    /// Returns `true` when this reference sits in a protected trunk (Tier 0/1/2) or telemetry stream.
    #[must_use]
    pub fn is_protected(&self) -> bool {
        match self {
            Self::SystemTrunk { branch } => {
                branch == "main" || branch == "master" || branch == "trunk"
            }
            Self::Trunk | Self::CellMain { .. } => true,
            Self::CardWorktree { .. } | Self::SubAgentWorktree { .. } => false,
            _ => true,
        }
    }

    /// Returns `true` when `ref_str` denotes the 4-segment `cell/<cell>/card/<card>` card path
    /// that lacks the terminal `/main` segment.
    #[must_use]
    pub fn is_predecessor_card_ref(ref_str: &str) -> bool {
        let trimmed = ref_str.trim();
        let bare = trimmed
            .strip_prefix("refs/heads/")
            .or_else(|| trimmed.strip_prefix("refs/fractal/"))
            .unwrap_or(trimmed);
        let Some((parts_buf, parts_len)) = split_ref_segments(bare) else {
            return false;
        };
        let parts = &parts_buf[..parts_len];
        parts.len() == 4 && parts[0] == "cell" && parts[2] == "card"
    }

    /// Parses any standard Git branch reference (`refs/heads/*`, bare branch, or `refs/fractal/*`)
    /// into a strongly-typed FractalRef according to the 5-tier taxonomy.
    #[must_use]
    pub fn from_git_ref(ref_str: &str) -> Option<Self> {
        let trimmed = ref_str.trim();
        let bare = trimmed.strip_prefix("refs/heads/").unwrap_or(trimmed);
        if bare == "main" || bare == "master" {
            return Some(Self::SystemTrunk {
                branch: bare.to_string(),
            });
        }
        if bare == "integration" {
            return Some(Self::Trunk);
        }
        let (parts_buf, parts_len) = split_ref_segments(bare)?;
        let parts = &parts_buf[..parts_len];
        if parts.len() == 3 && parts[0] == "cell" && parts[2] == "main" {
            return Some(Self::CellMain {
                cell_id: parts[1].to_string(),
            });
        }
        if parts.len() == 5 && parts[0] == "cell" && parts[2] == "card" && parts[4] == CARD_CANONICAL_LEAF {
            return Some(Self::CardWorktree {
                cell_id: parts[1].to_string(),
                card_id: parts[3].to_string(),
            });
        }
        if parts.len() == 4 && parts[0] == "cell" && parts[2] == "card" {
            return Some(Self::CardWorktree {
                cell_id: parts[1].to_string(),
                card_id: parts[3].to_string(),
            });
        }
        if parts.len() == 6 && parts[0] == "cell" && parts[2] == "card" && parts[4] == "sub" {
            return Some(Self::SubAgentWorktree {
                cell_id: parts[1].to_string(),
                card_id: parts[3].to_string(),
                subagent_id: parts[5].to_string(),
            });
        }
        if parts.len() == 3 && FACADE_TYPES.contains(&parts[0]) {
            return Some(Self::CardWorktree {
                cell_id: parts[1].to_string(),
                card_id: format!("{}-{}", parts[0], parts[2]),
            });
        }
        None
    }
}
