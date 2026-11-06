//! Test Suite: Pathspec Resolution Relative to the Working Directory
//! File Path: tests/rust/test_pathspec_resolution.rs
//!
//! Git resolves a pathspec against the current working directory, not the repository root. This
//! suite pins that rule because its absence is invisible from the root: `taxis add <file>` failed in
//! every subdirectory while every test that ran at the root passed, and the failure message
//! ("pathspec did not match any files") pointed at the file rather than at the resolution rule.
//!
//! The arithmetic is covered by unit tests beside `src/pathspec.rs`. What is checked here is that the
//! rule is actually *wired into* `add`, which a unit test cannot show.

use std::io::Write;
use std::process::Command;

use crate::cli_harness::test_temp_dir;

#[test]
fn add_works_from_a_subdirectory_and_records_a_root_relative_path() {
    let dir = test_temp_dir("pathspec-subdir-");
    let root = dir.path();
    let status = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["init", "--dev", "--workspace"])
        .arg(root)
        .current_dir(root)
        .status()
        .expect("init must run");
    assert!(status.success());

    let sub = root.join("sub");
    std::fs::create_dir_all(&sub).expect("create subdir");
    let mut handle = std::fs::File::create(sub.join("inner.txt")).expect("create file");
    writeln!(handle, "content").expect("write file");

    let output = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["add", "inner.txt"])
        .current_dir(&sub)
        .output()
        .expect("add must run");
    assert!(
        output.status.success(),
        "add one level down must succeed, got: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    // The index stores root-relative paths, so this also proves the prefix was applied rather than
    // the file being staged under a bare name.
    let listed = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["ls-files"])
        .current_dir(root)
        .output()
        .expect("ls-files must run");
    let table = String::from_utf8_lossy(&listed.stdout);
    assert!(
        table.contains("sub/inner.txt"),
        "the staged path must be recorded root-relative, got:\n{table}"
    );
}

#[test]
fn add_at_the_root_still_works() {
    // Guards the fix itself: applying a working-directory prefix must be a no-op at the root, or the
    // change would trade one broken case for another.
    let dir = test_temp_dir("pathspec-root-");
    let root = dir.path();
    let status = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["init", "--dev", "--workspace"])
        .arg(root)
        .current_dir(root)
        .status()
        .expect("init must run");
    assert!(status.success());

    let mut handle = std::fs::File::create(root.join("top.txt")).expect("create file");
    writeln!(handle, "content").expect("write file");

    let output = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["add", "top.txt"])
        .current_dir(root)
        .output()
        .expect("add must run");
    assert!(
        output.status.success(),
        "add at the root must keep working: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
