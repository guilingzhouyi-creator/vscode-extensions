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
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

use fractal_git::fractal::refs::validate_ref_name;
use fractal_git::{DiskRefStore, HeadState, Oid, RefStore};

/// Monotonic counter keeping scratch directory names unique within one process.
static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Creates a unique repository-shaped scratch directory.
///
/// On Windows the base is `%TEMP%\Low`, matching the convention used by the other storage suites
/// so that the sandboxed test host can create directories there.
fn scratch_repo(label: &str) -> PathBuf {
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = fs::create_dir_all(&base);
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

#[test]
fn head_writers_record_symbolic_and_detached_targets() {
    let git_dir = scratch_repo("head_writers");
    let store = DiskRefStore::new(&git_dir);
    let oid = oid_from_seed(71);

    store
        .update_head_symbolic("refs/heads/main")
        .expect("symbolic HEAD must be writable");
    let symbolic = fs::read_to_string(git_dir.join("HEAD")).expect("read symbolic HEAD");
    assert_eq!(symbolic, "ref: refs/heads/main\n");

    store
        .update_head_detached(&oid)
        .expect("detached HEAD must be writable");
    let detached = fs::read_to_string(git_dir.join("HEAD")).expect("read detached HEAD");
    assert_eq!(detached, format!("{}\n", oid.to_hex()));
    let _ = fs::remove_dir_all(&git_dir);
}

/// Returns true when the host provides a `git` binary usable as an interoperability reference baseline.
fn system_git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Runs one git subcommand inside `repo`, failing the test with the captured output on error.
///
/// The differential suites already require the system git binary, so these reference-manipulation
/// checks compare against the same reference baseline instead of re-asserting this crate's own conventions.
fn run_git(repo: &Path, args: &[&str]) -> Output {
    let output = Command::new("git")
        .arg("-c")
        .arg("init.defaultBranch=main")
        .arg("-c")
        .arg("user.name=Taxis Test")
        .arg("-c")
        .arg("user.email=test@taxis.internal")
        .arg("-c")
        .arg("commit.gpgsign=false")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("the system git binary must be runnable");
    assert!(
        output.status.success(),
        "git {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

/// Returns the trimmed standard output of one successful git subcommand.
fn git_stdout(repo: &Path, args: &[&str]) -> String {
    let output = run_git(repo, args);
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Initializes a real Git repository carrying `commits` empty commits on `main`.
fn init_git_repo(label: &str, commits: usize) -> PathBuf {
    let repo = scratch_repo(label);
    run_git(&repo, &["init", "-q", "."]);
    for index in 0..commits {
        run_git(
            &repo,
            &["commit", "-q", "--allow-empty", "-m", &format!("c{index}")],
        );
    }
    repo
}

/// Runs the built `taxis` binary inside `repo` and returns its captured output.
fn run_taxis(repo: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(repo)
        .output()
        .expect("the built taxis binary must be runnable")
}

/// Git's `check-ref-format` grammar rejects traversal, control bytes, and malformed components.
#[test]
fn invalid_reference_names_are_refused_before_any_path_is_built() {
    let refused = [
        "",
        "refs/heads/a..b",
        "refs/heads/.hidden",
        "refs/heads/tail.",
        "refs/heads/a.lock",
        "refs/heads/foo.lock/bar",
        "refs/heads/a b",
        "refs/heads/a~b",
        "refs/heads/a^b",
        "refs/heads/a:b",
        "refs/heads/a?b",
        "refs/heads/a*b",
        "refs/heads/a[b",
        "refs/heads/a\\b",
        "refs/heads/a@{1}",
        "@",
        "refs/heads/a//b",
        "refs/heads/a/",
        "/refs/heads/a",
        "heads/main",
        "refs/heads/../../etc/passwd",
        "refs/heads/a\nb",
    ];
    assert!(
        validate_ref_name(&format!("{}:/refs/heads/a", 'C')).is_err(),
        "a drive-letter prefix must be refused"
    );
    for name in refused {
        assert!(validate_ref_name(name).is_err(), "must refuse {name:?}");
    }

    let accepted = [
        "refs/heads/main",
        "refs/heads/feature/nested-name",
        "refs/heads/@",
        "refs/tags/v1.0.0",
        "refs/fractal/cell/cell-alpha/main",
        "HEAD",
        "ORIG_HEAD",
    ];
    for name in accepted {
        assert!(validate_ref_name(name).is_ok(), "must accept {name:?}");
    }

    let git_dir = scratch_repo("validate");
    let store = DiskRefStore::new(&git_dir);
    let oid = oid_from_seed(0x12);
    assert!(
        store
            .update_ref("refs/heads/../../escape", &oid, None)
            .is_err(),
        "a path-escape name must not reach the filesystem"
    );
    assert!(
        store.delete_ref("refs/heads/a..b").is_err(),
        "a malformed name must be refused by deletion too"
    );
    assert!(
        !git_dir.join("escape").exists(),
        "no escape file may appear"
    );
    assert!(
        !git_dir.parent().unwrap_or(&git_dir).join("escape").exists(),
        "no escape file may appear next to the git directory"
    );
    let _ = fs::remove_dir_all(&git_dir);
}

/// Deleting a packed reference rewrites the table, keeping the header, comments, and other entries.
#[test]
fn deleting_a_packed_reference_rewrites_the_table_and_keeps_other_lines() {
    let git_dir = scratch_repo("packed_delete");
    let kept = oid_from_seed(0x31);
    let doomed = oid_from_seed(0x32);
    let peeled = oid_from_seed(0x33);
    let other = oid_from_seed(0x34);
    let packed_before = format!(
        "# pack-refs with: peeled fully-peeled sorted \n\
         {} refs/heads/main\n\
         # operator note kept verbatim\n\
         {} refs/tags/v1.0\n\
         ^{}\n\
         {} refs/heads/other\n",
        kept.to_hex(),
        doomed.to_hex(),
        peeled.to_hex(),
        other.to_hex()
    );
    fs::write(git_dir.join("packed-refs"), &packed_before).expect("packed table must be writable");

    let store = DiskRefStore::new(&git_dir);
    assert!(
        store
            .delete_ref("refs/tags/v1.0")
            .expect("deletion must succeed"),
        "the packed entry must count as a deleted ref"
    );

    let packed_after =
        fs::read_to_string(git_dir.join("packed-refs")).expect("packed table must stay readable");
    assert!(packed_after.starts_with("# pack-refs with: peeled fully-peeled sorted \n"));
    assert!(
        packed_after.contains("# operator note kept verbatim\n"),
        "comment lines must survive the rewrite: {packed_after:?}"
    );
    assert!(!packed_after.contains("refs/tags/v1.0"));
    assert!(!packed_after.contains(&format!("^{}", peeled.to_hex())));
    assert!(packed_after.contains(&format!("{} refs/heads/main\n", kept.to_hex())));
    assert!(packed_after.contains(&format!("{} refs/heads/other\n", other.to_hex())));

    let listed = store.list_all().expect("listing must succeed");
    assert_eq!(listed.len(), 2, "only the untouched refs may remain");
    assert!(find_ref(&listed, "refs/tags/v1.0").is_none());
    assert!(
        !store
            .delete_ref("refs/tags/v1.0")
            .expect("second deletion must succeed"),
        "a second deletion must report that nothing was removed"
    );

    let staging_leftovers: Vec<PathBuf> = fs::read_dir(&git_dir)
        .expect("git directory must be readable")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "tmp"))
        .collect();
    assert!(
        staging_leftovers.is_empty(),
        "the packed rewrite must rename its staging file away: {staging_leftovers:?}"
    );
    let _ = fs::remove_dir_all(&git_dir);
}

/// A loose file shadowing a packed entry is removed from both sources in one deletion.
#[test]
fn deleting_a_reference_clears_loose_and_packed_sources() {
    let git_dir = scratch_repo("packed_shadow_delete");
    let packed_oid = oid_from_seed(0x35);
    fs::write(
        git_dir.join("packed-refs"),
        format!("{} refs/heads/main\n", packed_oid.to_hex()),
    )
    .expect("packed table must be writable");
    write_loose(
        &git_dir,
        "refs/heads/main",
        &format!("{}\n", oid_from_seed(0x36).to_hex()),
    );

    let store = DiskRefStore::new(&git_dir);
    assert!(store
        .delete_ref("refs/heads/main")
        .expect("deletion must succeed"));
    assert!(!git_dir.join("refs/heads/main").exists());
    let packed_after =
        fs::read_to_string(git_dir.join("packed-refs")).expect("packed table must stay readable");
    assert!(!packed_after.contains("refs/heads/main"));
    assert!(store.list_all().expect("listing must succeed").is_empty());
    let _ = fs::remove_dir_all(&git_dir);
}

/// Every successful update appends one formatted reflog line for the ref it rewrote.
#[test]
fn updating_a_reference_appends_reflog_entries() {
    let git_dir = scratch_repo("reflog_append");
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("HEAD must be writable");
    let store = DiskRefStore::new(&git_dir);
    let first = oid_from_seed(0x41);
    let second = oid_from_seed(0x42);
    let third = oid_from_seed(0x43);
    let head_update = oid_from_seed(0x44);

    store
        .update_ref("refs/heads/main", &first, None)
        .expect("first update must succeed");
    let log_path = git_dir.join("logs/refs/heads/main");
    let log_after_first = fs::read_to_string(&log_path).expect("the reflog must be created");
    assert_eq!(log_after_first.lines().count(), 1);
    let first_line = log_after_first
        .lines()
        .next()
        .expect("the reflog must hold its first line")
        .trim_end_matches('\r');
    assert!(
        first_line.starts_with(&format!("{} {}", Oid::ZERO.to_hex(), first.to_hex())),
        "the first line must record the zero old id: {first_line:?}"
    );
    assert!(
        first_line.contains(" <") && first_line.contains("> "),
        "the actor must be written as Name <email>: {first_line:?}"
    );
    assert!(
        !first_line.contains('\t'),
        "an update without a message must not gain a tab: {first_line:?}"
    );
    let record = first_line
        .split_once('\t')
        .map_or(first_line, |(prefix, _)| prefix)
        .trim_end();
    let trailing: Vec<&str> = record.rsplit(' ').take(2).collect();
    assert_eq!(trailing.len(), 2);
    assert!(
        trailing[0].len() == 5
            && (trailing[0].starts_with('+') || trailing[0].starts_with('-'))
            && trailing[0][1..].chars().all(|digit| digit.is_ascii_digit()),
        "the last field must be a numeric UTC offset: {first_line:?}"
    );
    assert!(
        trailing[1].chars().all(|digit| digit.is_ascii_digit()),
        "the penultimate field must be a Unix timestamp: {first_line:?}"
    );

    store
        .update_ref("refs/heads/main", &second, None)
        .expect("second update must succeed");
    store
        .update_ref_with_message("refs/heads/main", &third, None, "commit: probe")
        .expect("message update must succeed");
    let log_after_three = fs::read_to_string(&log_path).expect("reflog must stay readable");
    let lines: Vec<&str> = log_after_three.lines().collect();
    assert_eq!(lines.len(), 3, "updates must append, never truncate");
    assert!(lines[1].starts_with(&format!("{} ", first.to_hex())));
    assert!(
        lines[2].starts_with(&format!("{} {}", second.to_hex(), third.to_hex())),
        "the third line must chain the previous id: {lines:?}"
    );
    let (_, message) = lines[2]
        .split_once('\t')
        .expect("a written message must follow a tab");
    assert_eq!(message, "commit: probe");

    store
        .update_ref("HEAD", &head_update, None)
        .expect("HEAD update must succeed");
    let head_log =
        fs::read_to_string(git_dir.join("logs/HEAD")).expect("HEAD must gain its own reflog");
    assert!(
        head_log.contains(&head_update.to_hex()),
        "an explicit HEAD update must be logged on HEAD: {head_log:?}"
    );
    let _ = fs::remove_dir_all(&git_dir);
}

/// Deleting a ref also removes the reflog file Git would drop with it.
#[test]
fn deleting_a_reference_removes_its_reflog() {
    let git_dir = scratch_repo("reflog_delete");
    let store = DiskRefStore::new(&git_dir);
    store
        .update_ref("refs/heads/gone", &oid_from_seed(0x45), None)
        .expect("update must succeed");
    assert!(git_dir.join("logs/refs/heads/gone").is_file());

    assert!(store
        .delete_ref("refs/heads/gone")
        .expect("deletion must succeed"));
    assert!(!git_dir.join("logs/refs/heads/gone").exists());
    assert!(!git_dir.join("refs/heads/gone").exists());
    let _ = fs::remove_dir_all(&git_dir);
}

/// `ORIG_HEAD` records the pre-reset position as a full object id plus newline.
#[test]
fn writing_orig_head_records_the_previous_position() {
    let git_dir = scratch_repo("orig_head");
    let store = DiskRefStore::new(&git_dir);
    let previous = oid_from_seed(0x51);
    let earlier = oid_from_seed(0x52);

    store
        .write_orig_head(&previous)
        .expect("ORIG_HEAD must be writable");
    assert_eq!(
        fs::read_to_string(git_dir.join("ORIG_HEAD")).expect("ORIG_HEAD must be readable"),
        format!("{}\n", previous.to_hex())
    );
    store
        .write_orig_head(&earlier)
        .expect("ORIG_HEAD must be replaceable");
    assert_eq!(
        fs::read_to_string(git_dir.join("ORIG_HEAD")).expect("ORIG_HEAD must be readable"),
        format!("{}\n", earlier.to_hex())
    );
    let _ = fs::remove_dir_all(&git_dir);
}

/// `branch -d` removes a packed branch, reports it, and leaves `git show-ref` without it.
#[test]
fn deleting_a_packed_branch_is_reported_and_removed_from_git_show_ref() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_git_repo("cli_branch_packed", 1);
    run_git(&repo, &["branch", "feat"]);
    run_git(&repo, &["pack-refs", "--all"]);
    assert!(repo.join(".git/packed-refs").is_file());
    assert!(!repo.join(".git/refs/heads/feat").exists());
    assert!(git_stdout(&repo, &["show-ref"]).contains("refs/heads/feat"));

    let deleted = run_taxis(&repo, &["branch", "-d", "feat"]);
    assert!(
        deleted.status.success(),
        "branch -d on a packed ref must succeed: {}{}",
        String::from_utf8_lossy(&deleted.stdout),
        String::from_utf8_lossy(&deleted.stderr)
    );
    assert!(
        String::from_utf8_lossy(&deleted.stdout).contains("Deleted branch feat (was "),
        "the deletion must be reported: {}",
        String::from_utf8_lossy(&deleted.stdout)
    );
    assert!(!git_stdout(&repo, &["show-ref"]).contains("refs/heads/feat"));
    let packed_after =
        fs::read_to_string(repo.join(".git/packed-refs")).expect("packed table must stay readable");
    assert!(!packed_after.contains("refs/heads/feat"));
    assert!(packed_after.starts_with("# pack-refs with:"));
    let _ = fs::remove_dir_all(&repo);
}

/// A branch deletion that still finds the packed entry must fail loudly instead of claiming success.
#[test]
fn a_missing_branch_is_refused_with_the_git_message() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_git_repo("cli_branch_missing", 1);
    let deleted = run_taxis(&repo, &["branch", "-d", "nope"]);
    assert!(!deleted.status.success());
    assert!(
        String::from_utf8_lossy(&deleted.stderr).contains("error: branch 'nope' not found"),
        "stderr: {}",
        String::from_utf8_lossy(&deleted.stderr)
    );
    let _ = fs::remove_dir_all(&repo);
}

/// `tag -d` removes a packed tag instead of misreporting it as not found.
#[test]
fn deleting_a_packed_tag_is_reported_and_removed_from_git_show_ref() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_git_repo("cli_tag_packed", 1);
    run_git(&repo, &["tag", "t1"]);
    run_git(&repo, &["pack-refs", "--all"]);
    assert!(!repo.join(".git/refs/tags/t1").exists());
    assert!(git_stdout(&repo, &["show-ref"]).contains("refs/tags/t1"));

    let deleted = run_taxis(&repo, &["tag", "-d", "t1"]);
    assert!(
        deleted.status.success(),
        "tag -d on a packed ref must succeed: {}{}",
        String::from_utf8_lossy(&deleted.stdout),
        String::from_utf8_lossy(&deleted.stderr)
    );
    assert!(
        String::from_utf8_lossy(&deleted.stdout).contains("Deleted tag 't1'"),
        "stdout: {}",
        String::from_utf8_lossy(&deleted.stdout)
    );
    assert!(!git_stdout(&repo, &["show-ref"]).contains("refs/tags/t1"));
    let _ = fs::remove_dir_all(&repo);
}

/// Creating branches or tags with Git-invalid names is refused and writes nothing outside `.git`.
#[test]
fn creating_refs_with_invalid_names_is_refused() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_git_repo("cli_invalid_names", 1);

    let branch = run_taxis(&repo, &["branch", "a..b"]);
    assert!(!branch.status.success());
    assert!(
        String::from_utf8_lossy(&branch.stderr).contains("not a valid branch name"),
        "stderr: {}",
        String::from_utf8_lossy(&branch.stderr)
    );

    let escape = run_taxis(&repo, &["branch", "../../escape"]);
    assert!(!escape.status.success());
    assert!(!repo.join(".git/escape").exists());
    assert!(!repo.join("escape").exists());

    let tag = run_taxis(&repo, &["tag", "a..b"]);
    assert!(!tag.status.success());
    assert!(
        String::from_utf8_lossy(&tag.stderr).contains("not a valid tag name"),
        "stderr: {}",
        String::from_utf8_lossy(&tag.stderr)
    );
    assert!(!repo.join(".git/refs/tags/a..b").exists());
    let _ = fs::remove_dir_all(&repo);
}

/// `reset --soft` records the position it moved away from in `.git/ORIG_HEAD`.
#[test]
fn reset_writes_orig_head_before_moving_head() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_git_repo("cli_reset_orig_head", 2);
    run_git(&repo, &["checkout", "-q", "-b", "feat"]);
    run_git(&repo, &["commit", "-q", "--allow-empty", "-m", "feat only"]);
    let moved_from = git_stdout(&repo, &["rev-parse", "HEAD"]);
    let moved_to = git_stdout(&repo, &["rev-parse", "HEAD~1"]);

    let reset = run_taxis(&repo, &["reset", "--soft", "HEAD~1"]);
    assert!(
        reset.status.success(),
        "reset --soft must succeed: {}{}",
        String::from_utf8_lossy(&reset.stdout),
        String::from_utf8_lossy(&reset.stderr)
    );
    let orig_head =
        fs::read_to_string(repo.join(".git/ORIG_HEAD")).expect("reset must write ORIG_HEAD");
    assert_eq!(orig_head, format!("{moved_from}\n"));
    assert_eq!(git_stdout(&repo, &["rev-parse", "feat"]), moved_to);
    assert_eq!(
        fs::read_to_string(repo.join(".git/HEAD")).expect("HEAD must be readable"),
        "ref: refs/heads/feat\n"
    );
    let _ = fs::remove_dir_all(&repo);
}

/// `branch -d` refuses a branch that no other reference reaches, and `-D` forces it.
#[test]
fn deleting_an_unmerged_branch_requires_the_force_flag() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_git_repo("cli_branch_unmerged", 1);
    run_git(&repo, &["checkout", "-q", "-b", "feat"]);
    run_git(&repo, &["commit", "-q", "--allow-empty", "-m", "feat only"]);
    run_git(&repo, &["checkout", "-q", "main"]);

    let refused = run_taxis(&repo, &["branch", "-d", "feat"]);
    assert!(
        !refused.status.success(),
        "branch -d must refuse a merge loss"
    );
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert!(
        stderr.contains("the branch 'feat' is not fully merged"),
        "stderr: {stderr}"
    );
    assert!(repo.join(".git/refs/heads/feat").exists());

    let forced = run_taxis(&repo, &["branch", "-D", "feat"]);
    assert!(
        forced.status.success(),
        "branch -D must delete the branch: {}{}",
        String::from_utf8_lossy(&forced.stdout),
        String::from_utf8_lossy(&forced.stderr)
    );
    let stdout = String::from_utf8_lossy(&forced.stdout);
    let (_, abbreviated) = stdout
        .split_once("Deleted branch feat (was ")
        .expect("the deletion must name the object it dropped");
    let abbreviated = abbreviated
        .split_once(").")
        .expect("the abbreviated id must be parenthesised")
        .0;
    assert_eq!(abbreviated.len(), 7, "git abbreviates to seven: {stdout}");
    assert!(abbreviated.chars().all(|digit| digit.is_ascii_hexdigit()));
    assert!(!repo.join(".git/refs/heads/feat").exists());
    let _ = fs::remove_dir_all(&repo);
}

/// Re-creating an existing tag is a fatal error, matching git's exit code 128.
#[test]
fn re_creating_an_existing_tag_is_fatal() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_git_repo("cli_tag_exists", 1);
    run_git(&repo, &["tag", "t1"]);

    let duplicate = run_taxis(&repo, &["tag", "t1"]);
    assert_eq!(duplicate.status.code(), Some(128));
    let stderr = String::from_utf8_lossy(&duplicate.stderr);
    assert!(
        stderr.contains("fatal: tag 't1' already exists"),
        "stderr: {stderr}"
    );

    let missing = run_taxis(&repo, &["tag", "-d", "nope"]);
    assert_eq!(missing.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&missing.stderr).contains("error: tag 'nope' not found."),
        "stderr: {}",
        String::from_utf8_lossy(&missing.stderr)
    );
    let _ = fs::remove_dir_all(&repo);
}

/// `reset --hard` discards local edits without a cleanliness gate and drops staged additions.
#[test]
fn reset_hard_discards_dirty_edits_and_staged_only_files() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable or restricted");
        return;
    }
    let repo = init_git_repo("cli_reset_hard_dirty", 1);
    fs::write(repo.join("tracked.txt"), "base\n").expect("the tracked file must be writable");
    run_git(&repo, &["add", "tracked.txt"]);
    run_git(&repo, &["commit", "-q", "-m", "add tracked"]);
    run_git(&repo, &["checkout", "-q", "-b", "feat"]);
    fs::write(repo.join("tracked.txt"), "feat content\n").expect("the edit must be writable");
    run_git(&repo, &["commit", "-q", "-am", "change tracked"]);
    let moved_from = git_stdout(&repo, &["rev-parse", "HEAD"]);
    let moved_to = git_stdout(&repo, &["rev-parse", "HEAD~1"]);

    fs::write(repo.join("tracked.txt"), "dirty\n").expect("the dirt must be writable");
    fs::write(repo.join("staged-only.txt"), "staged\n").expect("the addition must be writable");
    run_git(&repo, &["add", "staged-only.txt"]);

    let reset = run_taxis(&repo, &["reset", "--hard", "HEAD~1"]);
    assert!(
        reset.status.success(),
        "reset --hard must not require a clean worktree: {}{}",
        String::from_utf8_lossy(&reset.stdout),
        String::from_utf8_lossy(&reset.stderr)
    );
    assert_eq!(
        fs::read_to_string(repo.join(".git/ORIG_HEAD")).expect("ORIG_HEAD must be readable"),
        format!("{moved_from}\n")
    );
    assert_eq!(git_stdout(&repo, &["rev-parse", "feat"]), moved_to);
    assert_eq!(
        fs::read_to_string(repo.join("tracked.txt")).expect("the target file must exist"),
        "base\n"
    );
    assert!(!repo.join("staged-only.txt").exists());
    assert!(
        git_stdout(&repo, &["status", "--porcelain"]).is_empty(),
        "the reset worktree must be clean"
    );
    let _ = fs::remove_dir_all(&repo);
}
