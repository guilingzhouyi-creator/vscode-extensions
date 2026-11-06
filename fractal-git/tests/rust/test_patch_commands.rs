//! Test Suite: Patch Flow (format-patch, apply, am)
//! File Path: tests/rust/test_patch_commands.rs
//!
//! Validates patch generation, hunk application, dry-run checking, index patching,
//! and mbox patch sequencing and commit reconstruction.

use std::fs;
use std::path::Path;

use crate::cli_harness::{run_in, test_temp_dir};

/// Initializes a dev repository with an initial commit.
fn init_repo_with_commit(dir: &Path) {
    let dir_str = dir.to_str().unwrap();
    let (code, stdout, stderr) = run_in(dir, &["init", "--dev", "--workspace", dir_str]);
    assert_eq!(code, 0, "init failed: {stdout}\n{stderr}");

    let file_path = dir.join("hello.txt");
    fs::write(&file_path, "Hello world\n").expect("write file");
    let (code, _, _) = run_in(dir, &["add", "hello.txt"]);
    assert_eq!(code, 0);

    let msg = "feat(core): 初次创建验证基线测试提交\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 需要真实提交来验证补丁与重构差异化流程。\n\n\
         [Added / 新增内容]\n- 新增 hello.txt 用于测试统一差异补丁生成。\n\n\
         [Verification / 验证结论]\n- 文件已就绪并通过测试断言验证有效性。";
    let (code, stdout, stderr) = run_in(dir, &["commit", "-m", msg]);
    assert_eq!(code, 0, "commit failed: {stdout}\n{stderr}");
}

#[test]
fn format_patch_generates_valid_patch_file_with_metadata() {
    let temp = test_temp_dir("fp_gen");
    let dir = temp.path();
    init_repo_with_commit(dir);

    // Make second commit
    fs::write(dir.join("hello.txt"), "Hello world\nLine two\n").unwrap();
    run_in(dir, &["add", "hello.txt"]);
    let msg2 = "feat(core): 增加第二行内容供差异比对\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 增加行以产生具有实际差异的补丁文件块。\n\n\
         [Added / 新增内容]\n- hello.txt 增补第二行内容。\n\n\
         [Verification / 验证结论]\n- 提交已完成并通过哈希校验确认无误。";
    run_in(dir, &["commit", "-m", msg2]);

    // Format last 1 commit
    let (code, stdout, stderr) = run_in(dir, &["format-patch", "-1", "-o", "patches"]);
    assert_eq!(code, 0, "stderr: {stderr}");
    assert!(stdout.contains("0001-"), "stdout was: {stdout}");

    let patch_file = dir.join(stdout.trim());
    assert!(patch_file.exists());
    let patch_content = fs::read_to_string(&patch_file).unwrap();
    assert!(patch_content.contains("From "));
    assert!(patch_content.contains("Subject: [PATCH]"));
    assert!(patch_content.contains("+Line two"));
}

#[test]
fn format_patch_to_stdout_outputs_mbox_headers() {
    let temp = test_temp_dir("fp_stdout");
    let dir = temp.path();
    init_repo_with_commit(dir);

    let (code, stdout, stderr) = run_in(dir, &["format-patch", "-1", "--stdout"]);
    assert_eq!(code, 0, "stderr: {stderr}");
    assert!(stdout.starts_with("From "));
    assert!(stdout.contains("Subject: [PATCH] feat(core): 初次创建验证基线测试提交"));
    assert!(stdout.contains("diff --git a/hello.txt b/hello.txt"));
    assert!(stdout.contains("+Hello world"));
}

#[test]
fn apply_stat_reports_file_and_diff_numbers() {
    let temp = test_temp_dir("apply_stat");
    let dir = temp.path();
    init_repo_with_commit(dir);

    let patch = "diff --git a/hello.txt b/hello.txt\n--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1,2 @@\n Hello world\n+Added from patch\n";

    let patch_file = dir.join("diff.patch");
    fs::write(&patch_file, patch).unwrap();

    let (code, stdout, stderr) = run_in(dir, &["apply", "--stat", "diff.patch"]);
    assert_eq!(code, 0, "stderr: {stderr}");
    assert!(stdout.contains("hello.txt"), "stdout was: {stdout}");
    assert!(stdout.contains('+'));
}

#[test]
fn apply_check_validates_clean_patch() {
    let temp = test_temp_dir("apply_check");
    let dir = temp.path();
    init_repo_with_commit(dir);

    let valid_patch = "diff --git a/hello.txt b/hello.txt\n--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1,2 @@\n Hello world\n+Good line\n";
    fs::write(dir.join("good.patch"), valid_patch).unwrap();

    let (code, _, _) = run_in(dir, &["apply", "--check", "good.patch"]);
    assert_eq!(code, 0);

    let bad_patch = "diff --git a/hello.txt b/hello.txt\n--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1,2 @@\n Nonexistent context line\n+Bad line\n";
    fs::write(dir.join("bad.patch"), bad_patch).unwrap();

    let (code, _, stderr) = run_in(dir, &["apply", "--check", "bad.patch"]);
    assert_ne!(code, 0);
    assert!(stderr.contains("patch failed") || stderr.contains("does not apply"));
}

#[test]
fn apply_mutates_worktree_cleanly() {
    let temp = test_temp_dir("apply_mutate");
    let dir = temp.path();
    init_repo_with_commit(dir);

    let patch = "diff --git a/hello.txt b/hello.txt\n--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1,2 @@\n Hello world\n+Line added by apply\n";
    fs::write(dir.join("change.patch"), patch).unwrap();

    let (code, _, stderr) = run_in(dir, &["apply", "change.patch"]);
    assert_eq!(code, 0, "stderr: {stderr}");

    let content = fs::read_to_string(dir.join("hello.txt")).unwrap();
    assert!(content.contains("Line added by apply"));
}

#[test]
fn am_applies_patch_series_and_creates_commits() {
    let temp_src = test_temp_dir("am_src");
    let src_dir = temp_src.path();
    init_repo_with_commit(src_dir);

    // Make second commit in src
    fs::write(src_dir.join("feature.txt"), "feature content\n").unwrap();
    run_in(src_dir, &["add", "feature.txt"]);
    let msg = "feat(core): 新特性功能落地与邮件补丁测试\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 增加功能测试以验证邮箱格式化补丁的应用能力。\n\n\
         [Added / 新增内容]\n- feature.txt 包含特性文本。\n\n\
         [Verification / 验证结论]\n- 提交已生成并通过哈希断言确认一致性。";
    let (code, stdout, stderr) = run_in(src_dir, &["commit", "-m", msg]);
    assert_eq!(code, 0, "second commit failed: {stdout}\n{stderr}");

    // Export patch
    let (code, stdout, _) = run_in(src_dir, &["format-patch", "-1", "-o", "mbox"]);
    assert_eq!(code, 0);
    let patch_content = fs::read(src_dir.join(stdout.trim())).unwrap();

    // Destination repo
    let temp_dst = test_temp_dir("am_dst");
    let dst_dir = temp_dst.path();
    init_repo_with_commit(dst_dir);

    fs::write(dst_dir.join("inbox.patch"), &patch_content).unwrap();
    let (code, stdout, stderr) = run_in(dst_dir, &["am", "inbox.patch"]);
    assert_eq!(code, 0, "am failed: {stdout}\n{stderr}");
    assert!(stdout.contains("Applying: feat(core): 新特性功能落地"));

    assert!(dst_dir.join("feature.txt").exists());
    let feature_content = fs::read_to_string(dst_dir.join("feature.txt")).unwrap();
    assert_eq!(feature_content, "feature content\n");
}
