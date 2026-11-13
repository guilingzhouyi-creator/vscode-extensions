//! Module: tests::test_bounded_worktree — Bounded Worktree, Virtual Inodes & Elastic Quarantine
//! File Path: tests/rust/test_bounded_worktree.rs
//! Architecture Role: Integration suite validating invariant FileUid tracking across renames,
//!   asynchronous pre-declaration protocols, MutationBudget bounds, and elastic quarantine stashes.
//! Dependencies & Triggers: Runs under `cargo test --test test_bounded_worktree`.
//! Responsibilities: Confirm fail-closed bounds and verify zero data loss under permission breaches.
//! Exit Semantics & Design Rationale:
//!   - Rename operations preserve immutable FileUids with zero permission drift.
//!   - Quarantined modifications are persisted into patch stashes without polluting the commit tree.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Gate and violation boundary isolation guard

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use fg_core::error::FractalError;
use fg_core::models::{FileUid, MutationBudget, Oid, ReservationStatus, SliceAuthorization};
use fg_index::quarantine::{IsolateMutationRequest, QuarantineRegistry, QuarantineStatus};
use fg_index::virtual_inode::VirtualInodeTable;
use fg_storage::reflink::{clone_file_cow, detach_for_write, is_readonly};
use fg_topology::worktree::ScopeProjection;

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
        let base = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&base);
        let path = base.join(format!(
            "taxis_bounded_wt_test_{}_{}_{}",
            prefix, pid, count
        ));
        let _ = std::fs::remove_dir_all(&path);
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

#[test]
fn test_virtual_inode_rename_invariance() {
    let mut table = VirtualInodeTable::new(Oid::ZERO);
    let original_path = "crates/fg-core/src/parser.rs";
    let moved_path = "crates/fg-core/src/syntax/parser.rs";

    let uid = FileUid::derive("fractal-git", "agent-refactor", original_path, 1000, 42);

    table.insert(uid, original_path).expect("insert succeeds");
    assert_eq!(table.lookup_uid_by_path(original_path), Some(uid));
    assert_eq!(table.lookup_path_by_uid(&uid), Some(original_path));

    // Execute rename
    let returned_uid = table
        .rename_path(original_path, moved_path)
        .expect("rename succeeds");
    assert_eq!(returned_uid, uid);

    // Assert that the old path is unmapped and the new path points to the identical FileUid
    assert_eq!(table.lookup_uid_by_path(original_path), None);
    assert_eq!(table.lookup_uid_by_path(moved_path), Some(uid));
    assert_eq!(table.lookup_path_by_uid(&uid), Some(moved_path));
}

#[test]
fn test_async_pre_declaration_and_budget_bounds() {
    let mut table = VirtualInodeTable::new(Oid::ZERO);
    let mut slice = SliceAuthorization::new(
        "my-game",
        "agent-worker",
        HashSet::new(),
        vec!["tests/integration/".to_string(), "benches/".to_string()],
        MutationBudget::new(2, 200, 0),
    );

    // File 1: OK
    let token1 = table
        .reserve_file_async("tests/integration/test_foo.rs", &mut slice, 100, 3600, 1)
        .expect("reserve 1 succeeds");
    assert_eq!(token1.status, ReservationStatus::Pending);
    assert_eq!(slice.consumed_files, 1);

    // File 2: OK
    let token2 = table
        .reserve_file_async("benches/bench_bar.rs", &mut slice, 100, 3600, 2)
        .expect("reserve 2 succeeds");
    assert_eq!(token2.status, ReservationStatus::Pending);
    assert_eq!(slice.consumed_files, 2);

    // File 3: Budget exceeded
    let budget_error = table
        .reserve_file_async("tests/integration/test_baz.rs", &mut slice, 100, 3600, 3)
        .unwrap_err();
    match budget_error {
        FractalError::MutationBudgetExceeded {
            budget_type,
            requested,
            limit,
        } => {
            assert_eq!(budget_type, "max_files");
            assert_eq!(requested, 3);
            assert_eq!(limit, 2);
        }
        other => panic!("Unexpected error: {:?}", other),
    }

    // Confirm token 1
    let confirmed_uid = table
        .confirm_reservation(&token1.token_id, 200)
        .expect("confirm token 1");
    assert_eq!(confirmed_uid, token1.file_uid);
    assert_eq!(
        table.lookup_uid_by_path("tests/integration/test_foo.rs"),
        Some(confirmed_uid)
    );
}

#[test]
fn test_unauthorized_prefix_fail_closed() {
    let mut table = VirtualInodeTable::new(Oid::ZERO);
    let mut slice = SliceAuthorization::new(
        "my-game",
        "agent-worker",
        HashSet::new(),
        vec!["src/allowed/".to_string()],
        MutationBudget::default(),
    );

    let unauthorized_error = table
        .reserve_file_async("src/forbidden/secret.rs", &mut slice, 100, 3600, 1)
        .unwrap_err();

    match unauthorized_error {
        FractalError::UnauthorizedFileMutation { rel_path, .. } => {
            assert_eq!(rel_path, "src/forbidden/secret.rs");
        }
        other => panic!("Expected UnauthorizedFileMutation, got: {:?}", other),
    }
}

#[test]
fn test_quarantine_isolation_and_restoration_cycle() {
    let test_dir = TestDir::new("quar");
    let quar_dir = test_dir.path().join(".taxis").join("quarantine");

    let uid = FileUid::derive("WebGames", "agent-wg", "scripts/mod.gd", 500, 99);
    let patch_payload = "--- a/scripts/mod.gd\n+++ b/scripts/mod.gd\n@@ -1 +1 @@\n-old\n+new\n";

    // 1. Isolate
    let record = QuarantineRegistry::isolate_mutation(IsolateMutationRequest {
        quarantine_dir: &quar_dir,
        project_id: "WebGames",
        agent_id: "agent-wg",
        rel_path: "scripts/mod.gd",
        file_uid: Some(uid),
        patch_or_content: patch_payload,
        reason: "Unregistered FileUid mutation outside authorized slice",
        current_time: 1700000000,
        nonce: 42,
    })
    .expect("isolation succeeds");

    assert_eq!(record.status, QuarantineStatus::Isolated);
    assert_eq!(record.rel_path, "scripts/mod.gd");

    // 2. Query
    let active = QuarantineRegistry::list_active_isolated(&quar_dir).expect("list active");
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].quarantine_id, record.quarantine_id);

    // 3. Read content
    let retrieved_patch =
        QuarantineRegistry::read_patch_content(&quar_dir, &record).expect("read patch content");
    assert_eq!(retrieved_patch, patch_payload);

    // 4. Mark restored
    QuarantineRegistry::mark_restored(&quar_dir, &record.quarantine_id).expect("mark restored");
    let active_after = QuarantineRegistry::list_active_isolated(&quar_dir).expect("list after");
    assert_eq!(active_after.len(), 0);

    // 5. Audit history still preserves record in Restored status
    let found = QuarantineRegistry::find_by_id(&quar_dir, &record.quarantine_id)
        .expect("find by id")
        .expect("record exists");
    assert_eq!(found.status, QuarantineStatus::Restored);
}

#[test]
fn test_quarantine_workspace_restore_and_path_safety() {
    let test_dir = TestDir::new("quar_restore");
    let work_root = test_dir.path().join("work_root");
    let quar_dir = test_dir.path().join(".taxis").join("quarantine");
    std::fs::create_dir_all(&work_root).unwrap();

    let target_file = work_root.join("scripts/mod.gd");
    std::fs::create_dir_all(target_file.parent().unwrap()).unwrap();
    std::fs::write(&target_file, "old\n").unwrap();

    let patch_payload = "--- a/scripts/mod.gd\n+++ b/scripts/mod.gd\n@@ -1 +1 @@\n-old\n+new\n";

    let record = QuarantineRegistry::isolate_mutation(IsolateMutationRequest {
        quarantine_dir: &quar_dir,
        project_id: "WebGames",
        agent_id: "agent-wg",
        rel_path: "scripts/mod.gd",
        file_uid: None,
        patch_or_content: patch_payload,
        reason: "Unregistered mutation outside slice",
        current_time: 1700000000,
        nonce: 101,
    })
    .expect("isolation succeeds");

    // Replay restoration to workspace
    let restored =
        QuarantineRegistry::restore_to_workspace(&quar_dir, &record.quarantine_id, &work_root)
            .expect("restore succeeds");
    assert_eq!(restored.status, QuarantineStatus::Restored);

    let restored_file_content = std::fs::read_to_string(&target_file).unwrap();
    assert_eq!(restored_file_content, "new\n");

    // Path traversal breach must fail closed
    let traversal_record = QuarantineRegistry::isolate_mutation(IsolateMutationRequest {
        quarantine_dir: &quar_dir,
        project_id: "WebGames",
        agent_id: "agent-evil",
        rel_path: "../../../evil.txt",
        file_uid: None,
        patch_or_content: "malicious",
        reason: "Path traversal attempt",
        current_time: 1700000000,
        nonce: 102,
    })
    .expect("isolation succeeds");

    let err = QuarantineRegistry::restore_to_workspace(
        &quar_dir,
        &traversal_record.quarantine_id,
        &work_root,
    )
    .unwrap_err();
    match err {
        FractalError::PolicyViolation(msg) => {
            assert!(msg.contains("forbidden"));
        }
        other => panic!("Expected PolicyViolation, got: {:?}", other),
    }
}

#[test]
fn test_virtual_inode_persistence_roundtrip() {
    let test_dir = TestDir::new("inode_table");
    let table_file = test_dir.path().join("virtual_inodes.json");

    let base_oid = Oid::from_hex("0123456789abcdef0123456789abcdef01234567").unwrap();
    let mut original = VirtualInodeTable::new(base_oid);

    let uid1 = FileUid::derive("prj", "ag", "src/a.rs", 10, 1);
    let uid2 = FileUid::derive("prj", "ag", "src/b.rs", 20, 2);

    original.insert(uid1, "src/a.rs").unwrap();
    original.insert(uid2, "src/b.rs").unwrap();

    original.save_to_path(&table_file).expect("save succeeds");

    let loaded = VirtualInodeTable::load_from_path(&table_file).expect("load succeeds");
    assert_eq!(loaded.base_commit_oid, base_oid);
    assert_eq!(loaded.lookup_uid_by_path("src/a.rs"), Some(uid1));
    assert_eq!(loaded.lookup_uid_by_path("src/b.rs"), Some(uid2));
    assert_eq!(loaded.lookup_path_by_uid(&uid1), Some("src/a.rs"));
    assert_eq!(loaded.lookup_path_by_uid(&uid2), Some("src/b.rs"));
}

#[test]
fn test_cow_worktree_materialization_and_path_jail_isolation() {
    let test_dir = TestDir::new("cow_isolation");
    let trunk_root = test_dir.path().join("trunk");
    let agent_root = test_dir.path().join("agent_worktree");

    std::fs::create_dir_all(trunk_root.join("src/allowed")).unwrap();
    std::fs::create_dir_all(trunk_root.join("src/restricted")).unwrap();

    let manifest = trunk_root.join("Cargo.toml");
    let allowed_file = trunk_root.join("src/allowed/worker.rs");
    let restricted_file = trunk_root.join("src/restricted/core.rs");

    std::fs::write(&manifest, "[package]\nname = \"test\"\n").unwrap();
    std::fs::write(&allowed_file, "pub fn do_work() { 1 }\n").unwrap();
    std::fs::write(&restricted_file, "pub fn core_secret() { 999 }\n").unwrap();

    let projection = ScopeProjection::scoped(vec!["src/allowed/".to_string()]);

    // Materialize into agent_root using CoW clone
    let dst_manifest = agent_root.join("Cargo.toml");
    let dst_allowed = agent_root.join("src/allowed/worker.rs");
    let dst_restricted = agent_root.join("src/restricted/core.rs");

    clone_file_cow(&manifest, &dst_manifest).unwrap();
    clone_file_cow(&allowed_file, &dst_allowed).unwrap();
    clone_file_cow(&restricted_file, &dst_restricted).unwrap();

    // Restricted file outside scope must be set read-only
    if !projection.contains_path("src/restricted/core.rs") {
        let _ = fg_storage::reflink::set_readonly(&dst_restricted, true);
    }

    assert!(dst_manifest.exists());
    assert!(dst_allowed.exists());
    assert!(dst_restricted.exists());
    assert!(
        is_readonly(&dst_restricted),
        "restricted file must be read-only"
    );

    // Agent modifies allowed file (detach if needed, write)
    let _ = detach_for_write(&dst_allowed);
    std::fs::write(&dst_allowed, "pub fn do_work() { 2 }\n").unwrap();

    // Verify trunk file is completely untouched
    assert_eq!(
        std::fs::read_to_string(&allowed_file).unwrap(),
        "pub fn do_work() { 1 }\n",
        "trunk file must remain unchanged after agent modification"
    );
    assert_eq!(
        std::fs::read_to_string(&dst_allowed).unwrap(),
        "pub fn do_work() { 2 }\n",
        "agent file must reflect modification"
    );
}
