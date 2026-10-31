//! Module: fg-storage — Commit Materialization Pipeline
//! File Path: crates/fg-storage/src/commit_materializer.rs
//! Architecture Role: Turns a set of working-tree files into a durable Git commit: blob
//!   objects, hierarchical trees, the commit object itself, and the advanced reference.
//! Dependencies & Triggers: Invoked by the Taxis CLI commit dispatcher and integration tests.
//! Responsibilities: Path-relative file ingestion, canonical object persistence, ref advance.
//! Exit Semantics & Design Rationale: Every step is fallible and ordered so that a failure
//!   leaves no partially-advanced reference. Objects are content-addressed and therefore
//!   idempotent, which makes a retry after a mid-way failure safe.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-OBJ-001`: Git object model serialization guard

use std::collections::BTreeMap;
use std::path::Path;

use fg_algorithms::traverse::flatten_tree_with;
use fg_core::constants::git::{OBJ_BLOB, OBJ_COMMIT, OBJ_TREE};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{parse_loose_header, FileMode, GitSignature, ObjectKind, Oid};
use fg_core::traits::{OdbStore, RefStore};
use fg_index::InMemoryIndexTree;
use fg_object::borrowed::GitCommitRef;
use fg_object::{GitCommit, GitTree};

/// Request describing one commit to materialize.
#[derive(Debug, Clone)]
pub struct CommitMaterializationRequest {
    /// Repository-relative paths to include, interpreted against `work_root`.
    pub files: Vec<String>,
    /// Directory that relative paths are resolved against.
    pub work_root: std::path::PathBuf,
    /// Commit message body (already validated by the caller's policy).
    pub message: String,
    /// Author signature.
    pub author: GitSignature,
    /// Git reference to advance, e.g. `refs/fractal/cell/main`.
    pub target_ref: String,
}

/// Request describing one commit materialized directly from staged index entries.
#[derive(Debug, Clone)]
pub struct IndexCommitRequest {
    /// Staged `(path, mode, blob_oid)` entries representing the complete target tree.
    pub entries: Vec<(String, FileMode, Oid)>,
    /// Commit message body (already validated by the caller's policy).
    pub message: String,
    /// Author signature.
    pub author: GitSignature,
    /// Committer signature.
    pub committer: GitSignature,
    /// Git reference to advance, e.g. `refs/heads/main`.
    pub target_ref: String,
}

/// Result of a successful materialization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaterializedCommit {
    /// OID of the created commit object.
    pub commit_oid: Oid,
    /// OID of the root tree.
    pub tree_oid: Oid,
    /// OIDs of every persisted blob, in input order.
    pub blob_oids: Vec<Oid>,
    /// Parent commit the new commit was chained onto, if the ref already existed.
    pub parent_oid: Option<Oid>,
    /// Git file mode recorded for each blob, in input order.
    ///
    /// The mode is observed from the working tree, so executables and symlinks keep their
    /// identity instead of being flattened to plain files. Callers that rewrite the on-disk
    /// index reuse this vector to stay consistent with the tree that was just committed.
    pub modes: Vec<FileMode>,
}

/// Writes every blob, the tree, and the commit object, leaving the reference untouched.
///
/// Callers that must surrender control to a reference-transaction hook between the object
/// writes and the reference update use this phase directly; otherwise prefer
/// [`materialize_commit`], which performs both steps in one call.
pub fn write_commit_objects(
    odb: &impl OdbStore,
    ref_store: &impl RefStore,
    request: &CommitMaterializationRequest,
) -> FractalResult<MaterializedCommit> {
    write_commit_objects_inner(odb, ref_store, request, &[])
}

/// Writes every blob, the tree, and a commit object, appending extra parents after the
/// reference's current parent.
///
/// A merge commit is the only caller that needs more than one parent: the first parent
/// stays the tip of the target reference and every entry of additional_parents follows
/// in order. The reference itself is left untouched, matching write_commit_objects'
/// contract.
pub fn write_commit_objects_with_parents(
    odb: &impl OdbStore,
    ref_store: &impl RefStore,
    request: &CommitMaterializationRequest,
    additional_parents: &[Oid],
) -> FractalResult<MaterializedCommit> {
    write_commit_objects_inner(odb, ref_store, request, additional_parents)
}

/// Persists all hierarchical Git tree objects from `index_tree` in a single sort, serialize, and
/// SHA-1 pass per directory (`FGT-PRF-001`), returning the root tree OID.
pub fn persist_index_tree(
    index_tree: &InMemoryIndexTree,
    odb: &(impl OdbStore + ?Sized),
) -> FractalResult<Oid> {
    index_tree.write_tree_with_payload_persister(|payload| odb.write_object(OBJ_TREE, payload))
}

/// Serializes `commit` (including optional `Praxis-Agent-Meta`, `FGT-OBJ-001`), persists it to
/// `odb`, and verifies that the stored OID agrees with `commit.oid()`.
pub fn persist_commit_object(
    commit: &GitCommit,
    odb: &(impl OdbStore + ?Sized),
) -> FractalResult<Oid> {
    let commit_oid = odb.write_object(OBJ_COMMIT, &commit.to_payload())?;
    if commit_oid != *commit.oid() {
        return Err(FractalError::HashMismatch {
            expected: commit.oid_hex(),
            actual: commit_oid.to_hex(),
        });
    }
    Ok(commit_oid)
}

/// Writes tree objects and a commit object directly from staged `(path, mode, oid)` index entries.
///
/// Unlike [`write_commit_objects_with_parents`], which hashes working-tree files on top of the
/// parent commit's tree, this function builds the tree strictly from the staged entries already
/// recorded in `.git/index` (or `repo.txc`). That preserves staged deletions and partial staging
/// without absorbing unstaged working-tree edits.
pub fn write_index_commit_objects_with_parents(
    odb: &impl OdbStore,
    ref_store: &impl RefStore,
    request: &IndexCommitRequest,
    additional_parents: &[Oid],
) -> FractalResult<MaterializedCommit> {
    let parent_oid = ref_store.get_ref(&request.target_ref)?;
    let mut parent_oids: Vec<Oid> = parent_oid.iter().copied().collect();
    parent_oids.extend(additional_parents.iter().copied());

    let mut index_tree = InMemoryIndexTree::new();
    let mut blob_oids = Vec::with_capacity(request.entries.len());
    let mut modes = Vec::with_capacity(request.entries.len());
    for (path, mode, oid) in &request.entries {
        index_tree.stage_oid(path, *mode, *oid)?;
        blob_oids.push(*oid);
        modes.push(*mode);
    }

    let tree_oid = persist_index_tree(&index_tree, odb)?;

    let commit = GitCommit::new(
        tree_oid,
        parent_oids,
        request.author.clone(),
        request.committer.clone(),
        request.message.clone(),
        None,
    );
    let commit_oid = persist_commit_object(&commit, odb)?;

    Ok(MaterializedCommit {
        commit_oid,
        tree_oid,
        blob_oids,
        parent_oid,
        modes,
    })
}

fn write_commit_objects_inner(
    odb: &impl OdbStore,
    ref_store: &impl RefStore,
    request: &CommitMaterializationRequest,
    additional_parents: &[Oid],
) -> FractalResult<MaterializedCommit> {
    if request.files.is_empty() {
        return Err(FractalError::ObjectCodec(
            "commit must include at least one file".into(),
        ));
    }

    let parent_oid = ref_store.get_ref(&request.target_ref)?;
    let mut parent_oids: Vec<Oid> = parent_oid.iter().copied().collect();
    parent_oids.extend(additional_parents.iter().copied());

    let mut index_tree = InMemoryIndexTree::new();
    if let Some(parent_commit_oid) = parent_oid {
        let raw_parent = odb.read_object(&parent_commit_oid)?;
        let (parent_kind, parent_payload) = parse_loose_header(&raw_parent)?;
        if parent_kind != ObjectKind::Commit {
            return Err(FractalError::ObjectCodec(format!(
                "parent object {} has kind '{}', expected 'commit'",
                parent_commit_oid.to_hex(),
                parent_kind.as_str()
            )));
        }
        let commit_ref = GitCommitRef::parse(parent_payload)?;
        let parent_entries = read_full_tree_entries(odb, commit_ref.tree_oid())?;
        index_tree = index_tree.graft_onto_parent(&parent_entries);
    }

    let mut blob_oids = Vec::with_capacity(request.files.len());
    let mut modes = Vec::with_capacity(request.files.len());

    for relative_path in &request.files {
        let absolute_path = request.work_root.join(relative_path);
        let mode = staged_file_mode(&absolute_path, relative_path)?;
        let payload = read_staged_file(&absolute_path, relative_path, mode)?;
        let persisted_oid = odb.write_object(OBJ_BLOB, &payload)?;
        index_tree.stage_oid(relative_path, mode, persisted_oid)?;
        blob_oids.push(persisted_oid);
        modes.push(mode);
    }

    let tree_oid = persist_index_tree(&index_tree, odb)?;

    let commit = GitCommit::new(
        tree_oid,
        parent_oids,
        request.author.clone(),
        request.author.clone(),
        request.message.clone(),
        None,
    );
    let commit_oid = persist_commit_object(&commit, odb)?;

    Ok(MaterializedCommit {
        commit_oid,
        tree_oid,
        blob_oids,
        parent_oid,
        modes,
    })
}

/// Recursively reads all entries from a Git tree hierarchy into a flat `path -> (FileMode, Oid)` map.
pub fn read_full_tree_entries(
    odb: &(impl OdbStore + ?Sized),
    root_tree_oid: &Oid,
) -> FractalResult<BTreeMap<String, (FileMode, Oid)>> {
    if *root_tree_oid == Oid::ZERO {
        return Ok(BTreeMap::new());
    }
    let mut flat = BTreeMap::new();
    flatten_tree_with(
        root_tree_oid,
        "",
        &|oid| {
            let raw_bytes = odb.read_object(oid)?;
            let (kind, payload) = parse_loose_header(&raw_bytes)?;
            if kind != ObjectKind::Tree {
                return Err(FractalError::ObjectCodec(format!(
                    "tree walk expected 'tree' for {}, found '{}'",
                    oid.to_hex(),
                    kind.as_str()
                )));
            }
            Ok(payload.to_vec())
        },
        &mut flat,
    )?;

    Ok(flat
        .into_iter()
        .map(|(path, entry)| (path, (entry.mode, entry.oid)))
        .collect())
}

/// Materializes `request` into the object database, advancing the target reference on success.
///
/// Object writes happen before the reference update so that a reader following the ref can
/// always resolve the full object graph it points at.
pub fn materialize_commit(
    odb: &impl OdbStore,
    ref_store: &impl RefStore,
    request: &CommitMaterializationRequest,
) -> FractalResult<MaterializedCommit> {
    let materialized = write_commit_objects(odb, ref_store, request)?;
    ref_store.update_ref(
        &request.target_ref,
        &materialized.commit_oid,
        materialized.parent_oid.as_ref(),
    )?;
    Ok(materialized)
}

/// Observes the Git file mode that a working-tree path should be committed with.
///
/// Symbolic links are recorded with the Git symlink mode, and on Unix hosts any file whose
/// execute bit is set keeps the executable mode. Everything else, including filesystems that
/// cannot express these distinctions, stays a regular file.
fn staged_file_mode(absolute_path: &Path, relative_path: &str) -> FractalResult<FileMode> {
    let metadata = std::fs::symlink_metadata(absolute_path)
        .map_err(|stat_err| staged_file_error(stat_err, absolute_path, relative_path))?;
    if metadata.file_type().is_symlink() {
        return Ok(FileMode::Symlink);
    }
    if has_executable_bit(&metadata) {
        return Ok(FileMode::ExecutableFile);
    }
    Ok(FileMode::RegularFile)
}

/// Reports whether the host marks a file as executable.
#[cfg(unix)]
fn has_executable_bit(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

/// Reports whether the host marks a file as executable (never, on filesystems without modes).
#[cfg(not(unix))]
fn has_executable_bit(_metadata: &std::fs::Metadata) -> bool {
    false
}

/// Reads the byte payload Git stores for one staged path.
///
/// For a regular file that is the file contents. For a symbolic link it is the link target,
/// because Git records the target text as the blob instead of following the link. Backslashes
/// are normalised to forward slashes so a Windows-created link stays readable on POSIX hosts.
fn read_staged_file(
    absolute_path: &Path,
    relative_path: &str,
    mode: FileMode,
) -> FractalResult<Vec<u8>> {
    if mode == FileMode::Symlink {
        let target = std::fs::read_link(absolute_path)
            .map_err(|link_err| staged_file_error(link_err, absolute_path, relative_path))?;
        let normalised = target.to_string_lossy().replace('\\', "/");
        return Ok(normalised.into_bytes());
    }
    std::fs::read(absolute_path)
        .map_err(|read_err| staged_file_error(read_err, absolute_path, relative_path))
}

/// Maps a filesystem failure into a diagnostic that names the staged path and its root.
fn staged_file_error(
    error: std::io::Error,
    absolute_path: &Path,
    relative_path: &str,
) -> FractalError {
    if error.kind() == std::io::ErrorKind::NotFound {
        FractalError::ObjectCodec(format!(
            "staged file '{}' does not exist under '{}'",
            relative_path,
            absolute_path.display()
        ))
    } else {
        FractalError::Io(error)
    }
}

/// Serializes tree entries into the canonical Git tree payload (type header excluded).
#[must_use]
pub fn serialize_tree_payload(tree: &GitTree) -> Vec<u8> {
    tree.to_payload()
}

/// Serializes a commit into the canonical Git commit payload (type header excluded), preserving
/// any attached `Praxis-Agent-Meta` header (`FGT-OBJ-001`).
#[must_use]
pub fn serialize_commit_payload(commit: &GitCommit) -> Vec<u8> {
    commit.to_payload()
}

#[cfg(test)]
mod tests {
    use super::{persist_commit_object, serialize_commit_payload};
    use crate::loose::LooseOdb;
    use fg_core::models::{AgentCommitMeta, GitSignature, Oid};
    use fg_object::GitCommit;

    fn test_temp_dir(prefix: &str) -> tempfile::TempDir {
        let base = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&base);
        tempfile::Builder::new()
            .prefix(prefix)
            .tempdir_in(&base)
            .or_else(|_| tempfile::tempdir())
            .expect("create test tempdir")
    }

    #[test]
    fn commit_serialization_preserves_agent_meta_without_hash_mismatch() {
        let dir = test_temp_dir("commit_materializer_");
        let odb = LooseOdb::without_cache(dir.path());
        let sig = GitSignature::new("Agent", "agent@example.com", 1_700_000_000);
        let meta = AgentCommitMeta {
            card_context: fg_core::models::PraxisCardContext {
                card_id: "card-01".to_string(),
                cell_id: "cell-alpha".to_string(),
                agent_uid: "fg-refactor".to_string(),
                role: Some("refactor".to_string()),
            },
            quality_score: 98.0,
            gate_status: "PASSED".to_string(),
            timestamp_ms: 1_700_000_000_000,
        };
        let commit = GitCommit::new(
            Oid::from_bytes([0x11; 20]),
            vec![],
            sig.clone(),
            sig,
            "feat(storage): preserve agent meta\n".to_string(),
            Some(meta),
        );

        let payload = serialize_commit_payload(&commit);
        assert!(std::str::from_utf8(&payload)
            .expect("utf8")
            .contains("Praxis-Agent-Meta: "));
        let persisted = persist_commit_object(&commit, &odb).expect("persist commit with meta");
        assert_eq!(persisted, *commit.oid());
    }
}
