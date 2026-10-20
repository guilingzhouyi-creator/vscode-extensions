//! Module: fg-storage — LayerVFS CAS Materializer Bridge
//! File Path: crates/fg-storage/src/cas_bridge.rs
//! Architecture Role: Bridges LayerVFS content-addressed snapshots into canonical Git Commit
//!   and Tree objects, persisting directly to `.git/objects/` with zero disk lock contention.

use std::path::Path;

use fg_core::error::FractalResult;
use fg_core::models::{AgentCommitMeta, GitSignature, Oid};
use fg_index::InMemoryIndexTree;
use fg_object::{FileMode, GitBlob, GitCommit};

use crate::loose::LooseOdb;

/// File payload descriptor from a LayerVFS winning snapshot.
#[derive(Debug, Clone)]
pub struct CasFileDescriptor {
    pub path: String,
    pub mode: FileMode,
    pub payload: Vec<u8>,
}

/// Request bundle for materializing a LayerVFS snapshot into a Git Commit.
#[derive(Debug, Clone)]
pub struct MaterializeRequest {
    pub parent_commit_oids: Vec<Oid>,
    pub files: Vec<CasFileDescriptor>,
    pub message: String,
    pub author: GitSignature,
    pub committer: GitSignature,
    pub agent_meta: Option<AgentCommitMeta>,
}

/// Atomic materializer from LayerVFS CAS state to Git ODB.
pub struct CasToGitMaterializer;

impl CasToGitMaterializer {
    /// Materializes a snapshot bundle directly into `.git/objects/`
    /// and returns the created Commit Oid.
    pub fn materialize(git_dir: &Path, request: MaterializeRequest) -> FractalResult<Oid> {
        let mut index = InMemoryIndexTree::new();

        // 1. Write blobs and record into virtual tree builder
        for file in request.files {
            let blob = GitBlob::from_bytes(file.payload);
            LooseOdb::write_loose_object_raw(git_dir, blob.raw_oid(), &blob.to_raw_object())?;
            index.stage_oid(&file.path, file.mode, *blob.raw_oid())?;
        }

        // 2. Recursively persist tree structure using callback to LooseOdb
        let root_tree_oid = index.write_tree_with_persister(|tree| {
            LooseOdb::write_loose_object_raw(git_dir, tree.raw_oid(), &tree.to_raw_object())
        })?;

        // 3. Assemble and persist canonical GitCommit object
        let commit = GitCommit::new(
            root_tree_oid.to_hex(),
            request
                .parent_commit_oids
                .iter()
                .map(|parent_oid| parent_oid.to_hex())
                .collect(),
            request.author,
            request.committer,
            request.message,
            request.agent_meta,
        );

        LooseOdb::write_loose_object_raw(git_dir, commit.raw_oid(), &commit.to_raw_object())?;

        Ok(*commit.raw_oid())
    }
}
