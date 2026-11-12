//! Module: taxis_cmd::commit_amend — Commit Amend State Loading and Materialization
//! File Path: src/bin/taxis_cmd/commit_amend.rs
//! Architecture Role: Manages `--amend` base commit resolution, parent preservation, and tree rebuilding.
//! Dependencies & Triggers: Dispatched by `taxis_cmd::commit` when `--amend` is active.
//! Responsibilities: Load target commit record, re-stage base entries, replace tree/commit object.
//! Exit Semantics & Design Rationale:
//!   - Accurately preserves original commit parents, author metadata, and detached HEAD state.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::fs;
use std::path::Path;

use fg_core::models::{FileMode, IndexStage, Oid};
use fg_storage::LooseOdb;
use fractal_git::{DiskRefStore, FractalRef, GitSignature, RefStore};

use super::commit_walk::{parse_commit_record, CommitRecord};
use super::common::{fail_fatal, fail_io, CliContext};

/// Resolved base commit state when amending `HEAD` or target ref.
pub(crate) struct AmendState {
    pub(crate) amended_oid: Oid,
    pub(crate) record: CommitRecord,
    pub(crate) detached_head: bool,
}

/// Loads the existing commit record targeted by `--amend`.
pub(crate) fn load_amend_state(ctx: &CliContext, target_ref: &FractalRef) -> AmendState {
    let ref_store = DiskRefStore::new(&ctx.git_dir);
    let target_name = target_ref.to_git_ref();
    let (amended_oid, detached_head) = match ref_store.get_ref(&target_name) {
        Ok(Some(oid)) => (oid, false),
        _ => match ref_store.head() {
            Ok(fg_topology::HeadState::Detached(oid)) => (oid, true),
            _ => fail_fatal("You have nothing to amend."),
        },
    };
    let view = super::repo_view::RepoView::open_or_exit(ctx);
    let commit_obj = match view.object(&amended_oid) {
        Ok(obj) => obj,
        Err(err) => fail_fatal(format!("load commit '{amended_oid}': {err}")),
    };
    let record = match parse_commit_record(amended_oid, &commit_obj.payload) {
        Ok(parsed) => parsed,
        Err(err) => fail_fatal(format!("parse commit '{amended_oid}': {err}")),
    };
    AmendState {
        amended_oid,
        record,
        detached_head,
    }
}

/// Builds a replacement commit preserving `state.record.parents` when amending.
pub(crate) fn materialize_amend_commit(
    ctx: &CliContext,
    odb: &LooseOdb,
    state: &AmendState,
    index_inputs: (&Path, &[&str], &[String], &Path),
    identity_and_msg: (&str, &GitSignature, &GitSignature, bool),
) -> fractal_git::MaterializedCommit {
    let (index_file, declared_files, staged_files, work_root) = index_inputs;
    let (message, author_override, committer, reset_author) = identity_and_msg;
    let mut index_tree = fg_index::InMemoryIndexTree::new();
    let mut blob_oids = Vec::new();
    let mut modes = Vec::new();

    if declared_files.is_empty() && index_file.is_file() {
        let loaded = match fg_index::GitIndex::load(index_file) {
            Ok(idx) => idx,
            Err(err) => fail_io("load git index for amend", err),
        };
        for entry in loaded
            .entries()
            .iter()
            .filter(|e| e.stage == IndexStage::Normal)
        {
            if let Err(err) = index_tree.stage_oid(&entry.path, entry.mode, entry.oid) {
                fail_io("stage index entry for amend", err);
            }
            blob_oids.push(entry.oid);
            modes.push(entry.mode);
        }
    } else {
        let view = super::repo_view::RepoView::open_or_exit(ctx);
        if let Ok(base_files) = super::tree_view::flatten_commit_tree(&view, &state.amended_oid) {
            for (path, te) in base_files {
                if let Err(err) = index_tree.stage_oid(&path, te.mode, te.oid) {
                    fail_io("stage base entry for amend", err);
                }
            }
        }
        stage_worktree_files_for_amend(
            odb,
            work_root,
            staged_files,
            (&mut index_tree, &mut blob_oids, &mut modes),
        );
    }

    let tree_oid = match fg_storage::commit_materializer::persist_index_tree(&index_tree, odb) {
        Ok(oid) => oid,
        Err(err) => fail_io("persist amended tree", err),
    };
    let effective_author = if reset_author || ctx.args.iter().any(|a| a == "--human") {
        author_override.clone()
    } else {
        GitSignature::new(
            state.record.author_name.clone(),
            state.record.author_mailbox.clone(),
            state.record.author_time,
        )
    };
    let commit = fg_object::GitCommit::new(
        tree_oid,
        state.record.parents.clone(),
        effective_author,
        committer.clone(),
        message,
        None,
    );
    let commit_oid = match fg_storage::commit_materializer::persist_commit_object(&commit, odb) {
        Ok(oid) => oid,
        Err(err) => fail_io("persist amended commit", err),
    };
    fractal_git::MaterializedCommit {
        commit_oid,
        tree_oid,
        blob_oids,
        parent_oid: Some(state.amended_oid),
        modes,
    }
}

/// Hashes working-tree files into `odb` and stages them into `index_tree` for `--amend`.
pub(crate) fn stage_worktree_files_for_amend(
    odb: &LooseOdb,
    work_root: &Path,
    staged_files: &[String],
    targets: (
        &mut fg_index::InMemoryIndexTree,
        &mut Vec<Oid>,
        &mut Vec<FileMode>,
    ),
) {
    use fg_core::traits::OdbStore;
    let (index_tree, blob_oids, modes) = targets;
    for path in staged_files {
        let full_path = work_root.join(path);
        let bytes = match fs::read(&full_path) {
            Ok(data_bytes) => data_bytes,
            Err(err) => fail_io("read staged file for amend", err),
        };
        let blob_oid = match odb.write_object(fg_core::constants::git::OBJ_BLOB, &bytes) {
            Ok(oid) => oid,
            Err(err) => fail_io("write blob for amend", err),
        };
        if let Err(err) = index_tree.stage_oid(path, FileMode::RegularFile, blob_oid) {
            fail_io("stage file for amend", err);
        }
        blob_oids.push(blob_oid);
        modes.push(FileMode::RegularFile);
    }
}
