//! Integration Test: Taxis In-Place Storage Engine (TIPSE)
//! File Path: tests/rust/test_in_place_engine.rs
//! Architecture Role: Verifies end-to-end functionality of SpacePlan preflight simulations,
//!   reverse tail-truncation, crash-safe WAL journaling, archive restoration, and low-disk repack.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-PRF-001, FGT-COR-001.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use fg_algorithms::space_plan::{
    check_headroom, simulate_space_plan, ExtractionUnit, SpacePlanConfig,
};
use fg_core::models::{compute_object_oid, ObjectKind};
use fg_storage::archive::{TarWriter, ZipWriter};
use fg_storage::in_place::{
    extract_tar_in_place, extract_zip_in_place, index_tar_archive, plan_tar_in_place,
    plan_zip_in_place, read_zip_central_directory, read_zip_eocd, ArchiveRestorer, InPlaceJournal,
    InPlaceLogEntry, TailTruncator,
};
use fg_storage::loose::LooseOdb;
use fg_storage::repack::{scan_loose_objects, RepackEngine, RepackOptions};

fn test_temp_dir(prefix: &str) -> tempfile::TempDir {
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = fs::create_dir_all(&base);
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(&base)
        .or_else(|_| tempfile::tempdir())
        .expect("create test tempdir")
}

#[test]
fn test_tipse_space_plan_simulation() {
    let config = SpacePlanConfig::new(50 * 1024 * 1024, 16 * 1024 * 1024);

    let units = vec![
        ExtractionUnit::new("a.bin", 20 * 1024 * 1024, 10 * 1024 * 1024, 100),
        ExtractionUnit::new("b.bin", 30 * 1024 * 1024, 20 * 1024 * 1024, 200),
    ];

    // Initial 100MB free:
    // a.bin: 100 - 20 = 80. (pending truncate: 10 < 16, no flush)
    // b.bin: 80 - 30 = 50. (is_last: flush 10 + 20 = 30 -> 80)
    // Min level: 50MB. Headroom: 50MB => Viable!
    let report = simulate_space_plan(100 * 1024 * 1024, &units, &config);
    assert!(report.is_viable);
    assert_eq!(report.trough_free_space, 50 * 1024 * 1024);
    assert!(check_headroom(&report).is_ok());

    // Initial 90MB free: trough drops to 40MB < 50MB headroom => Fails
    let tight_report = simulate_space_plan(90 * 1024 * 1024, &units, &config);
    assert!(!tight_report.is_viable);
    assert_eq!(tight_report.required_additional_bytes, 10 * 1024 * 1024);
    assert!(check_headroom(&tight_report).is_err());
}

#[test]
fn test_tipse_zip_end_to_end_in_place_extraction() {
    let dir = test_temp_dir("tipse_zip_");
    let zip_path = dir.path().join("source.zip");
    let extract_dir = dir.path().join("extracted");

    // 1. Build synthetic ZIP
    let file = File::create(&zip_path).expect("create zip");
    let mut writer = ZipWriter::new(file);

    let payload_a = b"First file contents inside zip archive.";
    let payload_b = b"Second file contents with additional details and metadata.";
    let payload_c = vec![0x33u8; 16384]; // 16KB

    writer
        .append_file("src/main.rs", 0o644, 1500000000, payload_a)
        .expect("write a");
    writer
        .append_file("docs/readme.md", 0o644, 1500000001, payload_b)
        .expect("write b");
    writer
        .append_file("assets/blob.dat", 0o644, 1500000002, &payload_c)
        .expect("write c");

    let mut finished = writer.finish().expect("finish");
    finished.flush().expect("flush");
    let initial_len = finished.metadata().expect("meta").len();
    drop(finished);

    // 2. Preflight SpacePlan check
    let mut zip_file = File::open(&zip_path).expect("open zip");
    let eocd = read_zip_eocd(&mut zip_file).expect("read eocd");
    let members = read_zip_central_directory(&mut zip_file, &eocd).expect("read cd");
    drop(zip_file);

    let config = SpacePlanConfig::new(1024, 2048);
    let plan = plan_zip_in_place(1024 * 1024, &members, &config);
    assert!(plan.is_viable);

    // 3. Perform in-place extraction
    let report = extract_zip_in_place(&zip_path, &extract_dir, &config).expect("extract");
    assert_eq!(report.files_extracted, 3);
    assert_eq!(report.final_archive_len, 0);
    assert!(report.total_truncated_bytes >= initial_len);

    // 4. Verify extracted files
    assert_eq!(
        fs::read(extract_dir.join("src/main.rs")).expect("read main"),
        payload_a
    );
    assert_eq!(
        fs::read(extract_dir.join("docs/readme.md")).expect("read readme"),
        payload_b
    );
    assert_eq!(
        fs::read(extract_dir.join("assets/blob.dat")).expect("read blob"),
        payload_c
    );
}

#[test]
fn test_tipse_tar_end_to_end_in_place_extraction() {
    let dir = test_temp_dir("tipse_tar_");
    let tar_path = dir.path().join("source.tar");
    let extract_dir = dir.path().join("extracted");

    // 1. Build synthetic Tar
    let file = File::create(&tar_path).expect("create tar");
    let mut writer = TarWriter::new(file);

    let doc = b"# Project Documentation\nTaxis In-Place Storage Engine.";
    let code = b"fn main() { println!(\"Hello TIPSE\"); }";

    writer
        .append_file("doc.md", 0o644, 1600000000, doc)
        .expect("append doc");
    writer
        .append_file("code.rs", 0o755, 1600000001, code)
        .expect("append code");
    writer.finish().expect("finish");

    // 2. Preflight SpacePlan check
    let mut tar_file = File::open(&tar_path).expect("open tar");
    let members = index_tar_archive(&mut tar_file).expect("index tar");
    drop(tar_file);

    let config = SpacePlanConfig::new(512, 512);
    let plan = plan_tar_in_place(1024 * 1024, &members, &config);
    assert!(plan.is_viable);

    // 3. Extract in-place
    let report = extract_tar_in_place(&tar_path, &extract_dir, &config).expect("extract tar");
    assert_eq!(report.files_extracted, 2);
    assert_eq!(report.final_archive_len, 0);

    // 4. Verify files
    assert_eq!(fs::read(extract_dir.join("doc.md")).expect("read doc"), doc);
    assert_eq!(
        fs::read(extract_dir.join("code.rs")).expect("read code"),
        code
    );
}

#[test]
fn test_tipse_wal_and_reversibility() {
    let dir = test_temp_dir("tipse_wal_");
    let wal_path = dir.path().join("transact.wal");
    let zip_path = dir.path().join("partial.zip");

    // 1. Write WAL records
    let mut journal = InPlaceJournal::open(&wal_path).expect("open journal");
    journal
        .append(&InPlaceLogEntry::SessionInit {
            archive_path: zip_path.display().to_string(),
            target_path: "extracted/".into(),
            total_members: 2,
            initial_archive_len: 5000,
        })
        .expect("append init");
    journal
        .append(&InPlaceLogEntry::MemberExtracted {
            name: "finished.txt".into(),
            extracted_bytes: 1500,
            local_header_offset: 3500,
            crc32: 0x9999,
        })
        .expect("append member");
    journal
        .append(&InPlaceLogEntry::BatchTruncated {
            new_len: 3500,
            freed_bytes: 1500,
        })
        .expect("append trunc");

    let state = InPlaceJournal::replay(&wal_path).expect("replay");
    assert!(!state.is_completed);
    assert!(state.extracted_members.contains("finished.txt"));
    assert_eq!(state.last_truncated_len, Some(3500));

    // 2. Synthesize valid zip tail for reversibility
    let file = File::create(&zip_path).expect("create zip");
    let mut writer = ZipWriter::new(file);
    writer
        .append_file("remaining.txt", 0o644, 1000, b"Still inside zip")
        .expect("write remaining");
    writer
        .append_file("aborted.txt", 0o644, 1001, b"Truncated away")
        .expect("write aborted");
    let mut finished = writer.finish().expect("finish");
    finished.flush().expect("flush");
    drop(finished);

    let mut truncator = TailTruncator::open_read_write(&zip_path).expect("truncator");
    let eocd = read_zip_eocd(truncator.file_mut()).expect("eocd");
    let members = read_zip_central_directory(truncator.file_mut(), &eocd).expect("cd");

    // Truncate aborted.txt
    truncator
        .truncate_to(members[1].local_header_offset)
        .expect("truncate");

    // Synthesize valid tail for remaining member
    ArchiveRestorer::synthesize_zip_tail(truncator.file_mut(), &members[..1]).expect("synthesize");

    let restored = ArchiveRestorer::verify_restored_zip(truncator.file_mut()).expect("verify");
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].name, "remaining.txt");
}

#[test]
fn test_tipse_low_disk_repack_progressive() {
    let dir = test_temp_dir("tipse_repack_");
    let git_dir = dir.path().join("repo.git");
    let objects_dir = git_dir.join("objects");
    fs::create_dir_all(&objects_dir).expect("create objects");

    // Write 6 loose objects
    for i in 0..6 {
        let content = format!("Unique payload string for loose object {}", i);
        let oid = compute_object_oid(ObjectKind::Blob, content.as_bytes());
        let header = format!("blob {}\0", content.len());
        let mut raw = header.into_bytes();
        raw.extend_from_slice(content.as_bytes());
        LooseOdb::write_loose_object_raw(&git_dir, &oid, &raw).expect("write loose");
    }

    assert_eq!(scan_loose_objects(&git_dir).expect("scan").len(), 6);

    // Repack with low_disk micro-pack slicing (slice limit: 64 bytes)
    let options = RepackOptions {
        low_disk: true,
        micro_pack_bytes: 64,
        keep_loose: false,
        ..Default::default()
    };

    let report_opt = RepackEngine::repack_repository(&git_dir, &options).expect("repack");
    let report = report_opt.expect("report present");

    assert_eq!(report.objects_packed, 6);
    assert_eq!(report.objects_verified, 6);
    assert_eq!(report.loose_pruned, 6);

    // Confirm all loose objects have been pruned
    assert!(scan_loose_objects(&git_dir).expect("scan after").is_empty());
}

fn system_git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn run_git(repo: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .current_dir(repo)
        .args(args)
        .output()
        .expect("git invocation failed")
}

fn run_git_ok(repo: &Path, args: &[&str]) -> String {
    let output = run_git(repo, args);
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let stderr_str = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "git {args:?} failed: {stdout_str}{stderr_str}"
    );
    stdout_str.into_owned()
}

fn create_repo(path: &Path) {
    fs::create_dir_all(path).expect("create repository directory");
    run_git_ok(path, &["init", "-q", "."]);
    run_git_ok(path, &["config", "user.name", "Taxis Test"]);
    run_git_ok(path, &["config", "user.email", "test@taxis.internal"]);
}

fn commit_files(repo: &Path, message: &str, files: &[(&str, &str)]) {
    for (relative, content) in files {
        let target: PathBuf = repo.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("create parent directory");
        }
        fs::write(&target, content).expect("write fixture file");
    }
    run_git_ok(repo, &["add", "-A"]);
    run_git_ok(repo, &["commit", "-q", "-m", message]);
}

fn run_taxis(repo: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_taxis"))
        .current_dir(repo)
        .args(args)
        .output()
        .expect("the built taxis binary must be runnable")
}

fn run_taxis_ok(repo: &Path, args: &[&str]) -> String {
    let output = run_taxis(repo, args);
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let stderr_str = String::from_utf8_lossy(&output.stderr);
    let exit_code = output.status.code();
    assert!(
        output.status.success(),
        "taxis {args:?} failed with exit code {exit_code:?}\nstdout: {stdout_str}\nstderr: {stderr_str}"
    );
    stdout_str.into_owned()
}

#[test]
fn test_tipse_cli_help_wiring() {
    let dir = test_temp_dir("tipse_cli_help_");

    let unarchive_help = run_taxis_ok(dir.path(), &["unarchive", "--help"]);
    assert!(unarchive_help.contains("--to-odb"));
    assert!(unarchive_help.contains("--branch"));
    assert!(unarchive_help.contains("--tree-only"));
    assert!(unarchive_help.contains(".bundle"));

    let bundle_help = run_taxis_ok(dir.path(), &["bundle", "--help"]);
    assert!(bundle_help.contains("unbundle"));
    assert!(bundle_help.contains("apply"));

    let repack_help = run_taxis_ok(dir.path(), &["repack", "--help"]);
    assert!(repack_help.contains("--low-disk"));
    assert!(repack_help.contains("-w"));

    let project_help = run_taxis_ok(dir.path(), &["project", "--help"]);
    assert!(project_help.contains("project"));

    let quarantine_help = run_taxis_ok(dir.path(), &["quarantine", "--help"]);
    assert!(quarantine_help.contains("quarantine"));

    let remote_help = run_taxis_ok(dir.path(), &["remote", "--help"]);
    assert!(remote_help.contains("remote"));

    let init_help = run_taxis_ok(dir.path(), &["init", "--help"]);
    assert!(init_help.contains("init"));
}

#[test]
fn test_tipse_cli_unarchive_to_odb_zip() {
    if !system_git_available() {
        eprintln!("skip: git is unavailable");
        return;
    }
    let dir = test_temp_dir("tipse_cli_odb_");
    let repo = dir.path().join("repo");
    create_repo(&repo);

    let zip_path = dir.path().join("source.zip");
    let file = File::create(&zip_path).expect("create zip");
    let mut writer = ZipWriter::new(file);
    writer
        .append_file("hello.txt", 0o644, 1500000000, b"Hello CAS ODB World")
        .expect("append hello");
    writer
        .append_file("nested/module.rs", 0o644, 1500000001, b"pub fn code() {}")
        .expect("append nested");
    let mut finished = writer.finish().expect("finish");
    finished.flush().expect("flush");
    drop(finished);

    let out = run_taxis_ok(
        &repo,
        &[
            "unarchive",
            "--to-odb",
            "--branch",
            "feature/in-place-import",
            zip_path.to_str().expect("path"),
        ],
    );
    assert!(out.contains("Root Tree OID"));
    assert!(out.contains("feature/in-place-import"));
    assert!(out.contains("Working Tree:        Bypassed"));

    // Verify zero working tree files were allocated on disk
    assert!(
        !repo.join("hello.txt").exists(),
        "working tree must not be populated in --to-odb mode"
    );
    assert!(
        !repo.join("nested").exists(),
        "working tree nested dir must not exist"
    );

    // Verify in-place truncation completed
    assert_eq!(
        fs::metadata(&zip_path).expect("meta").len(),
        0,
        "source zip should be truncated in-place to 0 bytes"
    );

    // Verify git ls-tree or taxis ls-tree can read the tree
    let ls_tree = run_taxis_ok(&repo, &["ls-tree", "-r", "feature/in-place-import"]);
    assert!(ls_tree.contains("hello.txt"));
    assert!(ls_tree.contains("nested/module.rs"));

    // Verify tree-only mode with fresh zip
    let tree_zip_path = dir.path().join("tree_only.zip");
    let tree_file = File::create(&tree_zip_path).expect("create tree zip");
    let mut tree_writer = ZipWriter::new(tree_file);
    tree_writer
        .append_file("isolated.txt", 0o644, 1500000002, b"Isolated tree file")
        .expect("append isolated");
    let mut tree_finished = tree_writer.finish().expect("finish tree zip");
    tree_finished.flush().expect("flush tree zip");
    drop(tree_finished);

    let tree_only_out = run_taxis_ok(
        &repo,
        &[
            "unarchive",
            "--to-odb",
            "--tree-only",
            tree_zip_path.to_str().expect("path"),
        ],
    );
    let tree_oid = tree_only_out.trim();
    assert_eq!(tree_oid.len(), 40, "tree-only output must be 40-hex OID");
    let cat_tree = run_taxis_ok(&repo, &["cat-file", "-t", tree_oid]);
    assert_eq!(cat_tree.trim(), "tree");
}

#[test]
fn test_tipse_cli_bundle_unbundle_and_delegation() {
    if !system_git_available() {
        eprintln!("skip: git is unavailable");
        return;
    }
    let dir = test_temp_dir("tipse_cli_bundle_");
    let src_repo = dir.path().join("src_repo");
    create_repo(&src_repo);
    commit_files(
        &src_repo,
        "initial commit",
        &[("pkg.txt", "bundle payload data\n")],
    );

    let bundle_path = dir.path().join("transfer.bundle");
    let bundle_arg = bundle_path.to_str().expect("path");
    run_taxis_ok(&src_repo, &["bundle", "create", bundle_arg, "HEAD"]);
    assert!(bundle_path.exists());
    let bundle_initial_len = fs::metadata(&bundle_path).expect("meta").len();
    assert!(bundle_initial_len > 0);

    // 1. In-place unbundle via `taxis bundle unbundle`
    let dst_repo = dir.path().join("dst_repo");
    create_repo(&dst_repo);
    let unbundle_out = run_taxis_ok(&dst_repo, &["bundle", "unbundle", bundle_arg]);
    assert!(unbundle_out.contains("Taxis In-Place Bundle Ingestion"));
    assert_eq!(
        fs::metadata(&bundle_path).expect("meta").len(),
        0,
        "bundle should be consumed in-place"
    );

    // Verify commits and files exist in dst_repo
    let src_head = run_git_ok(&src_repo, &["rev-parse", "HEAD"]);
    let dst_head = run_git_ok(&dst_repo, &["rev-parse", "HEAD"]);
    assert_eq!(src_head.trim(), dst_head.trim());
    let dst_ls = run_taxis_ok(&dst_repo, &["ls-tree", "-r", "HEAD"]);
    assert!(dst_ls.contains("pkg.txt"));

    // 2. In-place unarchive delegation via `taxis unarchive`
    let bundle_path2 = dir.path().join("transfer2.bundle");
    let bundle_arg2 = bundle_path2.to_str().expect("path");
    run_taxis_ok(&src_repo, &["bundle", "create", bundle_arg2, "HEAD"]);
    assert!(bundle_path2.exists());

    let dst_repo2 = dir.path().join("dst_repo2");
    create_repo(&dst_repo2);
    let unarchive_out = run_taxis_ok(&dst_repo2, &["unarchive", bundle_arg2]);
    assert!(unarchive_out.contains("Taxis In-Place Bundle Ingestion"));
    assert_eq!(
        fs::metadata(&bundle_path2).expect("meta").len(),
        0,
        "delegated bundle should be consumed in-place"
    );
    let dst2_head = run_git_ok(&dst_repo2, &["rev-parse", "HEAD"]);
    assert_eq!(src_head.trim(), dst2_head.trim());
    let dst2_ls = run_taxis_ok(&dst_repo2, &["ls-tree", "-r", "HEAD"]);
    assert!(dst2_ls.contains("pkg.txt"));
}

#[test]
fn test_tipse_cli_repack_low_disk() {
    if !system_git_available() {
        eprintln!("skip: git is unavailable");
        return;
    }
    let dir = test_temp_dir("tipse_cli_repack_");
    let repo = dir.path().join("repo");
    create_repo(&repo);

    commit_files(&repo, "commit 1", &[("c1.txt", "content 1\n")]);
    commit_files(&repo, "commit 2", &[("c2.txt", "content 2\n")]);

    // Repack with low-disk mode
    let out = run_taxis_ok(&repo, &["repack", "-w", "10", "--low-disk"]);
    assert!(out.contains("Taxis Packfile Consolidation"));
    assert!(out.contains("Objects Packed:"));
    assert!(out.contains("Loose Pruned:"));
}
