//! Module: tests::test_commit_materializer — Commit Materialization Pipeline Verification
//! File Path: tests/rust/test_commit_materializer.rs
//! Architecture Role: Proves that a commit request produces real, resolvable Git objects on
//!   disk and advances the target reference to the created commit.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Object persistence, tree hierarchy, parent chaining, failure atomicity.
//! Exit Semantics & Design Rationale: Assertions target observable filesystem and ref state,
//!   so a regression that silently skips a write cannot pass.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use fractal_git::{
    materialize_commit, CommitMaterializationRequest, DiskRefStore, FileMode, GitSignature,
    LooseOdb, OdbStore, RefStore,
};

/// Monotonic counter keeping scratch directory names unique within one process.
static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Creates a unique scratch directory.
///
/// On Windows the base is `%TEMP%\Low`, matching the convention used by the other storage
/// suites so that the sandboxed test host can create directories there.
fn scratch_dir(label: &str) -> PathBuf {
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
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
    let path = base.join(format!(
        "taxis_materializer_{}_{}_{}",
        label,
        std::process::id(),
        count
    ));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).expect("create scratch directory");
    path
}

/// Writes a UTF-8 file beneath `root`, creating parent directories as needed.
fn write_file(root: &Path, relative: &str, contents: &str) {
    let target = root.join(relative);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).expect("create file parent directory");
    }
    std::fs::write(&target, contents).expect("write scratch file");
}

/// Builds a request anchored at `root` targeting `ref_name`.
fn request_for(
    root: &Path,
    files: &[&str],
    message: &str,
    ref_name: &str,
) -> CommitMaterializationRequest {
    CommitMaterializationRequest {
        files: files.iter().map(|path| path.to_string()).collect(),
        work_root: root.to_path_buf(),
        message: message.to_string(),
        author: GitSignature::new(
            "Lead Architect",
            "architect@company.internal",
            1_700_000_000,
        ),
        target_ref: ref_name.to_string(),
    }
}

#[test]
fn materialize_commit_persists_objects_and_advances_ref() {
    let root = scratch_dir("objects");
    write_file(&root, "README.md", "hello taxis\n");
    write_file(&root, "src/main.rs", "fn main() {}\n");

    let git_dir = root.join(".git");
    let odb = LooseOdb::new(&git_dir);
    let ref_store = DiskRefStore::new(&git_dir);
    let request = request_for(
        &root,
        &["README.md", "src/main.rs"],
        "feat(core): initial materialization\n",
        "refs/fractal/cell/cell-alpha/main",
    );

    let materialized =
        materialize_commit(&odb, &ref_store, &request).expect("materialization must succeed");

    // The reference now points at the created commit.
    let stored_ref = ref_store
        .get_ref("refs/fractal/cell/cell-alpha/main")
        .expect("read advanced reference");
    assert_eq!(stored_ref, Some(materialized.commit_oid));
    assert!(materialized.parent_oid.is_none());

    // Every object is resolvable from the object database.
    assert!(odb.has_object(&materialized.commit_oid));
    assert!(odb.has_object(&materialized.tree_oid));
    for blob_oid in &materialized.blob_oids {
        assert!(odb.has_object(blob_oid));
    }

    // Modes are reported for every staged path so index rewrites can stay faithful.
    assert_eq!(materialized.modes, vec![FileMode::RegularFile; 2]);

    // Blob payloads round-trip through the loose store with their canonical headers.
    let readme_blob = odb
        .read_object(&materialized.blob_oids[0])
        .expect("read README blob");
    assert!(readme_blob.starts_with(b"blob 12\0"));
    assert!(readme_blob.ends_with(b"hello taxis\n"));

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn materialize_commit_chains_onto_existing_reference() {
    let root = scratch_dir("chain");
    write_file(&root, "a.txt", "first\n");

    let git_dir = root.join(".git");
    let odb = LooseOdb::new(&git_dir);
    let ref_store = DiskRefStore::new(&git_dir);
    let ref_name = "refs/fractal/cell/cell-beta/main";

    let first = materialize_commit(
        &odb,
        &ref_store,
        &request_for(&root, &["a.txt"], "feat: first commit\n", ref_name),
    )
    .expect("first commit");

    write_file(&root, "b.txt", "second\n");
    let second = materialize_commit(
        &odb,
        &ref_store,
        &request_for(&root, &["b.txt"], "feat: second commit\n", ref_name),
    )
    .expect("second commit");

    // The second commit records the first as its parent, keeping history connected.
    assert_eq!(second.parent_oid, Some(first.commit_oid));
    assert_ne!(first.tree_oid, second.tree_oid);
    assert_eq!(
        ref_store.get_ref(ref_name).expect("read ref"),
        Some(second.commit_oid)
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn materialize_commit_rejects_missing_file_without_advancing_ref() {
    let root = scratch_dir("missing");
    let git_dir = root.join(".git");
    let odb = LooseOdb::new(&git_dir);
    let ref_store = DiskRefStore::new(&git_dir);
    let ref_name = "refs/fractal/cell/cell-gamma/main";

    let failure = materialize_commit(
        &odb,
        &ref_store,
        &request_for(&root, &["absent.txt"], "feat: absent\n", ref_name),
    )
    .expect_err("a missing staged file must fail");

    let diagnostic = failure.to_string();
    assert!(
        diagnostic.contains("does not exist"),
        "expected a distinct missing-file diagnostic, got: {}",
        diagnostic
    );
    assert!(ref_store.get_ref(ref_name).expect("read ref").is_none());

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn materialize_commit_rejects_empty_file_list() {
    let root = scratch_dir("empty");
    let git_dir = root.join(".git");
    let odb = LooseOdb::new(&git_dir);
    let ref_store = DiskRefStore::new(&git_dir);

    let failure = materialize_commit(
        &odb,
        &ref_store,
        &request_for(
            &root,
            &[],
            "feat: nothing\n",
            "refs/fractal/cell/cell-delta/main",
        ),
    )
    .expect_err("an empty file list must fail");

    assert!(failure.to_string().contains("at least one file"));

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn materialize_commit_tree_contains_nested_paths() {
    let root = scratch_dir("nested");
    write_file(&root, "docs/guide/intro.md", "intro\n");

    let git_dir = root.join(".git");
    let odb = LooseOdb::new(&git_dir);
    let ref_store = DiskRefStore::new(&git_dir);
    let request = request_for(
        &root,
        &["docs/guide/intro.md"],
        "docs: add guide\n",
        "refs/fractal/cell/cell-epsilon/main",
    );

    let materialized = materialize_commit(&odb, &ref_store, &request).expect("nested commit");

    // The root tree must exist and the commit must reference it.
    let commit_bytes = odb
        .read_object(&materialized.commit_oid)
        .expect("read commit object");
    let commit_text = String::from_utf8_lossy(&commit_bytes);
    assert!(commit_text.contains(&format!("tree {}", materialized.tree_oid.to_hex())));
    assert!(commit_text.contains("docs: add guide"));

    let _ = std::fs::remove_dir_all(&root);
}

/// Proves the materializer records executable and symbolic-link modes instead of flattening.
///
/// Git derives both distinctions from the working tree when the index carries no overriding
/// statistics. Losing them would silently demote a script to a plain file and copy the bytes a
/// symbolic link points at, which changes the committed tree rather than merely its metadata.
#[cfg(unix)]
#[test]
fn materialize_commit_preserves_executable_and_symlink_modes() {
    use std::os::unix::fs::PermissionsExt;

    let root = scratch_dir("modes");
    write_file(&root, "run.sh", "#!/bin/sh\necho hi\n");
    write_file(&root, "plain.txt", "plain\n");
    let script_path = root.join("run.sh");
    let mut permissions = std::fs::metadata(&script_path)
        .expect("stat script")
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&script_path, permissions).expect("mark script executable");
    std::os::unix::fs::symlink("run.sh", root.join("link.sh")).expect("create symlink");

    let git_dir = root.join(".git");
    let odb = LooseOdb::new(&git_dir);
    let ref_store = DiskRefStore::new(&git_dir);
    let request = request_for(
        &root,
        &["run.sh", "plain.txt", "link.sh"],
        "feat(storage): keep working-tree modes\n",
        "refs/fractal/cell/cell-modes/main",
    );

    let materialized =
        materialize_commit(&odb, &ref_store, &request).expect("materialization must succeed");

    // The reported modes mirror the tree, in request order.
    assert_eq!(
        materialized.modes,
        vec![
            FileMode::ExecutableFile,
            FileMode::RegularFile,
            FileMode::Symlink
        ]
    );
    let tree_payload = odb
        .read_object(&materialized.tree_oid)
        .expect("read root tree");
    assert!(tree_payload
        .windows(b"100755 run.sh".len())
        .any(|window| window == b"100755 run.sh"));
    assert!(tree_payload
        .windows(b"120000 link.sh".len())
        .any(|window| window == b"120000 link.sh"));

    // A symbolic link stores its target text, never the bytes of the file it points at.
    let link_blob = odb
        .read_object(&materialized.blob_oids[2])
        .expect("read symlink blob");
    assert!(link_blob.ends_with(b"run.sh"));

    let _ = std::fs::remove_dir_all(&root);
}
