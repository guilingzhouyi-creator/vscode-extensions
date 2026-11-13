//! Module: fg-storage — Native INDX <-> Git DIRC v2 Index Projection
//! File Path: crates/fg-storage/src/projection/index.rs
//! Architecture Role: Translates staging entries between TAXC `IndxSection` and canonical
//!   `.git/index` (DIRC v2), including fallback tree reconstruction from HEAD commits.
//! Dependencies & Triggers: Internal submodule of `fg-storage::projection`.
//! Responsibilities: Export native `IndxSection` / fallback trees into DIRC v2 and ingest
//!   `.git/index` entries with stat cache and flags back into `IndxSection`.
//! Exit Semantics & Design Rationale: Falls back to copying `.git/index` or walking HEAD's
//!   tree when `INDX` is empty, preserving working-tree index consistency.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-OBJ-001.

use std::fs;
use std::path::Path;

use fg_core::error::FractalResult;
use fg_core::models::{IndexStage, Oid};
use fg_index::{write_dirc_v2, GitIndex, IndexEntry};
use fg_native::sections::indx::{
    IndxSection, StatCache, FLAG_ASSUME_VALID, FLAG_INTENT_TO_ADD, FLAG_SKIP_WORKTREE,
};

use crate::backends::odb_router::OdbRouter;

/// Exports native `INDX` section into canonical Git DIRC v2 index file.
pub(super) fn export_index_to_git(
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
        if let Ok(parsed) = GitIndex::load(&native_index) {
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

/// Ingests Git staging index (`.git/index`) into a native `IndxSection`.
pub(super) fn import_git_index(git_dir: &Path) -> FractalResult<IndxSection> {
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
