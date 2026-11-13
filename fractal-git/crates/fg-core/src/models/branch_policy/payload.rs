//! Module: fg-core — Sealed Binary Policy Payload Codec
//! File Path: crates/fg-core/src/models/branch_policy/payload.rs
//! Architecture Role: Defines `SealedPolicyPayload` and its compact binary codec
//!   stored inside the encrypted `.taxis-policy.txp` container.
//! Dependencies & Triggers: Consumes `super::types`, `super::wire`, and
//!   `fg_core::constants::branch::POLICY_MAX_PAYLOAD_LEN`.
//! Responsibilities: Serialize and parse `SealedPolicyPayload` with strict schema
//!   version and trailing-byte checks.
//! Exit Semantics & Design Rationale: Rejects truncated frames, unknown schema
//!   versions, and trailing garbage before policy consumption.

use crate::constants::branch::POLICY_MAX_PAYLOAD_LEN;
use crate::error::{FractalError, FractalResult};
use crate::models::policy::EnforcementTier;

use super::types::{BranchEnforcementTier, BranchPolicySpec};
use super::wire_decode::{
    commit_tier_from_u8, read_bool, read_fixed_16, read_i64, read_len_str, read_pair_list,
    read_str_list, read_u16, read_u64, read_u8, POLICY_REPO_ID_LEN,
};
use super::wire_encode::{commit_tier_to_u8, write_len_str, write_pair_list, write_str_list};

/// Authenticated payload persisted inside the encrypted `.taxis-policy.txp` binary vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealedPolicyPayload {
    /// Repository identity cryptographically bound to this policy vault.
    pub repo_id: [u8; POLICY_REPO_ID_LEN],
    /// Monotonically incremented policy generation number.
    pub revision: u64,
    /// Minimum enforcement floor required for commit message governance.
    pub commit_floor: EnforcementTier,
    /// Minimum enforcement floor required for branch naming and topology derivation.
    pub branch_floor: BranchEnforcementTier,
    /// Locks configuration mutations, exports, and resets behind human authority proof.
    pub locked_by_authority: bool,
    /// Unix timestamp in seconds when the kernel last wrote this policy vault.
    pub updated_at_secs: i64,
    /// Full branch standardization grammar enforced under configured tiers.
    pub branch_spec: BranchPolicySpec,
}

impl SealedPolicyPayload {
    /// Creates a new default payload for a repository bound to `repo_id`.
    #[must_use]
    pub fn with_tiers(
        repo_id: [u8; POLICY_REPO_ID_LEN],
        commit_floor: EnforcementTier,
        branch_floor: BranchEnforcementTier,
        locked_by_authority: bool,
        updated_at_secs: i64,
    ) -> Self {
        Self {
            repo_id,
            revision: 1,
            commit_floor,
            branch_floor,
            locked_by_authority,
            updated_at_secs,
            branch_spec: BranchPolicySpec::workspace_default(),
        }
    }

    /// Encodes the payload into compact binary form with zero JSON formatting.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::PolicyViolation`] when list counts or serialized length exceed ceilings.
    pub fn encode_binary(&self) -> FractalResult<Vec<u8>> {
        let mut out = Vec::with_capacity(512);
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&self.repo_id);
        out.extend_from_slice(&self.revision.to_le_bytes());
        out.push(commit_tier_to_u8(self.commit_floor));
        out.push(self.branch_floor.as_u8());
        out.push(u8::from(self.locked_by_authority));
        out.extend_from_slice(&self.updated_at_secs.to_le_bytes());

        write_len_str(&mut out, &self.branch_spec.card_canonical_leaf)?;
        out.push(u8::from(self.branch_spec.allow_legacy_card_read));
        out.push(u8::from(self.branch_spec.require_kebab_case));
        out.extend_from_slice(&self.branch_spec.max_segment_len.to_le_bytes());
        out.push(u8::from(self.branch_spec.enforce_dynamic_leases));

        write_str_list(&mut out, &self.branch_spec.recognized_cells)?;
        write_pair_list(&mut out, &self.branch_spec.cell_aliases)?;
        write_str_list(&mut out, &self.branch_spec.facade_types)?;
        write_str_list(&mut out, &self.branch_spec.forbidden_prefixes)?;

        if out.len() > POLICY_MAX_PAYLOAD_LEN {
            return Err(FractalError::PolicyViolation(format!(
                "encoded policy payload ({} bytes) exceeds ceiling {}",
                out.len(),
                POLICY_MAX_PAYLOAD_LEN
            )));
        }
        Ok(out)
    }

    /// Decodes a compact binary policy payload with full bounds verification.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::PolicyViolation`] when truncated, corrupted, or trailing bytes exist.
    pub fn decode_binary(payload: &[u8]) -> FractalResult<Self> {
        let mut cursor = 0usize;
        let schema_ver = read_u16(payload, &mut cursor, "schema_version")?;
        if schema_ver != 1 {
            return Err(FractalError::PolicyViolation(format!(
                "unsupported sealed policy payload schema version {schema_ver}"
            )));
        }
        let repo_id = read_fixed_16(payload, &mut cursor, "repo_id")?;
        let revision = read_u64(payload, &mut cursor, "revision")?;
        let commit_floor = commit_tier_from_u8(read_u8(payload, &mut cursor, "commit_floor")?)?;
        let branch_floor =
            BranchEnforcementTier::from_u8(read_u8(payload, &mut cursor, "branch_floor")?)?;
        let locked_by_authority = read_bool(payload, &mut cursor, "locked_by_authority")?;
        let updated_at_secs = read_i64(payload, &mut cursor, "updated_at_secs")?;

        let card_canonical_leaf = read_len_str(payload, &mut cursor, "card_canonical_leaf")?;
        let allow_legacy_card_read = read_bool(payload, &mut cursor, "allow_legacy_card_read")?;
        let require_kebab_case = read_bool(payload, &mut cursor, "require_kebab_case")?;
        let max_segment_len = read_u16(payload, &mut cursor, "max_segment_len")?;
        let enforce_dynamic_leases = read_bool(payload, &mut cursor, "enforce_dynamic_leases")?;

        let recognized_cells = read_str_list(payload, &mut cursor, "recognized_cells")?;
        let cell_aliases = read_pair_list(payload, &mut cursor, "cell_aliases")?;
        let facade_types = read_str_list(payload, &mut cursor, "facade_types")?;
        let forbidden_prefixes = read_str_list(payload, &mut cursor, "forbidden_prefixes")?;

        if cursor != payload.len() {
            return Err(FractalError::PolicyViolation(format!(
                "unexpected {} trailing bytes in decoded policy payload",
                payload.len().saturating_sub(cursor)
            )));
        }

        Ok(Self {
            repo_id,
            revision,
            commit_floor,
            branch_floor,
            locked_by_authority,
            updated_at_secs,
            branch_spec: BranchPolicySpec {
                card_canonical_leaf,
                allow_legacy_card_read,
                require_kebab_case,
                max_segment_len,
                enforce_dynamic_leases,
                recognized_cells,
                cell_aliases,
                facade_types,
                forbidden_prefixes,
            },
        })
    }
}
