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

use std::path::Path;

use fg_core::constants::git::{OBJ_BLOB, OBJ_COMMIT, OBJ_TREE};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileMode, GitSignature, Oid};
use fg_core::traits::{OdbStore, RefStore};
use fg_index::InMemoryIndexTree;
use fg_object::{GitBlob, GitCommit, GitTree};

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
    if request.files.is_empty() {
        return Err(FractalError::ObjectCodec(
            "commit must include at least one file".into(),
        ));
    }

    let mut index_tree = InMemoryIndexTree::new();
    let mut blob_oids = Vec::with_capacity(request.files.len());
    let mut modes = Vec::with_capacity(request.files.len());

    for relative_path in &request.files {
        let absolute_path = request.work_root.join(relative_path);
        let mode = staged_file_mode(&absolute_path, relative_path)?;
        let payload = read_staged_file(&absolute_path, relative_path, mode)?;
        let blob = GitBlob::from_bytes(payload);
        let persisted_oid = odb.write_object(OBJ_BLOB, blob.payload())?;
        if persisted_oid != *blob.oid() {
            return Err(FractalError::HashMismatch {
                expected: blob.oid().to_string(),
                actual: persisted_oid.to_hex(),
            });
        }
        index_tree.stage_oid(relative_path, mode, *blob.oid())?;
        blob_oids.push(*blob.oid());
        modes.push(mode);
    }

    let tree_oid = index_tree.write_tree_with_persister(|tree| {
        odb.write_object(OBJ_TREE, &serialize_tree_payload(tree))?;
        Ok(())
    })?;

    let parent_oid = ref_store.get_ref(&request.target_ref)?;

    let commit = GitCommit::new(
        tree_oid,
        parent_oid.iter().copied().collect(),
        request.author.clone(),
        request.author.clone(),
        request.message.clone(),
        None,
    );
    let commit_oid = odb.write_object(OBJ_COMMIT, &serialize_commit_payload(&commit))?;
    if commit_oid != *commit.oid() {
        return Err(FractalError::HashMismatch {
            expected: commit.oid_hex(),
            actual: commit_oid.to_hex(),
        });
    }

    Ok(MaterializedCommit {
        commit_oid,
        tree_oid,
        blob_oids,
        parent_oid,
        modes,
    })
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
pub fn serialize_tree_payload(tree: &GitTree) -> Vec<u8> {
    let mut payload = Vec::with_capacity(tree.entries().len() * 40);
    for entry in tree.entries() {
        payload.extend_from_slice(entry.mode.as_octal_str().as_bytes());
        payload.push(b' ');
        payload.extend_from_slice(entry.name.as_bytes());
        payload.push(0);
        payload.extend_from_slice(entry.oid.as_bytes());
    }
    payload
}

/// Serializes a commit into the canonical Git commit payload (type header excluded).
///
/// The message is appended verbatim: Git hashes exactly the message bytes it received, so adding a
/// newline here would diverge from the object id Git computed for the same commit.
pub fn serialize_commit_payload(commit: &GitCommit) -> Vec<u8> {
    use std::io::Write;
    let mut payload = Vec::with_capacity(256 + commit.message().len());
    let _ = writeln!(payload, "tree {}", commit.tree_oid());
    for parent in commit.parent_oids() {
        let _ = writeln!(payload, "parent {}", parent);
    }
    let _ = writeln!(payload, "author {}", commit.author().to_git_line());
    let _ = writeln!(payload, "committer {}", commit.committer().to_git_line());
    payload.push(b'\n');
    payload.extend_from_slice(commit.message().as_bytes());
    payload
}
