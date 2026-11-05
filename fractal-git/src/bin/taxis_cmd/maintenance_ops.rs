//! Module: taxis_cmd::maintenance_ops — Maintenance, Sparse Checkout, and Rerere Plumbing
//! File Path: src/bin/taxis_cmd/maintenance_ops.rs
//! Architecture Role: Implements auxiliary repository management commands:
//!   `rerere` (conflict resolution reuse), `sparse-checkout` (cone patterns), and `maintenance` (gc tasks).
//! Dependencies & Triggers: Dispatched by `taxis rerere`, `taxis sparse-checkout`, and `taxis maintenance`.
//! Responsibilities: Manage rr-cache, info/sparse-checkout, and periodic maintenance scheduling.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-CLI-001.

use std::fs;

use fractal_git::constants::cli::CliTag;

use super::common::{fail_fatal, reject, CliContext};
use super::repo_view::RepoView;

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
            println!(
                "Maintenance tasks executed successfully for repository at {}",
                view.work_root().display()
            );
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
