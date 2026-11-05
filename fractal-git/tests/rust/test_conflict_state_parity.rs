//! Module: tests::test_conflict_state_parity — Conflict Markers and State Transition Parity
//! File Path: tests/rust/test_conflict_state_parity.rs
//! Architecture Role: Proves merge conflict marker rendering (<<<<<<<, =======, >>>>>>>),
//!   operation-accurate dirty worktree rejection messages, and initial commit HEAD tracking.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Validate conflict presentation mode and state machine cleanliness.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-CLI-001.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

fn scratch_repo(label: &str) -> PathBuf {
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = fs::create_dir_all(&base);
    let path = base.join(format!(
        "taxis_cfl_st_{}_{}_{}",
        std::process::id(),
        count,
        label
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("scratch repository");
    path
}

fn run_taxis(repo: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(repo)
        .output()
        .expect("the built taxis binary must be runnable")
}

fn valid_msg(summary: &str) -> String {
    format!(
        "feat(core): {summary}\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 测试状态机转移与合并冲突呈现选项在分支集成中的契约。\n\n\
         [Added / 新增内容]\n- 增加验证用例文件。\n\n\
         [Verification / 验证结论]\n- 通过断言校验输出文本格式与选项契约。"
    )
}

#[test]
fn test_merge_conflict_markers_git_compat() {
    let repo = scratch_repo("merge_cfl");
    let init_out = run_taxis(&repo, &["init", "--dev"]);
    assert!(init_out.status.success());

    // Base commit
    fs::write(repo.join("file.txt"), "line 1\nbase content\nline 3\n").unwrap();
    run_taxis(&repo, &["add", "file.txt"]);
    let msg_base = valid_msg("基础提交");
    let c_base = run_taxis(&repo, &["commit", "-m", &msg_base]);
    assert!(c_base.status.success(), "base commit failed: {}", String::from_utf8_lossy(&c_base.stderr));

    // Branch feature
    let b_feat = run_taxis(&repo, &["checkout", "-b", "feature"]);
    assert!(b_feat.status.success());
    fs::write(repo.join("file.txt"), "line 1\nfeature edit\nline 3\n").unwrap();
    run_taxis(&repo, &["add", "file.txt"]);
    let msg_feat = valid_msg("功能分支修改");
    let c_feat = run_taxis(&repo, &["commit", "-m", &msg_feat]);
    assert!(c_feat.status.success());

    // Switch back
    let b_back = run_taxis(&repo, &["checkout", "main"]);
    if !b_back.status.success() {
        let _ = run_taxis(&repo, &["checkout", "refs/fractal/cell/cell-default/main"]);
    }
    fs::write(repo.join("file.txt"), "line 1\nmain edit\nline 3\n").unwrap();
    run_taxis(&repo, &["add", "file.txt"]);
    let msg_main = valid_msg("主干分支修改");
    let c_main = run_taxis(&repo, &["commit", "-m", &msg_main]);
    assert!(c_main.status.success());

    // Merge with --conflictstyle merge
    let m_out = run_taxis(&repo, &["merge", "feature", "--conflictstyle", "merge"]);
    assert!(!m_out.status.success(), "merge with conflicts must exit non-zero");
    let content = fs::read_to_string(repo.join("file.txt")).unwrap();
    assert!(content.contains("<<<<<<< HEAD"), "file must contain merge conflict marker start");
    assert!(content.contains("======="), "file must contain merge conflict marker separator");
    assert!(content.contains(">>>>>>> feature"), "file must contain merge conflict marker end");

    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn test_rebase_cleanliness_rejection_text() {
    let repo = scratch_repo("rebase_clean");
    let init_out = run_taxis(&repo, &["init", "--dev"]);
    assert!(init_out.status.success());

    fs::write(repo.join("tracked.txt"), "initial\n").unwrap();
    run_taxis(&repo, &["add", "tracked.txt"]);
    let msg = valid_msg("初始文件提交");
    let c = run_taxis(&repo, &["commit", "-m", &msg]);
    assert!(c.status.success());

    // Make worktree dirty
    fs::write(repo.join("tracked.txt"), "dirty modification\n").unwrap();

    let reb_out = run_taxis(&repo, &["rebase", "HEAD"]);
    assert!(!reb_out.status.success());
    let stderr = String::from_utf8_lossy(&reb_out.stderr);
    assert!(stderr.contains("rebase"), "rejection message must reference 'rebase': {stderr}");
    assert!(!stderr.contains("checkout:"), "rejection message must not mistakenly say 'checkout:'");

    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn test_unborn_commit_head_tracking() {
    let repo = scratch_repo("unborn_status");
    let init_out = run_taxis(&repo, &["init", "--dev"]);
    assert!(init_out.status.success());

    fs::write(repo.join("hello.txt"), "hello world\n").unwrap();
    run_taxis(&repo, &["add", "hello.txt"]);
    let msg = valid_msg("首个提交");
    let c = run_taxis(&repo, &["commit", "-m", &msg]);
    assert!(c.status.success());

    let log_out = run_taxis(&repo, &["log"]);
    assert!(log_out.status.success());
    let stdout = String::from_utf8_lossy(&log_out.stdout);
    let stderr = String::from_utf8_lossy(&log_out.stderr);
    let combined = format!("{stdout}{stderr}");
    assert!(
        combined.contains("commit "),
        "log must find commits even when on unborn trunk: {combined}"
    );
    assert!(
        combined.contains("HEAD is unborn"),
        "log must explain that HEAD is unborn: {combined}"
    );

    let _ = fs::remove_dir_all(&repo);
}
