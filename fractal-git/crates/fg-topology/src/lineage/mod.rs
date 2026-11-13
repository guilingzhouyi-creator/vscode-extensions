//! Module: fg-topology — Cryptographic Fractal Lineage Receipt Ledger
//! File Path: crates/fg-topology/src/lineage/mod.rs
//! Architecture Role: Records HMAC-SM3 authenticated lineage receipts (`Fork`, `Merge`, `Rebase`,
//!   `Rename`, `Migrate`, `Reclaim`) in a compact binary TXLN ledger inside the repository directory.

mod codec;
mod ledger;
#[cfg(test)]
mod tests;

use fg_core::error::{FractalError, FractalResult};

pub use ledger::LineageLedger;

pub(super) const LINEAGE_MAGIC: [u8; 4] = *b"TXLN";
pub(super) const LINEAGE_VERSION: u16 = 1;
pub(super) const LINEAGE_REL_PATH: &str = "journal/lineage.txl";
pub(super) const LINEAGE_TELEMETRY_PREFIX: &str = "refs/fractal/telemetry/lineage/";

/// Structural lifecycle transition kind recorded in the cryptographic lineage ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineageEventKind {
    /// New child branch derived from its canonical parent coordinate.
    Fork = 1,
    /// Verified upward promotion merge into parent branch.
    Merge = 2,
    /// Linear commit replay onto immediate parent reference.
    Rebase = 3,
    /// Same-coordinate branch rename operation.
    Rename = 4,
    /// D/F migration upgrading a predecessor four-segment card branch into `.../main`.
    Migrate = 5,
    /// Safe branch/worktree reclamation after lineage audit.
    Reclaim = 6,
}

impl LineageEventKind {
    pub(super) fn from_byte(raw: u8) -> FractalResult<Self> {
        match raw {
            1 => Ok(Self::Fork),
            2 => Ok(Self::Merge),
            3 => Ok(Self::Rebase),
            4 => Ok(Self::Rename),
            5 => Ok(Self::Migrate),
            6 => Ok(Self::Reclaim),
            other => Err(FractalError::CorruptStore(format!(
                "unknown lineage event discriminant '{other}'"
            ))),
        }
    }

    /// Returns stable kebab-case identifier string for diagnostics.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fork => "fork",
            Self::Merge => "merge",
            Self::Rebase => "rebase",
            Self::Rename => "rename",
            Self::Migrate => "migrate",
            Self::Reclaim => "reclaim",
        }
    }
}

/// Authenticated single transition record binding parent, child, commit OID, and cell identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FractalLineageReceipt {
    /// Lifecycle transition event category.
    pub event_kind: LineageEventKind,
    /// Domain cell coordinate (`fractal-git`, `auto-refactor`, etc.).
    pub cell_id: String,
    /// Source / parent reference name.
    pub source_ref: String,
    /// Target / child reference name.
    pub target_ref: String,
    /// Commit object hex id linked to the transition.
    pub commit_oid_hex: String,
    /// Optional parent commit object hex id.
    pub parent_oid_hex: String,
    /// UNIX epoch timestamp in seconds.
    pub timestamp_secs: i64,
    /// Keyed 32-byte HMAC-SM3 tag over canonical binary fields.
    pub hmac_tag: [u8; 32],
}

/// Parameters required to record a new authenticated [`FractalLineageReceipt`].
#[derive(Debug, Clone, Copy)]
pub struct LineageRecordParams<'a> {
    /// Transition kind (`Fork`, `Merge`, `Rebase`, `Rename`, `Migrate`, `Reclaim`).
    pub event_kind: LineageEventKind,
    /// Domain cell coordinate.
    pub cell_id: &'a str,
    /// Source / parent branch name.
    pub source_ref: &'a str,
    /// Target / child branch name.
    pub target_ref: &'a str,
    /// Resulting commit hex OID (40 chars or empty when unborn).
    pub commit_oid_hex: &'a str,
    /// Parent commit hex OID (40 chars or empty).
    pub parent_oid_hex: &'a str,
}
