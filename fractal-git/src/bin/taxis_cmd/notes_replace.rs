//! Module: taxis_cmd::notes_replace — Git Notes and Replace References Manipulation
//! File Path: src/bin/taxis_cmd/notes_replace.rs
//! Architecture Role: Implements `notes` and `replace` subcommands based on refs/notes/commits
//!   and refs/replace/<target_oid> references.
//! Dependencies & Triggers: Dispatched by `taxis notes` and `taxis replace`.
//! Responsibilities: CRUD operations on note blobs and object replacement references.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-GAT-001.

use std::io::Write;

use fg_topology::DiskRefStore;
use fractal_git::constants::cli::CliTag;
use fractal_git::{LooseOdb, OdbStore, RefStore};

use super::common::{fail_fatal, reject, CliContext};
use super::repo_view::RepoView;

/// Dispatches `taxis notes`.
pub fn handle_notes(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => fail_fatal(err),
    };
    let ref_store = DiskRefStore::new(view.git_dir());
    let subcmd = ctx.args.first().map(String::as_str).unwrap_or("list");
    match subcmd {
        "list" => notes_list(&ref_store),
        "show" => notes_show(ctx, &view, &ref_store),
        "add" => notes_add(ctx, &view, &ref_store),
        "remove" | "rm" => notes_remove(ctx, &view, &ref_store),
        _ => reject(
            CliTag::ERROR,
            format!("unknown notes subcommand '{subcmd}'"),
        ),
    }
}

fn notes_list(ref_store: &DiskRefStore) {
    let refs = ref_store.list_all().unwrap_or_default();
    for (name, oid) in refs {
        if let Some(target) = name.strip_prefix("refs/notes/commits/") {
            println!("{} {}", oid.to_hex(), target);
        } else if name == "refs/notes/commits" {
            println!("{} HEAD", oid.to_hex());
        }
    }
}

fn notes_show(ctx: &CliContext, view: &RepoView, ref_store: &DiskRefStore) {
    let target = ctx.args.get(1).map(String::as_str).unwrap_or("HEAD");
    let target_oid = resolve_or_reject(view, target);
    let note_ref = format!("refs/notes/commits/{}", target_oid.to_hex());
    if let Ok(Some(note_oid)) = ref_store.get_ref(&note_ref) {
        if let Ok(obj) = view.object(&note_oid) {
            let _ = std::io::stdout().write_all(&obj.payload);
            return;
        }
    }
    reject(CliTag::ERROR, format!("no note found for object {target}"));
}

fn notes_add(ctx: &CliContext, view: &RepoView, ref_store: &DiskRefStore) {
    let mut msg = None;
    let mut target = "HEAD";
    let mut cursor = 1;
    while cursor < ctx.args.len() {
        match ctx.args[cursor].as_str() {
            "-m" if cursor + 1 < ctx.args.len() => {
                msg = Some(ctx.args[cursor + 1].clone());
                cursor += 1;
            }
            other if !other.starts_with('-') => target = other,
            _ => {}
        }
        cursor += 1;
    }
    let Some(message) = msg else {
        reject(CliTag::ERROR, "notes add requires -m <message>");
    };
    let target_oid = resolve_or_reject(view, target);
    let odb = LooseOdb::new(view.git_dir());
    let blob_oid = match odb.write_object("blob", message.as_bytes()) {
        Ok(oid) => oid,
        Err(err) => reject(CliTag::ERROR, format!("write note object: {err}")),
    };
    let note_ref = format!("refs/notes/commits/{}", target_oid.to_hex());
    if let Err(e) = ref_store.update_ref(&note_ref, &blob_oid, None) {
        reject(CliTag::ERROR, format!("write note ref: {e}"));
    }
}

fn notes_remove(ctx: &CliContext, view: &RepoView, ref_store: &DiskRefStore) {
    let target = ctx.args.get(1).map(String::as_str).unwrap_or("HEAD");
    let target_oid = resolve_or_reject(view, target);
    let note_ref = format!("refs/notes/commits/{}", target_oid.to_hex());
    let _ = ref_store.delete_ref(&note_ref);
}

fn resolve_or_reject(view: &RepoView, spec: &str) -> fg_core::models::Oid {
    match view.resolve(spec) {
        Ok(oid) => oid,
        Err(err) => reject(CliTag::ERROR, err),
    }
}

/// Dispatches `taxis replace`.
pub fn handle_replace(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => fail_fatal(err),
    };
    let ref_store = DiskRefStore::new(view.git_dir());
    let (list, delete, positional) = parse_replace_args(&ctx.args);
    if list || (positional.is_empty() && !delete) {
        replace_list(&ref_store);
        return;
    }
    if delete {
        replace_delete(&view, &ref_store, &positional);
        return;
    }
    replace_set(&view, &ref_store, &positional);
}

fn parse_replace_args(args: &[String]) -> (bool, bool, Vec<&str>) {
    let mut list = false;
    let mut delete = false;
    let mut positional = Vec::new();
    for arg in args {
        match arg.as_str() {
            "-l" | "--list" => list = true,
            "-d" | "--delete" => delete = true,
            other if !other.starts_with('-') => positional.push(other),
            _ => {}
        }
    }
    (list, delete, positional)
}

fn replace_list(ref_store: &DiskRefStore) {
    let refs = ref_store.list_all().unwrap_or_default();
    for (name, _) in refs {
        if let Some(target) = name.strip_prefix("refs/replace/") {
            println!("{target}");
        }
    }
}

fn replace_delete(view: &RepoView, ref_store: &DiskRefStore, positional: &[&str]) {
    let Some(target) = positional.first() else {
        reject(CliTag::ERROR, "replace -d requires target object");
    };
    let target_oid = resolve_or_reject(view, target);
    let replace_ref = format!("refs/replace/{}", target_oid.to_hex());
    let _ = ref_store.delete_ref(&replace_ref);
}

fn replace_set(view: &RepoView, ref_store: &DiskRefStore, positional: &[&str]) {
    if positional.len() < 2 {
        reject(CliTag::ERROR, "replace requires <object> <replacement>");
    }
    let old_oid = resolve_or_reject(view, positional[0]);
    let new_oid = resolve_or_reject(view, positional[1]);
    let replace_ref = format!("refs/replace/{}", old_oid.to_hex());
    if let Err(e) = ref_store.update_ref(&replace_ref, &new_oid, None) {
        reject(CliTag::ERROR, format!("write replace ref: {e}"));
    }
}
