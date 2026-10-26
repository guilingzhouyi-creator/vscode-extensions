//! Integration Test: TIPSE destructive-mode safety contracts
//! File Path: tests/rust/test_tipse_safety.rs
//! Architecture Role: Pins the behaviour contract of `taxis unarchive` / `taxis bundle unbundle`
//!   so that projection, standard-extraction, and bundle-ingestion modes never destroy user data
//!   unless the caller asked for in-place reclamation.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-COR-001.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use fg_storage::archive::{TarWriter, ZipWriter};

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
    run_git_ok(path, &["config", "user.name", "Taxis Safety Test"]);
    run_git_ok(path, &["config", "user.email", "safety@taxis.internal"]);
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

fn write_zip(path: &Path, members: &[(&str, &[u8])]) {
    let file = File::create(path).expect("create zip fixture");
    let mut writer = ZipWriter::new(file);
    for (index, (name, payload)) in members.iter().enumerate() {
        writer
            .append_file(name, 0o644, 1500000000 + index as i64, payload)
            .expect("append zip member");
    }
    let mut finished = writer.finish().expect("finish zip fixture");
    finished.flush().expect("flush zip fixture");
}

fn write_tar(path: &Path, members: &[(&str, &[u8])]) {
    let file = File::create(path).expect("create tar fixture");
    let mut writer = TarWriter::new(file);
    for (index, (name, payload)) in members.iter().enumerate() {
        writer
            .append_file(name, 0o644, 1500000000 + index as i64, payload)
            .expect("append tar member");
    }
    let mut finished = writer.finish().expect("finish tar fixture");
    finished.flush().expect("flush tar fixture");
}

fn write_targz(path: &Path, members: &[(&str, &[u8])]) {
    let file = File::create(path).expect("create tar.gz fixture");
    let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    let mut writer = TarWriter::new(encoder);
    for (index, (name, payload)) in members.iter().enumerate() {
        writer
            .append_file(name, 0o644, 1500000000 + index as i64, payload)
            .expect("append tar.gz member");
    }
    let encoder = writer.finish().expect("finish tar.gz tar stream");
    let mut finished = encoder.finish().expect("finish tar.gz gzip stream");
    finished.flush().expect("flush tar.gz fixture");
}

fn assert_archive_untouched(path: &Path, before: &[u8]) {
    let after = fs::read(path).expect("read archive after command");
    assert_eq!(
        after,
        before,
        "archive '{}' must remain byte-identical",
        path.display()
    );
}

fn object_database_entries(repo: &Path) -> usize {
    let objects_dir = repo.join(".git").join("objects");
    fn walk(dir: &Path, acc: &mut usize) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, acc);
            } else {
                *acc += 1;
            }
        }
    }
    let mut count = 0;
    walk(&objects_dir, &mut count);
    count
}

#[test]
fn test_dry_run_projection_preserves_archive_worktree_and_odb() {
    if !system_git_available() {
        eprintln!("skip: git is unavailable");
        return;
    }
    let dir = test_temp_dir("tipse_safety_dry_run_");
    let repo = dir.path().join("repo");
    create_repo(&repo);

    let zip_path = dir.path().join("payload.zip");
    write_zip(
        &zip_path,
        &[
            ("alpha.txt", b"alpha payload\n"),
            ("nested/beta.txt", b"beta payload\n"),
        ],
    );
    let archive_before = fs::read(&zip_path).expect("read zip before command");
    let objects_before = object_database_entries(&repo);
    let refs_before = run_git_ok(&repo, &["for-each-ref"]);

    let dest = dir.path().join("dry_run_output");
    let stdout = run_taxis_ok(
        &repo,
        &[
            "unarchive",
            "--to-odb",
            "--dry-run",
            "--branch",
            "refs/heads/dry-run-probe",
            "-C",
            dest.to_str().expect("dest path"),
            zip_path.to_str().expect("zip path"),
        ],
    );

    assert!(
        stdout.contains("Disk Effects:            none (projection only)"),
        "projection must state that disk effects are absent: {stdout}"
    );
    assert_archive_untouched(&zip_path, &archive_before);
    assert!(
        !dest.exists(),
        "dry-run must not create the destination directory"
    );
    assert_eq!(
        object_database_entries(&repo),
        objects_before,
        "dry-run must not write loose objects"
    );
    assert_eq!(
        run_git_ok(&repo, &["for-each-ref"]),
        refs_before,
        "dry-run must not advance any reference"
    );
}

#[test]
fn test_no_in_place_zip_extracts_without_touching_source() {
    let dir = test_temp_dir("tipse_safety_zip_");
    let zip_path = dir.path().join("source.zip");
    write_zip(
        &zip_path,
        &[
            ("docs/readme.md", b"readme body\n"),
            ("src/main.rs", b"fn main() {}\n"),
        ],
    );
    let archive_before = fs::read(&zip_path).expect("read zip before command");
    let dest = dir.path().join("extracted");

    let stdout = run_taxis_ok(
        dir.path(),
        &[
            "unarchive",
            "--no-in-place",
            "-C",
            dest.to_str().expect("dest path"),
            zip_path.to_str().expect("zip path"),
        ],
    );

    assert!(
        stdout.contains("Source archive retained intact"),
        "standard extraction must report the retained source: {stdout}"
    );
    assert_archive_untouched(&zip_path, &archive_before);
    assert_eq!(
        fs::read(dest.join("docs").join("readme.md")).expect("read extracted readme"),
        b"readme body\n"
    );
    assert_eq!(
        fs::read(dest.join("src").join("main.rs")).expect("read extracted main"),
        b"fn main() {}\n"
    );
}

#[test]
fn test_no_in_place_tar_extracts_without_touching_source() {
    let dir = test_temp_dir("tipse_safety_tar_");
    let tar_path = dir.path().join("source.tar");
    write_tar(
        &tar_path,
        &[
            ("notes/one.txt", b"first tar member\n"),
            ("notes/two.txt", b"second tar member\n"),
        ],
    );
    let archive_before = fs::read(&tar_path).expect("read tar before command");
    let dest = dir.path().join("extracted");

    run_taxis_ok(
        dir.path(),
        &[
            "unarchive",
            "--no-in-place",
            "-C",
            dest.to_str().expect("dest path"),
            tar_path.to_str().expect("tar path"),
        ],
    );

    assert_archive_untouched(&tar_path, &archive_before);
    assert_eq!(
        fs::read(dest.join("notes").join("one.txt")).expect("read extracted one"),
        b"first tar member\n"
    );
    assert_eq!(
        fs::read(dest.join("notes").join("two.txt")).expect("read extracted two"),
        b"second tar member\n"
    );
}

#[test]
fn test_repack_rejects_malformed_micro_pack_and_unknown_flags() {
    let dir = test_temp_dir("tipse_safety_repack_");
    let repo = dir.path().join("repo");
    create_repo(&repo);

    let malformed = run_taxis(
        &repo,
        &["repack", "--low-disk", "--micro-pack", "not-a-size"],
    );
    assert_eq!(
        malformed.status.code(),
        Some(129),
        "malformed --micro-pack must be a usage error"
    );

    let below_floor = run_taxis(&repo, &["repack", "--low-disk", "--micro-pack", "512K"]);
    assert_eq!(
        below_floor.status.code(),
        Some(129),
        "--micro-pack below the 1M floor must be rejected"
    );

    let unknown = run_taxis(&repo, &["repack", "--definitely-not-a-flag"]);
    assert_eq!(
        unknown.status.code(),
        Some(129),
        "unknown repack flags must no longer be silently ignored"
    );
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

#[test]
fn test_bundle_unbundle_default_retains_source_and_advances_refs() {
    if !system_git_available() {
        eprintln!("skip: git is unavailable");
        return;
    }
    let dir = test_temp_dir("tipse_safety_bundle_keep_");
    let src_repo = dir.path().join("src_repo");
    create_repo(&src_repo);
    commit_files(
        &src_repo,
        "seed bundle payload",
        &[("payload.txt", "bundle retention payload\n")],
    );

    let bundle_path = dir.path().join("keep.bundle");
    run_taxis_ok(
        &src_repo,
        &[
            "bundle",
            "create",
            bundle_path.to_str().expect("bundle path"),
            "HEAD",
        ],
    );
    let bundle_before = fs::read(&bundle_path).expect("read bundle before ingestion");

    let dst_repo = dir.path().join("dst_repo");
    create_repo(&dst_repo);
    run_taxis_ok(
        &dst_repo,
        &[
            "bundle",
            "unbundle",
            bundle_path.to_str().expect("bundle path"),
        ],
    );

    assert_archive_untouched(&bundle_path, &bundle_before);
    let src_head = run_git_ok(&src_repo, &["rev-parse", "HEAD"]);
    let dst_head = run_git_ok(&dst_repo, &["rev-parse", "HEAD"]);
    assert_eq!(
        src_head.trim(),
        dst_head.trim(),
        "default ingestion must still advance the target branch"
    );
}

#[test]
fn test_bundle_unbundle_in_place_truncates_after_verification() {
    if !system_git_available() {
        eprintln!("skip: git is unavailable");
        return;
    }
    let dir = test_temp_dir("tipse_safety_bundle_truncate_");
    let src_repo = dir.path().join("src_repo");
    create_repo(&src_repo);
    commit_files(
        &src_repo,
        "seed truncation payload",
        &[("payload.txt", "bundle truncation payload\n")],
    );

    let bundle_path = dir.path().join("truncate.bundle");
    run_taxis_ok(
        &src_repo,
        &[
            "bundle",
            "create",
            bundle_path.to_str().expect("bundle path"),
            "HEAD",
        ],
    );
    let bundle_len_before = fs::metadata(&bundle_path).expect("bundle metadata").len();
    assert!(bundle_len_before > 0);

    let dst_repo = dir.path().join("dst_repo");
    create_repo(&dst_repo);
    run_taxis_ok(
        &dst_repo,
        &[
            "bundle",
            "unbundle",
            bundle_path.to_str().expect("bundle path"),
            "--in-place",
        ],
    );

    assert_eq!(
        fs::metadata(&bundle_path).expect("bundle metadata").len(),
        0,
        "--in-place must reclaim the consumed bundle"
    );
    let src_head = run_git_ok(&src_repo, &["rev-parse", "HEAD"]);
    let dst_head = run_git_ok(&dst_repo, &["rev-parse", "HEAD"]);
    assert_eq!(src_head.trim(), dst_head.trim());
}

#[test]
fn test_bundle_unbundle_rejects_corrupted_payload_without_data_loss() {
    if !system_git_available() {
        eprintln!("skip: git is unavailable");
        return;
    }
    let dir = test_temp_dir("tipse_safety_bundle_corrupt_");
    let src_repo = dir.path().join("src_repo");
    create_repo(&src_repo);
    commit_files(
        &src_repo,
        "seed corruption payload",
        &[("payload.txt", "bundle corruption payload\n")],
    );

    let bundle_path = dir.path().join("corrupt.bundle");
    run_taxis_ok(
        &src_repo,
        &[
            "bundle",
            "create",
            bundle_path.to_str().expect("bundle path"),
            "HEAD",
        ],
    );

    let mut corrupted = fs::read(&bundle_path).expect("read bundle");
    let last_index = corrupted.len() - 1;
    corrupted[last_index] ^= 0xFF;
    fs::write(&bundle_path, &corrupted).expect("write corrupted bundle");
    let corrupted_before = fs::read(&bundle_path).expect("reread corrupted bundle");

    let dst_repo = dir.path().join("dst_repo");
    create_repo(&dst_repo);
    let refs_before = run_git_ok(&dst_repo, &["for-each-ref"]);

    let output = run_taxis(
        &dst_repo,
        &[
            "bundle",
            "unbundle",
            bundle_path.to_str().expect("bundle path"),
        ],
    );
    assert!(
        !output.status.success(),
        "a corrupted bundle must be refused, not partially ingested"
    );
    assert_archive_untouched(&bundle_path, &corrupted_before);
    assert_eq!(
        run_git_ok(&dst_repo, &["for-each-ref"]),
        refs_before,
        "refusal must leave every reference untouched"
    );
    assert!(
        !dst_repo.join("payload.txt").exists(),
        "refusal must not materialize any working tree file"
    );
}

#[test]
fn test_targz_in_place_hole_punch_reports_measured_reclamation() {
    let dir = test_temp_dir("tipse_safety_targz_");
    let targz_path = dir.path().join("payload.tar.gz");
    // Incompressible payloads keep the compressed archive large enough that forward punching has
    // a real region to release instead of a few hundred gzip bytes.
    let mut large_payload = vec![0u8; 64 * 1024];
    let mut state: u32 = 0x5eed_1234;
    for byte in &mut large_payload {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        *byte = (state >> 24) as u8;
    }
    write_targz(
        &targz_path,
        &[
            ("bulk/blob.bin", large_payload.as_slice()),
            ("notes/readme.txt", b"targz payload\n"),
        ],
    );
    let archive_len_before = fs::metadata(&targz_path)
        .expect("stat tar.gz fixture")
        .len();
    assert!(archive_len_before > 0);
    let dest = dir.path().join("extracted");

    let output = run_taxis(
        dir.path(),
        &[
            "unarchive",
            "-C",
            dest.to_str().expect("dest path"),
            targz_path.to_str().expect("tar.gz path"),
        ],
    );
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let stderr_str = String::from_utf8_lossy(&output.stderr);
    if !output.status.success()
        && stderr_str
            .to_ascii_lowercase()
            .contains("unsupported filesystem capability")
    {
        eprintln!("skip: filesystem does not support hole punching: {stderr_str}");
        return;
    }
    assert!(
        output.status.success(),
        "taxis unarchive of a .tar.gz failed: {stdout_str}{stderr_str}"
    );
    assert!(
        stdout_str.contains("forward hole punching"),
        "in-place .tar.gz must report hole punching: {stdout_str}"
    );
    assert!(
        !stdout_str.contains("tail-truncation"),
        "in-place .tar.gz must not claim tail truncation: {stdout_str}"
    );
    assert_eq!(
        fs::read(dest.join("bulk").join("blob.bin")).expect("read extracted blob"),
        large_payload,
        "forward hole punching must still materialize the member payload"
    );
    assert_eq!(
        fs::read(dest.join("notes").join("readme.txt")).expect("read extracted readme"),
        b"targz payload\n"
    );
    assert_eq!(
        fs::metadata(&targz_path)
            .expect("stat tar.gz after command")
            .len(),
        archive_len_before,
        "forward hole punching keeps the archive logical length"
    );
    assert!(
        !dest.join(".taxis_unarchive.wal").exists(),
        "a completed extraction must remove its WAL journal"
    );
}

#[test]
fn test_unarchive_creates_missing_nested_destination_for_wal() {
    let dir = test_temp_dir("tipse_safety_nested_dest_");
    let zip_path = dir.path().join("nested.zip");
    write_zip(
        &zip_path,
        &[("nested/leaf.txt", b"nested destination payload\n")],
    );
    let dest = dir.path().join("out").join("nested").join("deep");
    assert!(
        !dest.exists(),
        "fixture precondition: destination ancestors do not exist"
    );

    let stdout = run_taxis_ok(
        dir.path(),
        &[
            "unarchive",
            "--no-in-place",
            "-C",
            dest.to_str().expect("dest path"),
            zip_path.to_str().expect("zip path"),
        ],
    );
    assert!(
        stdout.contains("Source archive retained intact"),
        "standard extraction must retain the source archive: {stdout}"
    );
    assert_eq!(
        fs::read(dest.join("nested").join("leaf.txt")).expect("read nested extraction"),
        b"nested destination payload\n"
    );
    assert!(
        !dest.join(".taxis_unarchive.wal").exists(),
        "WAL journal in a freshly created destination must be removed on completion"
    );
}

#[test]
fn test_unarchive_headroom_units_help_default_and_usage_errors() {
    let dir = test_temp_dir("tipse_safety_headroom_");
    let zip_path = dir.path().join("headroom.zip");
    write_zip(&zip_path, &[("one.txt", b"headroom payload\n")]);

    let help = run_taxis_ok(dir.path(), &["unarchive", "--help"]);
    assert!(
        help.contains("104857600 bytes"),
        "help must render the DEFAULT_SAFETY_HEADROOM_BYTES constant: {help}"
    );
    for unit in ["K", "M", "G", "T"] {
        assert!(
            help.contains(unit),
            "help must document the binary suffix {unit}: {help}"
        );
    }

    let malformed = run_taxis(
        dir.path(),
        &[
            "unarchive",
            "--headroom",
            "1X",
            zip_path.to_str().expect("zip path"),
        ],
    );
    assert_eq!(
        malformed.status.code(),
        Some(129),
        "--headroom with an unknown unit must be a usage error instead of silently falling back"
    );

    let missing_value = run_taxis(dir.path(), &["unarchive", "--headroom"]);
    assert_eq!(
        missing_value.status.code(),
        Some(129),
        "--headroom without a value must be a usage error"
    );

    let dest = dir.path().join("dry_run_output");
    let stdout = run_taxis_ok(
        dir.path(),
        &[
            "unarchive",
            "--dry-run",
            "--headroom",
            "1T",
            "-C",
            dest.to_str().expect("dest path"),
            zip_path.to_str().expect("zip path"),
        ],
    );
    assert!(
        stdout.contains("Disk Effects"),
        "a 1T headroom must be accepted by the projection path: {stdout}"
    );
    assert!(
        !dest.exists(),
        "dry-run must not create the destination directory"
    );
}
