//! Test Suite: Tree/Tag Plumbing & History Verification
//! File Path: tests/rust/test_plumbing_tree_commands.rs
//!
//! Asserts mktree, read-tree, mktag, name-rev, and verify-commit/tag operations.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::cli_harness::{run_in, test_temp_dir};

/// Runs taxis with stdin provided.
fn run_with_stdin(dir: &Path, args: &[&str], input: &[u8]) -> (i32, String, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("taxis spawn");

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input).expect("write stdin");
    }

    let output = child.wait_with_output().expect("wait output");
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

    fs::write(dir.join("root.txt"), "root line\n").unwrap();
    run_in(dir, &["add", "root.txt"]);
    let msg = "feat(core): 初次创建验证用根提交\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 需要真实根提交来搭建树对象管道与标签验证基准。\n\n\
         [Added / 新增内容]\n- root.txt 包含测试根文本。\n\n\
         [Verification / 验证结论]\n- 文件已就绪并通过测试断言验证有效性。";
    let (code, stdout, stderr) = run_in(dir, &["commit", "-m", msg]);
    assert_eq!(code, 0, "commit failed: {stdout}\n{stderr}");
}

#[test]
fn mktree_builds_canonical_tree_from_stdin() {
    let temp = test_temp_dir("mktree_test");
    let dir = temp.path();
    init_repo_with_commit(dir);

    // Hash a blob first
    let (code, blob_sha, _) = run_in(dir, &["hash-object", "-w", "root.txt"]);
    assert_eq!(code, 0);
    let blob_sha = blob_sha.trim();

    let input = format!("100644 blob {blob_sha}\tmy_file.txt\n");
    let (code, tree_sha, stderr) = run_with_stdin(dir, &["mktree"], input.as_bytes());
    assert_eq!(code, 0, "mktree stderr: {stderr}");
    let tree_sha = tree_sha.trim();
    assert_eq!(tree_sha.len(), 40);

    // Verify created tree can be listed by ls-tree
    let (code, stdout, _) = run_in(dir, &["ls-tree", tree_sha]);
    assert_eq!(code, 0);
    assert!(stdout.contains("my_file.txt"));
}

#[test]
fn read_tree_populates_index_and_worktree() {
    let temp = test_temp_dir("read_tree_test");
    let dir = temp.path();
    init_repo_with_commit(dir);

    // Get current HEAD tree
    let (_, head_sha, _) = run_in(dir, &["rev-parse", "HEAD"]);
    let head_sha = head_sha.trim();

    // Clear worktree and index
    let _ = fs::remove_file(dir.join("root.txt"));
    assert!(!dir.join("root.txt").exists());

    // read-tree with -u
    let (code, stdout, stderr) = run_in(dir, &["read-tree", "-u", head_sha]);
    assert_eq!(code, 0, "read-tree failed: {stdout}\n{stderr}");

    // File should be restored in worktree
    assert!(dir.join("root.txt").exists());
    let content = fs::read_to_string(dir.join("root.txt")).unwrap();
    assert_eq!(content, "root line\n");

    // Index should have root.txt
    let (_, ls_files, _) = run_in(dir, &["ls-files"]);
    assert!(ls_files.contains("root.txt"));
}

#[test]
fn mktag_validates_and_writes_tag_object() {
    let temp = test_temp_dir("mktag_test");
    let dir = temp.path();
    init_repo_with_commit(dir);

    let (_, head_sha, _) = run_in(dir, &["rev-parse", "HEAD"]);
    let head_sha = head_sha.trim();

    let tag_payload = format!(
        "object {head_sha}\n\
         type commit\n\
         tag v1.0.0\n\
         tagger Taxis Author <author@local> 1700000000 +0000\n\
         \n\
         Release version 1.0.0\n"
    );

    let (code, tag_sha, stderr) = run_with_stdin(dir, &["mktag"], tag_payload.as_bytes());
    assert_eq!(code, 0, "mktag failed: {stderr}");
    let tag_sha = tag_sha.trim();
    assert_eq!(tag_sha.len(), 40);

    // Verify cat-file sees it as a tag
    let (code, stdout, _) = run_in(dir, &["cat-file", "-t", tag_sha]);
    assert_eq!(code, 0);
    assert_eq!(stdout.trim(), "tag");
}

#[test]
fn name_rev_maps_commit_to_symbolic_branch_or_tag() {
    let temp = test_temp_dir("name_rev_test");
    let dir = temp.path();
    init_repo_with_commit(dir);

    let (_, head_sha, _) = run_in(dir, &["rev-parse", "HEAD"]);
    let head_sha = head_sha.trim().to_string();

    // Create a branch pointing to HEAD
    run_in(dir, &["update-ref", "refs/heads/feature-x", &head_sha]);

    let (code, stdout, stderr) = run_in(dir, &["name-rev", &head_sha]);
    assert_eq!(code, 0, "name-rev stderr: {stderr}");
    assert!(stdout.contains(&head_sha));
    assert!(stdout.contains("feature-x") || stdout.contains("main") || stdout.contains("cell"));
}

#[test]
fn verify_commit_rejects_unsigned_commit_with_exit_1() {
    let temp = test_temp_dir("verify_commit_test");
    let dir = temp.path();
    init_repo_with_commit(dir);

    let (_, head_sha, _) = run_in(dir, &["rev-parse", "HEAD"]);
    let head_sha = head_sha.trim();

    let (code, _, stderr) = run_in(dir, &["verify-commit", head_sha]);
    assert_eq!(code, 1);
    assert!(stderr.contains("does not have a signature"));
}

#[test]
fn verify_tag_rejects_unsigned_tag_with_exit_1() {
    let temp = test_temp_dir("verify_tag_test");
    let dir = temp.path();
    init_repo_with_commit(dir);

    // Create lightweight tag
    let (_, head_sha, _) = run_in(dir, &["rev-parse", "HEAD"]);
    let head_sha = head_sha.trim();
    run_in(dir, &["tag", "v0.1", head_sha]);

    let (code, _, stderr) = run_in(dir, &["verify-tag", "v0.1"]);
    assert_eq!(code, 1);
    assert!(stderr.contains("does not have a signature") || stderr.contains("not a tag"));
}
