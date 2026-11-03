//! Module: taxis_cmd::apply_mailbox — Mailbox Patch Application
//! File Path: src/bin/taxis_cmd/apply_mailbox.rs
//! Architecture Role: Implements `git am`, sequentially applying mbox-formatted patches
//!   and committing them with original authorship, timestamp, and message.
//! Dependencies & Triggers: Dispatched by `taxis am`.
//! Responsibilities: Parse mbox/patch streams, manage pause/resume/abort state,
//!   invoke the `apply` engine, materialize index trees, and produce atomic commits.
//! Exit Semantics & Design Rationale:
//!   - Exits 0 on complete application, `--abort`, or `--skip`.
//!   - Exits 1 on patch conflict, saving state to allow `--resolved`, `--skip`, or `--abort`.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Gate and commit workflow compliance

use std::fs;
use std::io::{self, Read};
use std::path::Path;

use fg_core::models::{current_unix_seconds, GitSignature, IndexStage, Oid};
use fg_core::traits::RefStore;
use fg_index::InMemoryIndexTree;
use fg_object::GitCommit;
use fg_storage::commit_materializer::{persist_commit_object, persist_index_tree};
use fg_topology::{DiskRefStore, HeadState};
use fractal_git::LooseOdb;
use serde::{Deserialize, Serialize};

use super::apply::{execute_apply, parse_unified_diff, ApplyOptions};
use super::common::{fail_fatal, CliContext};
use super::repo_view::RepoView;

const AM_STATE_FILE: &str = "taxis_am_state.json";

/// Persisted state when an `am` session pauses due to conflict.
#[derive(Debug, Serialize, Deserialize)]
struct AmSessionState {
    original_head: String,
    target_ref: Option<String>,
    patches: Vec<ParsedPatchMessage>,
    current_index: usize,
}

/// A parsed email patch message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedPatchMessage {
    pub author_name: String,
    pub author_email: String,
    pub date: i64,
    pub offset_minutes: i32,
    pub subject: String,
    pub body: String,
    pub patch_bytes: Vec<u8>,
}

/// Dispatches `taxis am`.
pub fn handle_am(ctx: &CliContext) {
    let view = RepoView::open_or_exit(ctx);
    let state_file = view.git_dir().join(AM_STATE_FILE);

    if ctx.args.contains(&"--abort".to_string()) {
        abort_am_session(&view, &state_file);
        return;
    }

    if ctx.args.contains(&"--skip".to_string()) {
        skip_current_patch(&view, &state_file);
        return;
    }

    if ctx.args.contains(&"--resolved".to_string()) || ctx.args.contains(&"--continue".to_string()) {
        continue_am_session(&view, &state_file);
        return;
    }

    // New am session
    let patch_payload = match load_am_payload(&ctx.args) {
        Ok(bytes) => bytes,
        Err(err) => fail_fatal(err),
    };

    let patches = parse_mbox_patches(&patch_payload);
    if patches.is_empty() {
        fail_fatal("no patches found to apply");
    }

    let head_oid = view.head_commit().unwrap_or(None).unwrap_or(Oid::ZERO);
    let ref_store = DiskRefStore::new(view.git_dir());
    let target_ref = match ref_store.head() {
        Ok(HeadState::Symbolic { name, .. }) => Some(name),
        _ => None,
    };

    let mut session = AmSessionState {
        original_head: head_oid.to_hex(),
        target_ref,
        patches,
        current_index: 0,
    };

    run_patch_loop(&view, &mut session, &state_file);
}

/// Loads patch files or stdin payload.
fn load_am_payload(args: &[String]) -> Result<Vec<u8>, String> {
    let mut files = Vec::new();
    for arg in args {
        if !arg.starts_with('-') {
            files.push(arg.clone());
        }
    }

    if files.is_empty() || (files.len() == 1 && files[0] == "-") {
        let mut buf = Vec::new();
        io::stdin()
            .read_to_end(&mut buf)
            .map_err(|e| format!("reading patch from stdin failed: {e}"))?;
        return Ok(buf);
    }

    let mut combined = Vec::new();
    for path_str in files {
        let bytes = fs::read(&path_str)
            .map_err(|e| format!("could not read '{path_str}': {e}"))?;
        combined.extend_from_slice(&bytes);
        if !combined.ends_with(b"\n") {
            combined.push(b'\n');
        }
    }
    Ok(combined)
}

/// Parses an mbox file into individual `ParsedPatchMessage` records.
pub fn parse_mbox_patches(bytes: &[u8]) -> Vec<ParsedPatchMessage> {
    let text = String::from_utf8_lossy(bytes);
    let mut messages = Vec::new();
    let mut current_lines = Vec::new();

    for line in text.lines() {
        if line.starts_with("From ") && line.contains(" 200") && !current_lines.is_empty() {
            if let Some(msg) = parse_single_message(&current_lines) {
                messages.push(msg);
            }
            current_lines.clear();
        }
        current_lines.push(line);
    }

    if !current_lines.is_empty() {
        if let Some(msg) = parse_single_message(&current_lines) {
            messages.push(msg);
        }
    }

    messages
}

/// Parses a single patch message text into metadata and unified diff.
fn parse_single_message(lines: &[&str]) -> Option<ParsedPatchMessage> {
    let mut author_name = "Taxis User".to_string();
    let mut author_email = "taxis@local".to_string();
    let mut date = current_unix_seconds() as i64;
    let mut offset_minutes = 0;
    let mut subject = String::new();
    let mut body_lines = Vec::new();
    let mut diff_lines = Vec::new();

    let mut in_headers = true;
    let mut in_body = false;
    let mut in_diff = false;

    for line in lines {
        if in_headers {
            if line.is_empty() {
                in_headers = false;
                in_body = true;
                continue;
            }
            if let Some(rest) = line.strip_prefix("From: ") {
                let trimmed = rest.trim();
                if let Some(open) = trimmed.rfind('<') {
                    author_name = trimmed[..open].trim().to_string();
                    let rem = &trimmed[open + 1..];
                    if let Some(close) = rem.find('>') {
                        author_email = rem[..close].trim().to_string();
                    }
                } else {
                    author_name = trimmed.to_string();
                }
            } else if let Some(rest) = line.strip_prefix("Subject: ") {
                let mut subj = rest.trim();
                if subj.starts_with("[PATCH") {
                    if let Some(close) = subj.find(']') {
                        subj = subj[close + 1..].trim();
                    }
                }
                subject = subj.to_string();
            } else if let Some(rest) = line.strip_prefix("Date: ") {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(rest.trim()) {
                    date = dt.timestamp();
                    offset_minutes = dt.offset().local_minus_utc() / 60;
                }
            }
            continue;
        }

        if in_body {
            if line.starts_with("---") {
                in_body = false;
                in_diff = true;
                continue;
            }
            body_lines.push(*line);
            continue;
        }

        if in_diff {
            diff_lines.push(*line);
        }
    }

    if subject.is_empty() && diff_lines.is_empty() {
        return None;
    }

    let diff_text = diff_lines.join("\n");
    Some(ParsedPatchMessage {
        author_name,
        author_email,
        date,
        offset_minutes,
        subject,
        body: body_lines.join("\n").trim().to_string(),
        patch_bytes: diff_text.into_bytes(),
    })
}

/// Loops through remaining patches in session, applying and committing each.
fn run_patch_loop(view: &RepoView, session: &mut AmSessionState, state_file: &Path) {
    let apply_opts = ApplyOptions {
        stat_only: false,
        numstat: false,
        check_only: false,
        cached: false,
        index: true,
        reverse: false,
        strip_leading: 1,
        files: Vec::new(),
    };

    while session.current_index < session.patches.len() {
        let patch = &session.patches[session.current_index];
        let file_patches = match parse_unified_diff(&patch.patch_bytes, 1, false) {
            Ok(p) => p,
            Err(err) => {
                fail_and_save_am_state(session, state_file, format!("corrupt patch: {err}"));
                return;
            }
        };

        if let Err(apply_err) = execute_apply(view, &file_patches, &apply_opts) {
            fail_and_save_am_state(
                session,
                state_file,
                format!(
                    "Patch failed at {:04} {}\n{}\n\
                     When you have resolved this problem, run \"taxis am --resolved\".\n\
                     If you prefer to skip this patch, run \"taxis am --skip\".\n\
                     To restore the original branch and stop patching, run \"taxis am --abort\".",
                    session.current_index + 1,
                    patch.subject,
                    apply_err
                ),
            );
            return;
        }

        commit_applied_patch(view, session, patch);
        println!("Applying: {}", patch.subject);
        session.current_index += 1;
    }

    let _ = fs::remove_file(state_file);
}

/// Commits the index after a clean patch apply.
fn commit_applied_patch(view: &RepoView, session: &AmSessionState, patch: &ParsedPatchMessage) {
    let index = match view.index() {
        Ok(Some(idx)) => idx,
        _ => fail_fatal("no index found to commit"),
    };

    let mut mem_tree = InMemoryIndexTree::new();
    for entry in index.entries() {
        if entry.stage != IndexStage::Normal {
            fail_fatal("cannot commit with unmerged conflict slots");
        }
        let _ = mem_tree.stage_oid(&entry.path, entry.mode, entry.oid);
    }

    let odb = LooseOdb::new(view.git_dir());
    let tree_oid = match persist_index_tree(&mem_tree, &odb) {
        Ok(t) => t,
        Err(err) => fail_fatal(format!("tree persistence failed: {err}")),
    };

    let head_oid = view.head_commit().unwrap_or(None);
    let parents = head_oid.into_iter().collect();

    let author_sig = GitSignature::new(
        patch.author_name.clone(),
        patch.author_email.clone(),
        patch.date,
    );
    let now = current_unix_seconds() as i64;
    let committer_sig = GitSignature::new("Taxis User", "taxis@local", now);

    let message = if patch.body.is_empty() {
        format!("{}\n", patch.subject)
    } else {
        format!("{}\n\n{}\n", patch.subject, patch.body)
    };

    let commit = GitCommit::new(tree_oid, parents, author_sig, committer_sig, message, None);
    let commit_oid = match persist_commit_object(&commit, &odb) {
        Ok(c) => c,
        Err(err) => fail_fatal(format!("commit persistence failed: {err}")),
    };

    let ref_store = DiskRefStore::new(view.git_dir());
    if let Some(ref_name) = &session.target_ref {
        let prev = ref_store.get_ref(ref_name).ok().flatten();
        let _ = ref_store.update_ref(ref_name, &commit_oid, prev.as_ref());
    } else {
        let _ = fs::write(view.git_dir().join("HEAD"), format!("{}\n", commit_oid.to_hex()));
    }
}

/// Saves state and exits with 1 on conflict.
fn fail_and_save_am_state(session: &AmSessionState, state_file: &Path, msg: String) {
    let json_bytes = serde_json::to_vec_pretty(session).unwrap_or_default();
    let _ = fs::write(state_file, json_bytes);
    eprintln!("{msg}");
    std::process::exit(1);
}

/// Aborts the current `am` session.
fn abort_am_session(view: &RepoView, state_file: &Path) {
    if !state_file.exists() {
        fail_fatal("no am session in progress to abort");
    }

    let bytes = match fs::read(state_file) {
        Ok(b) => b,
        Err(e) => fail_fatal(format!("reading am state failed: {e}")),
    };

    let session: AmSessionState = serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        fail_fatal(format!("corrupt am state: {e}"));
    });

    if let Ok(orig_oid) = Oid::from_hex(&session.original_head) {
        let ref_store = DiskRefStore::new(view.git_dir());
        if let Some(ref_name) = &session.target_ref {
            let prev = ref_store.get_ref(ref_name).ok().flatten();
            let _ = ref_store.update_ref(ref_name, &orig_oid, prev.as_ref());
        } else {
            let _ = fs::write(view.git_dir().join("HEAD"), format!("{}\n", orig_oid.to_hex()));
        }
    }

    let _ = fs::remove_file(state_file);
    println!("Aborted.");
}

/// Skips the currently failing patch and continues.
fn skip_current_patch(view: &RepoView, state_file: &Path) {
    let mut session = load_session(state_file);
    session.current_index += 1;
    if session.current_index >= session.patches.len() {
        let _ = fs::remove_file(state_file);
        println!("All patches applied or skipped.");
        return;
    }
    run_patch_loop(view, &mut session, state_file);
}

/// Resumes the session after manual resolution.
fn continue_am_session(view: &RepoView, state_file: &Path) {
    let mut session = load_session(state_file);
    if session.current_index < session.patches.len() {
        let patch = &session.patches[session.current_index];
        commit_applied_patch(view, &session, patch);
        println!("Applying: {}", patch.subject);
        session.current_index += 1;
    }
    run_patch_loop(view, &mut session, state_file);
}

fn load_session(state_file: &Path) -> AmSessionState {
    if !state_file.exists() {
        fail_fatal("no am session in progress");
    }
    let bytes = fs::read(state_file).unwrap_or_else(|e| fail_fatal(format!("read state: {e}")));
    serde_json::from_slice(&bytes).unwrap_or_else(|e| fail_fatal(format!("corrupt state: {e}")))
}
