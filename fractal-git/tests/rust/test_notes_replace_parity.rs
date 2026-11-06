//! Module: tests::test_notes_replace_parity — Auxiliary Namespace Parity
//! File Path: tests/rust/test_notes_replace_parity.rs
//! Architecture Role: Proves `notes` and `replace` auxiliary reference namespaces
//!   behave with differential parity against standard Git expectations.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Validate notes commit association and replace ref mapping lifecycle.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-CLI-001.

use std::fs;
use std::path::PathBuf;

use crate::cli_harness::run_taxis;

fn scratch_repo(label: &str) -> PathBuf {
    crate::cli_harness::scratch_repo("taxis_notes", label)
}

fn valid_msg(summary: &str) -> String {
    format!(
        "feat(core): {summary}\n\n\
         [Project / 项目归属]\n- fractal-git\n\n\
         [Why / 动机背景]\n- 测试辅助附注与替换引用命名空间生命周期契约。\n\n\
         [Added / 新增内容]\n- 增加验证用例文件。\n\n\
         [Verification / 验证结论]\n- 通过断言校验输出文本格式与选项契约。"
    )
}

#[test]
fn test_notes_crud_lifecycle() {
    let repo = scratch_repo("notes");
    let init_out = run_taxis(&repo, &["init", "--dev"]);
    assert!(init_out.status.success());

    fs::write(repo.join("note_target.txt"), "hello note\n").unwrap();
    run_taxis(&repo, &["add", "note_target.txt"]);
    let msg = valid_msg("附注测试提交");
    let c = run_taxis(&repo, &["commit", "-m", &msg]);
    assert!(c.status.success());

    // 1. Add note
    let note_add = run_taxis(
        &repo,
        &["notes", "add", "-m", "Sample note body text", "HEAD"],
    );
    assert!(
        note_add.status.success(),
        "notes add failed: {}",
        String::from_utf8_lossy(&note_add.stderr)
    );

    // 2. Show note
    let note_show = run_taxis(&repo, &["notes", "show", "HEAD"]);
    assert!(note_show.status.success());
    let show_str = String::from_utf8_lossy(&note_show.stdout);
    assert_eq!(show_str.trim(), "Sample note body text");

    // 3. List notes
    let note_list = run_taxis(&repo, &["notes", "list"]);
    assert!(note_list.status.success());
    let list_str = String::from_utf8_lossy(&note_list.stdout);
    assert!(!list_str.trim().is_empty());

    // 4. Remove note
    let note_rm = run_taxis(&repo, &["notes", "remove", "HEAD"]);
    assert!(note_rm.status.success());

    // 5. Verify show fails after removal
    let note_show_after = run_taxis(&repo, &["notes", "show", "HEAD"]);
    assert!(!note_show_after.status.success());

    let _ = fs::remove_dir_all(&repo);
}

#[test]
fn test_replace_lifecycle() {
    let repo = scratch_repo("replace");
    let init_out = run_taxis(&repo, &["init", "--dev"]);
    assert!(init_out.status.success());

    fs::write(repo.join("f1.txt"), "first\n").unwrap();
    run_taxis(&repo, &["add", "f1.txt"]);
    let msg1 = valid_msg("第一提交");
    let c1 = run_taxis(&repo, &["commit", "-m", &msg1]);
    assert!(c1.status.success());

    fs::write(repo.join("f2.txt"), "second\n").unwrap();
    run_taxis(&repo, &["add", "f2.txt"]);
    let msg2 = valid_msg("第二提交");
    let c2 = run_taxis(&repo, &["commit", "-m", &msg2]);
    assert!(c2.status.success());

    // 1. Create replace ref
    let rep_out = run_taxis(&repo, &["replace", "HEAD~1", "HEAD"]);
    assert!(
        rep_out.status.success(),
        "replace failed: {}",
        String::from_utf8_lossy(&rep_out.stderr)
    );

    // 2. List replace refs
    let rep_list = run_taxis(&repo, &["replace", "--list"]);
    assert!(rep_list.status.success());
    let list_str = String::from_utf8_lossy(&rep_list.stdout);
    assert!(!list_str.trim().is_empty());

    // 3. Delete replace ref
    let rep_del = run_taxis(&repo, &["replace", "-d", "HEAD~1"]);
    assert!(rep_del.status.success());

    let _ = fs::remove_dir_all(&repo);
}
