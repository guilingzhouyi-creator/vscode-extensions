//! Module: fg-core — Branch Enforcement Tiers & Naming Grammar Spec
//! File Path: crates/fg-core/src/models/branch_policy/types.rs
//! Architecture Role: Defines `BranchEnforcementTier` and `BranchPolicySpec` for
//!   five-tier workspace branch nomenclature and coordinate validation.
//! Dependencies & Triggers: Uses `fg_core::constants::branch` and `fg_core::error`.
//! Responsibilities: Parse enforcement tiers, normalize domain aliases, validate
//!   segments, and construct compiled single-binary workspace defaults.
//! Exit Semantics & Design Rationale: Fails closed on invalid discriminants or
//!   non-kebab/forbidden coordinate segments.

use crate::constants::branch::{
    canonicalize_cell_alias, is_forbidden_branch_prefix, is_valid_kebab_segment,
    CARD_CANONICAL_LEAF, CELL_ALIASES, FACADE_TYPES, FORBIDDEN_BRANCH_PREFIXES,
    MAX_BRANCH_SEGMENT_LEN, RECOGNIZED_CELLS,
};
use crate::error::{FractalError, FractalResult};

/// Enforcement posture specifically governing branch creation, inheritance, rename, and deletion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum BranchEnforcementTier {
    /// Native Git compatibility mode: arbitrary legal ref names allowed, while dual-FractalRef
    /// operations still uphold topological invariants.
    Native = 0,
    /// Migration mode: emits warnings on non-conforming new branches while blocking cross-tier/cell jumps.
    Advisory = 1,
    /// Full workspace fractal governance: Fail-Closed enforcement of canonical paths and closures.
    Strict = 2,
}

impl BranchEnforcementTier {
    /// Numeric strictness rank used for monotonic ratchet comparisons.
    #[must_use]
    pub const fn rank(self) -> u8 {
        self as u8
    }

    /// Canonical wire discriminant encoded inside the encrypted binary payload.
    #[must_use]
    pub const fn as_u8(self) -> u8 {
        self as u8
    }

    /// Decodes a binary tier discriminant, rejecting unknown values fail-closed.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::PolicyViolation`] when `value` falls outside `{0, 1, 2}`.
    pub fn from_u8(value: u8) -> FractalResult<Self> {
        match value {
            0 => Ok(Self::Native),
            1 => Ok(Self::Advisory),
            2 => Ok(Self::Strict),
            other => Err(FractalError::PolicyViolation(format!(
                "invalid branch enforcement tier byte '{other}' in policy payload"
            ))),
        }
    }

    /// Canonical lowercase CLI and diagnostic spelling.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Advisory => "advisory",
            Self::Strict => "strict",
        }
    }

    /// Case-insensitive parser for CLI flags and environment overrides.
    #[must_use]
    pub fn parse_str(raw_text: &str) -> Option<Self> {
        match raw_text.trim().to_ascii_lowercase().as_str() {
            "native" | "git-native" | "permissive" => Some(Self::Native),
            "advisory" | "warn" => Some(Self::Advisory),
            "strict" | "workspace-strict" => Some(Self::Strict),
            _ => None,
        }
    }
}

impl std::fmt::Display for BranchEnforcementTier {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Complete domain grammar and cell ownership specification enforced by Taxis branch gates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchPolicySpec {
    /// Canonical terminal leaf segment for Tier 3 card branches (standard: `"main"`).
    pub card_canonical_leaf: String,
    /// Permits parsing 4-segment `cell/<cell>/card/<card>` references on read paths.
    pub allow_legacy_card_read: bool,
    /// Requires every branch coordinate segment (`<cell-id>`, `<card-id>`, `<agent-id>`) to be `kebab-case`.
    pub require_kebab_case: bool,
    /// Maximum length in bytes of a single coordinate segment.
    pub max_segment_len: u16,
    /// Enables overlaying active dynamic project leases when evaluating cell membership.
    pub enforce_dynamic_leases: bool,
    /// Authorized domain cell identifiers permitted in Tier 2/3/4 coordinates.
    pub recognized_cells: Vec<String>,
    /// Alias pairs `(alias, canonical)` normalized into recognized cells.
    pub cell_aliases: Vec<(String, String)>,
    /// Allowed human-facing facade prefixes (`<type>/<cell-id>/<desc>`).
    pub facade_types: Vec<String>,
    /// Scratch branch prefixes prohibited under Strict governance.
    pub forbidden_prefixes: Vec<String>,
}

impl Default for BranchPolicySpec {
    fn default() -> Self {
        Self::workspace_default()
    }
}

impl BranchPolicySpec {
    /// Builds the compiled workspace single-binary default policy without disk I/O.
    #[must_use]
    pub fn workspace_default() -> Self {
        Self {
            card_canonical_leaf: CARD_CANONICAL_LEAF.to_owned(),
            allow_legacy_card_read: true,
            require_kebab_case: true,
            max_segment_len: u16::try_from(MAX_BRANCH_SEGMENT_LEN).unwrap_or(63),
            enforce_dynamic_leases: true,
            recognized_cells: RECOGNIZED_CELLS
                .iter()
                .map(|entry| (*entry).to_owned())
                .collect(),
            cell_aliases: CELL_ALIASES
                .iter()
                .map(|(alias, canonical)| ((*alias).to_owned(), (*canonical).to_owned()))
                .collect(),
            facade_types: FACADE_TYPES
                .iter()
                .map(|entry| (*entry).to_owned())
                .collect(),
            forbidden_prefixes: FORBIDDEN_BRANCH_PREFIXES
                .iter()
                .map(|entry| (*entry).to_owned())
                .collect(),
        }
    }

    /// Normalizes a candidate cell identifier through configured aliases and compiled aliases.
    #[must_use]
    pub fn normalize_cell<'a>(&'a self, raw_cell: &'a str) -> &'a str {
        for (alias, canonical) in &self.cell_aliases {
            if raw_cell == alias.as_str() {
                return canonical.as_str();
            }
        }
        canonicalize_cell_alias(raw_cell)
    }

    /// Returns `true` when `raw_cell` (after alias normalization) belongs to the recognized cell whitelist.
    #[must_use]
    pub fn is_recognized_cell(&self, raw_cell: &str) -> bool {
        let normalized = self.normalize_cell(raw_cell);
        self.recognized_cells
            .iter()
            .any(|cell| cell.as_str() == normalized)
    }

    /// Returns `true` when `facade_kind` is permitted in `<type>/<cell-id>/<desc>` facades.
    #[must_use]
    pub fn is_allowed_facade(&self, facade_kind: &str) -> bool {
        self.facade_types
            .iter()
            .any(|allowed| allowed.as_str() == facade_kind)
    }

    /// Returns `true` when `segment` matches a configured or built-in forbidden prefix.
    #[must_use]
    pub fn is_forbidden_prefix(&self, segment: &str) -> bool {
        if is_forbidden_branch_prefix(segment) {
            return true;
        }
        for prefix in &self.forbidden_prefixes {
            let prefix_str = prefix.as_str();
            if segment == prefix_str {
                return true;
            }
            if let Some(rest) = segment.strip_prefix(prefix_str) {
                if rest.starts_with('-') || rest.starts_with('/') {
                    return true;
                }
            }
        }
        false
    }

    /// Validates one coordinate segment against kebab-case, length bound, and temporary prefixes.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::PolicyViolation`] explaining the violated naming constraint.
    pub fn validate_segment(&self, role: &str, segment: &str) -> FractalResult<()> {
        let max_len = usize::from(self.max_segment_len);
        if segment.is_empty() || segment.len() > max_len {
            return Err(FractalError::PolicyViolation(format!(
                "{role} segment '{segment}' must be 1..={max_len} bytes"
            )));
        }
        if self.require_kebab_case && !is_valid_kebab_segment(segment) {
            return Err(FractalError::PolicyViolation(format!(
                "{role} segment '{segment}' must use lowercase ASCII kebab-case ([a-z0-9]+(-[a-z0-9]+)*)"
            )));
        }
        if self.is_forbidden_prefix(segment) {
            return Err(FractalError::PolicyViolation(format!(
                "{role} segment '{segment}' uses a forbidden temporary prefix (temp/tmp/wip)"
            )));
        }
        Ok(())
    }
}
