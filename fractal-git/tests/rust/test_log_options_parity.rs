//! Module: tests::test_log_options_parity — Log Graph and Diff Option Parity
//! File Path: tests/rust/test_log_options_parity.rs
//! Architecture Role: Proves `log --graph`, `log --stat`, `log --name-only`, and `log --name-status`
//!   behave with differential parity against standard Git expectations.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Validate log formatting and commit diff options across repository commits.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-CLI-001.

use std::fs;
use std::path::PathBuf;

use crate::cli_harness::run_taxis;

fn scratch_repo(label: &str) -> PathBuf {
    crate::cli_harness::scratch_repo("taxis_log_opts", label)
}

fn valid_msg(summary: &str) -> String {
    format!(
        "feat(root): {summary}\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 测试日志与差异命令在历史树上的解析和拓扑渲染功能。\n\n\
         [Added / 新增内容]\n- 增加验证用例文件。\n\n\
         [Verification / 验证结论]\n- 通过断言校验输出文本格式与选项契约。"
    )
}

#[test]
fn test_log_graph_and_diff_options() {
    let repo = scratch_repo("log_opts");
    let init_out = run_taxis(&repo, &["init", "--dev"]);
    assert!(init_out.status.success());

    // Commit 1: first.txt
    fs::write(repo.join("first.txt"), "hello world\n").unwrap();
    let add1 = run_taxis(&repo, &["add", "first.txt"]);
    assert!(add1.status.success());
    let msg1 = valid_msg("初次测试基准提交建立");
    let commit1 = run_taxis(&repo, &["commit", "-m", &msg1]);
    assert!(
        commit1.status.success(),
        "commit1 failed: {}",
        String::from_utf8_lossy(&commit1.stderr)
    );

    // Commit 2: second.txt
    fs::write(repo.join("second.txt"), "another file\n").unwrap();
    let add2 = run_taxis(&repo, &["add", "second.txt"]);
    assert!(add2.status.success());
    let msg2 = valid_msg("第二次测试用例提交建立");
    let commit2 = run_taxis(&repo, &["commit", "-m", &msg2]);
    assert!(
        commit2.status.success(),
        "commit2 failed: {}",
        String::from_utf8_lossy(&commit2.stderr)
    );

    // 1. Verify log --graph --oneline
    let graph_out = run_taxis(&repo, &["log", "--graph", "--oneline"]);
    assert!(graph_out.status.success());
    let graph_str = String::from_utf8_lossy(&graph_out.stdout);
    let graph_lines: Vec<&str> = graph_str.lines().collect();
    assert!(graph_lines.len() >= 2);
    assert!(graph_lines[0].starts_with("* "));
    assert!(graph_lines[1].starts_with("* "));

    // 2. Verify log --name-only -1
    let name_only_out = run_taxis(&repo, &["log", "--name-only", "-1"]);
    assert!(name_only_out.status.success());
    let name_only_str = String::from_utf8_lossy(&name_only_out.stdout);
    assert!(name_only_str.contains("second.txt"));
    assert!(!name_only_str.contains("first.txt"));

    // 3. Verify log --name-status -1
    let name_status_out = run_taxis(&repo, &["log", "--name-status", "-1"]);
    assert!(name_status_out.status.success());
    let name_status_str = String::from_utf8_lossy(&name_status_out.stdout);
    assert!(name_status_str.contains("A\tsecond.txt"));

    // 4. Verify log --stat -1
    let stat_out = run_taxis(&repo, &["log", "--stat", "-1"]);
    assert!(stat_out.status.success());
    let stat_str = String::from_utf8_lossy(&stat_out.stdout);
    assert!(stat_str.contains("second.txt"));
    assert!(stat_str.contains("1 file changed"));

    // 5. Verify diff --name-status between revisions
    let diff_ns_out = run_taxis(&repo, &["diff", "--name-status", "HEAD~1", "HEAD"]);
    assert!(diff_ns_out.status.success());
    let diff_ns_str = String::from_utf8_lossy(&diff_ns_out.stdout);
    assert!(diff_ns_str.contains("A\tsecond.txt"));

    let _ = fs::remove_dir_all(&repo);
}
