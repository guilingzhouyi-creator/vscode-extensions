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
mod index;
mod refs;
#[cfg(test)]
mod tests;

use std::fs;
use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{raw_object, Oid};
use fg_native::sections::head::HeadState;
use fg_native::sections::indx::IndxSection;
use fg_native::sections::meta::{LayoutMode, MetaSection};
use fg_native::sections::oplog::{OpLogEntry, OpLogParts};
use fg_native::sections::refs::RefsSection;
use fg_native::RepoDocument;

pub use export::export_native_to_git;
use index::import_git_index;
use refs::import_git_refs;

use crate::backends::odb_router::OdbRouter;
use crate::cas_backend::CasBackend;
use crate::loose::LooseOdb;

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

/// Prepares native repository directory layout and guard file.
pub(super) fn setup_native_scaffold(native_dir: &Path, force: bool) -> FractalResult<()> {
    let container_path = fg_native::container_path(native_dir);
    if container_path.exists() && !force {
        return Err(FractalError::CorruptStore(format!(
            "native container '{}' already exists; use --force to overwrite",
            container_path.display()
        )));
    }
    fs::create_dir_all(native_dir.join("objects/blocks"))?;
    fs::create_dir_all(native_dir.join("journal"))?;
    fg_native::write_guard_file(native_dir)
        .map_err(|err| FractalError::CorruptStore(format!("failed to write guard file: {err}")))?;
    #[cfg(windows)]
    let _ = fg_native::attempt_hide(native_dir);
    Ok(())
}

/// Ingests all objects from a Git ODB router into native CAS and loose ODB backends.
fn import_git_objects_to_cas(
    native_dir: &Path,
    router: &OdbRouter,
    cas: &CasBackend,
) -> FractalResult<usize> {
    let oids = router.all_oids()?;
    for oid in &oids {
        if let Some(packed) = router.read(oid)? {
            cas.put_block(packed.kind, &packed.payload)?;
            let framed = raw_object(packed.kind, &packed.payload);
            LooseOdb::write_loose_object_raw(native_dir, oid, &framed)?;
        }
    }
    Ok(oids.len())
}

/// Reads Git HEAD reference or detached commit OID.
fn import_git_head(git_dir: &Path) -> FractalResult<HeadState> {
    let head_path = git_dir.join("HEAD");
    if !head_path.is_file() {
        return Ok(HeadState::Symbolic {
            target: "refs/heads/main".to_string(),
        });
    }
    let content = fs::read_to_string(&head_path)?;
    let trimmed = content.trim();
    if let Some(target) = trimmed.strip_prefix("ref:") {
        Ok(HeadState::Symbolic {
            target: target.trim().to_string(),
        })
    } else if let Ok(oid) = Oid::from_hex(trimmed) {
        Ok(HeadState::Detached { oid })
    } else {
        Ok(HeadState::Symbolic {
            target: "refs/heads/main".to_string(),
        })
    }
}

/// Assembles a complete `RepoDocument` from imported Git components.
fn assemble_imported_document(
    repo_id: [u8; 16],
    layout_mode: LayoutMode,
    head: HeadState,
    refs: RefsSection,
    indx: IndxSection,
) -> FractalResult<RepoDocument> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let meta = MetaSection::new(repo_id, now_ms, layout_mode);
    let mut doc = RepoDocument::new(meta, head);
    doc.refs = refs;
    doc.indx = indx;

    let op_parts = OpLogParts {
        parent_ids: Vec::new(),
        head_oid: doc.head.detached_oid().copied(),
        branches: doc
            .refs
            .records()
            .iter()
            .map(|r| (r.name.clone(), r.oid))
            .collect(),
        staged_promotions: Vec::new(),
        timestamp_ms: now_ms,
        actor: "taxis-git-import".to_string(),
        command: "git-import".to_string(),
        description: "Initial import from Git repository".to_string(),
    };
    if let Ok(entry) = OpLogEntry::new(op_parts) {
        let _ = doc.oplog.upsert(entry);
    }

    Ok(doc)
}

/// Imports an existing Git repository (`.git/`) into a native Taxis repository (`.taxis/`).
///
/// # Errors
///
/// Returns [`FractalError::CorruptStore`] if `git_dir` is invalid, or propagates
/// I/O and serialization errors.
pub fn import_git_to_native(
    git_dir: &Path,
    native_dir: &Path,
    layout_mode: LayoutMode,
    force: bool,
) -> FractalResult<ImportReport> {
    if !git_dir.is_dir() {
        return Err(FractalError::CorruptStore(format!(
            "source git directory '{}' does not exist",
            git_dir.display()
        )));
    }

    setup_native_scaffold(native_dir, force)?;
    let cas = CasBackend::new(native_dir);
    let router = OdbRouter::open(git_dir.join("objects"))?;
    let objects_imported = import_git_objects_to_cas(native_dir, &router, &cas)?;
    let head = import_git_head(git_dir)?;
    let refs = import_git_refs(git_dir)?;
    let indx = import_git_index(git_dir)?;

    let repo_id = fg_native::generate_repo_id()
        .map_err(|err| FractalError::CorruptStore(format!("failed to generate repo id: {err}")))?;

    let doc = assemble_imported_document(repo_id, layout_mode, head, refs, indx)?;
    let container_path = fg_native::container_path(native_dir);
    doc.save_atomic(&container_path).map_err(|err| {
        FractalError::CorruptStore(format!("failed to save native container: {err}"))
    })?;

    // Also write loose refs and HEAD for tools reading directly from disk
    for record in doc.refs.records() {
        let dest = native_dir.join(&record.name);
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&dest, format!("{}\n", record.oid.to_hex()));
    }
    let head_str = match &doc.head {
        HeadState::Symbolic { target } => format!("ref: {target}\n"),
        HeadState::Detached { oid } => format!("{}\n", oid.to_hex()),
    };
    let _ = fs::write(native_dir.join("HEAD"), head_str);

    let src_index = git_dir.join("index");
    if src_index.is_file() {
        let _ = fs::copy(&src_index, native_dir.join("index"));
    }

    Ok(ImportReport {
        objects_imported,
        refs_imported: doc.refs.len(),
        index_entries_imported: doc.indx.len(),
        head: format_head_state(&doc.head),
        repo_id: doc.meta.repo_id_hex(),
    })
}
