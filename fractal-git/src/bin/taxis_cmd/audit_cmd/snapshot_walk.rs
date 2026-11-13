//! Module: taxis_cmd::audit_cmd — Safe Snapshot Directory Traversal & SM3 Tree ID
//! File Path: src/bin/taxis_cmd/audit_cmd/snapshot_walk.rs
//! Architecture Role: Collects deterministic UTF-8 text slices from `--snapshot-dir` while
//!   skipping symlinks, oversized files, binary objects, and build artifact directories.
//! Dependencies & Triggers: Invoked exclusively by `audit_cmd::snapshot_preview`.
//! Responsibilities: Maintain sorted POSIX relative path ordering across platforms.
//! Exit Semantics & Design Rationale: Iterative worklist traversal avoids stack exhaustion.

use std::fs::{self, DirEntry};
use std::path::{Path, PathBuf};

use fg_core::crypto::sm3_hash;
use fg_core::models::Oid;

const MAX_SNAPSHOT_BYTES: usize = 512 * 1024;
const SKIP_DIRS: [&str; 8] = [
    ".git",
    ".taxis",
    ".audit-logs",
    "node_modules",
    "target",
    "dist",
    "__pycache__",
    ".venv",
];

pub(super) fn collect_snapshot_files(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut pending_dirs = Vec::with_capacity(16);
    pending_dirs.push(root.to_path_buf());
    let mut collected: Vec<(String, Vec<u8>)> = Vec::with_capacity(64);
    while let Some(dir) = pending_dirs.pop() {
        visit_snapshot_directory(root, &dir, &mut pending_dirs, &mut collected);
    }
    collected.sort_by(|left, right| left.0.cmp(&right.0));
    collected
}

fn visit_snapshot_directory(
    root: &Path,
    dir: &Path,
    pending_dirs: &mut Vec<PathBuf>,
    collected: &mut Vec<(String, Vec<u8>)>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        process_snapshot_dir_entry(root, entry, pending_dirs, collected);
    }
}

fn process_snapshot_dir_entry(
    root: &Path,
    entry: DirEntry,
    pending_dirs: &mut Vec<PathBuf>,
    collected: &mut Vec<(String, Vec<u8>)>,
) {
    let path = entry.path();
    let Ok(file_type) = entry.file_type() else {
        return;
    };
    if file_type.is_symlink() {
        return;
    }
    if file_type.is_dir() {
        let name = entry.file_name();
        if let Some(dir_name) = name.to_str() {
            if !SKIP_DIRS.contains(&dir_name) {
                pending_dirs.push(path);
            }
        }
        return;
    }
    if !file_type.is_file() {
        return;
    }
    let Ok(rel) = path.strip_prefix(root) else {
        return;
    };
    let rel_posix = rel.to_string_lossy().replace('\\', "/");
    let Ok(bytes) = fs::read(&path) else {
        return;
    };
    if bytes.len() > MAX_SNAPSHOT_BYTES
        || bytes.contains(&0)
        || std::str::from_utf8(&bytes).is_err()
    {
        return;
    }
    collected.push((rel_posix, bytes));
}

pub(super) fn compute_snapshot_tree_oid(files: &[(String, Vec<u8>)]) -> Oid {
    let mut buf = Vec::with_capacity(1024);
    for (path, bytes) in files {
        buf.extend_from_slice(path.as_bytes());
        buf.push(0);
        buf.extend_from_slice(&bytes.len().to_le_bytes());
        buf.extend_from_slice(bytes);
    }
    let digest = sm3_hash(&buf);
    let mut raw = [0u8; 20];
    raw.copy_from_slice(&digest[..20]);
    Oid::from_bytes(raw)
}
