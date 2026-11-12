//! Module: taxis_cmd::stash_stack — Multi-Slot Stash Reference and Reflog Management
//! File Path: src/bin/taxis_cmd/stash_stack.rs
//! Architecture Role: Manages the multi-slot stash stack under `.git/logs/refs/stash` and `refs/stash`.
//! Dependencies & Triggers: Dispatched by `taxis stash` for list, drop, clear, and pop/push ref manipulation.
//! Responsibilities: Parsing stash slots, managing stack order, formatting reflog entries, and dropping slots.
//! Exit Semantics & Design Rationale:
//!   - Accurately tracks multiple stash slots (`stash@{0}`, `stash@{1}`, etc.).
//!   - Synchronizes `refs/stash` and native container records.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::fs;
use std::path::Path;

use fg_native::sections::refs::RefRecord;
use fg_native::RepoDocument;
use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, Oid, RefStore};

use super::commit_walk::parse_commit_record;
use super::common::{fail_io, fail_usage, print_json, reject, CliContext};
use super::repo_view::RepoView;

/// One entry in the multi-slot `refs/stash` stack (`stash@{0}` is newest).
pub(crate) struct StashSlot {
    pub(crate) raw_line: Option<String>,
    pub(crate) oid: Oid,
    pub(crate) message: String,
}

/// Lists available stash entries from `.git/logs/refs/stash` (or fallback `refs/stash`).
pub(crate) fn handle_stash_list(view: &RepoView, ctx: &CliContext) {
    let stack = read_stash_stack(view);
    if ctx.json_mode {
        let json_slots: Vec<serde_json::Value> = stack
            .iter()
            .enumerate()
            .map(|(index, slot)| {
                serde_json::json!({
                    "index": index,
                    "oid": slot.oid.to_hex(),
                    "summary": slot.message,
                })
            })
            .collect();
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "stash",
            "stashes": json_slots
        }));
        return;
    }

    for (index, slot) in stack.iter().enumerate() {
        println!("stash@{{{index}}}: {}", slot.message);
    }
}

/// Drops one stash entry (`stash@{n}`, defaulting to `0`).
pub(crate) fn handle_stash_drop(view: &RepoView, ctx: &CliContext, args: &[String]) {
    let slot_index = parse_stash_slot_arg(args);
    let stack = read_stash_stack(view);
    if slot_index >= stack.len() {
        if stack.is_empty() {
            reject(CliTag::ERROR, "error: No stash entries found.");
        }
        reject(
            CliTag::ERROR,
            format!("error: log for 'stash' only has {} entries", stack.len()),
        );
    }
    let dropped_oid = remove_stash_slot(view.git_dir(), stack, slot_index);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "stash",
            "status": "dropped",
            "index": slot_index,
            "oid": dropped_oid.to_hex(),
        }));
    } else {
        println!(
            "Dropped refs/stash@{{{slot_index}}} ({})",
            dropped_oid.to_hex()
        );
    }
}

/// Removes all stash entries (`refs/stash` and `logs/refs/stash`).
pub(crate) fn handle_stash_clear(view: &RepoView, ctx: &CliContext) {
    clear_stash_refs(view.git_dir());
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "stash",
            "status": "cleared"
        }));
    }
}

/// Parses an optional `stash@{n}` or integer `<n>` operand (default `0`).
pub(crate) fn parse_stash_slot_arg(args: &[String]) -> usize {
    let Some(raw) = args.iter().find(|a| !a.starts_with('-')) else {
        return 0;
    };
    let trimmed = raw.trim();
    if let Some(inner) = trimmed
        .strip_prefix("stash@{")
        .and_then(|rest| rest.strip_suffix('}'))
    {
        if let Ok(idx) = inner.parse::<usize>() {
            return idx;
        }
    } else if let Ok(idx) = trimmed.parse::<usize>() {
        return idx;
    }
    fail_usage(format!("invalid stash reference '{raw}'"))
}

/// Reads the stash stack in reverse chronological order (`stash@{0}` first).
pub(crate) fn read_stash_stack(view: &RepoView) -> Vec<StashSlot> {
    let log_path = view.git_dir().join("logs/refs/stash");
    if let Ok(contents) = fs::read_to_string(&log_path) {
        let mut parsed: Vec<StashSlot> = contents
            .lines()
            .filter_map(|line| parse_stash_reflog_line(view, line))
            .collect();
        if !parsed.is_empty() {
            parsed.reverse();
            return parsed;
        }
    }

    let ref_store = DiskRefStore::new(view.git_dir());
    let Ok(Some(stash_oid)) = ref_store.get_ref("refs/stash") else {
        return Vec::new();
    };
    let summary = read_stash_commit_subject(view, stash_oid);
    vec![StashSlot {
        raw_line: None,
        oid: stash_oid,
        message: summary,
    }]
}

/// Parses one line of `.git/logs/refs/stash`.
fn parse_stash_reflog_line(view: &RepoView, line: &str) -> Option<StashSlot> {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    if trimmed.trim().is_empty() {
        return None;
    }
    let (meta, msg_part) = trimmed.split_once('\t')?;
    let mut fields = meta.split_whitespace();
    let _old = fields.next()?;
    let new_hex = fields.next()?;
    let oid = Oid::from_hex(new_hex).ok()?;
    let message = if msg_part.trim().is_empty() {
        read_stash_commit_subject(view, oid)
    } else {
        msg_part.to_string()
    };
    Some(StashSlot {
        raw_line: Some(trimmed.to_string()),
        oid,
        message,
    })
}

/// Reads the subject line of a stash commit object.
fn read_stash_commit_subject(view: &RepoView, oid: Oid) -> String {
    view.object(&oid)
        .ok()
        .and_then(|obj| parse_commit_record(oid, &obj.payload).ok())
        .and_then(|rec| rec.message.lines().next().map(str::to_string))
        .unwrap_or_else(|| "WIP".to_string())
}

/// Removes `index` from `stack`, atomically updating `refs/stash` and `logs/refs/stash`.
pub(crate) fn remove_stash_slot(git_dir: &Path, mut stack: Vec<StashSlot>, index: usize) -> Oid {
    let removed = stack.remove(index);
    if stack.is_empty() {
        clear_stash_refs(git_dir);
        return removed.oid;
    }

    let top_oid = stack[0].oid;
    let ref_path = git_dir.join("refs/stash");
    if let Err(err) = fg_core::write_file_atomic(
        &ref_path,
        format!("{}\n", top_oid.to_hex()).as_bytes(),
        false,
    ) {
        fail_io("update refs/stash", err);
    }
    sync_native_stash_ref(git_dir, Some(top_oid));

    let log_lines: Vec<String> = stack.iter().rev().map(format_stash_log_entry).collect();
    let log_path = git_dir.join("logs/refs/stash");
    let body = format!("{}\n", log_lines.join("\n"));
    if let Err(err) = fg_core::write_file_atomic(&log_path, body.as_bytes(), false) {
        fail_io("update logs/refs/stash", err);
    }
    removed.oid
}

/// Formats one reflog line when rewriting `logs/refs/stash`.
pub(crate) fn format_stash_log_entry(slot: &StashSlot) -> String {
    if let Some(ref raw) = slot.raw_line {
        return raw.clone();
    }
    let zero = Oid::ZERO.to_hex();
    let ts = chrono::Utc::now().timestamp();
    format!(
        "{zero} {} Taxis Operator <operator@taxis.internal> {ts} +0000\t{}",
        slot.oid.to_hex(),
        slot.message
    )
}

/// Deletes `refs/stash`, its reflog, and removes `refs/stash` from `repo.txc`.
pub(crate) fn clear_stash_refs(git_dir: &Path) {
    let _ = fs::remove_file(git_dir.join("refs/stash"));
    let _ = fs::remove_file(git_dir.join("logs/refs/stash"));
    sync_native_stash_ref(git_dir, None);
}

/// Synchronizes `refs/stash` inside `repo.txc` when the native container is present.
pub(crate) fn sync_native_stash_ref(git_dir: &Path, oid_opt: Option<Oid>) {
    let container_path = fg_native::container_path(git_dir);
    if !container_path.is_file() {
        return;
    }
    if let Ok(mut doc) = RepoDocument::load(&container_path) {
        match oid_opt {
            Some(oid) => {
                let _ = doc.refs.upsert(RefRecord {
                    name: "refs/stash".to_string(),
                    oid,
                    peeled: None,
                });
            }
            None => {
                let mut rebuilt = fg_native::sections::refs::RefsSection::new();
                for record in doc.refs.records() {
                    if record.name != "refs/stash" {
                        let _ = rebuilt.upsert(record.clone());
                    }
                }
                doc.refs = rebuilt;
            }
        }
        let _ = doc.save_atomic(&container_path);
    }
}
