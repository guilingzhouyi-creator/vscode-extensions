//! Module: tests::test_cli_semantics_core — Commit, Branch, and Cherry-Pick Parity Tests
//! File Path: tests/rust/test_cli_semantics_core.rs
//! Architecture Role: Verifies Phase 0.4 fixes for `commit` (`-F`/`--file`, `--amend`,
//!   `--no-verify`, `--signoff`), `branch` (`-a`/`--all`, `-r`/`--remotes`, `-v`/`-vv`),
//!   and `cherry-pick --abort` state restoration.
//! Dependencies & Triggers: Mounted in `tests/integration_cli.rs` and run by `cargo test --workspace`.
//! Responsibilities: Validate command parity for commit flags, branch listings, and transplant abort.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-CLI-001`: CLI exit status and parity contract guard

use fractal_git::GitHookRunner;

use std::fs;
use std::path::Path;

use crate::cli_harness::{
    compliant_msg, run_git_ok, run_taxis, run_taxis_ok, system_git_available, test_temp_dir,
};

fn write_file(dir: &Path, rel: &str, body: &str) {
    let full = dir.join(rel);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).expect("create parent directories");
    }
    fs::write(full, body).expect("write test file");
}

#[test]
fn commit_file_flag_amend_signoff_and_no_verify_workflows() {
    let tmp = test_temp_dir("sem_cm_");
    let repo = tmp.path();
    run_taxis_ok(repo, &["init", "--dev"]);

    write_file(repo, "app/main.txt", "v1\n");
    write_file(
        repo,
        "commit_msg_1.txt",
        &compliant_msg("feat(app): initial commit via file", "app/main.txt"),
    );
    run_taxis_ok(repo, &["add", "app/main.txt"]);
    run_taxis_ok(repo, &["commit", "-F", "commit_msg_1.txt", "--signoff"]);

    let tree_1 = run_taxis_ok(repo, &["ls-tree", "-r", "--name-only", "HEAD"]);
    assert!(tree_1.contains("app/main.txt"));
    assert!(
        !tree_1.contains("commit_msg_1.txt"),
        "-F message file must NOT be staged into tree: {tree_1}"
    );
    let body_1 = run_taxis_ok(repo, &["cat-file", "-p", "HEAD"]);
    assert!(
        body_1.contains("Signed-off-by:"),
        "--signoff must append Signed-off-by trailer: {body_1}"
    );
    let c1_oid = run_taxis_ok(repo, &["rev-parse", "HEAD"]);

    // Second commit via `--file=...`
    write_file(repo, "app/main.txt", "v2\n");
    write_file(
        repo,
        "commit_msg_2.txt",
        &compliant_msg("feat(app): second commit via --file=", "app/main.txt"),
    );
    run_taxis_ok(repo, &["add", "app/main.txt"]);
    run_taxis_ok(repo, &["commit", "--file=commit_msg_2.txt"]);
    let tree_2 = run_taxis_ok(repo, &["ls-tree", "-r", "--name-only", "HEAD"]);
    assert!(
        !tree_2.contains("commit_msg_2.txt"),
        "--file= message file must NOT be staged into tree: {tree_2}"
    );
    let c2_oid = run_taxis_ok(repo, &["rev-parse", "HEAD"]);

    // `--amend --no-edit` updates tree while preserving c1 as parent
    write_file(repo, "app/amended.txt", "extra\n");
    run_taxis_ok(repo, &["add", "app/amended.txt"]);
    run_taxis_ok(repo, &["commit", "--amend", "--no-edit"]);
    let amended_oid = run_taxis_ok(repo, &["rev-parse", "HEAD"]);
    assert_ne!(amended_oid, c2_oid);
    assert_eq!(run_taxis_ok(repo, &["rev-parse", "HEAD^"]), c1_oid);
    let tree_amended = run_taxis_ok(repo, &["ls-tree", "-r", "--name-only", "HEAD"]);
    assert!(tree_amended.contains("app/main.txt") && tree_amended.contains("app/amended.txt"));

    // `--no-verify` bypasses blocking pre-commit & commit-msg hooks when shell is available
    if GitHookRunner::has_working_shell() {
        let hooks_dir = repo.join(".taxis/hooks");
        fs::create_dir_all(&hooks_dir).expect("mkdir hooks");
        let hook_script = "#!/bin/sh\nexit 1\n";
        fs::write(hooks_dir.join("pre-commit"), hook_script).expect("write pre-commit");
        fs::write(hooks_dir.join("commit-msg"), hook_script).expect("write commit-msg");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for name in ["pre-commit", "commit-msg"] {
                let p = hooks_dir.join(name);
                let mut perms = fs::metadata(&p).unwrap().permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&p, perms).unwrap();
            }
        }

        write_file(repo, "app/main.txt", "v3\n");
        run_taxis_ok(repo, &["add", "app/main.txt"]);
        let m3 = compliant_msg("feat(app): test no-verify hook bypass", "app/main.txt");
        let blocked = run_taxis(repo, &["commit", "-m", &m3]);
        assert!(
            !blocked.status.success(),
            "commit without --no-verify must fail when pre-commit/commit-msg block"
        );
        run_taxis_ok(repo, &["commit", "--no-verify", "-m", &m3]);
    }
}

#[test]
fn branch_all_remotes_and_verbose_tracking_output() {
    let tmp = test_temp_dir("sem_br_");
    let bare = tmp.path().join("origin.git");
    let repo = tmp.path().join("work");

    run_taxis_ok(tmp.path(), &["init", "work"]);
    write_file(&repo, "lib/ok.rs", "pub fn ok() {}\n");
    run_taxis_ok(&repo, &["add", "lib/ok.rs"]);
    run_taxis_ok(
        &repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(lib): initial lib", "lib/ok.rs"),
        ],
    );
    let head_oid = run_taxis_ok(&repo, &["rev-parse", "HEAD"]);
    run_taxis_ok(&repo, &["branch", "topic"]);

    if system_git_available() {
        fs::create_dir_all(&bare).expect("mkdir bare");
        run_git_ok(&bare, &["init", "--bare"]);
        let bare_str = bare.to_string_lossy().into_owned();
        run_taxis_ok(&repo, &["remote", "add", "origin", &bare_str]);
        run_taxis_ok(&repo, &["push", "-u", "origin", "main"]);
        run_taxis_ok(&repo, &["fetch", "origin"]);
        assert_eq!(
            run_taxis_ok(&repo, &["config", "--get", "branch.main.remote"]),
            "origin"
        );
        assert_eq!(
            run_taxis_ok(&repo, &["config", "--get", "branch.main.merge"]),
            "refs/heads/main"
        );
    } else {
        run_taxis_ok(
            &repo,
            &["update-ref", "refs/remotes/origin/main", &head_oid],
        );
        run_taxis_ok(&repo, &["config", "branch.main.remote", "origin"]);
        run_taxis_ok(&repo, &["config", "branch.main.merge", "refs/heads/main"]);
    }

    let out_all = run_taxis_ok(&repo, &["branch", "-a"]);
    assert!(
        out_all.contains("* main")
            && out_all.contains("topic")
            && out_all.contains("remotes/origin/main"),
        "branch -a output missing expected entries:\n{out_all}"
    );

    let out_remotes = run_taxis_ok(&repo, &["branch", "-r"]);
    assert!(out_remotes.contains("origin/main"));
    assert!(!out_remotes.contains("topic"));

    let out_vv = run_taxis_ok(&repo, &["branch", "-vv"]);
    let short7 = &head_oid[..7];
    assert!(
        out_vv.contains(short7)
            && out_vv.contains("[origin/main]")
            && out_vv.contains("initial lib"),
        "branch -vv missing oid/upstream/subject:\n{out_vv}"
    );
}

#[test]
fn cherry_pick_conflict_and_abort_restores_worktree_index_and_orig_head() {
    let tmp = test_temp_dir("sem_cp_");
    let repo = tmp.path();
    run_taxis_ok(repo, &["init", "--dev"]);
    run_taxis_ok(repo, &["config", "conflict.mode", "git-compat"]);

    write_file(repo, "shared/data.txt", "line 1\nbase line\nline 3\n");
    run_taxis_ok(repo, &["add", "shared/data.txt"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(shared): base state", "shared/data.txt"),
        ],
    );
    run_taxis_ok(repo, &["branch", "side"]);

    // Advance main with conflicting edit on line 2
    write_file(repo, "shared/data.txt", "line 1\nmain line\nline 3\n");
    run_taxis_ok(repo, &["add", "shared/data.txt"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(shared): main edit", "shared/data.txt"),
        ],
    );
    let main_oid = run_taxis_ok(repo, &["rev-parse", "HEAD"]);

    // Advance side with conflicting edit AND a brand-new clean file
    run_taxis_ok(repo, &["switch", "side"]);
    write_file(repo, "shared/data.txt", "line 1\nside line\nline 3\n");
    write_file(repo, "shared/pick_extra.txt", "from side\n");
    run_taxis_ok(repo, &["add", "shared/data.txt", "shared/pick_extra.txt"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(shared): side edit and extra", "shared/pick_extra.txt"),
        ],
    );
    let side_oid = run_taxis_ok(repo, &["rev-parse", "HEAD"]);

    // Switch back to main and cherry-pick side -> must conflict cleanly without silent override
    run_taxis_ok(repo, &["switch", "main"]);
    let cp_out = run_taxis(repo, &["cherry-pick", &side_oid]);
    assert!(
        !cp_out.status.success(),
        "conflicting cherry-pick must exit non-zero"
    );
    let conflicted = fs::read_to_string(repo.join("shared/data.txt")).unwrap();
    assert!(
        conflicted.contains("<<<<<<<")
            && conflicted.contains("=======")
            && conflicted.contains(">>>>>>>"),
        "shared/data.txt must contain conflict markers:\n{conflicted}"
    );
    assert!(repo.join(".taxis/CHERRY_PICK_HEAD").is_file());
    assert!(repo.join(".taxis/ORIG_HEAD").is_file());
    assert!(repo.join("shared/pick_extra.txt").is_file());

    // Abort must restore shared/data.txt, index, remove shared/pick_extra.txt, clear CHERRY_PICK_HEAD, and match ORIG_HEAD
    run_taxis_ok(repo, &["cherry-pick", "--abort"]);
    assert!(!repo.join(".taxis/CHERRY_PICK_HEAD").exists());
    assert!(!repo.join("shared/pick_extra.txt").exists());
    assert_eq!(
        fs::read_to_string(repo.join("shared/data.txt")).unwrap(),
        "line 1\nmain line\nline 3\n"
    );
    assert_eq!(run_taxis_ok(repo, &["rev-parse", "HEAD"]), main_oid);
    assert!(
        run_taxis_ok(repo, &["status", "--porcelain"]).is_empty(),
        "status must be clean after cherry-pick --abort: {}",
        run_taxis_ok(repo, &["status", "--porcelain"])
    );
}
