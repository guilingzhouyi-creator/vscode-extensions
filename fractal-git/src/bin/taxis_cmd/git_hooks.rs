//! Module: taxis_cmd::git_hooks — Git Hook Lifecycle Bridge
//! File Path: src/bin/taxis_cmd/git_hooks.rs
//! Architecture Role: Adapts the fg-gate Git hook runner into the exact lifecycle moments the
//!   Taxis commit, merge, and checkout dispatchers occupy, so locally installed gate scripts
//!   observe the same invocation order plain Git would produce.
//! Dependencies & Triggers: Called by commit.rs, merge.rs, and checkout.rs around their durable
//!   object and reference mutations.
//! Responsibilities: Writing message files, composing hook environments and arguments, and
//!   mapping blocking hook outcomes onto CLI rejections.
//! Exit Semantics & Design Rationale: Pre-operation hooks are fail-closed and abort the command;
//!   post-operation hooks only report diagnostics because Git itself ignores their exit codes.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use fractal_git::constants::cli::CliTag;
use fractal_git::{
    hook_argument_path, ActorIdentity, GitHookOutcome, GitHookRunner, GitHookStatus, HookContext,
    HookPipeline, HookTier, TaxisPolicy,
};

use super::common::reject;

/// Index file name inside the repository metadata directory.
const INDEX_FILE_NAME: &str = "index";

/// Message file Git exposes to commit message hooks.
const COMMIT_MESSAGE_FILE: &str = "COMMIT_EDITMSG";

/// Message file Git exposes to merge message hooks.
const MERGE_MESSAGE_FILE: &str = "MERGE_MSG";

/// Runs the pre-commit, prepare-commit-msg, and commit-msg chain for a commit operation.
pub fn run_commit_chain(runner: &GitHookRunner, git_dir: &Path, message: &str) {
    let envs = commit_environment(git_dir);
    let message_file = write_message_file(git_dir, COMMIT_MESSAGE_FILE, message);
    run_blocking(runner, "pre-commit", &[], None, &envs);
    run_prepare_commit_msg(runner, &message_file, "message", &envs);
    let message_argument = hook_argument_path(&message_file);
    run_blocking(runner, "commit-msg", &[message_argument], None, &envs);
}

/// Runs the pre-merge-commit, prepare-commit-msg, and commit-msg chain for a merge operation.
pub fn run_merge_chain(runner: &GitHookRunner, git_dir: &Path, message: &str) {
    let envs = commit_environment(git_dir);
    let message_file = write_message_file(git_dir, MERGE_MESSAGE_FILE, message);
    run_blocking(runner, "pre-merge-commit", &[], None, &envs);
    run_prepare_commit_msg(runner, &message_file, "merge", &envs);
    let message_argument = hook_argument_path(&message_file);
    run_blocking(runner, "commit-msg", &[message_argument], None, &envs);
}

/// Runs one post-operation hook, reporting failures without aborting the completed operation.
pub fn run_post_hook(runner: &GitHookRunner, name: &str, args: &[String]) {
    run_post_hook_with_stdin(runner, name, args, None);
}

/// Runs one post-operation hook that also consumes stdin records.
pub fn run_post_hook_with_stdin(
    runner: &GitHookRunner,
    name: &str,
    args: &[String],
    stdin: Option<&str>,
) {
    let outcome = runner.run(name, args, stdin, &BTreeMap::new());
    emit_hook_output(&outcome);
    if outcome.is_blocked() {
        eprintln!("{}", outcome.describe());
    }
}

/// Runs the pre-rebase hook before a branch tip is replayed onto a new base.
pub fn run_pre_rebase(runner: &GitHookRunner, upstream: &str, branch: Option<&str>) {
    let mut args = vec![upstream.to_string()];
    if let Some(branch_name) = branch {
        args.push(branch_name.to_string());
    }
    run_blocking(runner, "pre-rebase", &args, None, &BTreeMap::new());
}

/// Reports rewritten commits to the post-rewrite hook after a successful replay.
pub fn run_post_rewrite(runner: &GitHookRunner, kind: &str, pairs: &[(String, String)]) {
    let stdin: String = pairs
        .iter()
        .map(|(previous, rewritten)| format!("{previous} {rewritten}\n"))
        .collect();
    let args = [kind.to_string()];
    run_post_hook_with_stdin(runner, "post-rewrite", &args, Some(&stdin));
}

/// Evaluates the built-in fractal hook pipeline before materializing a commit.
pub fn assert_pipeline_approved(
    source_ref: &str,
    target_ref: &str,
    actor: &ActorIdentity,
    policy: &TaxisPolicy,
    staged_files: &[String],
    message: &str,
) {
    let context = HookContext {
        tier: HookTier::SubToCard,
        source_ref,
        target_ref,
        actor,
        policy,
        staged_files,
        commit_message: Some(message),
    };

    if let Err(pipeline_error) =
        HookPipeline::with_defaults().assert_tier_approved(HookTier::SubToCard, &context)
    {
        reject(
            CliTag::COMMIT_GOVERNANCE_FAIL,
            format!("Fractal hook pipeline rejected the commit: {pipeline_error}"),
        );
    }
}

/// Builds the environment Git exports to commit lifecycle hooks.
fn commit_environment(git_dir: &Path) -> BTreeMap<String, String> {
    let mut envs = BTreeMap::new();
    envs.insert(
        "GIT_INDEX_FILE".to_string(),
        hook_argument_path(&git_dir.join(INDEX_FILE_NAME)),
    );
    envs
}

/// Writes the hook-visible message file and returns its on-disk path.
fn write_message_file(git_dir: &Path, file_name: &str, message: &str) -> PathBuf {
    let message_file = git_dir.join(file_name);
    if let Err(write_error) = fs::write(&message_file, message) {
        reject(
            CliTag::ERROR,
            format!(
                "write hook message file '{}': {write_error}",
                message_file.display()
            ),
        );
    }
    message_file
}

/// Invokes prepare-commit-msg with the message file and its Git source label.
fn run_prepare_commit_msg(
    runner: &GitHookRunner,
    message_file: &Path,
    source: &str,
    envs: &BTreeMap<String, String>,
) {
    let args = [hook_argument_path(message_file), source.to_string()];
    run_blocking(runner, "prepare-commit-msg", &args, None, envs);
}

/// Forwards captured hook output the way Git does, always onto the caller's stderr.
fn emit_hook_output(outcome: &GitHookOutcome) {
    if !outcome.stdout.is_empty() {
        eprintln!("{}", outcome.stdout);
    }
    if matches!(outcome.status, GitHookStatus::TimedOut { .. }) {
        eprintln!("{}", outcome.describe());
    }
}

/// Runs one hook and rejects the command when the hook withholds approval.
fn run_blocking(
    runner: &GitHookRunner,
    name: &str,
    args: &[String],
    stdin: Option<&str>,
    envs: &BTreeMap<String, String>,
) {
    let outcome = runner.run(name, args, stdin, envs);
    emit_hook_output(&outcome);
    if outcome.is_blocked() {
        reject(
            CliTag::COMMIT_GOVERNANCE_FAIL,
            format!("Git hook rejected the operation: {}", outcome.describe()),
        );
    }
}

/// Convenience re-export so dispatchers can build a runner without extra imports.
pub fn discover(git_dir: &Path, work_root: &Path) -> GitHookRunner {
    GitHookRunner::discover(work_root, git_dir)
}
