//! Unit Test: fg-index (InMemoryIndexTree, ConflictStageSlot, IndexStage)
//! File Path: tests/rust/test_index.rs

use fractal_git::core::models::FileMode;
use fractal_git::core::models::Oid;
use fractal_git::index::index_file::IndexStat;
use fractal_git::index::{
    encode_dirc_v2, write_dirc_v2, ConflictStageSlot, GitIndex, InMemoryIndexTree, IndexEntry,
    IndexStage,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn test_temp_dir(prefix: &str) -> tempfile::TempDir {
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = std::fs::create_dir_all(&base);
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(&base)
        .or_else(|_| tempfile::tempdir())
        .expect("create test tempdir")
}

#[test]
fn test_in_memory_index_tree_clean_workflow() {
    let mut index = InMemoryIndexTree::new();
    let oid1 = Oid::from_bytes([1u8; 20]);
    let oid2 = Oid::from_bytes([2u8; 20]);

    index
        .stage_oid("src/lib.rs", FileMode::RegularFile, oid1)
        .unwrap();
    index
        .stage_oid("README.md", FileMode::RegularFile, oid2)
        .unwrap();

    assert_eq!(index.entry_count(), 2);
    assert!(!index.has_conflicts());

    let mut built_trees = Vec::new();
    let root_oid = index
        .write_tree_with_persister(|tree| {
            built_trees.push(*tree.oid());
            Ok(())
        })
        .expect("Tree build should succeed");

    assert_ne!(root_oid, Oid::ZERO);
    assert!(!built_trees.is_empty());
}

#[test]
fn test_in_memory_index_conflict_stages() {
    let mut index = InMemoryIndexTree::new();
    let base_oid = Oid::from_bytes([1u8; 20]);
    let ours_oid = Oid::from_bytes([2u8; 20]);
    let theirs_oid = Oid::from_bytes([3u8; 20]);

    index
        .stage_conflict(
            "src/conflict.rs",
            FileMode::RegularFile,
            base_oid,
            IndexStage::Base,
        )
        .unwrap();
    index
        .stage_conflict(
            "src/conflict.rs",
            FileMode::RegularFile,
            ours_oid,
            IndexStage::Ours,
        )
        .unwrap();
    index
        .stage_conflict(
            "src/conflict.rs",
            FileMode::RegularFile,
            theirs_oid,
            IndexStage::Theirs,
        )
        .unwrap();

    assert!(index.has_conflicts());

    // Tree build MUST fail while unmerged conflicts exist
    let res = index.write_tree_with_persister(|_| Ok(()));
    assert!(res.is_err());

    // Resolve conflict by staging clean entry
    let resolved_oid = Oid::from_bytes([4u8; 20]);
    index
        .stage_oid("src/conflict.rs", FileMode::RegularFile, resolved_oid)
        .unwrap();
    assert!(!index.has_conflicts());

    let res = index.write_tree_with_persister(|_| Ok(()));
    assert!(res.is_ok());
}

#[test]
fn test_conflict_stage_slot_resolution() {
    let mut slot = ConflictStageSlot::new("src/main.rs");
    let base_oid = Oid::from_bytes([1u8; 20]);
    let ours_oid = Oid::from_bytes([2u8; 20]);
    let theirs_oid = Oid::from_bytes([3u8; 20]);

    slot.record_stage(&fractal_git::index::StagingEntry::with_stage(
        "src/main.rs",
        FileMode::RegularFile,
        base_oid,
        IndexStage::Base,
    ));
    slot.record_stage(&fractal_git::index::StagingEntry::with_stage(
        "src/main.rs",
        FileMode::RegularFile,
        ours_oid,
        IndexStage::Ours,
    ));
    slot.record_stage(&fractal_git::index::StagingEntry::with_stage(
        "src/main.rs",
        FileMode::RegularFile,
        theirs_oid,
        IndexStage::Theirs,
    ));

    let resolved_ours = slot.resolve_ours().unwrap();
    assert_eq!(resolved_ours.oid, ours_oid);

    let resolved_theirs = slot.resolve_theirs().unwrap();
    assert_eq!(resolved_theirs.oid, theirs_oid);
}

#[test]
fn test_scoped_index_filtering_and_parent_grafting() {
    let mut parent_index = InMemoryIndexTree::new();
    let oid_a = Oid::from_bytes([10u8; 20]);
    let oid_b = Oid::from_bytes([20u8; 20]);
    let oid_c = Oid::from_bytes([30u8; 20]);

    parent_index
        .stage_oid("auto-refactor/src/lib.rs", FileMode::RegularFile, oid_a)
        .unwrap();
    parent_index
        .stage_oid("auto-refactor/tests/test1.rs", FileMode::RegularFile, oid_b)
        .unwrap();
    parent_index
        .stage_oid("workspace-timing/src/main.ts", FileMode::RegularFile, oid_c)
        .unwrap();

    // 1. Filter by scope: only pull out auto-refactor/src/
    let scoped = parent_index.filter_by_scope(&["auto-refactor/src".to_string()]);
    assert_eq!(scoped.entry_count(), 1);
    assert!(scoped.entries().contains_key("auto-refactor/src/lib.rs"));
    assert!(!scoped
        .entries()
        .contains_key("workspace-timing/src/main.ts"));

    // 2. Modify within scoped index
    let mut worktree_index = scoped;
    let oid_a_mod = Oid::from_bytes([99u8; 20]);
    worktree_index
        .stage_oid("auto-refactor/src/lib.rs", FileMode::RegularFile, oid_a_mod)
        .unwrap();

    // 3. Graft onto parent entries
    let mut parent_map = std::collections::BTreeMap::new();
    for (k, v) in parent_index.entries() {
        parent_map.insert(k.clone(), (v.mode, v.oid));
    }
    let grafted = worktree_index.graft_onto_parent(&parent_map);

    assert_eq!(grafted.entry_count(), 3);
    assert_eq!(
        grafted
            .entries()
            .get("auto-refactor/src/lib.rs")
            .unwrap()
            .oid,
        oid_a_mod
    );
    assert_eq!(
        grafted
            .entries()
            .get("workspace-timing/src/main.ts")
            .unwrap()
            .oid,
        oid_c
    );
}

#[test]
fn test_first_class_conflict_management() {
    let mut tree = InMemoryIndexTree::new();
    let base_oid = Oid::from_bytes([1u8; 20]);
    let our_oid = Oid::from_bytes([2u8; 20]);
    let their_oid = Oid::from_bytes([3u8; 20]);

    // Record conflict stages
    tree.stage_conflict(
        "src/state.rs",
        FileMode::RegularFile,
        base_oid,
        IndexStage::Base,
    )
    .unwrap();
    tree.stage_conflict(
        "src/state.rs",
        FileMode::RegularFile,
        our_oid,
        IndexStage::Ours,
    )
    .unwrap();
    tree.stage_conflict(
        "src/state.rs",
        FileMode::RegularFile,
        their_oid,
        IndexStage::Theirs,
    )
    .unwrap();

    assert!(tree.has_conflicts());
    assert_eq!(tree.conflict_count(), 1);
    assert!(tree.conflicts().contains_key("src/state.rs"));

    let slot = tree.conflicts().get("src/state.rs").unwrap();
    assert_eq!(slot.base.as_ref().map(|entry| entry.oid), Some(base_oid));
    assert_eq!(slot.ours.as_ref().map(|entry| entry.oid), Some(our_oid));
    assert_eq!(slot.theirs.as_ref().map(|entry| entry.oid), Some(their_oid));

    // Resolve conflict using Ours
    let resolved = slot.resolve_ours().unwrap();
    tree.resolve_conflict("src/state.rs", resolved);

    assert!(!tree.has_conflicts());
    assert_eq!(tree.conflict_count(), 0);
    assert_eq!(tree.entries().get("src/state.rs").unwrap().oid, our_oid);
}

#[test]
fn test_sparse_directory_collapsing_and_reconstruction() {
    let mut index = InMemoryIndexTree::new();
    let main_oid = Oid::from_bytes([42u8; 20]);
    let vendor_subtree_oid = Oid::from_bytes([99u8; 20]);

    // Stage local active files
    index
        .stage_oid("src/main.rs", FileMode::RegularFile, main_oid)
        .expect("Stage file succeeds");

    // Stage out-of-scope vendor subtree as a collapsed sparse directory (Git S_IFDIR truncation)
    index
        .stage_sparse_directory("vendor", vendor_subtree_oid)
        .expect("Stage sparse directory succeeds");

    assert_eq!(index.entry_count(), 2);
    // The map key is the address form (no trailing separator); the entry keeps the trailing `/`
    // that marks it collapsed.
    let vendor_entry = index
        .entries()
        .get("vendor")
        .expect("collapsed vendor entry exists");
    assert_eq!(vendor_entry.path, "vendor/");
    assert!(vendor_entry.is_sparse_directory());
    assert_eq!(vendor_entry.oid, vendor_subtree_oid);
    assert_eq!(vendor_entry.mode, FileMode::Directory);

    let mut created_trees = Vec::new();
    let root_oid = index
        .write_tree_with_persister(|built_tree| {
            created_trees.push(built_tree.clone());
            Ok(())
        })
        .expect("Write tree succeeds");

    assert_ne!(root_oid, Oid::ZERO);
    // Two trees created: "src" containing "main.rs", and the root tree
    assert_eq!(created_trees.len(), 2);

    let root_tree = &created_trees[1];
    let vendor_child = root_tree
        .entries()
        .iter()
        .find(|entry| entry.name == "vendor")
        .expect("Vendor child in root tree");

    assert_eq!(vendor_child.mode, FileMode::Directory);
    assert_eq!(vendor_child.oid, vendor_subtree_oid);
}

/// Returns whether a `git` executable is on `PATH`; differential tests skip without one.
fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Runs `git` in `repo` and returns its raw output.
fn run_git(repo: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .current_dir(repo)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git should be runnable when it is on PATH")
}

/// Runs `git` in `repo` and returns stdout, asserting success.
fn git_stdout(repo: &Path, args: &[&str]) -> String {
    let output = run_git(repo, args);
    assert!(
        output.status.success(),
        "git {args:?} failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("git stdout should be UTF-8")
}

/// Builds one stage-0 regular-file entry for checksum fixtures.
fn sample_entry(path: &str, seed: u8) -> IndexEntry {
    IndexEntry {
        path: path.to_string(),
        mode: FileMode::RegularFile,
        oid: Oid::from_bytes([seed; 20]),
        stage: IndexStage::Normal,
        size: 12,
        mtime_seconds: 1_700_000_000,
        mtime_nanos: 0,
        assume_valid: false,
        skip_worktree: false,
        intent_to_add: false,
    }
}

/// Parses an index that Git itself wrote with `--index-version 4` and cross-checks every entry
/// against `git ls-files --stage`.
#[test]
fn parses_a_real_git_version_four_index() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }
    let workspace = test_temp_dir("index_ws_");
    let repo = workspace.path();
    git_stdout(repo, &["init", "-q"]);
    fs::create_dir_all(repo.join("dir").join("nested")).expect("nested dirs");
    fs::write(repo.join("dir").join("alpha.txt"), b"alpha\n").expect("alpha");
    fs::write(repo.join("dir").join("alpha2.txt"), b"alpha2\n").expect("alpha2");
    fs::write(repo.join("dir").join("nested").join("beta.txt"), b"beta\n").expect("beta");
    fs::write(repo.join("zeta.txt"), b"zeta\n").expect("zeta");
    git_stdout(repo, &["add", "-A"]);
    git_stdout(repo, &["update-index", "--index-version", "4"]);

    let index_path = repo.join(".git").join("index");
    let index = GitIndex::load(&index_path).expect("a Git-written version 4 index must parse");
    assert_eq!(index.version(), 4);

    let expected = git_stdout(repo, &["ls-files", "--stage"]);
    let expected_lines: Vec<&str> = expected.lines().collect();
    assert_eq!(index.entries().len(), expected_lines.len());
    for (entry, line) in index.entries().iter().zip(expected_lines.iter()) {
        let (metadata, path) = line.split_once('\t').expect("stage line carries a path");
        let mut fields = metadata.split(' ');
        let mode = fields.next().expect("mode column");
        let oid = fields.next().expect("oid column");
        let stage = fields.next().expect("stage column");
        assert_eq!(path, entry.path, "path round-tripped through the v4 varint");
        assert_eq!(mode, format!("{:o}", entry.mode.to_u32()));
        assert_eq!(oid, entry.oid.to_hex());
        assert_eq!(stage, entry.stage.to_u8().to_string());
    }
}

/// A held `index.lock` must block writing instead of silently overwriting the index.
#[test]
fn refuses_to_write_when_the_index_lock_exists() {
    let workspace = test_temp_dir("index_ws_");
    let index_path = workspace.path().join("index");
    fs::write(
        workspace.path().join("index.lock"),
        b"held by another writer\n",
    )
    .expect("lock");
    let error = write_dirc_v2(&index_path, &[]).expect_err("a held lock must block the write");
    let message = error.to_string();
    assert!(
        message.contains("index.lock"),
        "the error should name the lock file, got: {message}"
    );
    assert!(
        !index_path.exists(),
        "a blocked write must not publish an index"
    );
}

/// A modified trailing checksum or body byte must be rejected, not parsed as a valid index.
#[test]
fn rejects_an_index_whose_checksum_or_body_was_modified() {
    let entries = vec![sample_entry("a.txt", 7)];

    let mut flipped_checksum = encode_dirc_v2(&entries).expect("encode");
    let last = flipped_checksum.len() - 1;
    flipped_checksum[last] ^= 0xff;
    assert!(
        GitIndex::parse(flipped_checksum, PathBuf::from("index")).is_err(),
        "the trailing SHA-1 must be verified"
    );

    let mut flipped_body = encode_dirc_v2(&entries).expect("encode");
    flipped_body[75] ^= 0x01;
    assert!(
        GitIndex::parse(flipped_body, PathBuf::from("index")).is_err(),
        "a flipped body byte must break the trailing SHA-1"
    );

    let mut truncated = encode_dirc_v2(&entries).expect("encode");
    truncated.pop();
    assert!(
        GitIndex::parse(truncated, PathBuf::from("index")).is_err(),
        "an index shorter than its checksum must be rejected"
    );
}

/// Writes an index ourselves in version 4 and confirms Git itself reads it back.
#[test]
fn git_reads_a_version_four_index_this_crate_wrote() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }
    let workspace = test_temp_dir("index_ws_");
    let repo = workspace.path();
    git_stdout(repo, &["init", "-q"]);
    fs::create_dir_all(repo.join("dir")).expect("dir");
    fs::write(repo.join("dir").join("alpha.txt"), b"alpha\n").expect("alpha");
    fs::write(repo.join("dir").join("alpha2.txt"), b"alpha2\n").expect("alpha2");
    fs::write(repo.join("zeta.txt"), b"zeta\n").expect("zeta");
    git_stdout(repo, &["add", "-A"]);

    let index_path = repo.join(".git").join("index");
    let expected = git_stdout(repo, &["ls-files", "--stage"]);
    let parsed = GitIndex::load(&index_path).expect("load the Git-written index");
    let rewritten = GitIndex::new(index_path.clone(), 4, parsed.entries().to_vec())
        .with_metadata(parsed.stats().to_vec(), parsed.extensions().to_vec());
    rewritten
        .write()
        .expect("write a version 4 index this crate built");

    let bytes = fs::read(&index_path).expect("read the index back");
    assert_eq!(
        &bytes[4..8],
        &4u32.to_be_bytes(),
        "the header must declare version 4"
    );
    let reparsed = GitIndex::load(&index_path).expect("reparse the version 4 index");
    assert_eq!(reparsed.version(), 4);
    assert_eq!(reparsed.entries().len(), parsed.entries().len());
    assert_eq!(
        git_stdout(repo, &["ls-files", "--stage"]),
        expected,
        "git must read the same entries out of the version 4 index"
    );
    let status = git_stdout(repo, &["status", "--porcelain"]);
    assert_eq!(
        status.lines().count(),
        expected.lines().count(),
        "git must report the same staged paths out of the version 4 index"
    );
}

/// A version 2 rewrite keeps the caller-supplied stat words and the parsed extension records.
#[test]
fn version_two_rewrite_round_trips_stat_words_and_extensions() {
    if !git_available() {
        eprintln!("skipping: git is not on PATH");
        return;
    }
    let workspace = test_temp_dir("index_ws_");
    let repo = workspace.path();
    git_stdout(repo, &["init", "-q"]);
    fs::create_dir_all(repo.join("dir")).expect("dir");
    fs::write(repo.join("dir").join("alpha.txt"), b"alpha\n").expect("alpha");
    fs::write(repo.join("zeta.txt"), b"zeta\n").expect("zeta");
    git_stdout(repo, &["add", "-A"]);

    let index_path = repo.join(".git").join("index");
    let parsed = GitIndex::load(&index_path).expect("load the Git-written index");
    assert_eq!(parsed.version(), 2);
    assert_eq!(parsed.stats().len(), parsed.entries().len());

    // The writer is a function of the sidecar it is handed, not of the host platform.
    let supplied: Vec<IndexStat> = parsed
        .entries()
        .iter()
        .map(|_| IndexStat {
            ctime_seconds: 11,
            ctime_nanos: 22,
            dev: 33,
            ino: 44,
            uid: 55,
            gid: 66,
        })
        .collect();
    let encoded = GitIndex::new(
        PathBuf::from("synthetic-index"),
        2,
        parsed.entries().to_vec(),
    )
    .with_metadata(supplied.clone(), Vec::new())
    .encode()
    .expect("encode");
    let reparsed =
        GitIndex::parse(encoded, PathBuf::from("synthetic-index")).expect("parse the encoding");
    assert_eq!(
        reparsed.stats(),
        supplied.as_slice(),
        "the stat sidecar must survive an encode and parse"
    );

    // Rewriting the real file preserves what Git recorded and stays readable by Git.
    let expected = git_stdout(repo, &["ls-files", "--stage"]);
    parsed.write().expect("rewrite the version 2 index");
    let reloaded = GitIndex::load(&index_path).expect("reload the rewritten index");
    assert_eq!(reloaded.stats(), parsed.stats());
    assert_eq!(reloaded.extensions(), parsed.extensions());
    assert_eq!(git_stdout(repo, &["ls-files", "--stage"]), expected);
}
