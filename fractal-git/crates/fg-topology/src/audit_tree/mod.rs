//! Module: fg-topology — Worktree-Free Fractal Audit Tree Materializer
//! File Path: crates/fg-topology/src/audit_tree/mod.rs
//! Architecture Role: Pure-ODB commit/tree materializer and hierarchical upward rollup engine
//!   for `refs/fractal/audit/{trunk, cell/*/main, cell/*/card/*/main, cell/*/card/*/sub/*}`.
//! Dependencies & Triggers: Uses `fg_core`, `crate::refs`, `trie`, and `odb_read`.
//! Responsibilities: Persist immutable audit artifact bundles in Git ODB, propagate ancestor
//!   rollups, and query audit blobs and lineage chains.
//! Exit Semantics & Design Rationale: Enforces `is_audit_tree()` confinement fail-closed.

mod odb_read;
mod trie;
#[cfg(test)]
mod unit_tests;

use std::collections::BTreeMap;
use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{
    parse_commit_header, parse_loose_header, validate_repo_relative_path, GitSignature, ObjectKind,
    Oid,
};
use fg_core::traits::{OdbStore, RefStore};
use serde::{Deserialize, Serialize};

use crate::refs::{DiskRefStore, FractalRef};
use odb_read::{
    collect_commit_parents, extract_commit_summary_line, find_blob_in_tree, read_commit_header_oid,
};
use trie::{
    format_audit_commit_payload, insert_trie_entry, sanitize_ref_component, write_tree_node,
    TreeNode,
};

const OBJ_BLOB: &str = "blob";
const OBJ_COMMIT: &str = "commit";

/// Single structured artifact blob to materialize inside an audit commit tree.
#[derive(Debug, Clone, Copy)]
pub struct AuditArtifactEntry<'a> {
    pub path: &'a str,
    pub payload: &'a [u8],
}

/// Complete specification for materializing one commit on a `refs/fractal/audit/...` branch.
#[derive(Debug, Clone)]
pub struct AuditCommitSpec<'a> {
    pub target_ref: &'a FractalRef,
    pub message: &'a str,
    pub author: &'a GitSignature,
    pub source_commit: Option<Oid>,
    pub rollup_parents: &'a [Oid],
    pub entries: &'a [AuditArtifactEntry<'a>],
}

/// Summary of an audit tree materialization and any automatic upward hierarchical rollups.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditMaterializeResult {
    pub target_ref: String,
    pub commit_oid: Oid,
    pub tree_oid: Oid,
    pub parent_oid: Option<Oid>,
    pub rolled_up_refs: Vec<(String, Oid)>,
}

/// Compact metadata stored under `rollups/*.json` during upward tier rollups.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditChildRollupMeta {
    pub child_ref: String,
    pub child_commit_oid: String,
    pub child_tree_oid: String,
    pub source_commit_oid: Option<String>,
}

/// Single commit summary returned while walking `refs/fractal/audit/...` ancestry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditCommitTrace {
    pub commit_oid: Oid,
    pub tree_oid: Oid,
    pub parents: Vec<Oid>,
    pub summary: String,
    pub timestamp_sec: i64,
}

/// Pure-ODB materializer for dedicated worktree-free Fractal Audit Trees.
pub struct AuditTreeMaterializer;

impl AuditTreeMaterializer {
    /// Materializes a single commit on `spec.target_ref` directly inside `odb` and `git_dir`.
    ///
    /// # Errors
    /// Returns [`FractalError::AccessDenied`] when `spec.target_ref` is outside `refs/fractal/audit/`.
    pub fn materialize_commit(
        odb: &impl OdbStore,
        git_dir: &Path,
        spec: &AuditCommitSpec<'_>,
    ) -> FractalResult<AuditMaterializeResult> {
        if !spec.target_ref.is_audit_tree() {
            return Err(FractalError::AccessDenied(format!(
                "refusing audit tree write to non-audit ref '{}'",
                spec.target_ref.to_git_ref()
            )));
        }
        let mut root_trie: BTreeMap<String, TreeNode> = BTreeMap::new();
        for entry in spec.entries {
            validate_repo_relative_path(entry.path)?;
            let blob_oid = odb.write_object(OBJ_BLOB, entry.payload)?;
            insert_trie_entry(&mut root_trie, entry.path, blob_oid)?;
        }
        let tree_oid = write_tree_node(odb, &root_trie)?;
        let prev_oid = spec.target_ref.read_oid(git_dir)?;
        let commit_payload = format_audit_commit_payload(
            tree_oid, prev_oid, spec.rollup_parents, spec.author, spec.source_commit, spec.message,
        );
        let commit_oid = odb.write_object(OBJ_COMMIT, commit_payload.as_bytes())?;
        spec.target_ref.verify_telemetry_update_policy(prev_oid, Some(commit_oid), false)?;
        DiskRefStore::new(git_dir).update_ref(&spec.target_ref.to_git_ref(), &commit_oid, prev_oid.as_ref())?;
        Ok(AuditMaterializeResult {
            target_ref: spec.target_ref.to_git_ref(),
            commit_oid,
            tree_oid,
            parent_oid: prev_oid,
            rolled_up_refs: Vec::new(),
        })
    }

    /// Materializes `spec.target_ref` and recursively rolls up ancestor audit refs.
    ///
    /// # Errors
    /// Propagates object store, serialization, or reference update failures at any tier.
    pub fn materialize_with_upward_rollup(
        odb: &impl OdbStore,
        git_dir: &Path,
        spec: &AuditCommitSpec<'_>,
    ) -> FractalResult<AuditMaterializeResult> {
        let mut base = Self::materialize_commit(odb, git_dir, spec)?;
        let (mut cur_ref, mut cur_commit, mut cur_tree) =
            (spec.target_ref.clone(), base.commit_oid, base.tree_oid);
        while let Some(parent_ref) = cur_ref.parent().filter(FractalRef::is_audit_tree) {
            let meta = AuditChildRollupMeta {
                child_ref: cur_ref.to_git_ref(),
                child_commit_oid: cur_commit.to_hex(),
                child_tree_oid: cur_tree.to_hex(),
                source_commit_oid: spec.source_commit.map(|oid| oid.to_hex()),
            };
            let rollup_json = serde_json::to_vec_pretty(&meta)
                .map_err(|err| FractalError::ObjectCodec(format!("failed to encode rollup meta: {err}")))?;
            let rollup_path = format!("rollups/{}.json", sanitize_ref_component(&meta.child_ref));
            let mut merged: Vec<AuditArtifactEntry<'_>> = Vec::with_capacity(spec.entries.len() + 1);
            merged.extend_from_slice(spec.entries);
            merged.push(AuditArtifactEntry { path: &rollup_path, payload: &rollup_json });
            let msg = format!("audit-rollup: inherit {} -> {}\n", meta.child_ref, parent_ref.to_git_ref());
            let parents = [cur_commit];
            let p_res = Self::materialize_commit(odb, git_dir, &AuditCommitSpec {
                target_ref: &parent_ref, message: &msg, author: spec.author,
                source_commit: spec.source_commit, rollup_parents: &parents, entries: &merged,
            })?;
            base.rolled_up_refs.push((p_res.target_ref, p_res.commit_oid));
            cur_ref = parent_ref;
            cur_commit = p_res.commit_oid;
            cur_tree = p_res.tree_oid;
        }
        Ok(base)
    }

    /// Reads an arbitrary artifact blob from the latest commit on `audit_ref`.
    ///
    /// # Errors
    /// Returns an error when `audit_ref` is invalid or objects are corrupted.
    pub fn read_audit_artifact(
        odb: &impl OdbStore,
        git_dir: &Path,
        audit_ref: &FractalRef,
        rel_path: &str,
    ) -> FractalResult<Option<Vec<u8>>> {
        if !audit_ref.is_audit_tree() {
            return Err(FractalError::AccessDenied(format!(
                "ref '{}' is not part of the audit tree namespace",
                audit_ref.to_git_ref()
            )));
        }
        let Some(commit_oid) = audit_ref.read_oid(git_dir)? else {
            return Ok(None);
        };
        let header = read_commit_header_oid(odb, &commit_oid)?;
        validate_repo_relative_path(rel_path)?;
        find_blob_in_tree(odb, &header.tree, rel_path)
    }

    /// Walks up to `limit` commits along `audit_ref` ancestry.
    ///
    /// # Errors
    /// Propagates ODB read or malformed commit header errors.
    pub fn inspect_audit_lineage(
        odb: &impl OdbStore,
        git_dir: &Path,
        audit_ref: &FractalRef,
        limit: usize,
    ) -> FractalResult<Vec<AuditCommitTrace>> {
        if !audit_ref.is_audit_tree() {
            return Err(FractalError::AccessDenied(format!(
                "ref '{}' is not part of the audit tree namespace",
                audit_ref.to_git_ref()
            )));
        }
        let mut cursor = audit_ref.read_oid(git_dir)?;
        let mut traces = Vec::with_capacity(limit.min(32));
        while let Some(commit_oid) = cursor.filter(|_| traces.len() < limit) {
            let raw = odb.read_object(&commit_oid)?;
            let (kind, payload) = parse_loose_header(&raw)?;
            if kind != ObjectKind::Commit {
                return Err(FractalError::ObjectCodec(format!("{commit_oid} is not a commit object")));
            }
            let header = parse_commit_header(payload)?;
            let parents = collect_commit_parents(payload)?;
            cursor = parents.first().copied();
            let timestamp_sec = header.committer.split_whitespace().nth_back(1)
                .and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
            traces.push(AuditCommitTrace {
                commit_oid, tree_oid: header.tree, parents,
                summary: extract_commit_summary_line(payload), timestamp_sec,
            });
        }
        Ok(traces)
    }
}
