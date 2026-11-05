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
    let mut discovered_refs: Vec<(String, Oid)> = Vec::new();
    let heads_dir = source_git_dir.join("refs/heads");
    if let Ok(entries) = std::fs::read_dir(&heads_dir) {
        for entry in entries.flatten() {
            let branch_name = entry.file_name().to_string_lossy().to_string();
            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                let trimmed = content.trim();
                if let Ok(oid) = Oid::from_hex(trimmed) {
                    discovered_refs.push((branch_name, oid));
                }
            }
        }
    }

    if let Ok(content) = std::fs::read_to_string(source_git_dir.join("packed-refs")) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.starts_with('^') || trimmed.is_empty() {
                continue;
            }
            if let Some((oid_hex, ref_name)) = trimmed.split_once(' ') {
                if let Some(branch) = ref_name.strip_prefix("refs/heads/") {
                    if !discovered_refs.iter().any(|(existing_branch, _)| existing_branch == branch) {
                        if let Ok(oid) = Oid::from_hex(oid_hex) {
                            discovered_refs.push((branch.to_string(), oid));
                        }
                    }
                }
            }
        }
    }

    let src_objects = source_git_dir.join("objects");
    let dst_objects = ctx.git_dir.join("objects");
    let _ = std::fs::create_dir_all(&dst_objects);

    if let Ok(entries) = std::fs::read_dir(&src_objects) {
        for entry in entries.flatten() {
            let entry_name = entry.file_name();
            let entry_name_str = entry_name.to_string_lossy();
            if entry_name_str.len() == 2 && entry.path().is_dir() {
                let dst_bucket = dst_objects.join(&*entry_name_str);
                let _ = std::fs::create_dir_all(&dst_bucket);
                if let Ok(obj_entries) = std::fs::read_dir(entry.path()) {
                    for obj in obj_entries.flatten() {
                        let dst_file = dst_bucket.join(obj.file_name());
                        if !dst_file.is_file() {
                            let _ = std::fs::copy(obj.path(), &dst_file);
                        }
                    }
                }
            } else if entry_name_str == "pack" && entry.path().is_dir() {
                let dst_pack = dst_objects.join("pack");
                let _ = std::fs::create_dir_all(&dst_pack);
                if let Ok(pack_entries) = std::fs::read_dir(entry.path()) {
                    for pack_file in pack_entries.flatten() {
                        let dst_file = dst_pack.join(pack_file.file_name());
                        if !dst_file.is_file() {
                            let _ = std::fs::copy(pack_file.path(), &dst_file);
                        }
                    }
                }
            }
        }
    }

    let remotes_dir = ctx.git_dir.join("refs/remotes").join(remote_target);
    let _ = std::fs::create_dir_all(&remotes_dir);
    let mut fetch_head_lines = Vec::new();
    let mut report_refs = Vec::new();

    for (branch, oid) in &discovered_refs {
        let tracking_ref_file = remotes_dir.join(branch);
        let was_old = std::fs::read_to_string(&tracking_ref_file)
            .ok()
            .and_then(|s| Oid::from_hex(s.trim()).ok());

        let _ = std::fs::write(&tracking_ref_file, format!("{}\n", oid.to_hex()));
        fetch_head_lines.push(format!("{}\t\tbranch '{branch}' of {target_url}\n", oid.to_hex()));

        let status_desc = match was_old {
            None => "[new branch]",
            Some(old) if old == *oid => "[up-to-date]",
            Some(_) => "[updated]",
        };
        report_refs.push((branch.clone(), oid.to_hex(), status_desc));
    }

    let _ = std::fs::write(ctx.git_dir.join("FETCH_HEAD"), fetch_head_lines.join(""));

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
    } else {
        println!("Fetching from local_file endpoint '{remote_target}' ({target_url})...");
        if report_refs.is_empty() {
            println!("No remote references advertised.");
        } else {
            for (branch_item, target_item, status_item) in &report_refs {
                let short_target = if target_item.len() >= 8 { &target_item[..8] } else { target_item };
                println!("  * {status_item:14} {branch_item:12} -> {remote_target}/{branch_item} ({short_target})");
            }
        }
    }
}
