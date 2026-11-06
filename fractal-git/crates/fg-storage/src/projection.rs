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

use std::fs;
use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{raw_object, IndexStage, Oid};
use fg_index::{write_dirc_v2, GitIndex, IndexEntry};
use fg_native::sections::head::HeadState;
use fg_native::sections::indx::{
    IndxSection, StatCache, FLAG_ASSUME_VALID, FLAG_INTENT_TO_ADD, FLAG_SKIP_WORKTREE,
};
use fg_native::sections::meta::{LayoutMode, MetaSection};
use fg_native::sections::oplog::{OpLogEntry, OpLogParts};
use fg_native::sections::refs::{RefRecord, RefsSection};
use fg_native::RepoDocument;

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
fn format_head_state(head: &HeadState) -> String {
    match head {
        HeadState::Symbolic { target } => format!("ref: {target}"),
        HeadState::Detached { oid } => oid.to_hex(),
    }
}

/// Validates that target destination does not exist unless overwrite is requested.
fn validate_destination(dest_dir: &Path, force: bool) -> FractalResult<()> {
    if dest_dir.exists() && !force {
        return Err(FractalError::CorruptStore(format!(
            "destination directory '{}' already exists; use --force to overwrite",
            dest_dir.display()
        )));
    }
    Ok(())
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

/// Writes all native references into `.git/refs/` hierarchy, projecting cell branches to `refs/heads/`.
fn write_git_refs(native_dir: &Path, git_dir: &Path, refs: &RefsSection) -> FractalResult<usize> {
    let mut written = std::collections::BTreeSet::new();
    let mut projected_heads: Vec<(String, Oid)> = Vec::new();

    for record in refs.records() {
        write_single_git_ref(git_dir, &record.name, &record.oid, &mut written)?;
        collect_projected_cell_branch(&record.name, record.oid, &mut projected_heads);
    }

    let refs_dir = native_dir.join("refs");
    if refs_dir.is_dir() {
        let mut disk_refs = RefsSection::new();
        let _ = collect_loose_refs_recursive(&refs_dir, &refs_dir, &mut disk_refs);
        for record in disk_refs.records() {
            write_single_git_ref(git_dir, &record.name, &record.oid, &mut written)?;
            collect_projected_cell_branch(&record.name, record.oid, &mut projected_heads);
        }
    }

    for (head_ref, oid) in projected_heads {
        write_single_git_ref(git_dir, &head_ref, &oid, &mut written)?;
    }

    Ok(written.len())
}

fn write_single_git_ref(
    git_dir: &Path,
    ref_name: &str,
    oid: &Oid,
    written: &mut std::collections::BTreeSet<String>,
) -> FractalResult<()> {
    let dest = git_dir.join(ref_name);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&dest, format!("{}\n", oid.to_hex()))?;
    written.insert(ref_name.to_string());
    Ok(())
}

fn collect_projected_cell_branch(ref_name: &str, oid: Oid, out: &mut Vec<(String, Oid)>) {
    if let Some(rest) = ref_name.strip_prefix("refs/fractal/cell/") {
        if let Some((_cell, branch)) = rest.split_once('/') {
            if !branch.is_empty() {
                out.push((format!("refs/heads/{branch}"), oid));
            }
        }
    }
}

/// Exports all objects from native CAS and ODB stores to loose Git objects.
fn export_cas_objects_to_git(native_dir: &Path, git_dir: &Path) -> FractalResult<usize> {
    let mut exported_oids = std::collections::BTreeSet::new();

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
    exported_oids: &mut std::collections::BTreeSet<Oid>,
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

/// Traverses a tree recursively to collect index entries for all leaf blobs using an in-place path buffer.
fn collect_tree_entries_recursive(
    router: &OdbRouter,
    work_root: &Path,
    tree_oid: &Oid,
    path_buf: &mut String,
    out: &mut Vec<IndexEntry>,
) -> FractalResult<()> {
    let Some(tree_obj) = router.read(tree_oid)? else {
        return Ok(());
    };
    let tree_ref = fg_object::GitTreeRef::from_bytes(&tree_obj.payload);
    for entry_res in tree_ref.iter() {
        let entry = entry_res?;
        let saved_len = path_buf.len();
        if saved_len > 0 {
            path_buf.push('/');
        }
        path_buf.push_str(entry.name);

        if entry.mode.is_tree() {
            collect_tree_entries_recursive(router, work_root, &entry.oid, path_buf, out)?;
        } else {
            let disk_file = work_root.join(path_buf.as_str());
            let (size, mtime_sec, mtime_nano) = read_disk_stat_triple(&disk_file);
            out.push(IndexEntry {
                path: path_buf.clone(),
                mode: entry.mode,
                oid: entry.oid,
                stage: IndexStage::Normal,
                size,
                mtime_seconds: mtime_sec,
                mtime_nanos: mtime_nano,
                assume_valid: false,
                skip_worktree: false,
                intent_to_add: false,
            });
        }
        path_buf.truncate(saved_len);
    }
    Ok(())
}

fn read_disk_stat_triple(disk_file: &Path) -> (u32, u32, u32) {
    let Ok(meta) = fs::metadata(disk_file) else {
        return (0, 0, 0);
    };
    let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    let duration = mtime
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    (
        meta.len() as u32,
        duration.as_secs() as u32,
        duration.subsec_nanos(),
    )
}

fn resolve_head_commit_oid(git_dir: &Path) -> Option<Oid> {
    let head_file = git_dir.join("HEAD");
    let content = fs::read_to_string(head_file).ok()?;
    let trimmed = content.trim();
    if let Some(target) = trimmed.strip_prefix("ref:") {
        let ref_path = git_dir.join(target.trim());
        let ref_content = fs::read_to_string(ref_path).ok()?;
        Oid::from_hex(ref_content.trim()).ok()
    } else {
        Oid::from_hex(trimmed).ok()
    }
}

fn rebuild_index_entries_from_head(git_dir: &Path) -> Option<Vec<IndexEntry>> {
    let work_root = git_dir.parent().unwrap_or(git_dir);
    let commit_oid = resolve_head_commit_oid(git_dir)?;
    let router = OdbRouter::open(git_dir.join("objects")).ok()?;
    let commit_obj = router.read(&commit_oid).ok()??;
    let commit_ref = fg_object::GitCommitRef::parse(&commit_obj.payload).ok()?;

    let mut git_entries = Vec::new();
    let mut path_buf = String::with_capacity(128);
    collect_tree_entries_recursive(
        &router,
        work_root,
        commit_ref.tree_oid(),
        &mut path_buf,
        &mut git_entries,
    )
    .ok()?;
    (!git_entries.is_empty()).then_some(git_entries)
}

/// Exports native `INDX` section into canonical Git DIRC v2 index file.
fn export_index_to_git(
    native_dir: &Path,
    git_dir: &Path,
    indx: &IndxSection,
) -> FractalResult<usize> {
    let entries = indx.entries();
    if !entries.is_empty() {
        let git_entries: Vec<IndexEntry> = entries
            .iter()
            .map(|entry| IndexEntry {
                path: entry.path.clone(),
                mode: entry.mode,
                oid: entry.oid,
                stage: entry.stage,
                size: entry.stat.size as u32,
                mtime_seconds: entry.stat.mtime_secs as u32,
                mtime_nanos: entry.stat.mtime_nanos,
                assume_valid: (entry.flags & FLAG_ASSUME_VALID) != 0,
                skip_worktree: (entry.flags & FLAG_SKIP_WORKTREE) != 0,
                intent_to_add: (entry.flags & FLAG_INTENT_TO_ADD) != 0,
            })
            .collect();

        write_dirc_v2(&git_dir.join("index"), &git_entries)?;
        return Ok(entries.len());
    }

    let native_index = native_dir.join("index");
    if native_index.is_file() {
        let _ = fs::copy(&native_index, git_dir.join("index"));
        if let Ok(parsed) = fg_index::GitIndex::load(&native_index) {
            return Ok(parsed.entries().len());
        }
    }

    if let Some(git_entries) = rebuild_index_entries_from_head(git_dir) {
        write_dirc_v2(&git_dir.join("index"), &git_entries)?;
        return Ok(git_entries.len());
    }

    let empty_entries: Vec<IndexEntry> = Vec::new();
    write_dirc_v2(&git_dir.join("index"), &empty_entries)?;
    Ok(0)
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

/// Projects a native Taxis repository (`.taxis/`) into a Git-compatible repository (`.git/`).
///
/// # Errors
///
/// Returns [`FractalError::RepositoryExists`] if `git_dir` exists without `force`,
/// or propagates I/O and object decoding failures.
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

/// Prepares native repository directory layout and guard file.
fn setup_native_scaffold(native_dir: &Path, force: bool) -> FractalResult<()> {
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

/// Ingests Git references from `packed-refs` and loose `refs/` directory.
fn import_git_refs(git_dir: &Path) -> FractalResult<RefsSection> {
    let mut refs = RefsSection::new();
    let packed_path = git_dir.join("packed-refs");
    if packed_path.is_file() {
        let packed_refs = parse_packed_refs(&packed_path);
        for (name, oid, peeled) in packed_refs {
            let _ = refs.upsert(RefRecord { name, oid, peeled });
        }
    }

    let refs_dir = git_dir.join("refs");
    if refs_dir.is_dir() {
        collect_loose_refs_recursive(&refs_dir, &refs_dir, &mut refs)?;
    }
    Ok(refs)
}

/// Parses Git `packed-refs` file preserving peeled tag associations.
fn parse_packed_refs(path: &Path) -> Vec<(String, Oid, Option<Oid>)> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut entries: Vec<(String, Oid, Option<Oid>)> = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(peeled_hex) = trimmed.strip_prefix('^') {
            if let Ok(peeled_oid) = Oid::from_hex(peeled_hex.trim()) {
                if let Some(last) = entries.last_mut() {
                    last.2 = Some(peeled_oid);
                }
            }
            continue;
        }
        if let Some((hex, name)) = trimmed.split_once(' ') {
            if let Ok(oid) = Oid::from_hex(hex.trim()) {
                entries.push((name.trim().to_string(), oid, None));
            }
        }
    }
    entries
}

/// Recursively scans loose reference files into a `RefsSection`.
fn collect_loose_refs_recursive(
    base_refs_dir: &Path,
    current_dir: &Path,
    refs: &mut RefsSection,
) -> FractalResult<()> {
    for entry in fs::read_dir(current_dir)? {
        let entry = entry?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_loose_refs_recursive(base_refs_dir, &entry_path, refs)?;
        } else if entry_path.is_file() {
            let Ok(relative) =
                entry_path.strip_prefix(base_refs_dir.parent().unwrap_or(base_refs_dir))
            else {
                continue;
            };
            let ref_name = relative.to_string_lossy().replace('\\', "/");
            let Ok(content) = fs::read_to_string(&entry_path) else {
                continue;
            };
            let trimmed = content.trim();
            if let Ok(oid) = Oid::from_hex(trimmed) {
                let _ = refs.upsert(RefRecord {
                    name: ref_name,
                    oid,
                    peeled: None,
                });
            }
        }
    }
    Ok(())
}

/// Ingests Git staging index (`.git/index`) into a native `IndxSection`.
fn import_git_index(git_dir: &Path) -> FractalResult<IndxSection> {
    let mut indx = IndxSection::new();
    let index_path = git_dir.join("index");
    if !index_path.is_file() {
        return Ok(indx);
    }
    let git_index = GitIndex::load(&index_path)?;
    for entry in git_index.entries() {
        let stat = StatCache {
            mtime_secs: i64::from(entry.mtime_seconds),
            mtime_nanos: entry.mtime_nanos,
            ctime_secs: i64::from(entry.mtime_seconds),
            ctime_nanos: entry.mtime_nanos,
            size: u64::from(entry.size),
            dev: 0,
            ino: 0,
            uid: 0,
            gid: 0,
        };
        let mut flags = 0u8;
        if entry.assume_valid {
            flags |= FLAG_ASSUME_VALID;
        }
        if entry.skip_worktree {
            flags |= FLAG_SKIP_WORKTREE;
        }
        if entry.intent_to_add {
            flags |= FLAG_INTENT_TO_ADD;
        }
        let native_entry = fg_native::sections::indx::IndexEntry {
            path: entry.path.clone(),
            mode: entry.mode,
            oid: entry.oid,
            stage: entry.stage,
            flags,
            stat,
        };
        let _ = indx.upsert(native_entry);
    }
    Ok(indx)
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

#[cfg(test)]
mod tests {
    use super::*;
    use fg_core::models::{FileMode, IndexStage, ObjectKind};
    use fg_core::traits::OdbStore;
    use fg_native::sections::head::HeadState;
    use fg_native::sections::indx::{IndexEntry as NativeIndexEntry, StatCache};
    use fg_native::sections::meta::{LayoutMode, MetaSection};
    use fg_native::sections::refs::RefRecord;
    use fg_native::RepoDocument;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(prefix: &str) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let count = COUNTER.fetch_add(1, Ordering::Relaxed);
            let pid = std::process::id();
            let base = std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("target")
                .join("test_tmp");
            let _ = std::fs::create_dir_all(&base);
            let path = base.join(format!("fg_proj_{}_{}_{}", prefix, pid, count));
            std::fs::create_dir_all(&path).expect("Failed to create test directory");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn test_export_and_import_roundtrip() {
        let sandbox = TestDir::new("roundtrip");
        let native_dir = sandbox.path().join(".taxis");
        let git_dir = sandbox.path().join(".git");

        // 1. Setup native repository
        setup_native_scaffold(&native_dir, false).expect("setup native scaffold");
        let cas = CasBackend::new(&native_dir);

        let blob_payload = b"hello world\n";
        let blob_oid = cas
            .put_block(ObjectKind::Blob, blob_payload)
            .expect("put blob");

        let repo_id = [0x55u8; 16];
        let meta = MetaSection::new(repo_id, 1000, LayoutMode::Dev);
        let head = HeadState::Symbolic {
            target: "refs/heads/main".to_string(),
        };
        let mut doc = RepoDocument::new(meta, head);

        doc.refs
            .upsert(RefRecord {
                name: "refs/heads/main".to_string(),
                oid: blob_oid,
                peeled: None,
            })
            .expect("upsert ref");

        doc.indx
            .upsert(NativeIndexEntry {
                path: "hello.txt".to_string(),
                mode: FileMode::RegularFile,
                oid: blob_oid,
                stage: IndexStage::Normal,
                flags: 0,
                stat: StatCache {
                    size: blob_payload.len() as u64,
                    mtime_secs: 1000,
                    mtime_nanos: 0,
                    ctime_secs: 1000,
                    ctime_nanos: 0,
                    dev: 0,
                    ino: 0,
                    uid: 0,
                    gid: 0,
                },
            })
            .expect("upsert index");

        doc.save_atomic(&fg_native::container_path(&native_dir))
            .expect("save doc");

        // 2. Export native -> git
        let export_report = export_native_to_git(&native_dir, &git_dir, false).expect("export");
        assert_eq!(export_report.objects_exported, 1);
        assert_eq!(export_report.refs_exported, 1);
        assert_eq!(export_report.index_entries_exported, 1);

        // Verify git projection artifacts
        assert!(git_dir.join("HEAD").is_file());
        assert!(git_dir.join("config").is_file());
        assert!(git_dir.join("refs/heads/main").is_file());
        assert!(git_dir.join("index").is_file());

        let loose_odb = LooseOdb::new(&git_dir);
        assert!(loose_odb.has_object(&blob_oid));

        let loaded_index = GitIndex::load(git_dir.join("index")).expect("load git index");
        assert_eq!(loaded_index.len(), 1);
        assert_eq!(loaded_index.entries()[0].path, "hello.txt");
        assert_eq!(loaded_index.entries()[0].oid, blob_oid);

        // 3. Import git -> new native
        let new_native_dir = sandbox.path().join(".taxis_imported");
        let import_report = import_git_to_native(&git_dir, &new_native_dir, LayoutMode::Dev, false)
            .expect("import");
        assert_eq!(import_report.objects_imported, 1);
        assert_eq!(import_report.refs_imported, 1);
        assert_eq!(import_report.index_entries_imported, 1);

        let new_cas = CasBackend::new(&new_native_dir);
        assert!(new_cas.has_block(&blob_oid));
        let (kind, recovered) = new_cas.get_block_with_kind(&blob_oid).expect("get block");
        assert_eq!(kind, ObjectKind::Blob);
        assert_eq!(recovered, blob_payload);

        let new_doc =
            RepoDocument::load(&fg_native::container_path(&new_native_dir)).expect("load new doc");
        assert_eq!(new_doc.refs.len(), 1);
        assert_eq!(new_doc.refs.get("refs/heads/main").unwrap().oid, blob_oid);
        assert_eq!(new_doc.indx.len(), 1);
        assert_eq!(new_doc.indx.entries()[0].path, "hello.txt");
    }
}
