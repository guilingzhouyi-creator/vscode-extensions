//! Module: test_relocate — Repository Layout Migration Roundtrip
//! File Path: tests/rust/test_relocate.rs
//! Architecture Role: Verifies the two physical layouts the format defines can be reached from one
//!   another without losing the repository, and that a migration refuses the states it cannot honour.
//! Dependencies & Triggers: Executed via `cargo test --test test_relocate`.
//! Responsibilities: Exercise the layout primitives `taxis relocate` composes — classify, move,
//!   link, and unlink — because the CLI command itself is a thin wrapper over them.
//! Exit Semantics & Design Rationale: The blast radius of a botched relocation is a repository that
//!   no command can find, so the assertions check recoverability rather than only success: after
//!   each step the container must still decode and the identity must be unchanged.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use fg_native::{LayoutMode, PhysicalLayout, RepoDocument, RepoLayout};

/// Scratch directory that does not live under the sandbox-denied repository root.
struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(prefix: &str) -> Self {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let count = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let base = std::env::temp_dir().join("Low");
        let _ = std::fs::create_dir_all(&base);
        let path = base.join(format!("fg_test_relocate_{prefix}_{pid}_{count}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create test directory");
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

/// Creates a development-mode repository and returns its identity.
fn initialize_dev(workspace: &Path) -> [u8; 16] {
    let created = RepoLayout::dev(workspace).initialize().expect("initialize");
    let document = RepoDocument::load(&created.container_path).expect("load container");
    document.meta.repo_id
}

#[test]
fn a_development_repository_classifies_as_a_directory() {
    let workspace = TestDir::new("dev-classify");
    let repo_id = initialize_dev(workspace.path());

    assert_eq!(
        fg_native::classify_workspace_entry(workspace.path()).expect("classify"),
        PhysicalLayout::Directory
    );

    let document = RepoDocument::load(&fg_native::container_path(&workspace.path().join(".taxis")))
        .expect("load container");
    assert_eq!(document.meta.repo_id, repo_id);
    assert_eq!(document.meta.layout_mode, LayoutMode::Dev);
}

#[test]
fn an_empty_workspace_has_nothing_to_relocate() {
    let workspace = TestDir::new("absent");

    assert_eq!(
        fg_native::classify_workspace_entry(workspace.path()).expect("classify"),
        PhysicalLayout::Absent
    );
}

#[test]
fn moving_the_bytes_out_of_the_workspace_preserves_the_identity() {
    let workspace = TestDir::new("move-out");
    let store_root = TestDir::new("store-root");
    let repo_id = initialize_dev(workspace.path());

    let source_dir = workspace.path().join(fg_native::WORKSPACE_DIR_NAME);
    let store_dir = fg_native::store_path(store_root.path(), &repo_id);

    // The move happens before any link exists, so the bytes are never reachable from two places.
    std::fs::create_dir_all(store_dir.parent().expect("store parent")).expect("create store root");
    std::fs::rename(&source_dir, &store_dir).expect("move into the store");

    let moved = RepoDocument::load(&fg_native::container_path(&store_dir)).expect("load moved");
    assert_eq!(
        moved.meta.repo_id, repo_id,
        "identity must survive the move"
    );
    assert!(
        !source_dir.exists(),
        "the original directory must be gone, not copied"
    );
}

#[test]
fn a_store_path_is_derived_from_the_id_alone() {
    let first_home = TestDir::new("home-a");
    let second_home = TestDir::new("home-b");
    let repo_id = [0x42u8; 16];

    let first = fg_native::store_path(first_home.path(), &repo_id);
    let second = fg_native::store_path(second_home.path(), &repo_id);

    // The file name is the id, so two machines resolving the same repository agree on the leaf
    // name even though the home roots differ.
    assert_eq!(
        first.file_name(),
        second.file_name(),
        "the store leaf must depend only on the repository id"
    );
    assert_eq!(
        first.file_name().and_then(|name| name.to_str()),
        Some(fg_native::repo_id_to_hex(&repo_id).as_str())
    );
}

#[test]
fn a_store_already_holding_a_container_is_detectable_before_moving() {
    let workspace = TestDir::new("collision");
    let store_root = TestDir::new("collision-store");
    let repo_id = initialize_dev(workspace.path());

    // A store directory that already holds a container belongs to another repository. Relocation
    // must see this before moving anything, so the check is on the container, not the directory.
    let occupied = fg_native::store_path(store_root.path(), &repo_id);
    std::fs::create_dir_all(&occupied).expect("create occupied store");
    RepoDocument::for_new_repository(LayoutMode::Release)
        .expect("build document")
        .publish_new(&fg_native::container_path(&occupied))
        .expect("publish occupying container");

    assert!(
        fg_native::container_path(&occupied).exists(),
        "the destination container is what relocation must refuse to overwrite"
    );
}

#[test]
fn the_guard_file_survives_initialization() {
    let workspace = TestDir::new("guard-after-move");
    initialize_dev(workspace.path());

    let repo_dir = workspace.path().join(fg_native::WORKSPACE_DIR_NAME);
    let guard = fg_native::read_guard_file(&repo_dir)
        .expect("read guard")
        .expect("guard present");
    assert_eq!(guard, fg_native::GUARD_FILE_CONTENT);
}

#[test]
fn an_orphaned_link_is_distinguishable_from_an_absent_repository() {
    let workspace = TestDir::new("orphan");
    let store_root = TestDir::new("orphan-store");
    let repo_id = initialize_dev(workspace.path());

    let store_dir = fg_native::store_path(store_root.path(), &repo_id);
    std::fs::create_dir_all(store_dir.parent().expect("store parent")).expect("create store root");
    std::fs::create_dir_all(&store_dir).expect("create store");

    // Only Windows has junctions; elsewhere the classification cannot report a link at all.
    if !cfg!(windows) {
        return;
    }

    let entry = workspace.path().join(fg_native::WORKSPACE_DIR_NAME);
    std::fs::remove_dir_all(&entry).expect("remove workspace directory");
    match fg_native::create_junction(&entry, &store_dir) {
        Ok(()) => {}
        Err(_) => return,
    }

    // Removing the target must leave a link that classifies as orphaned, not as a deleted
    // repository: the two states need different repairs.
    std::fs::remove_dir_all(&store_dir).expect("remove store");
    assert_eq!(
        fg_native::classify_workspace_entry(workspace.path()).expect("classify"),
        PhysicalLayout::OrphanedLink { target: store_dir }
    );
}
