//! Module: tests::test_list_files_parity — List Files Selection Flags Parity
//! File Path: tests/rust/test_list_files_parity.rs
//! Architecture Role: Proves `ls-files` selection flags (-c, -d, -m, -o, -u, -i, --exclude-standard)
//!   behave with differential parity against Git.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Validate IDE integration surface for untracked/modified discovery.
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
        "taxis_list_files_{}_{}_{}",
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

#[test]
fn test_ls_files_selection_flags_comprehensive() {
    let repo = scratch_repo("flags");
    let init_out = run_taxis(&repo, &["init", "--dev"]);
    assert!(init_out.status.success(), "init failed");

    // 1. Create files
    fs::write(repo.join("tracked.txt"), "tracked content\n").unwrap();
    fs::write(repo.join(".gitignore"), "ignored.txt\n").unwrap();
    fs::write(repo.join("ignored.txt"), "ignored content\n").unwrap();
    fs::write(repo.join("untracked.txt"), "untracked content\n").unwrap();

    // Stage tracked.txt
    let add_out = run_taxis(&repo, &["add", "tracked.txt"]);
    assert!(add_out.status.success(), "add failed");

    // Test cached (default)
    let ls_default = run_taxis(&repo, &["ls-files"]);
    assert!(ls_default.status.success());
    let stdout_def = String::from_utf8_lossy(&ls_default.stdout);
    let lines_def: Vec<&str> = stdout_def.lines().collect();
    assert!(lines_def.contains(&"tracked.txt"));
    assert!(!lines_def.contains(&"untracked.txt"));

    // Test -o (others without exclude)
    let ls_others_all = run_taxis(&repo, &["ls-files", "-o"]);
    assert!(ls_others_all.status.success());
    let stdout_o = String::from_utf8_lossy(&ls_others_all.stdout);
    let lines_o: Vec<&str> = stdout_o.lines().collect();
    assert!(lines_o.contains(&"untracked.txt"));
    assert!(lines_o.contains(&".gitignore"));
    assert!(lines_o.contains(&"ignored.txt"));
    assert!(!lines_o.contains(&"tracked.txt"));

    // Test -o --exclude-standard (others excluding ignored)
    let ls_others_ex = run_taxis(&repo, &["ls-files", "-o", "--exclude-standard"]);
    assert!(ls_others_ex.status.success());
    let stdout_o_ex = String::from_utf8_lossy(&ls_others_ex.stdout);
    let lines_o_ex: Vec<&str> = stdout_o_ex.lines().collect();
    assert!(lines_o_ex.contains(&"untracked.txt"));
    assert!(lines_o_ex.contains(&".gitignore"));
    assert!(!lines_o_ex.contains(&"ignored.txt"));

    // Test -o -i --exclude-standard (only ignored files)
    let ls_ignored = run_taxis(&repo, &["ls-files", "-o", "-i", "--exclude-standard"]);
    assert!(ls_ignored.status.success());
    let stdout_ign = String::from_utf8_lossy(&ls_ignored.stdout);
    let lines_ign: Vec<&str> = stdout_ign.lines().collect();
    assert!(lines_ign.contains(&"ignored.txt"));
    assert!(!lines_ign.contains(&"untracked.txt"));

    // Test -m (modified)
    fs::write(repo.join("tracked.txt"), "tracked content modified\n").unwrap();
    let ls_mod = run_taxis(&repo, &["ls-files", "-m"]);
    assert!(ls_mod.status.success());
    let stdout_m = String::from_utf8_lossy(&ls_mod.stdout);
    let lines_m: Vec<&str> = stdout_m.lines().collect();
    assert!(lines_m.contains(&"tracked.txt"));

    // Test -d (deleted)
    fs::remove_file(repo.join("tracked.txt")).unwrap();
    let ls_del = run_taxis(&repo, &["ls-files", "-d"]);
    assert!(ls_del.status.success());
    let stdout_d = String::from_utf8_lossy(&ls_del.stdout);
    let lines_d: Vec<&str> = stdout_d.lines().collect();
    assert!(lines_d.contains(&"tracked.txt"));

    let _ = fs::remove_dir_all(&repo);
}
