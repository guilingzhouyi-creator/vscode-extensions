//! Module: fg-storage — Native -> Git Export Pipeline
//! File Path: crates/fg-storage/src/projection/export.rs
//! Architecture Role: Projects a native Taxis repository (`.taxis/`) into a canonical `.git/`
//!   directory containing loose objects, references, HEAD, and DIRC v2 staging index.
//! Dependencies & Triggers: Internal submodule of `fg-storage::projection`; re-exported as
//!   `fg_storage::export_native_to_git`.
//! Responsibilities: Scaffold `.git/` metadata, export CAS & ODB objects, normalize HEAD, and
//!   emit an `ExportReport`.
//! Exit Semantics & Design Rationale: Refuses overwriting an existing target directory unless
//!   `force` is true; propagates I/O and container decode failures explicitly.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-OBJ-001.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{raw_object, Oid};
use fg_native::sections::head::HeadState;
use fg_native::RepoDocument;

use super::index::export_index_to_git;
use super::refs::write_git_refs;
use super::{format_head_state, validate_destination, ExportReport};
use crate::backends::odb_router::OdbRouter;
use crate::cas_backend::CasBackend;
use crate::loose::LooseOdb;

/// Projects a native Taxis repository (`.taxis/`) into a Git-compatible repository (`.git/`).
///
/// # Errors
///
/// Returns [`FractalError::CorruptStore`] if `git_dir` exists without `force` or container
/// loading fails, or propagates I/O and object decoding failures.
pub fn export_native_to_git(
    native_dir: &Path,
    git_dir: &Path,
    force: bool,
) -> FractalResult<ExportReport> {
    validate_destination(git_dir, force)?;

    let container_path = fg_native::container_path(native_dir);
    let doc = RepoDocument::load(&container_path).map_err(|err| {
        FractalError::CorruptStore(format!(
            "failed to load native container '{}': {err}",
            container_path.display()
        ))
    })?;

    initialize_git_scaffold(git_dir)?;
    let refs_exported = write_git_refs(native_dir, git_dir, &doc.refs)?;
    let head = write_git_head(native_dir, git_dir, &doc.head)?;
    let objects_exported = export_cas_objects_to_git(native_dir, git_dir)?;
    let index_entries_exported = export_index_to_git(native_dir, git_dir, &doc.indx)?;

    Ok(ExportReport {
        objects_exported,
        refs_exported,
        index_entries_exported,
        head,
    })
}

/// Initializes standard directory tree and config for a Git projection.
fn initialize_git_scaffold(git_dir: &Path) -> FractalResult<()> {
    fs::create_dir_all(git_dir.join("objects"))?;
    fs::create_dir_all(git_dir.join("refs/heads"))?;
    fs::create_dir_all(git_dir.join("refs/tags"))?;
    fs::create_dir_all(git_dir.join("info"))?;

    let config_content = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n";
    fs::write(git_dir.join("config"), config_content)?;

    let exclude_path = git_dir.join("info/exclude");
    let current_exclude = if exclude_path.exists() {
        fs::read_to_string(&exclude_path).unwrap_or_default()
    } else {
        String::new()
    };
    if !current_exclude.contains(".taxis") {
        let mut new_exclude = current_exclude;
        if !new_exclude.is_empty() && !new_exclude.ends_with('\n') {
            new_exclude.push('\n');
        }
        new_exclude.push_str(".taxis/\n");
        fs::write(&exclude_path, new_exclude)?;
    }

    Ok(())
}

/// Exports all objects from native CAS and ODB stores to loose Git objects.
fn export_cas_objects_to_git(native_dir: &Path, git_dir: &Path) -> FractalResult<usize> {
    let mut exported_oids = BTreeSet::new();

    // 1. Check CAS blocks under native_dir and native_dir/objects
    for cas_root in [native_dir.to_path_buf(), native_dir.join("objects")] {
        let cas = CasBackend::new(&cas_root);
        let Ok(oids) = cas.list_all_oids() else {
            continue;
        };
        for oid in oids {
            if !exported_oids.insert(oid) {
                continue;
            }
            if let Ok((kind, payload)) = cas.get_block_with_kind(&oid) {
                let framed = raw_object(kind, &payload);
                LooseOdb::write_loose_object_raw(git_dir, &oid, &framed)?;
            }
        }
    }

    // 2. Check ODB router under native_dir/objects (loose objects & packs)
    let odb_path = native_dir.join("objects");
    if odb_path.is_dir() {
        export_odb_router_objects(&odb_path, git_dir, &mut exported_oids)?;
    }

    Ok(exported_oids.len())
}

fn export_odb_router_objects(
    odb_path: &Path,
    git_dir: &Path,
    exported_oids: &mut BTreeSet<Oid>,
) -> FractalResult<()> {
    let Ok(router) = OdbRouter::open(odb_path) else {
        return Ok(());
    };
    let Ok(oids) = router.all_oids() else {
        return Ok(());
    };
    for oid in oids {
        if !exported_oids.insert(oid) {
            continue;
        }
        if let Ok(Some(obj)) = router.read(&oid) {
            let framed = raw_object(obj.kind, &obj.payload);
            LooseOdb::write_loose_object_raw(git_dir, &oid, &framed)?;
        }
    }
    Ok(())
}

/// Writes `.git/HEAD` from native HEAD or HeadState, ensuring symbolic targets point to a valid `refs/heads/*` ref when available.
fn write_git_head(native_dir: &Path, git_dir: &Path, head: &HeadState) -> FractalResult<String> {
    let raw_head = read_raw_native_head(native_dir, head);
    let resolved_head = normalize_exported_head(git_dir, &raw_head);
    fs::write(git_dir.join("HEAD"), format!("{resolved_head}\n"))?;
    Ok(resolved_head)
}

fn read_raw_native_head(native_dir: &Path, head: &HeadState) -> String {
    let native_head = native_dir.join("HEAD");
    if native_head.is_file() {
        if let Ok(content) = fs::read_to_string(&native_head) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    format_head_state(head)
}

fn normalize_exported_head(git_dir: &Path, raw_head: &str) -> String {
    let Some(target) = raw_head.strip_prefix("ref:").map(str::trim) else {
        return raw_head.to_string();
    };
    if let Some(rest) = target.strip_prefix("refs/fractal/cell/") {
        if let Some((_cell, branch)) = rest.split_once('/') {
            let projected = format!("refs/heads/{branch}");
            if git_dir.join(&projected).is_file() {
                return format!("ref: {projected}");
            }
        }
    }
    if git_dir.join(target).is_file() {
        return format!("ref: {target}");
    }
    if git_dir.join("refs/heads/main").is_file() {
        return "ref: refs/heads/main".to_string();
    }
    if let Ok(entries) = fs::read_dir(git_dir.join("refs/heads")) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                return format!("ref: refs/heads/{name}");
            }
        }
    }
    format!("ref: {target}")
}
