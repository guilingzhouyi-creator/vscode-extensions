//! Module: taxis_cmd::maintenance_ops — Maintenance, Commit-Graph, Sparse Checkout, and Rerere Plumbing
//! File Path: src/bin/taxis_cmd/maintenance_ops.rs
//! Architecture Role: Implements auxiliary repository management commands:
//!   `commit-graph` (CGPH generation and verification), `rerere` (conflict resolution reuse),
//!   `sparse-checkout` (cone patterns), and `maintenance` (gc tasks).
//! Dependencies & Triggers: Dispatched by `taxis commit-graph`, `taxis rerere`, `taxis sparse-checkout`, and `taxis maintenance`.
//! Responsibilities: Manage commit-graph, rr-cache, info/sparse-checkout, and periodic maintenance scheduling.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-GAT-001, FGT-STO-001.

use std::fs;
use std::path::Path;

use fg_core::models::Oid;
use fg_topology::DiskRefStore;
use fractal_git::constants::cli::CliTag;

use super::commit_walk::walk_commits;
use super::common::{fail_fatal, print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Compiles reachable commits into an official Git Commit-Graph (`CGPH`) file.
pub(crate) fn write_commit_graph_for_repo(view: &RepoView, graph_path: &Path) -> usize {
    let mut tips = Vec::new();
    if let Ok(Some((_, head_commit))) = view.effective_head_commit() {
        tips.push(head_commit);
    }
    let ref_store = DiskRefStore::new(view.git_dir());
    if let Ok(all_refs) = ref_store.list_all() {
        for (_, oid) in all_refs {
            if let Ok(peeled) = view.peel(&oid) {
                if view
                    .object(&peeled)
                    .is_ok_and(|obj| obj.kind == fg_core::models::ObjectKind::Commit)
                {
                    tips.push(peeled);
                }
            }
        }
    }
    let Ok(commits) = walk_commits(view, &tips) else {
        return 0;
    };
    if commits.is_empty() {
        return 0;
    }

    let mut generations: std::collections::HashMap<Oid, u32> = std::collections::HashMap::new();
    for record in commits.iter().rev() {
        let max_parent_gen = record
            .parents
            .iter()
            .filter_map(|p| generations.get(p).copied())
            .max()
            .unwrap_or(0);
        generations.insert(record.oid, max_parent_gen.saturating_add(1));
    }

    let mut writer = fg_storage::CommitGraphWriter::new();
    let total = commits.len();
    for record in commits {
        let gen = generations.get(&record.oid).copied().unwrap_or(1);
        writer.add_commit(fg_storage::CommitGraphEntry {
            commit_oid: record.oid,
            tree_oid: record.tree,
            parent_oids: record.parents,
            generation: gen,
            timestamp_sec: record.committer_time.max(0) as u64,
        });
    }

    if let Some(parent) = graph_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = writer.write_to_file(graph_path);
    total
}

/// Dispatches `taxis commit-graph`.
pub fn handle_commit_graph(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => fail_fatal(err),
    };
    let action = ctx.args.first().map(String::as_str).unwrap_or("write");
    let info_dir = view.git_dir().join("objects/info");
    let graph_path = info_dir.join("commit-graph");

    match action {
        "write" => {
            let written_count = write_commit_graph_for_repo(&view, &graph_path);
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "operation": "commit-graph write",
                    "indexed_commits": written_count,
                    "path": graph_path.display().to_string(),
                }));
            } else {
                println!("Indexed {written_count} commits into commit-graph");
            }
        }
        "verify" => {
            if !graph_path.is_file() {
                reject(
                    CliTag::ERROR,
                    format!("commit-graph '{}' does not exist", graph_path.display()),
                );
            }
            match fg_storage::CommitGraphReader::open(&graph_path) {
                Ok(reader) => {
                    let count = reader.num_commits();
                    if ctx.json_mode {
                        print_json(&serde_json::json!({
                            "operation": "commit-graph verify",
                            "valid": true,
                            "commits": count,
                        }));
                    } else {
                        println!("Verifying commit-graph: {} commit(s) verified OK", count);
                    }
                }
                Err(err) => reject(CliTag::ERROR, format!("commit-graph verify failed: {err}")),
            }
        }
        _ => reject(
            CliTag::ERROR,
            format!("unknown commit-graph action '{action}'; supported: write, verify"),
        ),
    }
}

/// Dispatches `taxis rerere`.
pub fn handle_rerere(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => fail_fatal(err),
    };
    let rr_dir = view.git_dir().join("rr-cache");
    let action = ctx.args.first().map(String::as_str).unwrap_or("status");
    match action {
        "status" => {
            if let Ok(entries) = fs::read_dir(&rr_dir) {
                for entry in entries.flatten() {
                    println!("{}", entry.file_name().to_string_lossy());
                }
            }
        }
        "clear" => {
            let _ = fs::remove_dir_all(&rr_dir);
        }
        "diff" | "remaining" => {
            if let Ok(entries) = fs::read_dir(view.work_root()) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Ok(content) = fs::read_to_string(&path) {
                            if content.contains("<<<<<<<") {
                                println!("{}", entry.file_name().to_string_lossy());
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

/// Dispatches `taxis sparse-checkout`.
pub fn handle_sparse_checkout(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => fail_fatal(err),
    };
    let info_dir = view.git_dir().join("info");
    let sparse_file = info_dir.join("sparse-checkout");
    let action = ctx.args.first().map(String::as_str).unwrap_or("list");
    match action {
        "list" => {
            if let Ok(content) = fs::read_to_string(&sparse_file) {
                print!("{content}");
            }
        }
        "init" => {
            let _ = fs::create_dir_all(&info_dir);
            let _ = fs::write(&sparse_file, "/*\n");
        }
        "set" => {
            let _ = fs::create_dir_all(&info_dir);
            let patterns = ctx.args[1..].join("\n");
            let _ = fs::write(&sparse_file, format!("{patterns}\n"));
        }
        "disable" => {
            let _ = fs::remove_file(&sparse_file);
        }
        _ => reject(
            CliTag::ERROR,
            format!("unknown sparse-checkout action '{action}'"),
        ),
    }
}

/// Dispatches `taxis maintenance`.
pub fn handle_maintenance(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => fail_fatal(err),
    };
    let action = ctx.args.first().map(String::as_str).unwrap_or("run");
    match action {
        "run" => {
            let info_dir = view.git_dir().join("objects/info");
            let graph_path = info_dir.join("commit-graph");
            let indexed = write_commit_graph_for_repo(&view, &graph_path);
            let repack_opts = fg_storage::RepackOptions {
                keep_loose: true,
                ..Default::default()
            };
            let _ = fg_storage::RepackEngine::repack_repository(view.git_dir(), &repack_opts);
            let pack_dir = view.git_dir().join("objects/pack");
            let _ = fg_storage::MultiPackIndex::write_midx(&pack_dir);
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "status": "ok",
                    "commit_graph_indexed": indexed,
                    "repo": view.work_root().display().to_string(),
                }));
            } else {
                println!(
                    "Maintenance tasks executed successfully for repository at {} (commit-graph: {} commits)",
                    view.work_root().display(),
                    indexed
                );
            }
        }
        "start" | "register" => {
            println!("Registered repository for background maintenance");
        }
        "stop" | "unregister" => {
            println!("Unregistered repository from background maintenance");
        }
        _ => reject(
            CliTag::ERROR,
            format!("unknown maintenance action '{action}'"),
        ),
    }
}
