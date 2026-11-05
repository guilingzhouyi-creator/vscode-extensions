//! Module: fractal_git::bench::e2e::projection — Merkle Subtree Resolution & Virtual Index Queries
//! File Path: src/bench/e2e/projection.rs
//! Architecture Role: Provides recursive Git Merkle tree traversal, atomic scratch directory allocation,
//!   and progressive virtual projection resolution for the single-threaded benchmark harness.
//! Responsibilities:
//!   - Safely allocate isolated transient scratch directories under `target/test_tmp/`.
//!   - Recursively resolve authentic Git tree and blob OIDs from hierarchical tree objects.
//!   - Query in-memory projected sparse index trees honoring ScopeProjection boundary invariants.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and zero-panic error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocations on hot paths
//! - `FGT-TOP-001`: Strict ScopeProjection boundary constraint enforcement

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use fg_index::InMemoryIndexTree;
use fg_object::borrowed::GitTreeRef;
use fg_storage::OdbRouter;
use fg_topology::worktree::ScopeProjection;

/// Monotonic scratch directory counter keeping concurrent test runs isolated.
static BENCH_TMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Creates a unique scratch testing directory under `target/test_tmp/`.
///
/// # Errors
/// Returns `FractalError::Io` if scratch directory creation fails.
pub fn create_bench_temp_dir(prefix: &str) -> FractalResult<PathBuf> {
    let id = BENCH_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    fs::create_dir_all(&base).map_err(FractalError::Io)?;
    let dir = base.join(format!("{prefix}_{}_{}", std::process::id(), id));
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    fs::create_dir_all(&dir).map_err(FractalError::Io)?;
    Ok(dir)
}

/// Helper locating a file inside a Git Merkle tree hierarchy.
///
/// # Errors
/// Returns `FractalError::ObjectCodec` or `FractalError::CorruptStore` if the file cannot be located.
pub fn find_file_in_tree(odb: &OdbRouter, root_tree_oid: Oid, target_path: &str) -> FractalResult<Oid> {
    let normalized = target_path.trim_matches('/').replace('\\', "/");
    let segments: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return Err(FractalError::ObjectCodec(
            "target path cannot be empty".into(),
        ));
    }

    let mut current_tree_oid = root_tree_oid;
    for (i, segment) in segments.iter().enumerate() {
        let is_last = i == segments.len() - 1;
        let tree_obj = odb
            .read(&current_tree_oid)?
            .ok_or_else(|| FractalError::CorruptStore(format!("tree object {current_tree_oid} missing")))?;
        let tree_ref = GitTreeRef::from_bytes(&tree_obj.payload);
        let entry = tree_ref
            .find_entry(segment)?
            .ok_or_else(|| FractalError::ObjectCodec(format!("entry '{segment}' not found in tree {current_tree_oid}")))?;

        if is_last {
            return Ok(entry.oid);
        }
        current_tree_oid = entry.oid;
    }

    Err(FractalError::ObjectCodec(format!(
        "file '{target_path}' not found in tree hierarchy"
    )))
}

/// Helper resolving a directory subtree OID from a root Merkle tree hierarchy.
///
/// # Errors
/// Returns `FractalError::ObjectCodec` or `FractalError::CorruptStore` if subtree resolution fails.
pub fn resolve_subtree_oid(odb: &OdbRouter, root_tree_oid: Oid, dir_path: &str) -> FractalResult<Oid> {
    let normalized = dir_path.trim_matches('/').replace('\\', "/");
    let segments: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return Ok(root_tree_oid);
    }

    let mut current_tree_oid = root_tree_oid;
    for segment in &segments {
        let tree_obj = odb
            .read(&current_tree_oid)?
            .ok_or_else(|| FractalError::CorruptStore(format!("tree object {current_tree_oid} missing")))?;
        let tree_ref = GitTreeRef::from_bytes(&tree_obj.payload);
        let entry = tree_ref
            .find_entry(segment)?
            .ok_or_else(|| FractalError::ObjectCodec(format!("subtree segment '{segment}' not found in tree {current_tree_oid}")))?;

        if !entry.mode.is_tree() {
            return Err(FractalError::ObjectCodec(format!(
                "path segment '{segment}' in '{dir_path}' is not a directory tree"
            )));
        }

        current_tree_oid = entry.oid;
    }

    Ok(current_tree_oid)
}

/// Helper resolving a target blob OID through an in-memory projected index tree and its active scope.
///
/// # Errors
/// Returns `FractalError::TopologyBreach` if target path violates active ScopeProjection bounds,
/// or `FractalError::ObjectCodec` if the file cannot be resolved.
pub fn resolve_blob_from_projected_index(
    odb: &OdbRouter,
    index_tree: &InMemoryIndexTree,
    scope: &ScopeProjection,
    target_path: &str,
) -> FractalResult<Oid> {
    // 1. Enforce ScopeProjection boundary constraint (FGT-TOP-001)
    if !scope.contains_path(target_path) {
        return Err(FractalError::TopologyBreach {
            source_ref: target_path.to_string(),
            target_ref: format!("Scope({:?})", scope.scopes),
            reason: "Target file lies outside authorized worktree scope projection".into(),
        });
    }

    let normalized = target_path.trim_matches('/').replace('\\', "/");

    // 2. Direct hit: check if the exact file path is directly staged in the index tree
    if let Some(staged) = index_tree.entries().get(&normalized) {
        if !staged.mode.is_tree() {
            return Ok(staged.oid);
        }
    }

    // 3. Sparse directory hit: check if any staged sparse subtree prefixes the target path
    // Picks the longest matching prefix (most specific subtree envelope)
    let mut best_prefix_match: Option<(&str, Oid)> = None;
    for (staged_path, entry) in index_tree.entries() {
        if entry.is_sparse_directory() {
            let dir_prefix = staged_path.trim_matches('/');
            let prefix_with_slash = format!("{dir_prefix}/");
            if normalized.starts_with(&prefix_with_slash) {
                if best_prefix_match.as_ref().is_none_or(|(best, _)| dir_prefix.len() > best.len()) {
                    best_prefix_match = Some((dir_prefix, entry.oid));
                }
            }
        }
    }

    if let Some((dir_prefix, subtree_oid)) = best_prefix_match {
        let subpath = &normalized[dir_prefix.len() + 1..];
        return find_file_in_tree(odb, subtree_oid, subpath);
    }

    Err(FractalError::ObjectCodec(format!(
        "file '{target_path}' not found within projected index tree entries"
    )))
}
