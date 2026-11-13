//! Module: taxis_cmd::daemon_scheduler — Lock-Free ODB & Hot-Session Snapshot Cloning
//! File Path: src/bin/taxis_cmd/daemon_scheduler/snapshot_clone.rs
//! Architecture Role: Extracts sorted tree blob inventories and UTF-8/text payloads from either
//!   a live [`DaemonHotSession`] or a committed branch tree while holding locks briefly.
//! Dependencies & Triggers: Called by `cycle.rs`.
//! Responsibilities: Exclude binary/oversized blobs (> 512 KiB) and resolve repo names cleanly.
//! Exit Semantics & Design Rationale: Releases session lock prior to audit parsing/hashing.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use fg_core::constants::git::OBJ_BLOB;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{parse_commit_header, parse_loose_header, ObjectKind, Oid};
use fg_core::traits::{OdbStore, RefStore};
use fg_storage::commit_materializer::read_full_tree_entries;
use fg_topology::refs::DiskRefStore;
use fractal_git::LooseOdb;

use crate::taxis_cmd::daemon::daemon_runtime::DaemonHotSession;
use crate::taxis_cmd::daemon::daemon_transport::resolve_taxis_runtime_dir;

pub(super) struct ClonedSnapshotData {
    pub(super) repository_id: String,
    pub(super) head_ref: Option<String>,
    pub(super) head_commit_oid: Option<Oid>,
    pub(super) tree_oid: Oid,
    pub(super) parent_oids: Vec<Oid>,
    pub(super) ordered: BTreeMap<String, Oid>,
    pub(super) files: Vec<(String, Vec<u8>)>,
    pub(super) manifest_paths: Vec<String>,
}

pub(super) fn clone_snapshot_under_lock(
    git_dir: &Path,
    session: &DaemonHotSession,
) -> FractalResult<ClonedSnapshotData> {
    let odb = LooseOdb::new(git_dir);
    let head_ref = std::fs::read_to_string(git_dir.join("HEAD"))
        .ok()
        .map(|raw| {
            raw.trim()
                .strip_prefix("ref:")
                .map_or(raw.trim(), str::trim)
                .to_owned()
        });
    let head_commit_oid = head_ref
        .as_deref()
        .and_then(|ref_name| DiskRefStore::new(git_dir).get_ref(ref_name).ok().flatten());
    let tree_builder = session.index_tree.clone();
    let mut tree_oid = tree_builder
        .write_tree_with_payload_persister(|payload| {
            odb.write_object(fg_core::constants::git::OBJ_TREE, payload)
        })
        .unwrap_or(Oid::ZERO);

    let mut ordered: BTreeMap<String, Oid> = session
        .index_tree
        .entries()
        .iter()
        .map(|(path, entry)| (path.clone(), entry.oid))
        .collect();
    if ordered.is_empty() {
        if let Some(commit_oid) = head_commit_oid {
            if let Ok((commit_entries, commit_tree_oid)) =
                load_commit_tree_entries(&odb, &commit_oid)
            {
                ordered = commit_entries;
                tree_oid = commit_tree_oid;
            }
        }
    }
    let (files, manifest_paths) = read_ordered_blobs(&odb, &ordered);

    let _blob_kind = OBJ_BLOB;
    let parent_oids = head_commit_oid.map(|oid| vec![oid]).unwrap_or_default();
    Ok(ClonedSnapshotData {
        repository_id: resolve_repo_name(git_dir),
        head_ref,
        head_commit_oid,
        tree_oid,
        parent_oids,
        ordered,
        files,
        manifest_paths,
    })
}

pub(super) fn load_commit_tree_entries(
    odb: &LooseOdb,
    commit_oid: &Oid,
) -> FractalResult<(BTreeMap<String, Oid>, Oid)> {
    let raw_commit = odb.read_object(commit_oid)?;
    let (kind, payload) = parse_loose_header(&raw_commit)?;
    if kind != ObjectKind::Commit {
        return Err(FractalError::ObjectCodec(String::from(
            "expected commit object while loading audit tree snapshot",
        )));
    }
    let header = parse_commit_header(payload)?;
    let entries = read_full_tree_entries(odb, &header.tree)?;
    let mut flattened = BTreeMap::new();
    for (rel_path, (_mode, oid)) in entries {
        flattened.insert(rel_path, oid);
    }
    Ok((flattened, header.tree))
}

pub(super) fn read_ordered_blobs(
    odb: &LooseOdb,
    ordered: &BTreeMap<String, Oid>,
) -> (Vec<(String, Vec<u8>)>, Vec<String>) {
    let mut files = Vec::with_capacity(ordered.len());
    let mut manifest_paths = Vec::with_capacity(ordered.len());
    for (rel_path, blob_oid) in ordered {
        let Ok(raw_obj) = odb.read_object(blob_oid) else {
            continue;
        };
        let Ok((ObjectKind::Blob, content)) = parse_loose_header(&raw_obj) else {
            continue;
        };
        if content.contains(&0) || content.len() > 512 * 1024 {
            continue;
        }
        manifest_paths.push(rel_path.clone());
        files.push((rel_path.clone(), content.to_vec()));
    }
    (files, manifest_paths)
}

pub(super) fn resolve_repo_name(git_dir: &Path) -> String {
    resolve_taxis_runtime_dir(git_dir)
        .parent()
        .and_then(|root| root.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("taxis-repo")
        .to_owned()
}

pub(super) fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|dur| u64::try_from(dur.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}
