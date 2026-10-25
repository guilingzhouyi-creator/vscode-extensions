//! Module: taxis_cmd::rebase_state — Rebase State Machine and Stop Controls
//! File Path: src/bin/taxis_cmd/rebase_state.rs
//! Architecture Role: Owns the persisted description of an interrupted rebase, the Git-shaped
//!   interoperability files under the state directory, the committer identity of replayed commits,
//!   and the resume, abort, and completion controls invoked by the rebase dispatcher.
//! Dependencies & Triggers: Loaded by src/bin/taxis_cmd/rebase.rs for every rebase, resume, abort,
//!   stop, and completion.
//! Responsibilities: Encode and reload the authoritative resume record, write the instruction and
//!   reference files Git tools read, honor GIT_COMMITTER_NAME/EMAIL/DATE, and either finish a replay
//!   or print the Git-shaped guidance for a stop.
//! Exit Semantics & Design Rationale:
//!   - The state directory is written before a replay mutates the branch reference, so an abort can
//!     restore the original tip from the recorded value.
//!   - A stop that needs operator action exits non-zero after persisting state, while an edit stop
//!     exits zero because amending is the expected next step.
//!   - Committer provenance comes from the environment instead of a fixed internal identity, so
//!     replayed commits stay attributable.
//!
//! ### Domain Governance Rules (SSOT):
//! - FGT-COR-001: Core data model and error contract guard
//! - FGT-GAT-001: Fractal Git domain gate guard
//! - FGT-STO-001: Storage layer crash safety guard

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use fg_core::models::{GitSignature, Oid, RebaseItem, RebasePlan};
use fractal_git::constants::cli::CliTag;
use serde::{Deserialize, Serialize};

use super::common::{fail_fatal, fail_io, print_json, reject, CliContext, EXIT_REJECTED};
use super::rebase::{project_worktree, record_rebase_op, ReplaySession};
use super::repo_view::RepoView;

/// Directory under the git directory that carries an in-progress rebase.
const REBASE_STATE_DIR: &str = "rebase-merge";

/// Committer display name used when the environment supplies none.
const DEFAULT_COMMITTER_NAME: &str = "Taxis Operator";

/// Committer mailbox used when the environment supplies none.
const DEFAULT_COMMITTER_EMAIL: &str = "operator@taxis.internal";

/// Persisted description of an interrupted rebase.
///
/// The instruction files Git reads (git-rebase-todo, done, head-name, orig-head, onto, stopped-sha,
/// message) are written for interoperability, while this structure is the authoritative resume
/// record: it names the remaining instructions and the tip reached so far, so a resume neither
/// replays applied commits nor skips pending ones.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RebaseState {
    pub(crate) upstream: Oid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) head_name: Option<String>,
    pub(crate) orig_head: Oid,
    pub(crate) current_tip: Oid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) stopped_sha: Option<Oid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) stopped_message: Option<String>,
    pub(crate) done: Vec<RebaseItem>,
    pub(crate) remaining: Vec<RebaseItem>,
}

/// Where a replay stopped and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StopKind {
    Edit,
    ExecFailed,
    Conflict,
}

/// Result of one replay run.
#[derive(Debug)]
pub(crate) enum ReplayOutcome {
    Completed,
    Stopped {
        stopped_sha: Oid,
        message: String,
        kind: StopKind,
    },
}

/// Immutable facts a stop or completion needs when writing references and reports.
pub(crate) struct RebaseOutcomeContext {
    pub(crate) from_commit: Oid,
    pub(crate) upstream_label: String,
    pub(crate) branch: Option<String>,
}

/// Path of the rebase state directory.
pub(crate) fn rebase_state_dir(git_dir: &Path) -> PathBuf {
    git_dir.join(REBASE_STATE_DIR)
}

/// Writes the Git-shaped state files and the authoritative resume record.
pub(crate) fn persist_state(git_dir: &Path, state: &RebaseState) {
    let dir = rebase_state_dir(git_dir);
    if let Err(err) = fs::create_dir_all(&dir) {
        fail_io("create rebase state directory", err);
    }

    let head_name = match &state.head_name {
        Some(branch) => format!("refs/heads/{branch}"),
        None => "detached HEAD".to_string(),
    };
    write_state_file(&dir.join("head-name"), &format!("{head_name}\n"));
    write_state_file(
        &dir.join("orig-head"),
        &format!("{}\n", state.orig_head.to_hex()),
    );
    write_state_file(&dir.join("onto"), &format!("{}\n", state.upstream.to_hex()));
    let todo = RebasePlan::new(state.upstream, state.remaining.clone()).format_todo_text();
    write_state_file(&dir.join("git-rebase-todo"), &todo);
    let done = RebasePlan::new(state.upstream, state.done.clone()).format_instruction_lines();
    write_state_file(&dir.join("done"), &done);
    if let Some(stopped_sha) = state.stopped_sha {
        write_state_file(
            &dir.join("stopped-sha"),
            &format!("{}\n", stopped_sha.to_hex()),
        );
    }
    if let Some(message) = &state.stopped_message {
        write_state_file(&dir.join("message"), message);
    }
    match serde_json::to_string_pretty(state) {
        Ok(json) => write_state_file(&dir.join("taxi-state.json"), &json),
        Err(err) => fail_io("encode rebase state", err),
    }
}

/// Writes one state file, failing fatally on an I/O error.
fn write_state_file(path: &Path, content: &str) {
    if let Err(err) = fs::write(path, content) {
        fail_io(format!("write '{}'", path.display()), err);
    }
}

/// Reads the authoritative resume record, distinguishing absence from corruption.
fn load_rebase_state(git_dir: &Path) -> Result<Option<RebaseState>, String> {
    let dir = rebase_state_dir(git_dir);
    if !dir.is_dir() {
        return Ok(None);
    }
    let path = dir.join("taxi-state.json");
    let content =
        fs::read_to_string(&path).map_err(|err| format!("read '{}': {err}", path.display()))?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|err| format!("parse '{}': {err}", path.display()))
}

/// Removes the rebase state directory after a completion or abort.
fn clear_state(git_dir: &Path) {
    let dir = rebase_state_dir(git_dir);
    if let Err(err) = fs::remove_dir_all(&dir) {
        if dir.exists() {
            fail_io("remove rebase state directory", err);
        }
    }
}

/// Records the original tip so an abort can restore it and tools can diff against it.
pub(crate) fn write_orig_head(git_dir: &Path, oid: Oid) {
    if let Err(err) = fs::write(git_dir.join("ORIG_HEAD"), format!("{}\n", oid.to_hex())) {
        fail_io("write ORIG_HEAD", err);
    }
}

/// Builds the committer signature from GIT_COMMITTER_NAME/EMAIL/DATE, falling back to the internal
/// operator identity and the current time.
pub(crate) fn committer_signature() -> GitSignature {
    let name = env::var("GIT_COMMITTER_NAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_COMMITTER_NAME.to_string());
    let email = env::var("GIT_COMMITTER_EMAIL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_COMMITTER_EMAIL.to_string());
    match env::var("GIT_COMMITTER_DATE")
        .ok()
        .and_then(|raw| parse_committer_date(&raw))
    {
        Some((timestamp_sec, tz_offset)) => GitSignature {
            name,
            email,
            timestamp_sec,
            tz_offset,
        },
        None => GitSignature::new(name, email, chrono::Utc::now().timestamp()),
    }
}

/// Parses Git's raw date format: an optional '@' prefix, seconds since the epoch, and a zone.
fn parse_committer_date(raw: &str) -> Option<(i64, String)> {
    let trimmed = raw.trim();
    let body = trimmed.strip_prefix('@').unwrap_or(trimmed);
    let mut fields = body.split_whitespace();
    let timestamp_sec = fields.next()?.parse::<i64>().ok()?;
    let tz_offset = fields
        .next()
        .map(format_timezone)
        .unwrap_or_else(|| "+0000".to_string());
    Some((timestamp_sec, tz_offset))
}

/// Normalizes a '+HHMM'/'-HHMM' zone, falling back to UTC for anything malformed.
fn format_timezone(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let valid = bytes.len() == 5
        && (bytes[0] == b'+' || bytes[0] == b'-')
        && bytes[1..].iter().all(u8::is_ascii_digit);
    if valid {
        raw.to_string()
    } else {
        "+0000".to_string()
    }
}

/// Formats minutes east of UTC as a Git zone offset.
pub(crate) fn format_offset_minutes(offset_minutes: i32) -> String {
    let sign = if offset_minutes < 0 { '-' } else { '+' };
    let absolute = offset_minutes.abs();
    format!("{}{:02}{:02}", sign, absolute / 60, absolute % 60)
}

/// Resumes the instruction list recorded by an interrupted rebase.
pub(crate) fn handle_rebase_continue(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };
    let mut state = match load_rebase_state(view.git_dir()) {
        Ok(Some(state)) => state,
        Ok(None) => reject(CliTag::ERROR, "fatal: No rebase in progress"),
        Err(detail) => fail_io("read rebase state", detail),
    };

    // HEAD carries an amended stop commit when the operator rewrote it; the recorded tip only covers
    // the case where the reference was not advanced.
    let tip = match view.head_commit() {
        Ok(Some(oid)) => oid,
        _ => state.current_tip,
    };

    let mut session = ReplaySession::new(&view, tip, state.upstream);
    let (outcome, done, remaining) = session.drive(state.remaining.clone());
    state.done.extend(done);
    state.remaining = remaining;
    state.current_tip = session.current_tip;

    let context = RebaseOutcomeContext {
        from_commit: tip,
        upstream_label: state.upstream.to_hex(),
        branch: state.head_name.clone(),
    };
    let completed = conclude_rebase(
        &view,
        &context,
        &mut state,
        outcome,
        &session.rewritten_pairs,
    );
    if !completed {
        return;
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "rebase",
            "status": "success",
            "new_head": state.current_tip.to_hex(),
            "branch": context.branch,
        }));
    } else {
        println!(
            "Successfully rebased and updated refs/heads/{}.",
            context.branch.as_deref().unwrap_or("HEAD")
        );
    }
}

/// Aborts the rebase recorded in the state directory and restores the original tip.
pub(crate) fn handle_rebase_abort(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };
    let state = match load_rebase_state(view.git_dir()) {
        Ok(Some(state)) => state,
        Ok(None) => reject(CliTag::ERROR, "fatal: No rebase in progress to abort"),
        Err(detail) => fail_io("read rebase state", detail),
    };

    let from_commit = match view.head_commit() {
        Ok(Some(oid)) => oid,
        _ => state.current_tip,
    };
    project_worktree(
        &view,
        from_commit,
        state.orig_head,
        state.head_name.as_deref(),
    );
    write_orig_head(view.git_dir(), state.orig_head);
    let _ = fs::remove_file(view.git_dir().join("REBASE_HEAD"));
    clear_state(view.git_dir());
    println!("Rebase aborted.");
}

/// Writes the projection and references for a completion, or persists a stop and prints its guidance.
pub(crate) fn conclude_rebase(
    view: &RepoView,
    context: &RebaseOutcomeContext,
    state: &mut RebaseState,
    outcome: ReplayOutcome,
    rewritten_pairs: &[(String, String)],
) -> bool {
    match outcome {
        ReplayOutcome::Completed => {
            project_worktree(
                view,
                context.from_commit,
                state.current_tip,
                context.branch.as_deref(),
            );
            let hook_runner = super::git_hooks::discover(view.git_dir(), view.work_root());
            super::git_hooks::run_post_rewrite(&hook_runner, "rebase", rewritten_pairs);
            record_rebase_op(
                view,
                state.current_tip,
                &context.upstream_label,
                context.branch.as_deref(),
            );
            clear_state(view.git_dir());
            true
        }
        ReplayOutcome::Stopped {
            stopped_sha,
            message,
            kind,
        } => {
            state.stopped_sha = Some(stopped_sha);
            state.stopped_message = Some(message.clone());
            persist_state(view.git_dir(), state);
            project_worktree(
                view,
                context.from_commit,
                state.current_tip,
                context.branch.as_deref(),
            );
            print_stop(kind, &message, stopped_sha);
            false
        }
    }
}

/// Prints Git-shaped guidance for a stop; an unresolved exec/conflict exits non-zero.
fn print_stop(kind: StopKind, message: &str, stopped_sha: Oid) {
    match kind {
        StopKind::Edit => {
            println!(
                "Stopped at {}...  {}",
                &stopped_sha.to_hex()[..8],
                message.lines().next().unwrap_or("")
            );
            println!();
            println!("You can amend the commit now, with");
            println!();
            println!("  taxis commit --amend");
            println!();
            println!("Once you are satisfied with your changes, run");
            println!();
            println!("  taxis rebase --continue");
        }
        StopKind::ExecFailed | StopKind::Conflict => {
            eprintln!("{message}");
            eprintln!("You can fix the problem, and then run");
            eprintln!();
            eprintln!("  taxis rebase --continue");
            eprintln!();
            eprintln!("To abort the rebase and restore the original tip, run");
            eprintln!();
            eprintln!("  taxis rebase --abort");
            std::process::exit(EXIT_REJECTED);
        }
    }
}
