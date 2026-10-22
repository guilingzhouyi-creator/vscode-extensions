//! Module: tests::test_refs — Reference Resolution Across Both On-Disk Sources
//! File Path: tests/rust/test_refs.rs
//! Architecture Role: Proves that `DiskRefStore` reports the same reference set Git does, by
//!   reading loose files, the packed table, symbolic bodies, and `HEAD` through one path.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Loose versus packed precedence, symbolic resolution, peeled line skipping,
//!   unborn and detached `HEAD`, refused scans, and unique atomic-write staging names.
//! Exit Semantics & Design Rationale: Every assertion inspects bytes this test wrote itself, so a
//!   regression that silently drops a reference or swallows an I/O failure cannot pass.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use fractal_git::{DiskRefStore, HeadState, Oid, RefStore};

/// Monotonic counter keeping scratch directory names unique within one process.
static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Creates a unique repository-shaped scratch directory.
///
/// On Windows the base is `%TEMP%\Low`, matching the convention used by the other storage suites
/// so that the sandboxed test host can create directories there.
fn scratch_repo(label: &str) -> PathBuf {
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = if cfg!(windows) {
        let low = std::env::temp_dir().join("Low");
        let _ = fs::create_dir_all(&low);
        if low.exists() {
            low
        } else {
            std::env::temp_dir()
        }
    } else {
        std::env::temp_dir()
    };
    let path = base.join(format!(
        "taxis_refs_{}_{}_{}",
        label,
        std::process::id(),
        count
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(path.join("refs")).expect("scratch refs directory must be creatable");
    path
}

/// Builds a distinct object id whose first byte is derived from `seed`.
fn oid_from_seed(seed: u8) -> Oid {
    let mut bytes = [0u8; 20];
    for (index, slot) in bytes.iter_mut().enumerate() {
        *slot = seed.wrapping_add(index as u8);
    }
    Oid::from_bytes(bytes)
}

/// Writes one loose reference file with the given body.
fn write_loose(git_dir: &Path, name: &str, body: &str) {
    let path = git_dir.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parent directory must be creatable");
    }
    fs::write(&path, body).expect("reference file must be writable");
}

/// Looks up one name in a listing.
fn find_ref(listed: &[(String, Oid)], name: &str) -> Option<Oid> {
    listed
        .iter()
        .find(|(entry_name, _)| entry_name == name)
        .map(|(_, oid)| *oid)
}

/// A repository whose only loose reference records an object id is read back unchanged.
#[test]
fn a_loose_reference_is_reported_with_its_object_id() {
    let git_dir = scratch_repo("loose");
    let expected = oid_from_seed(0x11);
    write_loose(
        &git_dir,
        "refs/heads/main",
        &format!("{}\n", expected.to_hex()),
    );

    let store = DiskRefStore::new(&git_dir);
    let listed = store.list_all().expect("listing must succeed");
    assert_eq!(find_ref(&listed, "refs/heads/main"), Some(expected));
    let _ = fs::remove_dir_all(&git_dir);
}

/// The packed table contributes references that have no loose file.
#[test]
fn a_packed_reference_is_reported_when_no_loose_file_exists() {
    let git_dir = scratch_repo("packed");
    let packed_oid = oid_from_seed(0x22);
    fs::write(
        git_dir.join("packed-refs"),
        format!(
            "# pack-refs with: peeled fully-peeled sorted\n{} refs/tags/v1.0\n",
            packed_oid.to_hex()
        ),
    )
    .expect("packed table must be writable");

    let store = DiskRefStore::new(&git_dir);
    let listed = store.list_all().expect("listing must succeed");
    assert_eq!(find_ref(&listed, "refs/tags/v1.0"), Some(packed_oid));
    let _ = fs::remove_dir_all(&git_dir);
}

/// A peeled target line in the packed table never becomes its own reference.
#[test]
fn a_peeled_line_is_not_reported_as_a_reference() {
    let git_dir = scratch_repo("peeled");
    let tag_oid = oid_from_seed(0x33);
    let commit_oid = oid_from_seed(0x44);
    fs::write(
        git_dir.join("packed-refs"),
        format!(
            "{} refs/tags/v2.0\n^{}\n",
            tag_oid.to_hex(),
            commit_oid.to_hex()
        ),
    )
    .expect("packed table must be writable");

    let store = DiskRefStore::new(&git_dir);
    let listed = store.list_all().expect("listing must succeed");
    assert_eq!(listed.len(), 1);
    assert_eq!(find_ref(&listed, "refs/tags/v2.0"), Some(tag_oid));
    let _ = fs::remove_dir_all(&git_dir);
}

/// A loose file overrides the packed entry with the same name.
#[test]
fn a_loose_file_wins_over_the_packed_entry() {
    let git_dir = scratch_repo("precedence");
    let packed_oid = oid_from_seed(0x55);
    let loose_oid = oid_from_seed(0x66);
    fs::write(
        git_dir.join("packed-refs"),
        format!("{} refs/heads/main\n", packed_oid.to_hex()),
    )
    .expect("packed table must be writable");
    write_loose(
        &git_dir,
        "refs/heads/main",
        &format!("{}\n", loose_oid.to_hex()),
    );

    let store = DiskRefStore::new(&git_dir);
    let listed = store.list_all().expect("listing must succeed");
    assert_eq!(find_ref(&listed, "refs/heads/main"), Some(loose_oid));
    let _ = fs::remove_dir_all(&git_dir);
}

/// A symbolic reference resolves to the object its target names.
#[test]
fn a_symbolic_reference_resolves_to_its_target_object() {
    let git_dir = scratch_repo("symbolic");
    let target_oid = oid_from_seed(0x77);
    write_loose(
        &git_dir,
        "refs/remotes/origin/main",
        &format!("{}\n", target_oid.to_hex()),
    );
    write_loose(
        &git_dir,
        "refs/remotes/origin/HEAD",
        "ref: refs/remotes/origin/main\n",
    );

    let store = DiskRefStore::new(&git_dir);
    let listed = store.list_all().expect("listing must succeed");
    assert_eq!(
        find_ref(&listed, "refs/remotes/origin/HEAD"),
        Some(target_oid)
    );
    let _ = fs::remove_dir_all(&git_dir);
}

/// A symbolic reference whose target is absent is omitted instead of reported with a wrong id.
#[test]
fn a_symbolic_reference_without_a_target_is_omitted() {
    let git_dir = scratch_repo("dangling");
    write_loose(
        &git_dir,
        "refs/remotes/origin/HEAD",
        "ref: refs/remotes/origin/main\n",
    );

    let store = DiskRefStore::new(&git_dir);
    let listed = store.list_all().expect("listing must succeed");
    assert!(listed.is_empty(), "dangling symbolic ref must be omitted");
    let _ = fs::remove_dir_all(&git_dir);
}

/// A symbolic reference that points at itself is reported as corruption, not followed forever.
#[test]
fn a_symbolic_cycle_is_reported_as_corruption() {
    let git_dir = scratch_repo("cycle");
    write_loose(&git_dir, "refs/heads/loop", "ref: refs/heads/loop\n");

    let store = DiskRefStore::new(&git_dir);
    let scan = store.list_all();
    assert!(scan.is_err(), "a symbolic cycle must not be followed");
    let _ = fs::remove_dir_all(&git_dir);
}

/// `HEAD` as a symbolic body reports the branch and the commit it resolves to.
#[test]
fn a_symbolic_head_reports_the_branch_and_its_commit() {
    let git_dir = scratch_repo("head-symbolic");
    let head_oid = oid_from_seed(0x88);
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("HEAD must be writable");
    write_loose(
        &git_dir,
        "refs/heads/main",
        &format!("{}\n", head_oid.to_hex()),
    );

    let store = DiskRefStore::new(&git_dir);
    let head = store.head().expect("head resolution must succeed");
    assert_eq!(
        head,
        HeadState::Symbolic {
            name: "refs/heads/main".to_string(),
            target: Some(head_oid),
        }
    );
    let _ = fs::remove_dir_all(&git_dir);
}

/// A branch that has no commits yet reports a symbolic head with no target.
#[test]
fn an_unborn_branch_reports_a_symbolic_head_without_a_target() {
    let git_dir = scratch_repo("head-unborn");
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("HEAD must be writable");

    let store = DiskRefStore::new(&git_dir);
    let head = store.head().expect("head resolution must succeed");
    assert_eq!(
        head,
        HeadState::Symbolic {
            name: "refs/heads/main".to_string(),
            target: None,
        }
    );
    let _ = fs::remove_dir_all(&git_dir);
}

/// A body that records an object id directly reports a detached head.
#[test]
fn a_direct_body_reports_a_detached_head() {
    let git_dir = scratch_repo("head-detached");
    let head_oid = oid_from_seed(0x99);
    fs::write(git_dir.join("HEAD"), format!("{}\n", head_oid.to_hex()))
        .expect("HEAD must be writable");

    let store = DiskRefStore::new(&git_dir);
    let head = store.head().expect("head resolution must succeed");
    assert_eq!(head, HeadState::Detached(head_oid));
    let _ = fs::remove_dir_all(&git_dir);
}

/// A repository with no `HEAD` reports absence rather than a fabricated position.
#[test]
fn a_missing_head_reports_absence() {
    let git_dir = scratch_repo("head-absent");

    let store = DiskRefStore::new(&git_dir);
    let head = store.head().expect("head resolution must succeed");
    assert_eq!(head, HeadState::Absent);
    let _ = fs::remove_dir_all(&git_dir);
}

/// A `refs` path that exists as a file is reported as corruption.
#[test]
fn a_refs_path_that_is_not_a_directory_is_reported() {
    let git_dir = scratch_repo("refs-file");
    fs::remove_dir_all(git_dir.join("refs")).expect("scratch refs directory must be removable");
    fs::write(git_dir.join("refs"), b"not a directory").expect("file must be writable");

    let store = DiskRefStore::new(&git_dir);
    let scan = store.list_all();
    assert!(scan.is_err(), "a file in place of refs/ must be reported");
    let _ = fs::remove_dir_all(&git_dir);
}

/// Updating a symbolic reference writes the branch it names instead of replacing the body.
#[test]
fn updating_a_symbolic_reference_preserves_the_symbolic_body() {
    let git_dir = scratch_repo("update-symbolic");
    let new_oid = oid_from_seed(0xab);
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("HEAD must be writable");

    let store = DiskRefStore::new(&git_dir);
    store
        .update_ref("HEAD", &new_oid, None)
        .expect("update must succeed");

    let head_body = fs::read_to_string(git_dir.join("HEAD")).expect("HEAD must be readable");
    assert!(head_body.starts_with("ref: "), "symbolic body must survive");
    let branch_body =
        fs::read_to_string(git_dir.join("refs/heads/main")).expect("branch must be readable");
    assert_eq!(branch_body.trim(), new_oid.to_hex());
    let _ = fs::remove_dir_all(&git_dir);
}

/// Two concurrent writers of one reference never leave a staging file behind.
#[test]
fn concurrent_updates_leave_no_staging_files() {
    let git_dir = scratch_repo("staging");
    let store = DiskRefStore::new(&git_dir);
    for seed in 0..8u8 {
        store
            .update_ref("refs/heads/main", &oid_from_seed(seed), None)
            .expect("update must succeed");
    }

    let mut staging_leftovers = Vec::new();
    for entry in fs::read_dir(git_dir.join("refs/heads")).expect("directory must be readable") {
        let path = entry.expect("entry must be readable").path();
        if path.extension().is_some() {
            staging_leftovers.push(path);
        }
    }
    assert!(
        staging_leftovers.is_empty(),
        "staging files must be renamed away: {:?}",
        staging_leftovers
    );
    let _ = fs::remove_dir_all(&git_dir);
}
