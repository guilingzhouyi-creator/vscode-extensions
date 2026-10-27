//! Module: test_git_hooks — Git Hook Contract Runner Integration Tests
//! File Path: tests/rust/test_git_hooks.rs
//! Architecture Role: Verifies that the fg-gate Git hook runner resolves hook locations like Git,
//!   forwards arguments, stdin, working directory, and environment, and interprets exit codes
//!   fail-closed for pre-operation hooks.
//! Dependencies & Triggers: Executed by cargo test in the fractal-git workspace.
//! Responsibilities: Covering missing, passing, blocking, and core.hooksPath-discovered hooks.
//! Exit Semantics & Design Rationale: Panics on any assertion failure, matching cargo test
//!   conventions; every fixture lives in an isolated temporary directory.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use std::time::{Duration, Instant};

use fractal_git::{GitHookRunner, GitHookStatus, OdbStore, RefStore};

/// Writes a hook script with LF endings and an executable bit where the platform needs one.
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

/// Builds a repository skeleton with an empty `.git/hooks` directory.
fn bootstrap_repo() -> (tempfile::TempDir, std::path::PathBuf) {
    let fixture_root =
        std::path::PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("git-hook-runner");
    fs::create_dir_all(&fixture_root).expect("create fixture root");
    let repository = tempfile::Builder::new()
        .prefix("hook-runner-")
        .tempdir_in(&fixture_root)
        .expect("create temporary repository");
    let git_dir = repository.path().join(".git");
    fs::create_dir_all(git_dir.join("hooks")).expect("create hooks directory");
    fs::write(
        git_dir.join("config"),
        "[core]\n\trepositoryformatversion = 0\n\tbare = false\n",
    )
    .expect("write repository config");
    (repository, git_dir)
}

/// Returns an environment map pointing marker outputs into the fixture directory.
fn marker_environment(marker: &Path) -> BTreeMap<String, String> {
    let mut envs = BTreeMap::new();
    envs.insert(
        "TAXIS_HOOK_MARKER".to_string(),
        marker.to_string_lossy().to_string(),
    );
    envs
}

#[test]
fn missing_hook_never_blocks_the_operation() {
    let (repository, git_dir) = bootstrap_repo();
    let runner = GitHookRunner::discover(repository.path(), &git_dir);

    let outcome = runner.run("pre-commit", &[], None, &BTreeMap::new());

    assert_eq!(outcome.status, GitHookStatus::Missing);
    assert!(!outcome.is_blocked());
    assert_eq!(outcome.exit_code(), 0);
    assert!(!runner.is_installed("pre-commit"));
}

#[test]
fn passing_hook_receives_arguments_and_the_worktree_cwd() {
    if !GitHookRunner::has_working_shell() {
        return;
    }
    let (repository, git_dir) = bootstrap_repo();
    write_hook(
        &git_dir.join("hooks").join("commit-msg"),
        "#!/bin/sh\nprintf 'cwd-ok' > cwd-probe.txt\nprintf '%s' \"$1\" > \"$TAXIS_HOOK_MARKER\"\n",
    );
    let marker = repository.path().join("args.txt");
    let runner = GitHookRunner::discover(repository.path(), &git_dir);

    let outcome = runner.run(
        "commit-msg",
        &["COMMIT_EDITMSG".to_string()],
        None,
        &marker_environment(&marker),
    );

    assert_eq!(outcome.status, GitHookStatus::Passed);
    assert!(runner.is_installed("commit-msg"));
    assert!(repository.path().join("cwd-probe.txt").is_file());
    assert_eq!(
        fs::read_to_string(marker).expect("read marker"),
        "COMMIT_EDITMSG"
    );
}

#[test]
fn hook_stdin_is_forwarded_verbatim() {
    if !GitHookRunner::has_working_shell() {
        return;
    }
    let (repository, git_dir) = bootstrap_repo();
    write_hook(
        &git_dir.join("hooks").join("pre-push"),
        "#!/bin/sh\ncat > \"$TAXIS_HOOK_MARKER\"\n",
    );
    let marker = repository.path().join("stdin.txt");
    let runner = GitHookRunner::discover(repository.path(), &git_dir);

    let outcome = runner.run(
        "pre-push",
        &[],
        Some("refs/heads/main 1111111111111111111111111111111111111111\n"),
        &marker_environment(&marker),
    );

    assert_eq!(outcome.status, GitHookStatus::Passed);
    assert_eq!(
        fs::read_to_string(marker).expect("read stdin marker"),
        "refs/heads/main 1111111111111111111111111111111111111111\n"
    );
}

#[test]
fn non_zero_hook_exit_blocks_and_captures_stderr() {
    if !GitHookRunner::has_working_shell() {
        return;
    }
    let (repository, git_dir) = bootstrap_repo();
    write_hook(
        &git_dir.join("hooks").join("pre-commit"),
        "#!/bin/sh\necho 'gate says no' >&2\nexit 7\n",
    );
    let runner = GitHookRunner::discover(repository.path(), &git_dir);

    let outcome = runner.run("pre-commit", &[], None, &BTreeMap::new());

    assert_eq!(outcome.status, GitHookStatus::Blocked { exit_code: 7 });
    assert!(outcome.is_blocked());
    assert_eq!(outcome.exit_code(), 7);
    assert!(outcome.stderr.contains("gate says no"));
    assert!(outcome.describe().contains("status 7"));
}

#[test]
fn core_hooks_path_overrides_the_default_hooks_directory() {
    if !GitHookRunner::has_working_shell() {
        return;
    }
    let (repository, git_dir) = bootstrap_repo();
    fs::write(
        git_dir.join("config"),
        "[core]\n\thooksPath = custom-hooks\n",
    )
    .expect("write config with hooksPath");
    write_hook(
        &repository.path().join("custom-hooks").join("pre-commit"),
        "#!/bin/sh\nprintf 'discovered' > \"$TAXIS_HOOK_MARKER\"\n",
    );
    let marker = repository.path().join("discovery.txt");
    let runner = GitHookRunner::discover(repository.path(), &git_dir);

    assert_eq!(runner.hooks_dir(), repository.path().join("custom-hooks"));

    let outcome = runner.run("pre-commit", &[], None, &marker_environment(&marker));

    assert_eq!(outcome.status, GitHookStatus::Passed);
    assert_eq!(
        fs::read_to_string(marker).expect("read marker"),
        "discovered"
    );
    assert!(
        !runner.is_installed("commit-msg"),
        "the default .git/hooks directory must stop being consulted"
    );
}

#[test]
fn hook_environment_follows_the_git_contract() {
    if !GitHookRunner::has_working_shell() {
        return;
    }
    let (repository, git_dir) = bootstrap_repo();
    let nested = repository.path().join("nested");
    fs::create_dir_all(&nested).expect("create nested directory");
    write_hook(
        &git_dir.join("hooks").join("pre-commit"),
        "#!/bin/sh\nenv | sort > \"$TAXIS_HOOK_MARKER\"\n",
    );
    let marker = repository.path().join("environment.txt");
    let runner = GitHookRunner::discover(repository.path(), &git_dir);
    let previous_directory = std::env::current_dir().expect("read current directory");

    std::env::set_current_dir(&nested).expect("enter nested directory");
    let outcome = runner.run("pre-commit", &[], None, &marker_environment(&marker));
    std::env::set_current_dir(&previous_directory).expect("restore current directory");

    assert_eq!(outcome.status, GitHookStatus::Passed);
    let environment = fs::read_to_string(marker).expect("read environment dump");
    assert!(
        !environment.contains("GIT_DIR="),
        "hooks must not inherit GIT_DIR"
    );
    assert!(
        !environment.contains("GIT_WORK_TREE="),
        "hooks must not inherit GIT_WORK_TREE"
    );
    assert!(
        environment.contains("GIT_PREFIX=nested/"),
        "a subdirectory invocation must export GIT_PREFIX, dump was: {environment}"
    );
}

#[test]
fn core_taxishooks_false_disables_hook_execution() {
    let (repository, git_dir) = bootstrap_repo();
    fs::write(
        git_dir.join("config"),
        "[core]\n\trepositoryformatversion = 0\n\tbare = false\n\thooksPath = custom-hooks\n\ttaxishooks = false\n",
    )
    .expect("write config disabling hooks");
    write_hook(
        &repository.path().join("custom-hooks").join("pre-commit"),
        "#!/bin/sh\nprintf 'should-not-run' > \"$TAXIS_HOOK_MARKER\"\n",
    );
    let marker = repository.path().join("disabled.txt");
    let runner = GitHookRunner::discover(repository.path(), &git_dir);

    assert!(
        !runner.config().enabled,
        "core.taxishooks must disable hooks"
    );

    let outcome = runner.run("pre-commit", &[], None, &marker_environment(&marker));

    assert_eq!(outcome.status, GitHookStatus::Missing);
    assert!(!outcome.is_blocked());
    assert!(!marker.exists(), "a disabled hook must not execute");
}

#[test]
fn hook_timeout_is_read_from_config_and_never_blocks() {
    if !GitHookRunner::has_working_shell() {
        return;
    }
    let (repository, git_dir) = bootstrap_repo();
    fs::write(
        git_dir.join("config"),
        "[core]\n\trepositoryformatversion = 0\n\tbare = false\n\ttaxishooktimeout = 120\n",
    )
    .expect("write config with a hook budget");
    write_hook(
        &git_dir.join("hooks").join("pre-commit"),
        "#!/bin/sh\nsleep 2\n",
    );
    let runner = GitHookRunner::discover(repository.path(), &git_dir);
    assert_eq!(runner.config().timeout, Duration::from_millis(120));
    assert!(runner.config().enabled);

    let started = Instant::now();
    let outcome = runner.run("pre-commit", &[], None, &BTreeMap::new());
    let elapsed = started.elapsed();

    assert!(
        matches!(outcome.status, GitHookStatus::TimedOut { .. }),
        "an over-budget hook must report TimedOut, got {:?}",
        outcome.status
    );
    assert!(!outcome.is_blocked());
    assert_eq!(outcome.exit_code(), 0);
    assert!(
        elapsed < Duration::from_millis(2500),
        "the budget must terminate the hook promptly, took {elapsed:?}"
    );
}

fn run_taxis(repo: &Path, args: &[&str]) -> std::process::Output {
    std::process::Command::new(env!("CARGO_BIN_EXE_taxis"))
        .current_dir(repo)
        .args(args)
        .output()
        .expect("the built taxis binary must be runnable")
}

#[test]
fn test_reference_transaction_blocks_branch_creation() {
    if !GitHookRunner::has_working_shell() {
        return;
    }
    let (repository, git_dir) = bootstrap_repo();
    let hook_path = git_dir.join("hooks").join("reference-transaction");
    write_hook(
        &hook_path,
        "#!/bin/sh\n\
         while read -r old new ref; do\n\
           case \"$ref\" in\n\
             *blocked-branch*) exit 1 ;;\n\
           esac\n\
         done\n\
         exit 0\n",
    );

    // Initial commit so HEAD exists
    let seed_file = repository.path().join("seed.txt");
    fs::write(&seed_file, b"seed payload\n").expect("write seed");
    fs::create_dir_all(git_dir.join("objects")).expect("create objects directory");
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("write HEAD");

    // Create a seed commit directly in refs/heads/main
    let ref_store = fractal_git::DiskRefStore::new(&git_dir);
    let odb = fractal_git::LooseOdb::new(&git_dir);
    let dummy_tree = odb.write_object("tree", b"").expect("write dummy tree");
    let sig = fractal_git::GitSignature::new("Tester", "test@company.com", 1700000000);
    let commit = fractal_git::GitCommit::new(
        dummy_tree,
        vec![],
        sig.clone(),
        sig,
        "feat(core): seed\n",
        None,
    );
    let commit_payload = fg_storage::commit_materializer::serialize_commit_payload(&commit);
    let commit_oid = odb
        .write_object("commit", &commit_payload)
        .expect("write dummy commit");
    let _ = ref_store.update_ref("refs/heads/main", &commit_oid, None);

    // Now attempt to branch with blocked name
    let blocked_out = run_taxis(repository.path(), &["branch", "blocked-branch"]);
    assert!(
        !blocked_out.status.success(),
        "branch creation must fail when blocked by reference-transaction hook"
    );
    let stderr = String::from_utf8_lossy(&blocked_out.stderr);
    assert!(
        stderr.contains("reference-transaction hook blocked"),
        "stderr must report reference-transaction hook blockage: {stderr}"
    );

    // Assert ref was NOT written
    let check_ref = ref_store
        .get_ref("refs/heads/blocked-branch")
        .ok()
        .flatten();
    assert!(
        check_ref.is_none(),
        "blocked branch ref must not exist on disk"
    );
}

#[test]
fn test_reference_transaction_blocks_tag_creation() {
    if !GitHookRunner::has_working_shell() {
        return;
    }
    let (repository, git_dir) = bootstrap_repo();
    let hook_path = git_dir.join("hooks").join("reference-transaction");
    write_hook(
        &hook_path,
        "#!/bin/sh\n\
         while read -r old new ref; do\n\
           case \"$ref\" in\n\
             *blocked-tag*) exit 1 ;;\n\
           esac\n\
         done\n\
         exit 0\n",
    );

    fs::create_dir_all(git_dir.join("objects")).expect("create objects directory");
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("write HEAD");

    let ref_store = fractal_git::DiskRefStore::new(&git_dir);
    let odb = fractal_git::LooseOdb::new(&git_dir);
    let dummy_tree = odb.write_object("tree", b"").expect("write dummy tree");
    let sig = fractal_git::GitSignature::new("Tester", "test@company.com", 1700000000);
    let commit = fractal_git::GitCommit::new(
        dummy_tree,
        vec![],
        sig.clone(),
        sig,
        "feat(core): seed\n",
        None,
    );
    let commit_payload = fg_storage::commit_materializer::serialize_commit_payload(&commit);
    let commit_oid = odb
        .write_object("commit", &commit_payload)
        .expect("write dummy commit");
    let _ = ref_store.update_ref("refs/heads/main", &commit_oid, None);

    let blocked_out = run_taxis(repository.path(), &["tag", "blocked-tag", "main"]);
    assert!(
        !blocked_out.status.success(),
        "tag creation must fail when blocked by reference-transaction hook"
    );

    let check_ref = ref_store.get_ref("refs/tags/blocked-tag").ok().flatten();
    assert!(
        check_ref.is_none(),
        "blocked tag ref must not exist on disk"
    );
}
