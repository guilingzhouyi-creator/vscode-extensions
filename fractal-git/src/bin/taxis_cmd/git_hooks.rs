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
    HookPipeline, HookTier, Oid, TaxisPolicy,
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

/// Runs prepare-commit-msg for a commit reusing an existing message and returns the final text.
pub fn run_prepare_chain(
    runner: &GitHookRunner,
    git_dir: &Path,
    message: &str,
    source: &str,
) -> String {
    let envs = commit_environment(git_dir);
    let message_file = write_message_file(git_dir, COMMIT_MESSAGE_FILE, message);
    run_prepare_commit_msg(runner, &message_file, source, &envs);
    fs::read_to_string(&message_file).unwrap_or_else(|_| message.to_string())
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

/// One reference row Git feeds to a reference-transaction hook on stdin.
#[derive(Debug, Clone)]
pub struct ReferenceUpdate {
    /// Previous target, or none when the reference is being created.
    pub previous: Option<Oid>,
    /// New target commit, or symbolic body for HEAD rewiring.
    pub next: String,
    /// Fully qualified reference name, or HEAD for the symbolic head.
    pub name: String,
}

/// Runs one reference-transaction phase and reports whether the hook allowed it.
///
/// Git sends the transaction state as the sole argument and one space separated
/// old, new, name record per updated reference on stdin; a non-zero exit aborts
/// the transaction during the preparing or prepared phases.
pub fn run_reference_transaction(
    runner: &GitHookRunner,
    state: &str,
    updates: &[ReferenceUpdate],
) -> bool {
    if updates.is_empty() {
        return true;
    }

    let stdin: String = updates
        .iter()
        .map(|update| {
            let previous = update
                .previous
                .map(|oid| oid.to_hex())
                .unwrap_or_else(|| "0".repeat(40));
            format!("{} {} {}\n", previous, update.next, update.name)
        })
        .collect();
    let args = [state.to_string()];
    let outcome = runner.run(
        "reference-transaction",
        &args,
        Some(&stdin),
        &BTreeMap::new(),
    );
    emit_hook_output(&outcome);
    if outcome.is_blocked() {
        eprintln!("{}", outcome.describe());
        return false;
    }
    true
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes one executable hook script into the fixture directory.
    fn write_hook(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create hook directory");
        }
        fs::write(path, body).expect("write hook script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(path).expect("hook metadata").permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).expect("chmod hook script");
        }
    }

    /// Builds a runner over an isolated hooks directory and returns its marker path.
    fn fixture(hook_body: &str) -> (tempfile::TempDir, GitHookRunner, std::path::PathBuf) {
        let root = tempfile::tempdir().expect("create hook fixture");
        let hooks = root.path().join("hooks");
        let marker = root.path().join("reference-transaction.log");
        let script = hook_body.replace("{marker}", &marker.to_string_lossy());
        write_hook(&hooks.join("reference-transaction"), &script);
        let runner = GitHookRunner::with_hooks_dir(root.path(), root.path().join(".git"), &hooks);
        (root, runner, marker)
    }

    #[test]
    fn reference_transaction_receives_state_and_rows() {
        let (_root, runner, marker) =
            fixture("#!/bin/sh\nprintf 'state=%s\n' \"$1\" >> \"{marker}\"\ncat >> \"{marker}\"\n");
        let update = ReferenceUpdate {
            previous: None,
            next: "a".repeat(40),
            name: "refs/heads/main".to_string(),
        };

        assert!(run_reference_transaction(&runner, "prepared", &[update]));

        let recorded = fs::read_to_string(&marker).expect("read hook marker");
        assert!(
            recorded.contains("state=prepared"),
            "state missing: {recorded}"
        );
        assert!(
            recorded.contains(&format!(
                "{} {} refs/heads/main",
                "0".repeat(40),
                "a".repeat(40)
            )),
            "row missing: {recorded}"
        );
    }

    #[test]
    fn blocking_reference_transaction_rejects_the_phase() {
        let (_root, runner, _marker) = fixture("#!/bin/sh\nexit 1\n");
        let update = ReferenceUpdate {
            previous: None,
            next: "b".repeat(40),
            name: "HEAD".to_string(),
        };

        assert!(!run_reference_transaction(&runner, "preparing", &[update]));
        assert!(run_reference_transaction(&runner, "committed", &[]));
    }
}
