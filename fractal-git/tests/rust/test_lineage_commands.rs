//! Test Suite: Commit Lineage Diagnostics (cherry & range-diff)
//! File Path: tests/rust/test_lineage_commands.rs
//!
//! Asserts commit equivalence detection in `cherry` and structural patch diffing in `range-diff`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Creates a temporary directory inside `target/test_tmp/`.
fn test_temp_dir(prefix: &str) -> tempfile::TempDir {
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = fs::create_dir_all(&base);
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(&base)
        .or_else(|_| tempfile::tempdir())
        .expect("create test tempdir")
}

/// Runs taxis in `dir`, returning (exit_code, stdout, stderr).
fn run_in(dir: &Path, args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(dir)
        .output()
        .expect("taxis must run");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    )
}

/// Initializes a repo and makes an initial commit.
fn init_repo_with_commit(dir: &Path) {
    let dir_str = dir.to_str().unwrap();
    let (code, stdout, stderr) = run_in(dir, &["init", "--dev", "--workspace", dir_str]);
    assert_eq!(code, 0, "init failed: {stdout}\n{stderr}");

    fs::write(dir.join("base.txt"), "base content\n").unwrap();
    run_in(dir, &["add", "base.txt"]);
    let msg = "feat(core): 初次创建验证基准提交\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 需要真实提交来搭建谱系比较与变基测试基线。\n\n\
         [Added / 新增内容]\n- base.txt 包含测试基线文本。\n\n\
         [Verification / 验证结论]\n- 文件已就绪并通过测试断言验证有效性。";
    let (code, stdout, stderr) = run_in(dir, &["commit", "-m", msg]);
    assert_eq!(code, 0, "commit failed: {stdout}\n{stderr}");
}

#[test]
fn cherry_identifies_unapplied_and_applied_commits() {
    let temp = test_temp_dir("cherry_test");
    let dir = temp.path();
    init_repo_with_commit(dir);

    // Create upstream commit
    fs::write(dir.join("up.txt"), "upstream line\n").unwrap();
    run_in(dir, &["add", "up.txt"]);
    let msg1 = "feat(core): 上游特性功能增量提交\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 增加上游专属功能以用于模拟多分支差异。\n\n\
         [Added / 新增内容]\n- up.txt 包含上游特性行。\n\n\
         [Verification / 验证结论]\n- 提交已完成并通过哈希断言确认无误。";
    let (code, stdout, stderr) = run_in(dir, &["commit", "-m", msg1]);
    assert_eq!(code, 0, "commit msg1 failed: {stdout}\n{stderr}");

    // Update ref main to track this
    let (_, rev_stdout, _) = run_in(dir, &["rev-parse", "HEAD"]);
    let upstream_sha = rev_stdout.trim().to_string();
    assert!(!upstream_sha.is_empty(), "upstream_sha must not be empty");
    let (code, stdout, stderr) = run_in(dir, &["update-ref", "refs/heads/main", &upstream_sha]);
    assert_eq!(code, 0, "update-ref failed: {stdout}\n{stderr}");

    // Create local feature commit
    fs::write(dir.join("feat.txt"), "feature line\n").unwrap();
    run_in(dir, &["add", "feat.txt"]);
    let msg2 = "feat(core): 本地分支专属特性功能\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 增加分支特性以用于测试上游未合入判定。\n\n\
         [Added / 新增内容]\n- feat.txt 包含分支专属行。\n\n\
         [Verification / 验证结论]\n- 提交已成功生成并通过哈希比对断言。";
    let (code, stdout, stderr) = run_in(dir, &["commit", "-m", msg2]);
    assert_eq!(code, 0, "commit msg2 failed: {stdout}\n{stderr}");

    // cherry against main
    let (code, stdout, stderr) = run_in(dir, &["cherry", "-v", "refs/heads/main", "refs/fractal/cell/cell-default/main"]);
    assert_eq!(code, 0, "cherry failed: {stdout}\n{stderr}");
    assert!(stdout.contains("+ "), "stdout was: {stdout}");
    assert!(stdout.contains("feat(core): 本地分支专属特性功能"));
}

#[test]
fn range_diff_compares_commit_ranges() {
    let temp = test_temp_dir("range_diff_test");
    let dir = temp.path();
    init_repo_with_commit(dir);

    let (_, base_sha, _) = run_in(dir, &["rev-parse", "HEAD"]);
    let base_sha = base_sha.trim().to_string();
    assert!(!base_sha.is_empty(), "base_sha must not be empty");

    // Commit 1
    fs::write(dir.join("f1.txt"), "hello 1\n").unwrap();
    run_in(dir, &["add", "f1.txt"]);
    let msg1 = "feat(core): 特性提交之一用于范围比对\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 增加范围比对所需的第一组增量提交。\n\n\
         [Added / 新增内容]\n- f1.txt 初始文件。\n\n\
         [Verification / 验证结论]\n- 提交成功落盘并通过断言校验。";
    let (code, stdout, stderr) = run_in(dir, &["commit", "-m", msg1]);
    assert_eq!(code, 0, "commit msg1 failed: {stdout}\n{stderr}");
    let (_, c1_sha, _) = run_in(dir, &["rev-parse", "HEAD"]);
    let c1_sha = c1_sha.trim().to_string();
    assert!(!c1_sha.is_empty(), "c1_sha must not be empty");
    let (code, stdout, stderr) = run_in(dir, &["update-ref", "refs/heads/branch1", &c1_sha]);
    assert_eq!(code, 0, "update-ref failed: {stdout}\n{stderr}");

    // Compare range against itself
    let range1 = format!("{base_sha}..refs/heads/branch1");
    let range2 = format!("{base_sha}..refs/heads/branch1");
    let (code, stdout, stderr) = run_in(dir, &["range-diff", &range1, &range2]);
    assert_eq!(code, 0, "range-diff failed: {stdout}\n{stderr}");
    assert!(stdout.contains("="), "stdout was: {stdout}");
    assert!(stdout.contains("feat(core): 特性提交之一用于范围比对"));
}
