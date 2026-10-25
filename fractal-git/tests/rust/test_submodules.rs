//! Module: tests::test_submodules — Submodule Complete Lifecycle & Path Jail Security
//! File Path: tests/rust/test_submodules.rs
//! Architecture Role: Integration tests verifying .gitmodules parsing, submodule path validation,
//!   status calculation, config synchronization, and Path Jail boundary enforcement.
//! Dependencies & Triggers: Runs under `cargo test --test test_submodules`.
//! Responsibilities: Validate full submodule lifecycle operations without escape vulnerabilities.
//! Exit Semantics & Design Rationale:
//!   - Path traversal must fail with SecurityBreach error.
//!   - Submodule status must accurately report '-', '+', and ' ' symbols matching Git conventions.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use fg_core::models::{FileMode, Oid, SubmoduleEntry, SubmoduleUpdateStrategy};
use fg_index::submodules::GitModules;
use fg_topology::submodule::SubmoduleController;

static DIR_LOCK: Mutex<()> = Mutex::new(());

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(prefix: &str) -> Self {
        let _guard = DIR_LOCK.lock().unwrap();
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let count = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let base = if cfg!(windows) {
            let low = std::env::temp_dir().join("Low");
            let _ = std::fs::create_dir_all(&low);
            if low.exists() {
                low
            } else {
                std::env::temp_dir()
            }
        } else {
            std::env::temp_dir()
        };
        let path = base.join(format!("taxis_sub_test_{}_{}_{}", prefix, pid, count));
        std::fs::create_dir_all(&path).expect("Failed to create test directory");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn dummy_oid(byte: u8) -> Oid {
    let mut bytes = [0u8; 20];
    bytes[0] = byte;
    Oid::from_bytes(bytes)
}

#[test]
fn test_submodule_entry_path_jail_validation() {
    // Valid relative paths
    assert!(SubmoduleEntry::new("lib1", "vendor/lib1", "https://example.com/lib1.git").is_ok());
    assert!(SubmoduleEntry::new("engine", "src/sub/engine", "git@github.com:foo/bar.git").is_ok());

    // Path traversal escapes
    assert!(SubmoduleEntry::new("bad", "../outside", "https://example.com").is_err());
    assert!(SubmoduleEntry::new("bad", "vendor/../../outside", "https://example.com").is_err());
    assert!(SubmoduleEntry::new("bad", "/etc/passwd", "https://example.com").is_err());
    assert!(SubmoduleEntry::new("bad", "C:\\Windows", "https://example.com").is_err());
    assert!(SubmoduleEntry::new("bad", "   ", "https://example.com").is_err());
}

#[test]
fn test_gitmodules_round_trip_and_persistence() {
    let test_dir = TestDir::new("gitmodules_rw");
    let mut modules = GitModules::new();

    let entry1 = SubmoduleEntry::new("dep/a", "vendor/a", "https://example.com/a.git")
        .expect("entry1")
        .with_branch("main")
        .with_update_strategy(SubmoduleUpdateStrategy::Rebase);
    let entry2 = SubmoduleEntry::new("dep/b", "vendor/b", "https://example.com/b.git")
        .expect("entry2")
        .with_update_strategy(SubmoduleUpdateStrategy::Checkout);

    modules.insert(entry1.clone());
    modules.insert(entry2.clone());

    modules.write_to_worktree(test_dir.path()).expect("write gitmodules");

    let loaded = GitModules::load_from_worktree(test_dir.path()).expect("load gitmodules");
    assert_eq!(loaded.len(), 2);

    let found_a = loaded.get_by_path("vendor/a").expect("vendor/a");
    assert_eq!(found_a.name, "dep/a");
    assert_eq!(found_a.url, "https://example.com/a.git");
    assert_eq!(found_a.branch.as_deref(), Some("main"));
    assert_eq!(found_a.update_strategy, SubmoduleUpdateStrategy::Rebase);

    let found_b = loaded.get_by_name("dep/b").expect("dep/b");
    assert_eq!(found_b.path, "vendor/b");
}

#[test]
fn test_submodule_status_transitions() {
    let test_dir = TestDir::new("sub_status");
    let work_root = test_dir.path();

    let mut modules = BTreeMap::new();
    let entry = SubmoduleEntry::new("libs/math", "vendor/math", "https://example.com/math.git").expect("entry");
    modules.insert("vendor/math".to_string(), entry);

    let mut tree_gitlinks = BTreeMap::new();
    tree_gitlinks.insert("vendor/math".to_string(), (FileMode::Gitlink, dummy_oid(0xAA)));

    // Phase 1: Uninitialized (no local directory) -> '-'
    let status1 = SubmoduleController::compute_status(work_root, &modules, &tree_gitlinks);
    assert_eq!(status1.len(), 1);
    assert_eq!(status1[0].status_symbol, '-');
    assert!(!status1[0].is_initialized);
    assert_eq!(status1[0].gitlink_oid, Some(dummy_oid(0xAA).to_hex()));

    // Phase 2: Cloned but checked out different commit -> '+'
    let sub_git = work_root.join("vendor/math/.git");
    fs::create_dir_all(&sub_git).expect("create sub .git");
    fs::write(sub_git.join("HEAD"), format!("{}\n", dummy_oid(0xBB).to_hex())).expect("write sub HEAD");

    let status2 = SubmoduleController::compute_status(work_root, &modules, &tree_gitlinks);
    assert_eq!(status2.len(), 1);
    assert_eq!(status2[0].status_symbol, '+');
    assert!(status2[0].is_initialized);
    assert_eq!(status2[0].head_oid, Some(dummy_oid(0xBB).to_hex()));

    // Phase 3: Checked out exact commit matching parent Gitlink -> ' '
    fs::write(sub_git.join("HEAD"), format!("{}\n", dummy_oid(0xAA).to_hex())).expect("write matching HEAD");

    let status3 = SubmoduleController::compute_status(work_root, &modules, &tree_gitlinks);
    assert_eq!(status3.len(), 1);
    assert_eq!(status3[0].status_symbol, ' ');
    assert_eq!(status3[0].head_oid, Some(dummy_oid(0xAA).to_hex()));
}
