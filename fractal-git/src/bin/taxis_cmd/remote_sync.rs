//! Module: taxis_cmd::remote_sync — Local Filesystem Repository Transport Synchronizer
//! File Path: src/bin/taxis_cmd/remote_sync.rs
//! Architecture Role: Handles offline local filesystem repository fetch and synchronization,
//!   discovering source branches/packed-refs, copying missing objects, and recording tracking refs.
//! Dependencies & Triggers: Dispatched by taxis_cmd::remote during local transport sync.
//! Responsibilities: Local repository git directory resolution and object store copying.
//! Exit Semantics & Design Rationale:
//!   - Synchronizes references and loose/packed objects deterministically without network overhead.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage engine content-addressable storage guard

use std::path::{Path, PathBuf};

use fg_core::models::Oid;
use serde_json::json;

use super::common::{print_json, CliContext};
pub use super::remote_sync_push::{sync_local_repository_push, LocalPushParams};

/// Resolves the Git metadata directory for a local file URL or path.
pub fn resolve_source_git_dir(target_url: &str) -> Option<PathBuf> {
    let clean_url = target_url.strip_prefix("file://").unwrap_or(target_url);
    let candidate_path = Path::new(clean_url);
    if candidate_path.join(".git").is_dir() {
        Some(candidate_path.join(".git"))
    } else if candidate_path.join(".taxis").is_dir() {
        Some(candidate_path.join(".taxis"))
    } else if candidate_path.join("HEAD").is_file() {
        Some(candidate_path.to_path_buf())
    } else {
        None
    }
}

/// Synchronizes references and missing objects from a local repository.
pub fn sync_local_repository_fetch(
    ctx: &CliContext,
    source_git_dir: &Path,
    remote_target: &str,
    target_url: &str,
) {
    let discovered_refs = discover_local_remote_refs(source_git_dir);
    copy_object_store_contents(
        &source_git_dir.join("objects"),
        &ctx.git_dir.join("objects"),
    );
    let report_refs =
        record_fetched_tracking_refs(&ctx.git_dir, remote_target, target_url, &discovered_refs);
    report_fetch_outcome(ctx, remote_target, target_url, &report_refs);
}

fn discover_local_remote_refs(source_git_dir: &Path) -> Vec<(String, Oid)> {
    let mut discovered_refs: Vec<(String, Oid)> = Vec::new();
    collect_loose_heads_refs(&source_git_dir.join("refs/heads"), &mut discovered_refs);
    collect_packed_heads_refs(&source_git_dir.join("packed-refs"), &mut discovered_refs);
    if discovered_refs.is_empty() {
        let default_cell = source_git_dir.join("refs/fractal/cell/cell-default/main");
        if let Ok(content) = std::fs::read_to_string(default_cell) {
            if let Ok(oid) = Oid::from_hex(content.trim()) {
                discovered_refs.push(("main".to_string(), oid));
            }
        }
    }
    discovered_refs
}

fn collect_loose_heads_refs(heads_dir: &Path, discovered_refs: &mut Vec<(String, Oid)>) {
    let Ok(entries) = std::fs::read_dir(heads_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let branch_name = entry.file_name().to_string_lossy().to_string();
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if let Ok(oid) = Oid::from_hex(content.trim()) {
            discovered_refs.push((branch_name, oid));
        }
    }
}

fn collect_packed_heads_refs(packed_refs_path: &Path, discovered_refs: &mut Vec<(String, Oid)>) {
    let Ok(content) = std::fs::read_to_string(packed_refs_path) else {
        return;
    };
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('^') {
            continue;
        }
        let Some((oid_hex, ref_name)) = trimmed.split_once(' ') else {
            continue;
        };
        let Some(branch) = ref_name.strip_prefix("refs/heads/") else {
            continue;
        };
        if discovered_refs
            .iter()
            .any(|(existing, _)| existing == branch)
        {
            continue;
        }
        if let Ok(oid) = Oid::from_hex(oid_hex) {
            discovered_refs.push((branch.to_string(), oid));
        }
    }
}

pub(crate) fn copy_object_store_contents(src_objects: &Path, dst_objects: &Path) {
    let _ = std::fs::create_dir_all(dst_objects);
    let Ok(entries) = std::fs::read_dir(src_objects) else {
        return;
    };
    for entry in entries.flatten() {
        let entry_name = entry.file_name();
        let entry_name_str = entry_name.to_string_lossy();
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if entry_name_str.len() == 2 {
            copy_directory_files(&path, &dst_objects.join(&*entry_name_str));
        } else if entry_name_str == "pack" {
            copy_directory_files(&path, &dst_objects.join("pack"));
        }
    }
}

fn copy_directory_files(src_dir: &Path, dst_dir: &Path) {
    let _ = std::fs::create_dir_all(dst_dir);
    let Ok(entries) = std::fs::read_dir(src_dir) else {
        return;
    };
    for item in entries.flatten() {
        if item.file_name() == "multi-pack-index" {
            continue;
        }
        let dst_file = dst_dir.join(item.file_name());
        if !dst_file.is_file() {
            let _ = std::fs::copy(item.path(), &dst_file);
        }
    }
}

fn record_fetched_tracking_refs(
    git_dir: &Path,
    remote_target: &str,
    target_url: &str,
    discovered_refs: &[(String, Oid)],
) -> Vec<(String, String, &'static str)> {
    let remotes_dir = git_dir.join("refs/remotes").join(remote_target);
    let _ = std::fs::create_dir_all(&remotes_dir);
    let mut fetch_head_lines = Vec::new();
    let mut report_refs = Vec::new();

    for (branch, oid) in discovered_refs {
        let tracking_ref_file = remotes_dir.join(branch);
        let was_old = std::fs::read_to_string(&tracking_ref_file)
            .ok()
            .and_then(|s| Oid::from_hex(s.trim()).ok());

        let _ = std::fs::write(&tracking_ref_file, format!("{}\n", oid.to_hex()));
        fetch_head_lines.push(format!(
            "{}\t\tbranch '{branch}' of {target_url}\n",
            oid.to_hex()
        ));

        let status_desc = match was_old {
            None => "[new branch]",
            Some(old) if old == *oid => "[up-to-date]",
            Some(_) => "[updated]",
        };
        report_refs.push((branch.clone(), oid.to_hex(), status_desc));
    }

    let _ = std::fs::write(git_dir.join("FETCH_HEAD"), fetch_head_lines.join(""));
    report_refs
}

fn report_fetch_outcome(
    ctx: &CliContext,
    remote_target: &str,
    target_url: &str,
    report_refs: &[(String, String, &'static str)],
) {
    if ctx.json_mode {
        let refs_json: Vec<serde_json::Value> = report_refs
            .iter()
            .map(|(branch_item, target_item, status_item)| {
                json!({
                    "branch": branch_item,
                    "target": target_item,
                    "status": status_item,
                })
            })
            .collect();
        print_json(&json!({
            "status": "ok",
            "transport": "local_file",
            "remote": remote_target,
            "url": target_url,
            "refs": refs_json,
        }));
        return;
    }

    println!("Fetching from local_file endpoint '{remote_target}' ({target_url})...");
    if report_refs.is_empty() {
        println!("No remote references advertised.");
        return;
    }
    for (branch_item, target_item, status_item) in report_refs {
        let short_target = &target_item[..target_item.len().min(8)];
        println!(
            "  * {status_item:14} {branch_item:12} -> {remote_target}/{branch_item} ({short_target})"
        );
    }
}
