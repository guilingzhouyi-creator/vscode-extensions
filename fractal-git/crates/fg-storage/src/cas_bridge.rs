//! Module: fg-storage — LayerVFS CAS Materializer Bridge
//! File Path: crates/fg-storage/src/cas_bridge.rs
//! Architecture Role: Bridges LayerVFS content-addressed snapshots into canonical Git Commit
//!   and Tree objects, persisting directly to `.git/objects/` with zero disk lock contention.
//! Dependencies & Triggers: Consumed by orchestrator pipeline and variant evaluation winners.
//! Responsibilities: Materialize blobs into loose ODB, construct directory tree hierarchies,
//!   and produce signed commit objects with Agent metadata.
//! Exit Semantics & Design Rationale: Returns the produced commit OID directly upon successful flush;
//!   fails atomically if loose object creation fails.
//!
//! Domain Governance Rules: FGT-STO-001 (storage bridging), FGT-COR-001, FGT-LCK-001.

use std::path::Path;

use fg_core::constants::git::OBJ_BLOB;
use fg_core::error::FractalResult;
use fg_core::models::{AgentCommitMeta, FileMode, GitSignature, Oid};
use fg_core::traits::OdbStore;
use fg_index::InMemoryIndexTree;
use fg_object::GitCommit;

use crate::commit_materializer::{persist_commit_object, persist_index_tree};
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
        let odb = LooseOdb::without_cache(git_dir);
        let mut index = InMemoryIndexTree::new();

        for file in request.files {
            let blob_oid = odb.write_object(OBJ_BLOB, &file.payload)?;
            index.stage_oid(&file.path, file.mode, blob_oid)?;
        }

        let root_tree_oid = persist_index_tree(&index, &odb)?;

        let commit = GitCommit::new(
            root_tree_oid,
            request.parent_commit_oids,
            request.author,
            request.committer,
            request.message,
            request.agent_meta,
        );

        persist_commit_object(&commit, &odb)
    }
}
