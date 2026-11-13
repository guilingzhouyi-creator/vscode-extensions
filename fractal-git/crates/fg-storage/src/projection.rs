//! Module: fg-storage — Native <-> Git Projection Layer
//! File Path: crates/fg-storage/src/projection.rs
//! Architecture Role: Bi-directional format bridge between Taxis-native repositories
//!   (`.taxis/`, TAXC container, CAS block store) and Git-compatible repositories
//!   (`.git/`, loose objects, packed-refs, DIRC staging index).
//! Dependencies & Triggers: Invoked by `taxis git-export`, `taxis git-import`, and `taxis init --git-compat`.
//! Responsibilities: Lossless conversion of object graphs, reference tables, HEAD pointers,
//!   and staging cache between native TAXC storage and canonical Git format.
//! Exit Semantics & Design Rationale:
//!   - Conversion is an explicit, one-way atomic operation, avoiding two-state machine synchronization.
//!   - `git-export` writes strict Git loose objects and DIRC v2 index passing `git fsck --strict`.
//!   - `git-import` ingests all loose and packed objects, populating native CAS and TAXC sections.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-OBJ-001`: Git object model serialization guard

mod export;
mod import;
mod index;
mod refs;
#[cfg(test)]
mod tests;

use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_native::sections::head::HeadState;

pub use export::export_native_to_git;
pub use import::import_git_to_native;

/// Summary metrics returned upon successful export from native to Git.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportReport {
    /// Total number of objects written into `.git/objects/`.
    pub objects_exported: usize,
    /// Total number of reference files written into `.git/refs/`.
    pub refs_exported: usize,
    /// Total number of staged entries written into `.git/index`.
    pub index_entries_exported: usize,
    /// String representation of the exported HEAD.
    pub head: String,
}

/// Summary metrics returned upon successful import from Git to native.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportReport {
    /// Total number of objects ingested into native CAS.
    pub objects_imported: usize,
    /// Total number of references recorded in `REFS`.
    pub refs_imported: usize,
    /// Total number of staged entries recorded in `INDX`.
    pub index_entries_imported: usize,
    /// String representation of the imported HEAD.
    pub head: String,
    /// Hex string of the newly assigned repository id.
    pub repo_id: String,
}

/// Formats a `HeadState` into a human-readable display string.
pub(super) fn format_head_state(head: &HeadState) -> String {
    match head {
        HeadState::Symbolic { target } => format!("ref: {target}"),
        HeadState::Detached { oid } => oid.to_hex(),
    }
}

/// Validates that target destination does not exist unless overwrite is requested.
pub(super) fn validate_destination(dest_dir: &Path, force: bool) -> FractalResult<()> {
    if dest_dir.exists() && !force {
        return Err(FractalError::CorruptStore(format!(
            "destination directory '{}' already exists; use --force to overwrite",
            dest_dir.display()
        )));
    }
    Ok(())
}
