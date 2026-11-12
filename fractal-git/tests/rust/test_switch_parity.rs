//! Module: tests::test_switch_parity — Switch Command Differential Parity With System Git
//! File Path: tests/rust/test_switch_parity.rs
//! Architecture Role: Verifies `taxis switch` / `taxis sw` flag matrix against system Git oracle:
//!   `-c`, `-C`, `-`, `--detach`, `--orphan`, and bare commit rejection.
//! Dependencies & Triggers: Run by `cargo test --workspace` via `tests/integration_cli.rs`.
//! Responsibilities: Validate differential parity for branch switching without command-line drift.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-CLI-001.

use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use crate::cli_harness::{run_taxis, run_taxis_ok, system_git_available, test_temp_dir};

fn run_git_switch_parity(repo: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .current_dir(repo)
        .arg("-c")
        .arg("init.defaultBranch=main")
        .arg("-c")
        .arg("user.name=Parity Test")
        .arg("-c")
        .arg("user.email=parity@taxis.internal")
        .arg("-c")
        .arg("commit.gpgsign=false")
        .arg("-c")
        .arg("core.autocrlf=false")
        .arg("-c")
        .arg("core.longpaths=true")
        .arg("-c")
        .arg("advice.detachedHead=false")
        .env("GIT_AUTHOR_NAME", "Parity Test")
        .env("GIT_AUTHOR_EMAIL", "parity@taxis.internal")
        .env("GIT_AUTHOR_DATE", "1700000100 +0000")
        .env("GIT_COMMITTER_NAME", "Parity Test")
        .env("GIT_COMMITTER_EMAIL", "parity@taxis.internal")
        .env("GIT_COMMITTER_DATE", "1700000100 +0000")
        .args(args)
        .output()
        .expect("spawn system git binary")
}

fn seed_git_twin(repo: &Path) -> (String, String) {
    let init = run_git_switch_parity(repo, &["init", "-q", "."]);
    assert!(
        init.status.success(),
        "git init failed: {}",
        String::from_utf8_lossy(&init.stderr)
    );
    fs::write(repo.join("a.txt"), "base-v1\n").expect("write a.txt");
    assert!(run_git_switch_parity(repo, &["add", "a.txt"])
        .status
        .success());
    assert!(
        run_git_switch_parity(repo, &["commit", "-q", "-m", "init: v1"])
            .status
            .success()
    );
    let c1 = String::from_utf8_lossy(&run_git_switch_parity(repo, &["rev-parse", "HEAD"]).stdout)
        .trim()
        .to_string();

    fs::write(repo.join("a.txt"), "main-v2\n").expect("write a.txt v2");
    assert!(run_git_switch_parity(repo, &["add", "a.txt"])
        .status
        .success());
    assert!(
        run_git_switch_parity(repo, &["commit", "-q", "-m", "feat: v2"])
            .status
            .success()
    );
    let c2 = String::from_utf8_lossy(&run_git_switch_parity(repo, &["rev-parse", "HEAD"]).stdout)
        .trim()
        .to_string();
    (c1, c2)
}

#[test]
fn test_switch_options_differential_parity_with_system_git() {
    if !system_git_available() {
        return;
    }

    let tmp = test_temp_dir("sw_parity_");
    let git_repo = tmp.path().join("git_oracle");
    let taxis_repo = tmp.path().join("taxis_cand");
    fs::create_dir_all(&git_repo).expect("mkdir git_repo");
    fs::create_dir_all(&taxis_repo).expect("mkdir taxis_repo");

    let (c1_g, c2_g) = seed_git_twin(&git_repo);
    let (c1_t, c2_t) = seed_git_twin(&taxis_repo);
    assert_eq!(c1_g, c1_t);
    assert_eq!(c2_g, c2_t);

    // 1. `switch -c feat` (must not mistake `-c` for a branch name)
    let g_sc = run_git_switch_parity(&git_repo, &["switch", "-c", "feat"]);
    let t_sc = run_taxis(&taxis_repo, &["switch", "-c", "feat"]);
    assert_eq!(t_sc.status.code(), g_sc.status.code(), "switch -c exit");
    assert_eq!(
        String::from_utf8_lossy(&t_sc.stdout),
        String::from_utf8_lossy(&g_sc.stdout)
    );
    assert!(
        String::from_utf8_lossy(&t_sc.stderr).contains("Switched to a new branch 'feat'"),
        "stderr: {}",
        String::from_utf8_lossy(&t_sc.stderr)
    );
    assert_eq!(
        run_taxis_ok(&taxis_repo, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "feat"
    );

    // 2. `switch -C feat <c1>` force-reset existing branch (`sw` alias too)
    let g_s_force = run_git_switch_parity(&git_repo, &["switch", "-C", "feat", &c1_g]);
    let t_s_force = run_taxis(&taxis_repo, &["sw", "-C", "feat", &c1_t]);
    assert_eq!(
        t_s_force.status.code(),
        g_s_force.status.code(),
        "sw -C exit"
    );
    assert_eq!(run_taxis_ok(&taxis_repo, &["rev-parse", "HEAD"]), c1_t);
    assert_eq!(
        fs::read_to_string(taxis_repo.join("a.txt")).unwrap(),
        fs::read_to_string(git_repo.join("a.txt")).unwrap()
    );

    // 3. `switch -` toggles back to previous branch (`main`)
    let g_dash = run_git_switch_parity(&git_repo, &["switch", "-"]);
    let t_dash = run_taxis(&taxis_repo, &["switch", "-"]);
    assert_eq!(t_dash.status.code(), g_dash.status.code(), "switch - exit");
    assert_eq!(
        run_taxis_ok(&taxis_repo, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "main"
    );

    // 4. Bare `switch <commit>` without `--detach` fails non-zero like git
    let g_bare_commit = run_git_switch_parity(&git_repo, &["switch", &c1_g]);
    let t_bare_commit = run_taxis(&taxis_repo, &["switch", &c1_t]);
    assert!(!g_bare_commit.status.success());
    assert!(!t_bare_commit.status.success());

    // 5. `switch --detach <commit>` detaches HEAD
    let g_det = run_git_switch_parity(&git_repo, &["switch", "--detach", &c1_g]);
    let t_det = run_taxis(&taxis_repo, &["switch", "--detach", &c1_t]);
    assert_eq!(t_det.status.code(), g_det.status.code(), "switch --detach");
    assert_eq!(run_taxis_ok(&taxis_repo, &["rev-parse", "HEAD"]), c1_t);

    // 6. `switch --orphan empty-branch` switches to unborn branch & removes tracked files from index/worktree
    let g_orp = run_git_switch_parity(&git_repo, &["switch", "--orphan", "empty-branch"]);
    let t_orp = run_taxis(&taxis_repo, &["switch", "--orphan", "empty-branch"]);
    assert_eq!(t_orp.status.code(), g_orp.status.code(), "switch --orphan");
    assert!(!git_repo.join("a.txt").exists());
    assert!(!taxis_repo.join("a.txt").exists());
    assert!(run_taxis_ok(&taxis_repo, &["ls-files"]).is_empty());
}
