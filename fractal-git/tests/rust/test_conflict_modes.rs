//! Module: tests::test_conflict_modes — Dual-Mode Conflict Presentation and Dirty Worktree Safety
//! File Path: tests/rust/test_conflict_modes.rs
//! Architecture Role: Integration verification for Agent-Algebraic vs Git-Compat conflict presentation,
//!   TAXC META persistence, runtime `config` mutation, and 3-way DirtyWorktreeGuard safety.
//! Dependencies & Triggers: Runs under `cargo test --test test_conflict_modes`.
//! Responsibilities: Validate conflict presentation dual-modes, runtime switching, and dirty worktree protection.
//! Exit Semantics & Design Rationale:
//!   - AgentAlgebraic must never inject broken marker strings into workspace files.
//!   - GitCompat and Diff3 must render exact standard Git conflict marker strings.
//!   - DirtyWorktreeGuard must deterministically block overwriting untracked or dirty local files.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use fg_core::models::{ConflictPresentationMode, FileMode, IndexStage, Oid};
use fg_index::{DirtyCollisionKind, DirtyWorktreeGuard, IndexEntry};
use fg_native::sections::meta::{LayoutMode, MetaSection};
use fg_topology::conflict_tree::ConflictTreeManager;

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
        let path = base.join(format!("taxis_conflict_test_{}_{}_{}", prefix, pid, count));
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

fn dummy_entry(path: &str, oid: Oid) -> IndexEntry {
    IndexEntry {
        path: path.to_string(),
        mode: FileMode::RegularFile,
        oid,
        stage: IndexStage::Normal,
        size: 100,
        mtime_seconds: 1000,
        mtime_nanos: 0,
        assume_valid: false,
        skip_worktree: false,
        intent_to_add: false,
    }
}

#[test]
fn test_meta_section_conflict_mode_round_trip() {
    let mut repo_id = [0u8; 16];
    repo_id[0] = 0x42;
    let meta = MetaSection::new(repo_id, 1_700_000_000_000, LayoutMode::Dev)
        .with_conflict_mode(ConflictPresentationMode::GitCompat);

    assert_eq!(meta.conflict_mode, ConflictPresentationMode::GitCompat);
    let encoded = meta.encode().expect("encode");
    let decoded = MetaSection::decode(&encoded).expect("decode");
    assert_eq!(decoded.conflict_mode, ConflictPresentationMode::GitCompat);

    let meta_agent = meta.with_conflict_mode(ConflictPresentationMode::AgentAlgebraic);
    let enc_agent = meta_agent.encode().expect("encode");
    let dec_agent = MetaSection::decode(&enc_agent).expect("decode");
    assert_eq!(dec_agent.conflict_mode, ConflictPresentationMode::AgentAlgebraic);
}

#[test]
fn test_agent_algebraic_keeps_files_clean_and_compilable() {
    let base = b"pub fn calculate() -> i32 { 1 }\n";
    let ours = b"pub fn calculate() -> i32 { 2 }\n";
    let theirs = b"pub fn calculate() -> i32 { 3 }\n";

    let rendered = ConflictTreeManager::render_content(
        ConflictPresentationMode::AgentAlgebraic,
        base,
        ours,
        theirs,
        "HEAD",
        "feature",
    );

    // Assert that AgentAlgebraic preserves the clean 'ours' branch content
    assert_eq!(rendered, ours);
    let text = String::from_utf8(rendered).expect("utf8");
    assert!(!text.contains("<<<<<<<"));
    assert!(!text.contains("======="));
    assert!(!text.contains(">>>>>>>"));
}

#[test]
fn test_git_compat_and_diff3_render_proper_markers() {
    let base = b"base_implementation\n";
    let ours = b"ours_feature\n";
    let theirs = b"theirs_feature\n";

    // 1. GitCompat 2-way
    let git_compat_bytes = ConflictTreeManager::render_content(
        ConflictPresentationMode::GitCompat,
        base,
        ours,
        theirs,
        "HEAD",
        "feature",
    );
    let git_compat_str = String::from_utf8(git_compat_bytes).expect("utf8");
    assert!(git_compat_str.contains("<<<<<<< HEAD\nours_feature\n=======\ntheirs_feature\n>>>>>>> feature\n"));
    assert!(!git_compat_str.contains("|||||||"));

    // 2. Diff3 3-way
    let diff3_bytes = ConflictTreeManager::render_content(
        ConflictPresentationMode::Diff3,
        base,
        ours,
        theirs,
        "HEAD",
        "feature",
    );
    let diff3_str = String::from_utf8(diff3_bytes).expect("utf8");
    assert!(diff3_str.contains("<<<<<<< HEAD\nours_feature\n||||||| base\nbase_implementation\n=======\ntheirs_feature\n>>>>>>> feature\n"));
}

#[test]
fn test_conflict_tree_manager_lifecycle_and_slices() {
    let mut manager = ConflictTreeManager::new();
    assert_eq!(manager.conflict_count(), 0);

    manager.record_conflict(
        "src/core.rs",
        FileMode::RegularFile,
        Some(dummy_oid(1)),
        Some(dummy_oid(2)),
        Some(dummy_oid(3)),
    );

    assert_eq!(manager.conflict_count(), 1);
    let slice = manager.conflicts().get("src/core.rs").expect("slice exists");
    let report = slice.to_agent_report(120, 135);
    assert_eq!(report.path, "src/core.rs");
    assert_eq!(report.status, "unmerged_algebraic");
    assert_eq!(report.ours_len, 120);
    assert_eq!(report.theirs_len, 135);

    // Resolve ours
    let resolved_oid = manager.resolve_ours("src/core.rs");
    assert_eq!(resolved_oid, Some(dummy_oid(2)));
    assert_eq!(manager.conflict_count(), 0);
}

#[test]
fn test_dirty_worktree_guard_collision_detection() {
    let mut current_tree = BTreeMap::new();
    current_tree.insert("tracked.rs".to_string(), (FileMode::RegularFile, dummy_oid(1)));
    current_tree.insert("deleted.rs".to_string(), (FileMode::RegularFile, dummy_oid(2)));

    let mut target_tree = BTreeMap::new();
    target_tree.insert("tracked.rs".to_string(), (FileMode::RegularFile, dummy_oid(9)));
    target_tree.insert("untracked_new.rs".to_string(), (FileMode::RegularFile, dummy_oid(3)));
    // deleted.rs is omitted from target_tree

    let entry_tracked = dummy_entry("tracked.rs", dummy_oid(1));
    let entry_deleted = dummy_entry("deleted.rs", dummy_oid(2));

    let mut index_entries = BTreeMap::new();
    index_entries.insert("tracked.rs".to_string(), &entry_tracked);
    index_entries.insert("deleted.rs".to_string(), &entry_deleted);

    let collisions = DirtyWorktreeGuard::check_transition(
        &current_tree,
        &target_tree,
        &index_entries,
        |p| p == "untracked_new.rs",
        |p, _| p == "tracked.rs",
    );

    assert_eq!(collisions.len(), 2);
    let collision_map: BTreeMap<_, _> = collisions.into_iter().map(|c| (c.path, c.kind)).collect();

    assert_eq!(
        collision_map.get("untracked_new.rs"),
        Some(&DirtyCollisionKind::UntrackedOverwritten)
    );
    assert_eq!(
        collision_map.get("tracked.rs"),
        Some(&DirtyCollisionKind::UnstagedModified)
    );

    let rejection_msg = DirtyWorktreeGuard::format_rejection(
        &[
            DirtyWorktreeGuard::check_transition(
                &current_tree,
                &target_tree,
                &index_entries,
                |p| p == "untracked_new.rs",
                |p, _| p == "tracked.rs",
            )[0]
                .clone(),
        ],
        "checkout",
    );
    assert!(rejection_msg.contains("error:"));
    assert!(rejection_msg.contains("checkout"));
}

#[test]
fn test_config_file_update_and_load() {
    let test_dir = TestDir::new("config_test");
    let config_file = test_dir.path().join("config");

    // Write initial config
    let initial = "[core]\n\tfilemode = true\n";
    std::fs::write(&config_file, initial).expect("write config");

    let repo_config = fg_index::config::RepoConfig::load(test_dir.path());
    assert_eq!(repo_config.conflict_mode(), ConflictPresentationMode::AgentAlgebraic);

    // Update conflict.mode
    fg_index::config::write_config_entry(
        &config_file,
        "conflict",
        "mode",
        "git-compat",
    )
    .expect("write entry");

    let updated_config = fg_index::config::RepoConfig::load(test_dir.path());
    assert_eq!(updated_config.conflict_mode(), ConflictPresentationMode::GitCompat);

    // Update back to diff3
    fg_index::config::write_config_entry(
        &config_file,
        "conflict",
        "mode",
        "diff3",
    )
    .expect("write diff3 entry");

    let diff3_config = fg_index::config::RepoConfig::load(test_dir.path());
    assert_eq!(diff3_config.conflict_mode(), ConflictPresentationMode::Diff3);
}
