//! Module: taxis_cmd::rebase — Native 'rebase' Command Dispatcher
//! File Path: src/bin/taxis_cmd/rebase.rs
//! Architecture Role: Implements linear commit replay onto upstream base: DAG ancestor
//!   filtering, sequential 3-way merge-ort tree application, and new commit synthesis; the
//!   stop/resume state machine lives in rebase_state.rs.
//! Dependencies & Triggers: Dispatched by 'taxis rebase', 'taxis rebase --continue', and
//!   'taxis rebase --abort'.
//! Responsibilities: Validate worktree cleanliness and plan legality, determine rebase commit slice,
//!   iteratively replay commits with original author provenance, and hand the replay outcome to the
//!   state layer for reference updates and stop reporting.
//! Exit Semantics & Design Rationale:
//!   - A plan Git would refuse is rejected before any reference changes. A first instruction of
//!     squash/fixup has no previous commit to meld into, and accepting it built a parentless root
//!     commit inside the replayed range with a different parent chain than Git.
//!   - The replay session only synthesizes objects; projecting the worktree, advancing the branch
//!     reference, and persisting a stop belong to the state layer, so a resume and an abort share
//!     one implementation.
//!
//! ### Domain Governance Rules (SSOT):
//! - FGT-COR-001: Core data model and error contract guard
//! - FGT-GAT-001: Fractal Git domain gate guard
//! - FGT-ALG-001: Algorithmic three-way tree equivalence guard

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::Command;

use fg_algorithms::merge::{ThreeWayMerge, ThreeWayMergeResult};
use fg_core::models::{FileMode, GitSignature, Oid, RebaseAction, RebaseItem, RebasePlan};
use fg_index::InMemoryIndexTree;
use fg_object::GitCommit;
use fg_storage::commit_materializer::{persist_commit_object, persist_index_tree};
use fg_storage::LooseOdb;
use fractal_git::constants::cli::CliTag;

use super::checkout::{
    assert_worktree_cleanliness_for, materialize_files, remove_stale_files, update_dirc_index,
    update_references,
};
use super::commit_walk::{parse_commit_record, walk_commits, CommitRecord};
use super::common::{fail_fatal, fail_io, print_json, reject, CliContext};
use super::operation::{record_head_operation, HeadOperationSpec};
use super::rebase_state::{
    committer_signature, conclude_rebase, format_offset_minutes, handle_rebase_abort,
    handle_rebase_continue, persist_state, rebase_state_dir, write_orig_head, RebaseOutcomeContext,
    RebaseState, ReplayOutcome, StopKind,
};
use super::repo_view::RepoView;
use super::tree_view::{flatten_commit_tree, flatten_tree_for_diff};

/// Parsed options for 'taxis rebase'.
#[derive(Debug, Clone)]
struct RebaseCliOptions {
    upstream: Option<String>,
    interactive: bool,
    plan_file: Option<PathBuf>,
    plan_stdin: bool,
    abort: bool,
    continue_rebase: bool,
}

fn parse_rebase_cli_options(args: &[String]) -> RebaseCliOptions {
    let mut upstream = None;
    let mut interactive = false;
    let mut plan_file = None;
    let mut plan_stdin = false;
    let mut abort = false;
    let mut continue_rebase = false;

    let mut cursor = 0;
    while cursor < args.len() {
        let arg = &args[cursor];
        if arg == "--abort" {
            abort = true;
            cursor += 1;
        } else if arg == "--continue" {
            continue_rebase = true;
            cursor += 1;
        } else if arg == "-i" || arg == "--interactive" {
            interactive = true;
            cursor += 1;
        } else if arg == "--plan-stdin" {
            plan_stdin = true;
            cursor += 1;
        } else if arg == "--plan" && cursor + 1 < args.len() {
            plan_file = Some(PathBuf::from(&args[cursor + 1]));
            cursor += 2;
        } else if let Some(stripped) = arg.strip_prefix("--plan=") {
            plan_file = Some(PathBuf::from(stripped));
            cursor += 1;
        } else if !arg.starts_with('-') && upstream.is_none() {
            upstream = Some(arg.clone());
            cursor += 1;
        } else {
            cursor += 1;
        }
    }

    RebaseCliOptions {
        upstream,
        interactive,
        plan_file,
        plan_stdin,
        abort,
        continue_rebase,
    }
}

/// Result of one instruction.
enum StepOutcome {
    Applied,
    Stopped {
        stopped_sha: Oid,
        message: String,
        kind: StopKind,
        consumed: bool,
    },
}

/// One clean-merge failure, carrying what the operator needs to see.
struct MergeConflict {
    commit: Oid,
    subject: String,
    paths: Vec<String>,
}

/// One replay session: the tip reached so far plus the rewritten-commit ledger.
pub(crate) struct ReplaySession<'a> {
    view: &'a RepoView,
    odb: LooseOdb,
    onto: Oid,
    pub(crate) current_tip: Oid,
    last_message: String,
    last_parents: Vec<Oid>,
    pub(crate) rewritten_pairs: Vec<(String, String)>,
}

impl<'a> ReplaySession<'a> {
    pub(crate) fn new(view: &'a RepoView, tip: Oid, onto: Oid) -> Self {
        let (last_message, last_parents) = match view.object(&tip) {
            Ok(object) => match parse_commit_record(tip, &object.payload) {
                Ok(record) => (record.message, record.parents),
                Err(_) => (String::new(), Vec::new()),
            },
            Err(_) => (String::new(), Vec::new()),
        };
        Self {
            view,
            odb: LooseOdb::new(view.git_dir()),
            onto,
            current_tip: tip,
            last_message,
            last_parents,
            rewritten_pairs: Vec::new(),
        }
    }

    /// Consumes instructions until the queue empties or a step stops the rebase.
    pub(crate) fn drive(
        &mut self,
        mut queue: Vec<RebaseItem>,
    ) -> (ReplayOutcome, Vec<RebaseItem>, Vec<RebaseItem>) {
        let mut done = Vec::new();
        fg_core::diag_info!("rebase", "replaying {} planned step(s)", queue.len());
        while !queue.is_empty() {
            let rebase_step = queue.remove(0);
            // Per-step record: a rebase that stops half way is the hard case to reconstruct, and the
            // action taken for each step is the only thing that explains where it stopped.
            fg_core::diag_debug!(
                "rebase",
                "step action={:?} remaining={}",
                rebase_step.action,
                queue.len()
            );
            match self.apply(&rebase_step) {
                StepOutcome::Applied => done.push(rebase_step),
                StepOutcome::Stopped {
                    stopped_sha,
                    message,
                    kind,
                    consumed,
                } => {
                    fg_core::diag_info!(
                        "rebase",
                        "stopped at {} kind={:?} consumed={} applied={}",
                        stopped_sha.to_hex(),
                        kind,
                        consumed,
                        done.len()
                    );
                    if consumed {
                        done.push(rebase_step);
                    } else {
                        queue.insert(0, rebase_step);
                    }
                    let outcome = ReplayOutcome::Stopped {
                        stopped_sha,
                        message,
                        kind,
                    };
                    return (outcome, done, queue);
                }
            }
        }
        (ReplayOutcome::Completed, done, Vec::new())
    }

    fn apply(&mut self, item: &RebaseItem) -> StepOutcome {
        match item.action {
            RebaseAction::Drop => StepOutcome::Applied,
            RebaseAction::Exec => self.run_exec(item),
            _ => self.apply_commit_step(item),
        }
    }

    fn run_exec(&mut self, item: &RebaseItem) -> StepOutcome {
        let command = item.command.clone().unwrap_or_default();
        if run_shell_command(self.view.work_root(), &command) {
            return StepOutcome::Applied;
        }
        StepOutcome::Stopped {
            stopped_sha: self.current_tip,
            message: format!("error: Execution failed: {command}"),
            kind: StopKind::ExecFailed,
            consumed: true,
        }
    }

    fn apply_commit_step(&mut self, item: &RebaseItem) -> StepOutcome {
        let record = self.commit_record(item);
        let tree_oid = match self.merged_tree_oid(&record) {
            Ok(oid) => oid,
            Err(conflict) => return self.conflict_stop(conflict),
        };

        let (parents, message) = match item.action {
            RebaseAction::Squash => (
                self.last_parents.clone(),
                format!("{}\n\n{}", self.last_message, record.message),
            ),
            RebaseAction::Fixup => (self.last_parents.clone(), self.last_message.clone()),
            RebaseAction::Reword => (
                vec![self.current_tip],
                item.new_message
                    .clone()
                    .unwrap_or_else(|| record.message.clone()),
            ),
            _ => (vec![self.current_tip], record.message.clone()),
        };

        // `reword` is the only action that writes text nobody has written before, so it is the
        // only one that faces the full contract. Pick, squash and fixup replay text that already
        // passed a gate; re-judging it against today's rules would reject valid history.
        let rewrite_origin = if item.action == RebaseAction::Reword && item.new_message.is_some() {
            fg_gate::commit_guard::rewrite::MessageOrigin::Authored
        } else {
            fg_gate::commit_guard::rewrite::MessageOrigin::Inherited
        };
        let rebase_floor = fg_gate::PolicyFloor::resolve(self.view.git_dir());
        let rebase_policy = fg_gate::policy_floor::preset_for_tier(rebase_floor.tier);
        if let Err(guard_error) = fg_gate::commit_guard::rewrite::verify_rewrite_message(
            &rebase_policy,
            &rebase_floor,
            &message,
            rewrite_origin,
            None,
        ) {
            reject(
                CliTag::COMMIT_GOVERNANCE_FAIL,
                format!(
                    "Rebase message rejected for {}: {guard_error}",
                    record.oid.to_hex()
                ),
            );
        }

        let author = author_signature(&record);
        let new_oid = self.write_commit(tree_oid, parents.clone(), &message, author);
        self.rewritten_pairs
            .push((record.oid.to_hex(), new_oid.to_hex()));
        self.current_tip = new_oid;
        self.last_message = message.clone();
        self.last_parents = parents;

        if item.action == RebaseAction::Edit {
            return StepOutcome::Stopped {
                stopped_sha: new_oid,
                message,
                kind: StopKind::Edit,
                consumed: true,
            };
        }
        StepOutcome::Applied
    }

    fn commit_record(&self, item: &RebaseItem) -> CommitRecord {
        let commit = match item.commit {
            Some(oid) => oid,
            None => reject(
                CliTag::ERROR,
                format!("{} requires a commit", item.action.as_str()),
            ),
        };
        let object = match self.view.object(&commit) {
            Ok(object) => object,
            Err(err) => reject(CliTag::ERROR, err),
        };
        match parse_commit_record(commit, &object.payload) {
            Ok(record) => record,
            Err(err) => reject(CliTag::ERROR, err),
        }
    }

    /// Three-way merges this commit's delta onto the current tip and persists the resulting tree.
    fn merged_tree_oid(&self, record: &CommitRecord) -> Result<Oid, MergeConflict> {
        let parent_oid = record.parents.first().copied().unwrap_or(self.onto);
        let (_, base_tree_oid) = self.resolve_tree_oid(parent_oid);
        let (_, theirs_tree_oid) = self.resolve_tree_oid(record.oid);
        let (_, ours_tree_oid) = self.resolve_tree_oid(self.current_tip);

        let mut base_files = BTreeMap::new();
        let mut theirs_files = BTreeMap::new();
        let mut ours_files = BTreeMap::new();
        let _ = flatten_tree_for_diff(self.view, &base_tree_oid, "", &mut base_files);
        let _ = flatten_tree_for_diff(self.view, &theirs_tree_oid, "", &mut theirs_files);
        let _ = flatten_tree_for_diff(self.view, &ours_tree_oid, "", &mut ours_files);

        let base_map = oid_map(&base_files);
        let theirs_map = oid_map(&theirs_files);
        let ours_map = oid_map(&ours_files);

        let merged_tree = match ThreeWayMerge::merge(&base_map, &ours_map, &theirs_map) {
            ThreeWayMergeResult::Clean { merged_tree } => merged_tree,
            ThreeWayMergeResult::FastForward => theirs_map.clone(),
            ThreeWayMergeResult::Conflicted { conflicts, .. } => {
                return Err(MergeConflict {
                    commit: record.oid,
                    subject: record.subject().to_string(),
                    paths: conflicts
                        .iter()
                        .map(|conflict| conflict.path.clone())
                        .collect(),
                });
            }
        };

        let mut in_mem_index = InMemoryIndexTree::new();
        for (path, oid) in &merged_tree {
            let mode = theirs_files
                .get(path)
                .or_else(|| ours_files.get(path))
                .map(|entry| entry.mode)
                .unwrap_or(FileMode::RegularFile);
            let _ = in_mem_index.stage_oid(path, mode, *oid);
        }

        Ok(persist_index_tree(&in_mem_index, &self.odb)
            .unwrap_or_else(|err| fail_io("persist rebased tree", err)))
    }

    fn resolve_tree_oid(&self, commit: Oid) -> (Oid, Oid) {
        match self.view.resolve_tree(&commit.to_hex()) {
            Ok(resolved) => resolved,
            Err(err) => reject(CliTag::ERROR, err),
        }
    }

    fn write_commit(
        &self,
        tree_oid: Oid,
        parents: Vec<Oid>,
        message: &str,
        author: GitSignature,
    ) -> Oid {
        let committer = committer_signature();
        let commit = GitCommit::new(
            tree_oid,
            parents,
            author,
            committer,
            message.to_string(),
            None,
        );
        persist_commit_object(&commit, &self.odb)
            .unwrap_or_else(|err| fail_io("persist rebased commit", err))
    }

    fn conflict_stop(&self, conflict: MergeConflict) -> StepOutcome {
        let _ = fs::write(
            self.view.git_dir().join("REBASE_HEAD"),
            format!("{}\n", conflict.commit.to_hex()),
        );
        StepOutcome::Stopped {
            stopped_sha: conflict.commit,
            message: format!(
                "error: could not apply {}... {}\nConflict in: {:?}",
                &conflict.commit.to_hex()[..8],
                conflict.subject,
                conflict.paths
            ),
            kind: StopKind::Conflict,
            consumed: false,
        }
    }
}

/// Entry point: dispatches a new rebase, a resume, or an abort.
pub fn handle_rebase(ctx: &CliContext) {
    let opts = parse_rebase_cli_options(&ctx.args);

    if opts.abort {
        handle_rebase_abort(ctx);
        return;
    }
    if opts.continue_rebase {
        handle_rebase_continue(ctx);
        return;
    }

    let upstream_arg = match &opts.upstream {
        Some(upstream) => upstream.clone(),
        None => reject(CliTag::ERROR, "rebase expects an upstream branch or commit"),
    };

    let view = RepoView::open_or_exit(ctx);

    if rebase_state_dir(view.git_dir()).is_dir() {
        reject(
            CliTag::ERROR,
            "a rebase is already in progress; run 'taxis rebase --continue' or 'taxis rebase --abort'",
        );
    }

    assert_worktree_cleanliness_for(&view, false, "rebase");

    let upstream_commit = match view.resolve(&upstream_arg) {
        Ok(oid) => oid,
        Err(err) => reject(
            CliTag::ERROR,
            format!("cannot resolve upstream '{upstream_arg}': {err}"),
        ),
    };

    let ours_commit = match view.effective_head_commit() {
        Ok(Some((_, oid))) => oid,
        _ => reject(CliTag::ERROR, "HEAD has no commit; cannot rebase"),
    };

    let effective_branch = view
        .head_branch()
        .ok()
        .flatten()
        .map(|(branch_name, _)| branch_name);

    let bases = match super::commit_walk::build_ccd_index(&view, &[ours_commit, upstream_commit]) {
        Ok(index) => index.merge_bases(&ours_commit, &upstream_commit),
        Err(err) => fail_fatal(format!("build corrected-date index: {err}")),
    };
    if bases.is_empty() {
        reject(
            CliTag::ERROR,
            "fatal: refusing to rebase unrelated histories",
        );
    }

    let merge_base = bases[0];

    // Case 1: Already up-to-date
    if merge_base == upstream_commit {
        report_rebase_up_to_date(ctx.json_mode);
        return;
    }

    // Case 2: Fast-forward (ours is an ancestor of upstream)
    let hook_runner = super::git_hooks::discover(view.git_dir(), view.work_root());
    super::git_hooks::run_pre_rebase(&hook_runner, &upstream_arg, effective_branch.as_deref());

    if merge_base == ours_commit {
        execute_fast_forward_rebase(
            &view,
            ours_commit,
            upstream_commit,
            &upstream_arg,
            effective_branch.as_deref(),
            ctx.json_mode,
        );
        return;
    }

    // Case 3: True Rebase - collect commits between merge_base and ours
    let commits_to_replay = collect_replay_commits(&view, ours_commit, merge_base);
    if commits_to_replay.is_empty() {
        println!("No commits to replay. Current branch is up to date.");
        return;
    }

    let known_oids: Vec<Oid> = commits_to_replay.iter().map(|record| record.oid).collect();
    let plan = select_plan(&opts, &known_oids, &commits_to_replay, upstream_commit);
    if let Err(err) = plan.validate() {
        reject(CliTag::ERROR, err);
    }
    ensure_plan_commits_in_range(&plan, &commits_to_replay);

    if opts.interactive && ctx.json_mode {
        print_json(&serde_json::json!({
            "status": "plan_ready",
            "upstream": upstream_commit.to_hex(),
            "plan": plan,
        }));
        return;
    }

    let mut state = RebaseState {
        upstream: upstream_commit,
        head_name: effective_branch.clone(),
        orig_head: ours_commit,
        current_tip: upstream_commit,
        stopped_sha: None,
        stopped_message: None,
        done: Vec::new(),
        remaining: plan.items.clone(),
    };
    write_orig_head(view.git_dir(), ours_commit);
    persist_state(view.git_dir(), &state);

    let mut session = ReplaySession::new(&view, upstream_commit, upstream_commit);
    let (outcome, done, remaining) = session.drive(plan.items.clone());
    state.done = done;
    state.remaining = remaining;
    state.current_tip = session.current_tip;

    let context = RebaseOutcomeContext {
        from_commit: ours_commit,
        upstream_label: upstream_arg.clone(),
        branch: effective_branch.clone(),
    };
    let completed = conclude_rebase(
        &view,
        &context,
        &mut state,
        outcome,
        &session.rewritten_pairs,
    );
    if completed {
        report_rebase_completion(
            ctx.json_mode,
            plan.items.len(),
            state.current_tip,
            effective_branch.as_deref(),
        );
    }
}

fn report_rebase_up_to_date(json_mode: bool) {
    if json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "rebase",
            "status": "already_up_to_date"
        }));
    } else {
        println!("Current branch is up to date.");
    }
}

fn execute_fast_forward_rebase(
    view: &RepoView,
    ours_commit: Oid,
    upstream_commit: Oid,
    upstream_arg: &str,
    effective_branch: Option<&str>,
    json_mode: bool,
) {
    project_worktree(view, ours_commit, upstream_commit, effective_branch);
    record_rebase_op(view, upstream_commit, upstream_arg, effective_branch);
    if json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "rebase",
            "status": "fast-forward",
            "new_head": upstream_commit.to_hex(),
        }));
    } else {
        println!(
            "Fast-forwarded branch to {}",
            &upstream_commit.to_hex()[..8]
        );
    }
}

fn report_rebase_completion(
    json_mode: bool,
    replayed_count: usize,
    new_tip: Oid,
    effective_branch: Option<&str>,
) {
    if json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "rebase",
            "status": "success",
            "replayed_count": replayed_count,
            "new_head": new_tip.to_hex(),
            "branch": effective_branch,
        }));
    } else {
        println!(
            "Successfully rebased and updated refs/heads/{}.",
            effective_branch.unwrap_or("HEAD")
        );
    }
}

/// Projects the worktree, index, and references from one commit's tree onto another's.
pub(crate) fn project_worktree(
    view: &RepoView,
    from_commit: Oid,
    target_commit: Oid,
    branch: Option<&str>,
) {
    let current_files = flatten_commit_tree(view, &from_commit).unwrap_or_default();
    let (_, target_tree) = match view.resolve_tree(&target_commit.to_hex()) {
        Ok(resolved) => resolved,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let mut target_files = BTreeMap::new();
    let _ = flatten_tree_for_diff(view, &target_tree, "", &mut target_files);

    remove_stale_files(view.work_root(), &current_files, &target_files);
    let index_entries = materialize_files(view, &target_files);
    update_dirc_index(view.git_dir(), &index_entries);
    update_references(view.git_dir(), view.work_root(), target_commit, branch);
}

/// Collects the commits between the merge base and the branch tip, oldest first.
fn collect_replay_commits(view: &RepoView, ours_commit: Oid, merge_base: Oid) -> Vec<CommitRecord> {
    let all_walked = match walk_commits(view, &[ours_commit]) {
        Ok(list) => list,
        Err(err) => reject(CliTag::ERROR, err),
    };
    let mut commits_to_replay = Vec::new();
    for record in all_walked {
        if record.oid == merge_base {
            break;
        }
        commits_to_replay.push(record);
    }
    commits_to_replay.reverse();
    commits_to_replay
}

/// Builds the instruction plan from a file, stdin, or the default pick list.
fn select_plan(
    opts: &RebaseCliOptions,
    known_oids: &[Oid],
    commits: &[CommitRecord],
    upstream: Oid,
) -> RebasePlan {
    if let Some(path) = &opts.plan_file {
        let content = match fs::read_to_string(path) {
            Ok(content) => content,
            Err(err) => reject(
                CliTag::ERROR,
                format!("read plan file '{}': {err}", path.display()),
            ),
        };
        return parse_plan_text(&content, known_oids, upstream);
    }
    if opts.plan_stdin {
        let mut content = String::new();
        if let Err(err) = io::stdin().read_to_string(&mut content) {
            reject(CliTag::ERROR, format!("read rebase plan from stdin: {err}"));
        }
        return parse_plan_text(&content, known_oids, upstream);
    }

    let items: Vec<RebaseItem> = commits.iter().map(default_pick).collect();
    RebasePlan::new(upstream, items)
}

/// Parses a JSON or Git instruction-text plan and pins its upstream to the resolved commit.
fn parse_plan_text(content: &str, known_oids: &[Oid], upstream: Oid) -> RebasePlan {
    let mut plan = if content.trim_start().starts_with('{') {
        match serde_json::from_str::<RebasePlan>(content) {
            Ok(plan) => plan,
            Err(err) => reject(CliTag::ERROR, format!("parse JSON rebase plan: {err}")),
        }
    } else {
        match RebasePlan::parse_todo_text(content, known_oids) {
            Ok(items) => RebasePlan::new(upstream, items),
            Err(err) => reject(CliTag::ERROR, format!("parse todo rebase plan: {err}")),
        }
    };
    plan.upstream = upstream;
    plan
}

/// Default pick instruction for one replay commit.
fn default_pick(record: &CommitRecord) -> RebaseItem {
    RebaseItem {
        action: RebaseAction::Pick,
        commit: Some(record.oid),
        summary: record.subject().to_string(),
        new_message: None,
        command: None,
    }
}

/// Rejects a plan naming a commit that is not part of the replay range.
fn ensure_plan_commits_in_range(plan: &RebasePlan, commits: &[CommitRecord]) {
    for item in &plan.items {
        let Some(commit) = item.commit else {
            continue;
        };
        if item.action == RebaseAction::Drop {
            continue;
        }
        if !commits.iter().any(|record| record.oid == commit) {
            reject(
                CliTag::ERROR,
                format!("commit {} not in replay range", commit.to_hex()),
            );
        }
    }
}

/// Projects one commit entry list into a path-to-object-id map for the merge engine.
fn oid_map(files: &BTreeMap<String, super::tree_view::TreeEntry>) -> BTreeMap<String, Oid> {
    files
        .iter()
        .map(|(path, entry)| (path.clone(), entry.oid))
        .collect()
}

/// Builds the author signature of a replayed commit from its original provenance.
fn author_signature(record: &CommitRecord) -> GitSignature {
    GitSignature {
        name: record.author_name.clone(),
        email: record.author_mailbox.clone(),
        timestamp_sec: record.author_time,
        tz_offset: format_offset_minutes(record.author_offset_minutes),
    }
}

/// Runs an exec instruction through the platform shell in the worktree root.
fn run_shell_command(work_root: &Path, command: &str) -> bool {
    let mut shell = if cfg!(windows) {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C");
        cmd
    } else {
        let mut sh = Command::new("sh");
        sh.arg("-c");
        sh
    };
    match shell.arg(command).current_dir(work_root).status() {
        Ok(status) => status.success(),
        Err(_) => false,
    }
}

/// Records rebase operation into OperationGraph.
pub(crate) fn record_rebase_op(
    view: &RepoView,
    new_head: Oid,
    upstream: &str,
    branch_name: Option<&str>,
) {
    record_head_operation(HeadOperationSpec {
        git_dir: view.git_dir(),
        head_oid: new_head,
        branch_or_ref: branch_name,
        actor: "operator",
        command: "rebase",
        description: format!("rebase onto {upstream}"),
    });
}
