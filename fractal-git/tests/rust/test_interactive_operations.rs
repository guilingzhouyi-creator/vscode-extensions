//! Module: test_interactive_operations — Interactive Operations & Transport Integration Suite
//! File Path: tests/rust/test_interactive_operations.rs
//! Architecture Role: End-to-end integration and verification for Batch 5 components:
//!   RebasePlan & todo text codec plus plan legality, PatchPlan, Intent Blackboard v2 fine-grained
//!   AST symbol leases, RemoteTransport (MockTransport & LoopbackTransport), and the rebase
//!   stop/resume/abort state machine driven through the built taxis binary.
//! Dependencies & Triggers: Run by cargo test; the CLI cases spawn the built taxis binary and use
//!   the system git binary as the byte-level reference baseline.
//! Responsibilities: First-instruction squash/fixup rejection with zero repository change, edit stop
//!   followed by --continue, exec failure followed by --abort restoration, committer identity taken
//!   from the environment, and rewritten history equal to what system git produces for the same input.
//! Exit Semantics & Design Rationale: Every rewritten commit is compared against a scratch repository
//!   where system git performed the same rebase under the same fixed identities. Comparing object ids
//!   is stronger than re-asserting this crate's own formatting, and it catches payload drift that a
//!   structural assertion would miss.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

use fg_core::models::{
    CardBlackboard, Oid, PatchHunkChoice, PatchPlan, RebaseAction, RebaseItem, RebasePlan,
    SymbolClaim,
};
use fg_transport::remote::{LoopbackTransport, MockTransport, RemoteRef, RemoteTransport};

/// Monotonic counter keeping scratch directory names unique within one process.
static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Author identity of every commit created by the test fixtures.
const AUTHOR_NAME: &str = "Alice Author";
/// Author mailbox of every commit created by the test fixtures.
const AUTHOR_EMAIL: &str = "alice@example.com";
/// Committer identity of the commits created by the test fixtures.
const COMMITTER_NAME: &str = "Carol Committer";
/// Committer mailbox of the commits created by the test fixtures.
const COMMITTER_EMAIL: &str = "carol@example.com";

/// Subject of the first replayed commit in the branching fixture.
const SUBJECT_FIRST: &str = "feat: add bravo";

/// Subject of the second replayed commit in the branching fixture.
const SUBJECT_SECOND: &str = "feat: add charlie";

/// Creates a unique repository-shaped scratch directory.
fn scratch_repo(label: &str) -> PathBuf {
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = fs::create_dir_all(&base);
    let path = base.join(format!(
        "taxis_interactive_{}_{}_{}",
        std::process::id(),
        count,
        label
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("scratch repository");
    path
}

/// Environment that pins author and committer identity and date for a fixture commit.
fn setup_identity(date_secs: i64) -> Vec<(&'static str, String)> {
    vec![
        ("GIT_AUTHOR_NAME", AUTHOR_NAME.to_string()),
        ("GIT_AUTHOR_EMAIL", AUTHOR_EMAIL.to_string()),
        ("GIT_AUTHOR_DATE", format!("{date_secs} +0000")),
        ("GIT_COMMITTER_NAME", COMMITTER_NAME.to_string()),
        ("GIT_COMMITTER_EMAIL", COMMITTER_EMAIL.to_string()),
        ("GIT_COMMITTER_DATE", format!("{date_secs} +0000")),
    ]
}

/// Environment that pins only the committer identity, which is what a rebase consumes.
fn committer_identity(date_secs: i64) -> Vec<(&'static str, String)> {
    vec![
        ("GIT_COMMITTER_NAME", COMMITTER_NAME.to_string()),
        ("GIT_COMMITTER_EMAIL", COMMITTER_EMAIL.to_string()),
        ("GIT_COMMITTER_DATE", format!("{date_secs} +0000")),
    ]
}

/// Returns true when the host provides a `git` binary usable as an interoperability reference baseline.
fn system_git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Runs one git subcommand inside a repository and returns its captured output.
fn run_git_command(repo: &Path, args: &[&str], envs: &[(&str, String)]) -> Output {
    let mut command = Command::new("git");
    command
        .arg("-c")
        .arg("init.defaultBranch=main")
        .arg("-c")
        .arg("user.name=Taxis Test")
        .arg("-c")
        .arg("user.email=test@taxis.internal")
        .arg("-c")
        .arg("commit.gpgsign=false")
        .arg("-c")
        .arg("core.autocrlf=false")
        .args(args)
        .current_dir(repo);
    for (key, value) in envs {
        command.env(key, value);
    }
    command
        .output()
        .expect("the system git binary must be runnable")
}

/// Runs one git subcommand, failing the test when it exits non-zero.
fn run_git(repo: &Path, args: &[&str]) -> Output {
    run_git_success(repo, args, &[])
}

/// Runs one git subcommand with environment overrides, failing the test when it exits non-zero.
fn run_git_success(repo: &Path, args: &[&str], envs: &[(&str, String)]) -> Output {
    let output = run_git_command(repo, args, envs);
    assert!(
        output.status.success(),
        "git {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

/// Returns one git subcommand's stdout with the trailing newline removed.
fn git_stdout(repo: &Path, args: &[&str]) -> String {
    let output = run_git(repo, args);
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string()
}

/// Returns the first payload header line of a commit that starts with a prefix.
fn commit_header_line(repo: &Path, commit: &str, prefix: &str) -> String {
    let payload = git_stdout(repo, &["cat-file", "commit", commit]);
    payload
        .lines()
        .find(|line| line.starts_with(prefix))
        .unwrap_or("")
        .to_string()
}

/// Runs the built taxis binary inside a repository with environment overrides.
fn run_taxis_with_env(repo: &Path, args: &[&str], envs: &[(&str, String)]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_taxis"));
    command.args(args).current_dir(repo);
    for (key, value) in envs {
        command.env(key, value);
    }
    command
        .output()
        .expect("the built taxis binary must be runnable")
}

/// Writes one file, stages it, and commits it under the fixture identity.
fn commit_file(repo: &Path, path: &str, content: &str, message: &str, date_secs: i64) -> String {
    fs::write(repo.join(path), content).expect("write tracked file");
    let envs = setup_identity(date_secs);
    run_git_success(repo, &["add", path], &envs);
    run_git_success(repo, &["commit", "-q", "-m", message], &envs);
    git_stdout(repo, &["rev-parse", "HEAD"])
}

/// Deterministic seed of a history that genuinely needs a three-way replay.
///
/// main advances after feature branched, so replaying feature onto main is not a fast-forward and
/// the replayed trees must be produced by merging, exactly as Git does it.
struct SeedRepo {
    repo: PathBuf,
    upstream_tip: String,
    feature_tip: String,
    first_feature: String,
    second_feature: String,
    feature_tip_author_line: String,
}

fn seed_branching_history(label: &str) -> SeedRepo {
    let repo = scratch_repo(label);
    run_git(&repo, &["init", "-q", "."]);
    commit_file(&repo, "a.txt", "alpha\n", "init: add alpha", 1_700_000_000);
    run_git(&repo, &["checkout", "-q", "-b", "feature"]);
    let first_feature = commit_file(&repo, "b.txt", "bravo\n", SUBJECT_FIRST, 1_700_000_010);
    let second_feature = commit_file(&repo, "c.txt", "charlie\n", SUBJECT_SECOND, 1_700_000_020);
    let feature_tip = git_stdout(&repo, &["rev-parse", "HEAD"]);
    run_git(&repo, &["checkout", "-q", "main"]);
    commit_file(
        &repo,
        "d.txt",
        "delta\n",
        "chore: advance main with delta",
        1_700_000_030,
    );
    let upstream_tip = git_stdout(&repo, &["rev-parse", "HEAD"]);
    run_git(&repo, &["checkout", "-q", "feature"]);
    let feature_tip_author_line = commit_header_line(&repo, &feature_tip, "author ");
    SeedRepo {
        repo,
        upstream_tip,
        feature_tip,
        first_feature,
        second_feature,
        feature_tip_author_line,
    }
}

/// Writes a todo-format plan file inside the git directory and returns its relative name.
///
/// The plan lives under .git so it never appears as an untracked worktree file and cannot weaken
/// the cleanliness assertions that the CLI tests rely on.
fn write_plan(seed: &SeedRepo, name: &str, lines: &str) -> String {
    let relative = format!(".git/{name}");
    fs::write(seed.repo.join(&relative), lines).expect("write rebase plan");
    relative
}

/// Short form used by todo lines.
fn short(oid: &str) -> String {
    oid[..8].to_string()
}

#[test]
fn test_rebase_plan_json_and_todo_roundtrip() {
    let c1 = Oid::from_bytes([1u8; 20]);
    let c2 = Oid::from_bytes([2u8; 20]);
    let c3 = Oid::from_bytes([3u8; 20]);
    let upstream = Oid::from_bytes([9u8; 20]);

    let items = vec![
        RebaseItem {
            action: RebaseAction::Pick,
            commit: Some(c1),
            summary: "feat: add first feature".into(),
            new_message: None,
            command: None,
        },
        RebaseItem {
            action: RebaseAction::Reword,
            commit: Some(c2),
            summary: "fix: correct bug".into(),
            new_message: Some("fix: completely rewritten commit message".into()),
            command: None,
        },
        RebaseItem {
            action: RebaseAction::Squash,
            commit: Some(c3),
            summary: "test: add tests for fix".into(),
            new_message: None,
            command: None,
        },
        RebaseItem {
            action: RebaseAction::Exec,
            commit: None,
            summary: "make test".into(),
            new_message: None,
            command: Some("make test".into()),
        },
    ];

    let plan = RebasePlan::new(upstream, items);

    // 1. JSON Serde Roundtrip
    let json_str = serde_json::to_string_pretty(&plan).expect("Serialize plan to JSON");
    let deserialized: RebasePlan =
        serde_json::from_str(&json_str).expect("Deserialize plan from JSON");
    assert_eq!(plan, deserialized);

    // 2. Todo Text Format & Parse Roundtrip
    let todo_text = plan.format_todo_text();
    assert!(todo_text.contains("pick 0101010 feat: add first feature"));
    assert!(todo_text.contains("reword 0202020 fix: correct bug"));
    assert!(todo_text.contains("squash 0303030 test: add tests for fix"));
    assert!(todo_text.contains("exec make test"));
    assert!(todo_text.contains("# x, exec <command>"));

    let known_commits = vec![c1, c2, c3];
    let parsed_items =
        RebasePlan::parse_todo_text(&todo_text, &known_commits).expect("Parse todo text");
    assert_eq!(parsed_items.len(), 4);
    assert_eq!(parsed_items[0].action, RebaseAction::Pick);
    assert_eq!(parsed_items[0].commit, Some(c1));
    assert_eq!(parsed_items[1].action, RebaseAction::Reword);
    assert_eq!(parsed_items[1].commit, Some(c2));
    assert_eq!(parsed_items[1].new_message, None);
    assert_eq!(parsed_items[2].action, RebaseAction::Squash);
    assert_eq!(parsed_items[2].commit, Some(c3));
    assert_eq!(parsed_items[3].action, RebaseAction::Exec);
    assert_eq!(parsed_items[3].commit, None);
    assert_eq!(parsed_items[3].command.as_deref(), Some("make test"));
}

#[test]
fn test_rebase_plan_legality_rejects_unexecutable_instructions() {
    let c1 = Oid::from_bytes([1u8; 20]);
    let c2 = Oid::from_bytes([2u8; 20]);
    let upstream = Oid::from_bytes([9u8; 20]);

    let pick = |commit: Oid| RebaseItem {
        action: RebaseAction::Pick,
        commit: Some(commit),
        summary: String::new(),
        new_message: None,
        command: None,
    };

    // Empty plan.
    let empty = RebasePlan::new(upstream, Vec::new());
    let empty_error = empty.validate().expect_err("empty plan must be rejected");
    assert!(empty_error.to_string().contains("no instructions"));

    // A first squash/fixup has no previous commit to meld into; Git refuses it and a replay that
    // accepted it would build a parentless root commit inside the replayed range.
    let mut squash_first = pick(c2);
    squash_first.action = RebaseAction::Squash;
    let squash_plan = RebasePlan::new(upstream, vec![squash_first]);
    let squash_error = squash_plan
        .validate()
        .expect_err("first squash must be rejected");
    assert!(squash_error
        .to_string()
        .contains("cannot 'squash' without a previous commit"));

    let mut fixup_first = pick(c2);
    fixup_first.action = RebaseAction::Fixup;
    let fixup_plan = RebasePlan::new(upstream, vec![fixup_first]);
    let fixup_error = fixup_plan
        .validate()
        .expect_err("first fixup must be rejected");
    assert!(fixup_error
        .to_string()
        .contains("cannot 'fixup' without a previous commit"));

    // Reword without a replacement message cannot be replayed deterministically.
    let mut reword = pick(c1);
    reword.action = RebaseAction::Reword;
    let reword_error = RebasePlan::new(upstream, vec![reword]).validate();
    assert!(reword_error.is_err());
    assert!(
        format!("{}", reword_error.expect_err("reword needs message"))
            .contains("requires a new message")
    );

    // Exec without a command used to degrade into a pick.
    let silent_exec = RebaseItem {
        action: RebaseAction::Exec,
        commit: None,
        summary: String::new(),
        new_message: None,
        command: Some("   ".into()),
    };
    let exec_error = RebasePlan::new(upstream, vec![silent_exec]).validate();
    assert!(exec_error.is_err());
    assert!(format!("{}", exec_error.expect_err("exec needs command"))
        .contains("exec requires a command"));

    // A commit step must not smuggle an exec command, and must name a commit.
    let mut smuggled = pick(c1);
    smuggled.command = Some("make test".into());
    assert!(RebasePlan::new(upstream, vec![smuggled])
        .validate()
        .is_err());

    let commitless = RebaseItem {
        action: RebaseAction::Pick,
        commit: None,
        summary: "ghost".into(),
        new_message: None,
        command: None,
    };
    assert!(RebasePlan::new(upstream, vec![commitless])
        .validate()
        .is_err());

    // A legal plan validates, and the checked constructor accepts exactly the same plans.
    let legal = RebasePlan::new(upstream, vec![pick(c1), pick(c2)]);
    assert!(legal.validate().is_ok());
    assert!(RebasePlan::validated(upstream, vec![pick(c1), pick(c2)]).is_ok());
}

#[test]
fn test_rebase_plan_deserializes_legacy_json_without_command_field() {
    let c1 = Oid::from_bytes([1u8; 20]);
    let upstream = Oid::from_bytes([9u8; 20]);

    // Plans written before exec carried a command field must keep loading: commit stays a plain hex
    // string, command and new_message are missing.
    let legacy_json = format!(
        "{{\"upstream\":\"{}\",\"items\":[{{\"action\":\"pick\",\"commit\":\"{}\",\"summary\":\"legacy pick\"}}]}}",
        upstream.to_hex(),
        c1.to_hex()
    );
    let plan: RebasePlan =
        serde_json::from_str(&legacy_json).expect("legacy plan must deserialize");
    assert_eq!(plan.items.len(), 1);
    assert_eq!(plan.items[0].commit, Some(c1));
    assert_eq!(plan.items[0].command, None);
    assert_eq!(plan.items[0].new_message, None);
    assert!(plan.validate().is_ok());
}

#[test]
fn test_patch_plan_and_choices() {
    assert_eq!(PatchHunkChoice::parse("y"), Some(PatchHunkChoice::Yes));
    assert_eq!(PatchHunkChoice::parse("n"), Some(PatchHunkChoice::No));
    assert_eq!(PatchHunkChoice::parse("q"), Some(PatchHunkChoice::Quit));
    assert_eq!(PatchHunkChoice::parse("e"), Some(PatchHunkChoice::Edit));
    assert_eq!(PatchHunkChoice::parse("s"), Some(PatchHunkChoice::Split));

    let plan = PatchPlan {
        file_path: "crates/fg-storage/src/repack.rs".into(),
        hunk_decisions: vec![
            PatchHunkChoice::Yes,
            PatchHunkChoice::No,
            PatchHunkChoice::Yes,
        ],
    };

    let json = serde_json::to_string(&plan).expect("Serialize patch plan");
    let deserialized: PatchPlan = serde_json::from_str(&json).expect("Deserialize patch plan");
    assert_eq!(plan, deserialized);
}

#[test]
fn test_intent_blackboard_v2_ast_symbol_leases() {
    let mut board = CardBlackboard::new("cell-infra", "card-100");
    let now_ms = 1_000_000i64;

    // 1. Agent 1 claims the function compute_checksum in hasher.rs
    let lease1 = board
        .claim_symbol(
            SymbolClaim::new("agent-01", "src/hasher.rs", "compute_checksum", 300, now_ms)
                .with_symbol("compute_checksum", Some("Function")),
        )
        .expect("Claim function lease");
    assert_eq!(lease1.agent_uid, "agent-01");

    // 2. Agent 2 claims a DIFFERENT symbol format_output in the SAME file hasher.rs.
    // This MUST succeed under Blackboard v2 fine-grained AST symbol leases.
    let lease2 = board
        .claim_symbol(
            SymbolClaim::new("agent-02", "src/hasher.rs", "format_output", 300, now_ms)
                .with_symbol("format_output", Some("Function")),
        )
        .expect("Claim disjoint function lease in same file");
    assert_eq!(lease2.agent_uid, "agent-02");

    // 3. Agent 3 attempts to claim the SAME symbol compute_checksum.
    // This MUST collide with Agent 1.
    let collision = board
        .claim_symbol(
            SymbolClaim::new("agent-03", "src/hasher.rs", "compute_checksum", 300, now_ms)
                .with_symbol("compute_checksum", Some("Function")),
        )
        .expect_err("Collision on identical symbol");
    assert_eq!(collision.conflicting_agent, "agent-01");

    // 4. Whole-file claim (the wildcard symbol) must collide with existing symbol leases.
    let file_collision = board
        .claim_symbol(SymbolClaim::new(
            "agent-04",
            "src/hasher.rs",
            "*",
            300,
            now_ms,
        ))
        .expect_err("Whole-file claim collides with symbol leases");
    assert_eq!(file_collision.file_path, "src/hasher.rs");

    // 5. Release lease1 and verify compute_checksum is now claimable.
    assert!(board.release(&lease1.lease_id));
    let lease3 = board
        .claim_symbol(
            SymbolClaim::new("agent-03", "src/hasher.rs", "compute_checksum", 300, now_ms)
                .with_symbol("compute_checksum", Some("Function")),
        )
        .expect("Claim freed symbol");
    assert_eq!(lease3.agent_uid, "agent-03");
}

#[test]
fn test_remote_transport_mock_and_loopback() {
    let commit1 = Oid::from_bytes([10u8; 20]);
    let commit2 = Oid::from_bytes([20u8; 20]);

    // 1. MockTransport
    let mut mock = MockTransport::new("mock://origin")
        .with_refs(vec![RemoteRef {
            name: "refs/heads/main".into(),
            target: commit1,
        }])
        .with_fetch_payload(b"PACK_DUMMY_PAYLOAD".to_vec());

    assert_eq!(mock.url(), "mock://origin");
    let refs = mock.list_refs().expect("List mock refs");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].name, "refs/heads/main");

    let push_res = mock
        .push(
            &[("refs/heads/feature".into(), commit2, None)],
            Some(b"PACK_DATA"),
        )
        .expect("Push to mock");
    assert_eq!(push_res.len(), 1);
    assert!(push_res[0].1.is_ok());
    assert_eq!(mock.recorded_pushes.len(), 1);

    let fetch_bytes = mock.fetch(&[commit1], &[]).expect("Fetch from mock");
    assert_eq!(fetch_bytes, b"PACK_DUMMY_PAYLOAD");

    // 2. LoopbackTransport with atomic CAS validation
    let mut loopback = LoopbackTransport::new("loopback://peer");
    loopback.set_ref("refs/heads/main", commit1);

    // Initial ref state
    assert_eq!(loopback.get_ref("refs/heads/main"), Some(commit1));

    // Successful fast-forward push with matching expected old OID
    let push_ok = loopback
        .push(
            &[("refs/heads/main".into(), commit2, Some(commit1))],
            Some(b"PACK_V2_LOOPBACK"),
        )
        .expect("CAS push");
    assert_eq!(push_ok[0].1, Ok(()));
    assert_eq!(loopback.get_ref("refs/heads/main"), Some(commit2));

    // Stored pack can be fetched
    let fetched = loopback
        .fetch(&[commit2], &[commit1])
        .expect("Fetch loopback");
    assert_eq!(fetched, b"PACK_V2_LOOPBACK");

    // Rejected non-fast-forward push with stale expected old OID
    let stale_commit = Oid::from_bytes([99u8; 20]);
    let push_stale = loopback
        .push(
            &[("refs/heads/main".into(), commit1, Some(stale_commit))],
            None,
        )
        .expect("Push call succeeds but report indicates failure");
    assert!(push_stale[0].1.is_err());
    // Ref unchanged
    assert_eq!(loopback.get_ref("refs/heads/main"), Some(commit2));
}

#[test]
fn test_first_squash_or_fixup_rejected_before_any_repository_change() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let seed = seed_branching_history("reject_first_squash");
    let before_head = git_stdout(&seed.repo, &["rev-parse", "HEAD"]);
    assert_eq!(before_head, seed.feature_tip);
    let before_status = git_stdout(&seed.repo, &["status", "--porcelain"]);
    assert!(before_status.is_empty());

    let squash_plan = write_plan(
        &seed,
        "squash-plan.txt",
        &format!(
            "squash {} {}\npick {} {}\n",
            short(&seed.first_feature),
            SUBJECT_FIRST,
            short(&seed.second_feature),
            SUBJECT_SECOND
        ),
    );
    let rejected = run_taxis_with_env(
        &seed.repo,
        &["rebase", "--plan", &squash_plan, "main"],
        &committer_identity(1_700_000_500),
    );
    assert_eq!(rejected.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&rejected.stderr);
    assert!(
        stderr.contains("cannot 'squash' without a previous commit"),
        "unexpected stderr: {stderr}"
    );

    // Zero repository change: no tip movement, no state directory, no ORIG_HEAD, clean worktree.
    assert_eq!(git_stdout(&seed.repo, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(git_stdout(&seed.repo, &["status", "--porcelain"]), "");
    assert!(!seed.repo.join(".git").join("ORIG_HEAD").exists());
    assert!(!seed.repo.join(".git").join("rebase-merge").exists());
    assert_eq!(
        git_stdout(&seed.repo, &["rev-parse", "feature"]),
        before_head
    );

    let fixup_plan = write_plan(
        &seed,
        "fixup-plan.txt",
        &format!(
            "fixup {} {}\npick {} {}\n",
            short(&seed.first_feature),
            SUBJECT_FIRST,
            short(&seed.second_feature),
            SUBJECT_SECOND
        ),
    );
    let rejected_fixup = run_taxis_with_env(
        &seed.repo,
        &["rebase", "--plan", &fixup_plan, "main"],
        &committer_identity(1_700_000_500),
    );
    assert_eq!(rejected_fixup.status.code(), Some(1));
    let stderr_fixup = String::from_utf8_lossy(&rejected_fixup.stderr);
    assert!(
        stderr_fixup.contains("cannot 'fixup' without a previous commit"),
        "unexpected stderr: {stderr_fixup}"
    );
    assert_eq!(git_stdout(&seed.repo, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(git_stdout(&seed.repo, &["status", "--porcelain"]), "");
    assert!(!seed.repo.join(".git").join("rebase-merge").exists());
}

#[test]
fn test_edit_stop_then_continue_matches_system_git() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let seed = seed_branching_history("edit_continue");
    let baseline = seed_branching_history("edit_continue_baseline");
    let committer = committer_identity(1_700_000_500);
    let plan_name = write_plan(
        &seed,
        "edit-plan.txt",
        &format!(
            "edit {} {}\npick {} {}\n",
            short(&seed.first_feature),
            SUBJECT_FIRST,
            short(&seed.second_feature),
            SUBJECT_SECOND
        ),
    );

    let stop = run_taxis_with_env(
        &seed.repo,
        &["rebase", "--plan", &plan_name, "main"],
        &committer,
    );
    assert!(
        stop.status.success(),
        "edit stop failed: {}{}",
        String::from_utf8_lossy(&stop.stdout),
        String::from_utf8_lossy(&stop.stderr)
    );
    let stop_stdout = String::from_utf8_lossy(&stop.stdout);
    assert!(stop_stdout.contains("Stopped at"), "stdout: {stop_stdout}");
    assert!(stop_stdout.contains("taxis rebase --continue"));

    let state_dir = seed.repo.join(".git").join("rebase-merge");
    assert!(
        state_dir.is_dir(),
        "rebase state directory must be persisted"
    );
    let stopped_head = git_stdout(&seed.repo, &["rev-parse", "HEAD"]);
    assert_ne!(stopped_head, seed.first_feature);
    assert_eq!(
        git_stdout(&seed.repo, &["rev-parse", "HEAD^"]),
        seed.upstream_tip
    );
    assert_eq!(
        commit_header_line(&seed.repo, &stopped_head, "author "),
        commit_header_line(&seed.repo, &seed.first_feature, "author ")
    );
    assert_eq!(
        git_stdout(&seed.repo, &["show", "-s", "--format=%s", "HEAD"]),
        SUBJECT_FIRST
    );
    assert_eq!(
        fs::read_to_string(state_dir.join("head-name"))
            .expect("read head-name")
            .trim(),
        "refs/heads/feature"
    );
    assert_eq!(
        fs::read_to_string(state_dir.join("orig-head"))
            .expect("read orig-head")
            .trim(),
        seed.feature_tip
    );
    assert_eq!(
        fs::read_to_string(state_dir.join("onto"))
            .expect("read onto")
            .trim(),
        seed.upstream_tip
    );
    let todo = fs::read_to_string(state_dir.join("git-rebase-todo")).expect("read todo");
    // Git writes todo instructions with seven-character abbreviations.
    assert!(todo.contains(&format!("pick {}", &seed.second_feature[..7])));
    let done = fs::read_to_string(state_dir.join("done")).expect("read done");
    assert!(done.contains(&format!("edit {}", &seed.first_feature[..7])));
    assert_eq!(
        fs::read_to_string(state_dir.join("stopped-sha"))
            .expect("read stopped-sha")
            .trim(),
        stopped_head
    );

    // Continue in a fresh process: the remaining pick must be replayed onto the stopped tip.
    let resumed = run_taxis_with_env(&seed.repo, &["rebase", "--continue"], &committer);
    assert!(
        resumed.status.success(),
        "continue failed: {}{}",
        String::from_utf8_lossy(&resumed.stdout),
        String::from_utf8_lossy(&resumed.stderr)
    );
    assert!(String::from_utf8_lossy(&resumed.stdout).contains("Successfully rebased"));
    assert!(!state_dir.exists());
    assert_eq!(git_stdout(&seed.repo, &["status", "--porcelain"]), "");

    // Reference baseline: system git performs the same rebase (no edit stop) under the same committer identity.
    run_git_success(&baseline.repo, &["rebase", "main"], &committer);
    assert_eq!(
        git_stdout(&seed.repo, &["rev-parse", "HEAD"]),
        git_stdout(&baseline.repo, &["rev-parse", "HEAD"])
    );
    assert_eq!(
        git_stdout(&seed.repo, &["rev-parse", "HEAD^"]),
        git_stdout(&baseline.repo, &["rev-parse", "HEAD^"])
    );
    let log_format = "--format=%H|%T|%P|%an|%ae|%at|%cn|%ce|%ct|%s";
    assert_eq!(
        git_stdout(&seed.repo, &["log", "-2", log_format]),
        git_stdout(&baseline.repo, &["log", "-2", log_format])
    );
    assert_eq!(
        git_stdout(&seed.repo, &["cat-file", "commit", "HEAD"]),
        git_stdout(&baseline.repo, &["cat-file", "commit", "HEAD"])
    );
    assert_eq!(
        commit_header_line(&seed.repo, "HEAD", "author "),
        commit_header_line(&baseline.repo, &baseline.feature_tip, "author ")
    );
}

#[test]
fn test_exec_failure_then_abort_restores_original_tip() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let seed = seed_branching_history("exec_abort");
    let committer = committer_identity(1_700_000_500);
    let failing_command = if cfg!(windows) { "exit /b 3" } else { "exit 3" };
    let plan_name = write_plan(
        &seed,
        "exec-plan.txt",
        &format!(
            "pick {} {}\nexec {}\npick {} {}\n",
            short(&seed.first_feature),
            SUBJECT_FIRST,
            failing_command,
            short(&seed.second_feature),
            SUBJECT_SECOND
        ),
    );

    let failed = run_taxis_with_env(
        &seed.repo,
        &["rebase", "--plan", &plan_name, "main"],
        &committer,
    );
    assert_eq!(failed.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&failed.stderr);
    assert!(stderr.contains("Execution failed"), "stderr: {stderr}");
    assert!(stderr.contains("taxis rebase --continue"));
    assert!(stderr.contains("taxis rebase --abort"));
    assert!(seed.repo.join(".git").join("rebase-merge").is_dir());
    // The pick before the failing exec was already applied, so the tip moved.
    assert_ne!(
        git_stdout(&seed.repo, &["rev-parse", "HEAD"]),
        seed.feature_tip
    );

    let aborted = run_taxis_with_env(&seed.repo, &["rebase", "--abort"], &committer);
    assert!(
        aborted.status.success(),
        "abort failed: {}{}",
        String::from_utf8_lossy(&aborted.stdout),
        String::from_utf8_lossy(&aborted.stderr)
    );
    assert!(String::from_utf8_lossy(&aborted.stdout).contains("Rebase aborted."));

    // Full restoration: tip, branch, worktree, index, and no residual state.
    assert_eq!(
        git_stdout(&seed.repo, &["rev-parse", "HEAD"]),
        seed.feature_tip
    );
    assert_eq!(
        git_stdout(&seed.repo, &["rev-parse", "feature"]),
        seed.feature_tip
    );
    assert_eq!(git_stdout(&seed.repo, &["status", "--porcelain"]), "");
    assert!(!seed.repo.join(".git").join("rebase-merge").exists());
    assert_eq!(
        fs::read_to_string(seed.repo.join("b.txt")).expect("read b.txt"),
        "bravo\n"
    );
    assert_eq!(
        fs::read_to_string(seed.repo.join("c.txt")).expect("read c.txt"),
        "charlie\n"
    );
    assert_eq!(
        fs::read_to_string(seed.repo.join(".git").join("ORIG_HEAD"))
            .expect("read ORIG_HEAD")
            .trim(),
        seed.feature_tip
    );
}

#[test]
fn test_committer_identity_from_environment_matches_system_git() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let seed = seed_branching_history("committer_env");
    let baseline = seed_branching_history("committer_env_baseline");
    // A non-UTC zone proves the offset is carried through instead of being normalized to +0000.
    let committer = vec![
        ("GIT_COMMITTER_NAME", "Release Bot".to_string()),
        ("GIT_COMMITTER_EMAIL", "release@example.com".to_string()),
        ("GIT_COMMITTER_DATE", "@1700000900 +0530".to_string()),
    ];

    let rebased = run_taxis_with_env(&seed.repo, &["rebase", "main"], &committer);
    assert!(
        rebased.status.success(),
        "rebase failed: {}{}",
        String::from_utf8_lossy(&rebased.stdout),
        String::from_utf8_lossy(&rebased.stderr)
    );
    let head = git_stdout(&seed.repo, &["rev-parse", "HEAD"]);
    let committer_line = commit_header_line(&seed.repo, &head, "committer ");
    assert_eq!(
        committer_line,
        "committer Release Bot <release@example.com> 1700000900 +0530"
    );
    // Author provenance is preserved verbatim, including the original author time and zone.
    assert_eq!(
        commit_header_line(&seed.repo, &head, "author "),
        seed.feature_tip_author_line
    );

    // Byte-level baseline: git rebase under the same environment produces the same commit ids.
    run_git_success(&baseline.repo, &["rebase", "main"], &committer);
    assert_eq!(head, git_stdout(&baseline.repo, &["rev-parse", "HEAD"]));
    assert_eq!(
        git_stdout(&seed.repo, &["rev-parse", "HEAD^"]),
        git_stdout(&baseline.repo, &["rev-parse", "HEAD^"])
    );
}
