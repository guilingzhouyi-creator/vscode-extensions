//! Module: tests::test_pack_generation — Git Packfile & Index v2 Pack Generation & Repack Verification
//! File Path: tests/rust/test_pack_generation.rs
//! Architecture Role: Verifies binary equivalence of Packfile v2 and Index v2 generation against
//!   internal readers and external Git baseline validator (`git verify-pack`).
//! Dependencies & Triggers: Runs under cargo test.
//! Responsibilities: Validate pack writing, delta compression, index lookup, and loose object consolidation.
//! Exit Semantics & Design Rationale:
//!   - Every object packed into a generated pack must decode identically to its original bytes.
//!   - If Git binary is available, `git verify-pack` is executed to validate Index v2 compatibility.

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use fractal_git::algorithms::pack::{
    find_pack_deltas, DeltaResolution, PackDeltaChain, PackDeltaItem,
};
use fractal_git::core::models::{compute_object_oid, ObjectKind, Oid};
use fractal_git::core::traits::OdbStore;
use fractal_git::storage::backends::{
    DeltaBaseSource, IdxWriter, OdbRouter, PackEntryMeta, PackFile, PackIndex, PackWriter,
};
use fractal_git::storage::loose::LooseOdb;
use fractal_git::storage::repack::{
    verify_written_pack, RepackEngine, RepackOptions, REPACK_BLOCKED_MARKER,
};

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
        let base = {
            let candidate = std::env::temp_dir();
            let probe = candidate.join(format!(".write_probe_{}_{}", pid, count));
            if std::fs::create_dir(&probe).is_ok() {
                let _ = std::fs::remove_dir(&probe);
                candidate
            } else {
                let ws_tmp = std::env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join("target")
                    .join("test_tmp");
                let _ = std::fs::create_dir_all(&ws_tmp);
                ws_tmp
            }
        };
        let path = base.join(format!("taxis_pack_test_{}_{}_{}", prefix, pid, count));
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

/// Reports whether a usable system `git` is on PATH (memoised in the shared harness).
fn system_git_available() -> bool {
    crate::cli_harness::system_git_available()
}

/// Helper verifying with system git's `git verify-pack -v` if git is executable.
fn verify_with_system_git(idx_path: &Path) {
    if !system_git_available() {
        println!("git binary not executable in this sandbox, skipping external Git verification.");
        return;
    }

    let output = Command::new("git")
        .arg("verify-pack")
        .arg("-v")
        .arg(idx_path)
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            println!(
                "git verify-pack successfully verified: {}",
                idx_path.display()
            );
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            panic!(
                "git verify-pack rejected {}: exit={:?}, err={}, stdout={}",
                idx_path.display(),
                out.status.code(),
                err,
                stdout
            );
        }
    } else {
        println!("git binary not found, skipping external Git verification.");
    }
}

#[test]
fn test_pack_and_idx_generation_roundtrip() {
    let test_dir = TestDir::new("pack_gen");
    let pack_path = test_dir.path().join("test.pack");
    let idx_path = test_dir.path().join("test.idx");

    let mut items = Vec::new();

    // 1. Base blob
    let base_blob =
        b"line 1: initial content\nline 2: shared header\nline 3: common footer\n".to_vec();
    let base_oid = compute_object_oid(ObjectKind::Blob, &base_blob);
    items.push(PackDeltaItem::new(
        base_oid,
        ObjectKind::Blob,
        base_blob.clone(),
        Some("file.txt"),
    ));

    // 2. Delta blob (similar to base to trigger OFS_DELTA)
    let delta_blob =
        b"line 1: modified content\nline 2: shared header\nline 3: common footer\n".to_vec();
    let delta_oid = compute_object_oid(ObjectKind::Blob, &delta_blob);
    items.push(PackDeltaItem::new(
        delta_oid,
        ObjectKind::Blob,
        delta_blob.clone(),
        Some("file.txt"),
    ));

    // 3. Tree object
    let tree_payload = b"100644 file.txt\0\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14".to_vec();
    let tree_oid = compute_object_oid(ObjectKind::Tree, &tree_payload);
    items.push(PackDeltaItem::new(
        tree_oid,
        ObjectKind::Tree,
        tree_payload.clone(),
        None,
    ));

    // 4. Commit object
    let commit_payload = format!(
        "tree {}\nauthor Alice <alice@example.com> 1600000000 +0000\ncommitter Alice <alice@example.com> 1600000000 +0000\n\nInitial commit\n",
        tree_oid.to_hex()
    ).into_bytes();
    let commit_oid = compute_object_oid(ObjectKind::Commit, &commit_payload);
    items.push(PackDeltaItem::new(
        commit_oid,
        ObjectKind::Commit,
        commit_payload.clone(),
        None,
    ));

    // Resolve delta chains
    let chains = find_pack_deltas(items, 10, 50);
    assert_eq!(chains.len(), 4);

    // Write pack stream
    let pack_file_out = File::create(&pack_path).expect("create pack file");
    let (pack_oid, entries) = PackWriter::write_pack(&chains, pack_file_out).expect("write pack");
    assert_eq!(entries.len(), 4);

    // Write index stream
    let idx_file_out = File::create(&idx_path).expect("create idx file");
    let _idx_oid = IdxWriter::write_idx(entries, &pack_oid, idx_file_out).expect("write idx");

    // Read back and verify using internal PackIndex & PackFile
    let pack_index = PackIndex::load(&idx_path).expect("load pack index");
    assert_eq!(pack_index.object_count(), 4);

    let pack_file = PackFile::load(&pack_path).expect("load pack file");
    assert_eq!(pack_file.object_count(), 4);

    // Verify all 4 objects resolve accurately using OdbRouter
    let router = OdbRouter::open(test_dir.path()).expect("open router on generated pack");
    for (expected_oid, expected_kind, expected_payload) in [
        (base_oid, ObjectKind::Blob, base_blob),
        (delta_oid, ObjectKind::Blob, delta_blob),
        (tree_oid, ObjectKind::Tree, tree_payload),
        (commit_oid, ObjectKind::Commit, commit_payload),
    ] {
        let offset = pack_index
            .lookup(&expected_oid)
            .expect("object offset must be found");
        let resolved = pack_file.read_at(offset, &router).expect("read object");
        assert_eq!(resolved.kind, expected_kind);
        assert_eq!(resolved.payload, expected_payload);
    }

    // Verify against external Git baseline
    verify_with_system_git(&idx_path);
}

#[test]
fn test_repack_engine_consolidation_and_router_integration() {
    let test_dir = TestDir::new("repack_engine");
    let repo_dir = test_dir.path();
    let objects_dir = repo_dir.join("objects");
    std::fs::create_dir_all(&objects_dir).expect("create objects dir");

    let loose_odb = LooseOdb::new(repo_dir);

    // Write 5 loose objects
    let mut written_oids = Vec::new();
    for i in 0..5 {
        let content =
            format!("file revision number {}\nshared common block of data\n", i).into_bytes();
        let oid = loose_odb
            .write_object("blob", &content)
            .expect("write loose object");
        written_oids.push((oid, content));
    }

    // Repack
    let options = RepackOptions {
        window_size: 10,
        max_depth: 10,
        keep_loose: false,
        auto_repack_threshold: 3,
        ..Default::default()
    };

    let report_opt =
        RepackEngine::repack_repository(repo_dir, &options).expect("repack repository");
    let report = report_opt.expect("report must be generated");

    assert_eq!(report.objects_packed, 5);
    assert_eq!(report.loose_pruned, 5);
    assert_eq!(report.objects_verified, 5);
    assert!(report.pack_bytes > 0);

    // Verify pack and idx exist on disk
    let pack_file_path = repo_dir
        .join("objects")
        .join("pack")
        .join(format!("pack-{}.pack", report.pack_oid.to_hex()));
    let idx_file_path = repo_dir
        .join("objects")
        .join("pack")
        .join(format!("pack-{}.idx", report.pack_oid.to_hex()));

    assert!(pack_file_path.is_file(), "packfile must exist");
    assert!(idx_file_path.is_file(), "idx file must exist");

    // Verify using OdbRouter
    let router = OdbRouter::open(&objects_dir).expect("open router on repacked repo");
    for (oid, expected_content) in written_oids {
        let obj_opt = router.read(&oid).expect("read object via router");
        let packed = obj_opt.expect("object must be resolved from pack");
        assert_eq!(packed.kind, ObjectKind::Blob);
        assert_eq!(packed.payload, expected_content);
    }

    // External git verify-pack
    verify_with_system_git(&idx_file_path);
}

#[test]
fn test_async_repack_spawning() {
    let test_dir = TestDir::new("async_repack");
    let repo_dir = test_dir.path();
    let objects_dir = repo_dir.join("objects");
    std::fs::create_dir_all(&objects_dir).expect("create objects dir");

    let loose_odb = LooseOdb::new(repo_dir);
    for i in 0..4 {
        let content = format!("async test file revision {}\n", i).into_bytes();
        let _ = loose_odb
            .write_object("blob", &content)
            .expect("write loose object");
    }

    let options = RepackOptions {
        window_size: 5,
        max_depth: 5,
        keep_loose: false,
        auto_repack_threshold: 2,
        ..Default::default()
    };

    assert!(RepackEngine::should_auto_repack(repo_dir, 2));
    assert!(!RepackEngine::should_auto_repack(repo_dir, 10));

    let handle = RepackEngine::trigger_async_repack(repo_dir.to_path_buf(), options);
    let report_res = handle.join().expect("thread join must succeed");
    let report_opt = report_res.expect("repack result must succeed");
    let report = report_opt.expect("report must be present");

    assert_eq!(report.objects_packed, 4);
    assert_eq!(report.loose_pruned, 4);
    assert_eq!(report.objects_verified, 4);
}

/// Resolver proving a written pack is self-contained: `REF_DELTA` would need an outside base.
struct EmptyBaseResolver;

impl DeltaBaseSource for EmptyBaseResolver {
    fn read_base(
        &self,
        oid: &Oid,
    ) -> fractal_git::core::error::FractalResult<(ObjectKind, Vec<u8>)> {
        Err(fractal_git::core::error::FractalError::CorruptStore(
            format!("pack entry references external base {}", oid.to_hex()),
        ))
    }
}

/// Runs `git verify-pack -v` as a strict baseline validator: a missing or rejecting Git fails the test.
fn git_verify_pack_strict(idx_path: &Path) -> String {
    let output = Command::new("git")
        .arg("verify-pack")
        .arg("-v")
        .arg(idx_path)
        .output()
        .unwrap_or_else(|error| panic!("system git is required but could not spawn: {error}"));
    assert!(
        output.status.success(),
        "git verify-pack rejected {}: {}",
        idx_path.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// Writes one pack/idx pair and returns the writer metadata for replay verification.
fn write_pack_pair(
    pack_path: &Path,
    idx_path: &Path,
    chains: &[PackDeltaChain],
) -> Vec<PackEntryMeta> {
    let pack_out = File::create(pack_path).expect("create pack file");
    let (pack_oid, entries) = PackWriter::write_pack(chains, pack_out).expect("write pack");
    let idx_out = File::create(idx_path).expect("create idx file");
    IdxWriter::write_idx(entries.clone(), &pack_oid, idx_out).expect("write idx");
    entries
}

/// Runs one Git command inside `dir`, panicking with Git's own message on failure.
fn run_git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap_or_else(|error| panic!("system git is required but could not spawn: {error}"));
    assert!(
        output.status.success(),
        "git {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn test_large_copy_delta_roundtrip_with_system_git() {
    if !system_git_available() {
        println!("git binary unavailable in this sandbox, skipping test_large_copy_delta_roundtrip_with_system_git.");
        return;
    }
    const BASE_LEN: usize = 16 * 1024 * 1024;
    let test_dir = TestDir::new("large_copy_delta");
    let pack_path = test_dir.path().join("large.pack");
    let idx_path = test_dir.path().join("large.idx");

    let pattern: Vec<u8> = (0u8..64).collect();
    let mut base = Vec::with_capacity(BASE_LEN);
    while base.len() < BASE_LEN {
        base.extend_from_slice(&pattern);
    }
    base.truncate(BASE_LEN);
    let mut target = base.clone();
    target.extend_from_slice(b"TAIL-EXTENSION-17");

    let base_oid = compute_object_oid(ObjectKind::Blob, &base);
    let target_oid = compute_object_oid(ObjectKind::Blob, &target);
    let items = vec![
        PackDeltaItem::new(base_oid, ObjectKind::Blob, base, Some("big.bin")),
        PackDeltaItem::new(target_oid, ObjectKind::Blob, target, Some("big.bin")),
    ];
    let chains = find_pack_deltas(items, 10, 50);
    assert_eq!(chains.len(), 2);
    let deltas: Vec<&PackDeltaChain> = chains
        .iter()
        .filter(|chain| matches!(chain.resolution, DeltaResolution::Delta { .. }))
        .collect();
    assert_eq!(
        deltas.len(),
        1,
        "16 MiB of shared bytes must be delta encoded"
    );
    let delta_len = match &deltas[0].resolution {
        DeltaResolution::Delta { delta_payload, .. } => delta_payload.len(),
        DeltaResolution::Full { payload } => {
            panic!("expected a delta, got {} full bytes", payload.len())
        }
    };
    assert!(
        delta_len < 64,
        "a single 16 MiB copy must stay tiny, got {delta_len} delta bytes"
    );

    let entries = write_pack_pair(&pack_path, &idx_path, &chains);
    let replay = verify_written_pack(&pack_path, &idx_path, &entries)
        .expect("a 16 MiB copy delta must replay and match its ids");
    assert_eq!(replay.objects_verified, 2);
    git_verify_pack_strict(&idx_path);
}

#[test]
fn test_verify_written_pack_rejects_oid_mismatch() {
    let test_dir = TestDir::new("verify_oid_mismatch");
    let pack_path = test_dir.path().join("wrong.pack");
    let idx_path = test_dir.path().join("wrong.idx");

    let payload = b"object stored under a deliberately wrong id\n".to_vec();
    let wrong_oid = Oid::from_bytes([0x42; 20]);
    let items = vec![PackDeltaItem::new(
        wrong_oid,
        ObjectKind::Blob,
        payload,
        Some("wrong.txt"),
    )];
    let chains = find_pack_deltas(items, 10, 50);
    let entries = write_pack_pair(&pack_path, &idx_path, &chains);

    let error = verify_written_pack(&pack_path, &idx_path, &entries)
        .expect_err("a wrong recorded id must fail replay");
    let message = error.to_string();
    assert!(
        message.contains(REPACK_BLOCKED_MARKER),
        "error must carry the marker: {message}"
    );
    assert!(
        message.contains("decodes to"),
        "error must name the decoded id: {message}"
    );
}

#[test]
fn test_verify_written_pack_rejects_corrupt_delta_payload() {
    let test_dir = TestDir::new("verify_bad_delta");
    let pack_path = test_dir.path().join("bad.pack");
    let idx_path = test_dir.path().join("bad.idx");

    let base_payload = b"base payload for the corrupt delta case".to_vec();
    let base_oid = compute_object_oid(ObjectKind::Blob, &base_payload);
    let base_chain = PackDeltaChain {
        oid: base_oid,
        kind: ObjectKind::Blob,
        resolution: DeltaResolution::Full {
            payload: base_payload.clone(),
        },
        original_size: base_payload.len(),
        depth: 0,
    };
    let corrupt_chain = PackDeltaChain {
        oid: Oid::from_bytes([0x24; 20]),
        kind: ObjectKind::Blob,
        resolution: DeltaResolution::Delta {
            base_oid,
            base_index: 0,
            delta_payload: vec![0xff, 0x01],
        },
        original_size: 77,
        depth: 1,
    };
    let entries = write_pack_pair(&pack_path, &idx_path, &[base_chain, corrupt_chain]);

    let error = verify_written_pack(&pack_path, &idx_path, &entries)
        .expect_err("a corrupt delta payload must fail replay");
    let message = error.to_string();
    assert!(
        message.contains(REPACK_BLOCKED_MARKER),
        "error must carry the marker: {message}"
    );
    assert!(
        message.contains("cannot be replayed"),
        "error must name the unreadable entry: {message}"
    );
}

#[test]
fn test_reads_git_generated_delta_pack() {
    if !system_git_available() {
        println!(
            "git binary unavailable in this sandbox, skipping test_reads_git_generated_delta_pack."
        );
        return;
    }
    let test_dir = TestDir::new("git_delta_pack");
    let repo = test_dir.path();
    run_git(repo, &["init", "-q"]);

    let lines: Vec<String> = (0..20_000usize)
        .map(|index| {
            format!(
                "line {index:06} {:012x}",
                (index as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15) & 0xffff_ffff_ffff
            )
        })
        .collect();
    fs::write(repo.join("big.txt"), format!("{}\n", lines.join("\n")))
        .expect("write first revision");
    run_git(repo, &["add", "big.txt"]);
    run_git(
        repo,
        &[
            "-c",
            "user.name=Taxis Test",
            "-c",
            "user.email=taxis@example.com",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "-m",
            "first",
        ],
    );

    let mut changed = lines;
    changed[10] = "line 000010 CHANGED BY TAXIS TEST".to_string();
    changed[15_000] = "line 015000 CHANGED BY TAXIS TEST".to_string();
    fs::write(repo.join("big.txt"), format!("{}\n", changed.join("\n")))
        .expect("write second revision");
    run_git(repo, &["add", "big.txt"]);
    run_git(
        repo,
        &[
            "-c",
            "user.name=Taxis Test",
            "-c",
            "user.email=taxis@example.com",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "-m",
            "second",
        ],
    );
    run_git(repo, &["-c", "pack.window=20", "repack", "-adf"]);

    let pack_dir = repo.join(".git").join("objects").join("pack");
    let idx_path = fs::read_dir(&pack_dir)
        .expect("read pack dir")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .find(|path| path.extension().is_some_and(|ext| ext == "idx"))
        .expect("git repack must generate an index");
    let pack_path = idx_path.with_extension("pack");
    assert!(pack_path.is_file(), "git repack must generate a pack");

    let pack_index = PackIndex::load(&idx_path).expect("load git index");
    let pack_file = PackFile::load(&pack_path).expect("load git pack");
    assert_eq!(pack_file.object_count() as usize, pack_index.object_count());
    for index in 0..pack_index.object_count() {
        let oid = pack_index.oid_at(index).expect("oid for git index entry");
        let offset = pack_index.offset_at(index);
        let packed = pack_file
            .read_at(offset, &EmptyBaseResolver)
            .expect("decode git pack object");
        assert_eq!(compute_object_oid(packed.kind, &packed.payload), oid);
    }

    let stdout = git_verify_pack_strict(&idx_path);
    let delta_entries = stdout
        .lines()
        .filter(|line| {
            let tokens: Vec<&str> = line.split_whitespace().collect();
            tokens.len() >= 6
                && tokens[0].len() == 40
                && tokens[0].chars().all(|c| c.is_ascii_hexdigit())
        })
        .count();
    assert!(
        delta_entries >= 1,
        "git pack must contain a delta to exercise the decoder: {stdout}"
    );
}
