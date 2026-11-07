//! Module: test_edge_porcelain — Edge Porcelain Commands & Algorithms Integration Suite
//! File Path: tests/rust/test_edge_porcelain.rs
//! Architecture Role: End-to-end integration and verification for Batch 4 edge porcelain components:
//!   `blame` (line-by-line attribution), `bisect` (topological centroid regression search),
//!   `archive` (streaming Tar/Zip generation), and `bundle` (Git bundle v2 serialization & verification).
//! Dependencies & Triggers: Executed by `cargo test --test test_edge_porcelain`. Requires host system Git for differential parity checks.
//! Responsibilities: Validate topological line attribution, bisect centroid monotonicity, archive tar/zip stream validity, and bundle header/pack integrity.
//! Exit Semantics & Design Rationale: Asserts byte-level parity and behavioral equivalence with standard Git semantics.
//!
//! Domain Governance Rules: FGT-COR-001 (differential parity), FGT-ALG-001, FGT-STO-001.

use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use crate::cli_harness::{system_git_available, test_temp_dir};
use fg_algorithms::blame::{BlameEngine, BlameLine};
use fg_algorithms::pack::PackDeltaItem;
use fg_core::models::{ObjectKind, Oid};
use fg_storage::archive::{ArchiveEntry, ArchiveFormat, ArchiveGenerator};
use fg_storage::bundle::BundleEngine;
use fg_topology::bisect::{BisectEngine, BisectState, BisectStep};

#[test]
fn test_blame_line_mapping_and_hunks() {
    let parent_text = "line 1\nline 2\nline 3\n";
    let child_text = "line 1\nline 2 modified\nline 2.5 inserted\nline 3\n";

    let mapping = BlameEngine::compute_line_mapping(parent_text, child_text);

    // Line 1 (idx 0): unchanged, points to parent idx 0
    assert_eq!(mapping[0], Some(0));
    // Line 2 (idx 1): modified, so new in child -> None
    assert_eq!(mapping[1], None);
    // Line 2.5 (idx 2): inserted in child -> None
    assert_eq!(mapping[2], None);
    // Line 3 (idx 3): unchanged, points to parent idx 2
    assert_eq!(mapping[3], Some(2));

    // Test hunk aggregation
    let oid1 = Oid::from_bytes([1u8; 20]);
    let oid2 = Oid::from_bytes([2u8; 20]);

    let blame_lines = vec![
        BlameLine {
            line_no: 1,
            commit_oid: oid1,
            author_name: "Alice".into(),
            commit_time: 1000,
            content: "line 1".into(),
        },
        BlameLine {
            line_no: 2,
            commit_oid: oid2,
            author_name: "Bob".into(),
            commit_time: 2000,
            content: "line 2 modified".into(),
        },
        BlameLine {
            line_no: 3,
            commit_oid: oid2,
            author_name: "Bob".into(),
            commit_time: 2000,
            content: "line 2.5 inserted".into(),
        },
        BlameLine {
            line_no: 4,
            commit_oid: oid1,
            author_name: "Alice".into(),
            commit_time: 1000,
            content: "line 3".into(),
        },
    ];

    let hunks = BlameEngine::aggregate_hunks(&blame_lines);
    assert_eq!(hunks.len(), 3);
    assert_eq!(hunks[0].commit_oid, oid1);
    assert_eq!(hunks[0].line_count, 1);
    assert_eq!(hunks[1].commit_oid, oid2);
    assert_eq!(hunks[1].line_count, 2);
    assert_eq!(hunks[2].commit_oid, oid1);
    assert_eq!(hunks[2].line_count, 1);
}

#[test]
fn test_bisect_topological_centroid() {
    // 5 commits: c0 -> c1 -> c2 -> c3 -> c4
    let c0 = Oid::from_bytes([10u8; 20]);
    let c1 = Oid::from_bytes([11u8; 20]);
    let c2 = Oid::from_bytes([12u8; 20]); // Regression
    let c3 = Oid::from_bytes([13u8; 20]);
    let c4 = Oid::from_bytes([14u8; 20]); // Bad head

    let mut parents: HashMap<Oid, Vec<Oid>> = HashMap::new();
    parents.insert(c4, vec![c3]);
    parents.insert(c3, vec![c2]);
    parents.insert(c2, vec![c1]);
    parents.insert(c1, vec![c0]);
    parents.insert(c0, vec![]);

    // Step 1: bad=c4, good=[c0]
    let step1 = BisectEngine::compute_midpoint(&c4, &[c0], &[], |o| parents.get(o).cloned());
    let mid1 = match step1 {
        BisectStep::Step {
            candidate,
            remaining_candidates,
            ..
        } => {
            assert_eq!(remaining_candidates, 4); // c1, c2, c3, c4
            candidate
        }
        other => panic!("Expected BisectStep::Step, got {:?}", other),
    };

    // Candidate should be c2 (centroid of 4 candidates)
    assert_eq!(mid1, c2);

    // Step 2: mark c2 as bad (so bad=c2, good=[c0])
    let step2 = BisectEngine::compute_midpoint(&c2, &[c0], &[], |o| parents.get(o).cloned());
    let mid2 = match step2 {
        BisectStep::Step {
            candidate,
            remaining_candidates,
            ..
        } => {
            assert_eq!(remaining_candidates, 2); // c1, c2
            candidate
        }
        other => panic!("Expected BisectStep::Step, got {:?}", other),
    };
    assert_eq!(mid2, c1);

    // Step 3: mark c1 as good (so bad=c2, good=[c1])
    let step3 = BisectEngine::compute_midpoint(&c2, &[c1], &[], |o| parents.get(o).cloned());
    match step3 {
        BisectStep::Found { first_bad } => {
            assert_eq!(first_bad, c2);
        }
        other => panic!("Expected BisectStep::Found, got {:?}", other),
    }
}

#[test]
fn test_bisect_state_persistence() {
    let dir = test_temp_dir("bisect_state_");
    let orig = Oid::from_bytes([1u8; 20]);
    let bad = Oid::from_bytes([2u8; 20]);
    let good1 = Oid::from_bytes([3u8; 20]);

    let mut state = BisectState::new(orig, bad);
    state.good.push(good1);

    state.save(dir.path()).unwrap();

    let loaded = BisectState::load(dir.path())
        .unwrap()
        .expect("Loaded state");
    assert_eq!(loaded, state);

    BisectState::clear(dir.path()).unwrap();
    let after_clear = BisectState::load(dir.path()).unwrap();
    assert!(after_clear.is_none());
}

#[test]
fn test_archive_tar_and_zip_generation() {
    let entries = vec![
        ArchiveEntry {
            path: "hello.txt".into(),
            mode: 0o100644,
            mtime: 1700000000,
            payload: b"Hello World!\n".to_vec(),
        },
        ArchiveEntry {
            path: "bin/script.sh".into(),
            mode: 0o100755,
            mtime: 1700000000,
            payload: b"#!/bin/sh\necho hi\n".to_vec(),
        },
    ];

    // 1. Tar format
    let mut tar_buf = Vec::new();
    ArchiveGenerator::write_archive(ArchiveFormat::Tar, Some("repo/"), &entries, &mut tar_buf)
        .unwrap();
    assert!(!tar_buf.is_empty());
    // Tar size must be a multiple of 512 bytes
    assert_eq!(tar_buf.len() % 512, 0);

    // Verify UStar magic in first header at offset 257
    assert_eq!(&tar_buf[257..263], b"ustar\0");

    // 2. TarGz format
    let mut gz_buf = Vec::new();
    ArchiveGenerator::write_archive(ArchiveFormat::TarGz, Some("repo/"), &entries, &mut gz_buf)
        .unwrap();
    assert!(!gz_buf.is_empty());
    // Gzip magic header: 0x1f, 0x8b
    assert_eq!(gz_buf[0], 0x1f);
    assert_eq!(gz_buf[1], 0x8b);

    // 3. Zip format
    let mut zip_buf = Vec::new();
    ArchiveGenerator::write_archive(ArchiveFormat::Zip, Some("repo/"), &entries, &mut zip_buf)
        .unwrap();
    assert!(!zip_buf.is_empty());
    // Zip local header signature: PK\x03\x04
    assert_eq!(&zip_buf[..4], b"PK\x03\x04");
}

#[test]
fn test_bundle_serialization_and_verification() {
    let commit_oid = Oid::from_bytes([5u8; 20]);
    let ref_name = "refs/heads/main".to_string();

    let items = vec![PackDeltaItem {
        oid: commit_oid,
        kind: ObjectKind::Commit,
        payload: b"tree 0000000000000000000000000000000000000000\nauthor Test <t@t> 0 +0000\ncommitter Test <t@t> 0 +0000\n\nInit\n".to_vec(),
        basename_hash: 0,
    }];

    let chains = fg_algorithms::pack::find_pack_deltas(items, 10, 50);

    let mut bundle_bytes = Vec::new();
    let report = BundleEngine::write_bundle(
        &mut bundle_bytes,
        &[],
        &[(commit_oid, ref_name.clone())],
        &chains,
    )
    .expect("Bundle created");

    assert_eq!(report.ref_count, 1);
    assert_eq!(report.object_count, 1);

    // Read and verify bundle header
    let mut cursor = Cursor::new(bundle_bytes);
    let header = BundleEngine::read_header(&mut cursor).expect("Bundle header verified");

    assert_eq!(header.version, 2);
    assert_eq!(header.references.len(), 1);
    assert_eq!(header.references[0], (commit_oid, ref_name));
    assert_eq!(header.pack_object_count, 1);

    // Verify embedded pack checksum
    let verified_checksum = BundleEngine::verify_pack_checksum(&mut cursor, header.pack_offset)
        .expect("Checksum matches");
    assert_eq!(verified_checksum, report.pack_checksum);
}

/// Runs one `git` invocation inside `repo` with deterministic identity configuration.
fn run_git(repo: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .arg("-c")
        .arg("init.defaultBranch=main")
        .arg("-c")
        .arg("user.name=Taxis Test")
        .arg("-c")
        .arg("user.email=test@taxis.internal")
        .arg("-c")
        .arg("commit.gpgsign=false")
        .arg("-c")
        .arg("core.autocrlf=false")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("the system git binary must be runnable")
}

/// Runs one `git` invocation and asserts success, returning standard output.
fn run_git_ok(repo: &Path, args: &[&str]) -> String {
    let output = run_git(repo, args);
    assert!(
        output.status.success(),
        "git {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// Runs the built `taxis` binary inside `repo`, returning its captured output.
fn run_taxis(repo: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(repo)
        .output()
        .expect("the built taxis binary must be runnable")
}

/// Runs `taxis` and asserts success, returning standard output.
fn run_taxis_ok(repo: &Path, args: &[&str]) -> String {
    let output = run_taxis(repo, args);
    assert!(
        output.status.success(),
        "taxis {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// Creates an empty repository at `path`.
fn create_repo(path: &Path) {
    fs::create_dir_all(path).expect("create repository directory");
    run_git_ok(path, &["init", "-q", "."]);
}

/// Writes `files` into `repo` and commits them under `message`.
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

/// Returns the object id `git` resolves `revision` to inside `repo`.
fn git_rev(repo: &Path, revision: &str) -> String {
    run_git_ok(repo, &["rev-parse", revision])
        .trim()
        .to_string()
}

/// Asserts the recursively listed tree of `revision` matches between `source` and `clone`.
fn assert_tree_listing_matches(source: &Path, clone: &Path, revision: &str) {
    assert_eq!(
        run_git_ok(source, &["ls-tree", "-r", "--full-tree", revision]),
        run_git_ok(clone, &["ls-tree", "-r", "--full-tree", "HEAD"]),
        "bundle clone tree listing diverges from the source"
    );
}

/// A bundle must carry the whole object closure of every packaged ref: commits, every subtree and
/// every blob. Git verifies the result independently, so any missing subtree object is fatal here.
#[test]
fn bundle_head_roundtrips_nested_tree_history_through_git() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable, so bundle interoperability cannot be asserted");
        return;
    }

    let dir = test_temp_dir("bundle_head_");
    let repo = dir.path().join("repo");
    create_repo(&repo);
    commit_files(
        &repo,
        "init",
        &[
            ("README.md", "root\n"),
            ("src/main.rs", "fn main() {}\n"),
            ("src/nested/deep.txt", "deep\n"),
            ("assets/logo.bin", "\u{0}\u{1}\u{2}binary"),
        ],
    );
    commit_files(
        &repo,
        "extend",
        &[
            ("src/main.rs", "fn main() { println!(\"hi\"); }\n"),
            ("docs/guide.md", "# Guide\n"),
        ],
    );

    let bundle = dir.path().join("head.bundle");
    let bundle_arg = bundle.to_str().expect("utf-8 temporary path");
    run_taxis_ok(&repo, &["bundle", "create", bundle_arg, "HEAD"]);

    let verify = run_git_ok(&repo, &["bundle", "verify", bundle_arg]);
    assert!(
        verify.contains("complete history"),
        "git bundle verify did not accept the created bundle: {verify}"
    );

    let clone = dir.path().join("clone");
    run_git_ok(
        dir.path(),
        &[
            "clone",
            "-q",
            bundle_arg,
            clone.to_str().expect("utf-8 path"),
        ],
    );
    assert_eq!(git_rev(&repo, "HEAD"), git_rev(&clone, "HEAD"));
    assert_tree_listing_matches(&repo, &clone, "HEAD");
    assert_eq!(
        fs::read_to_string(clone.join("src/nested/deep.txt")).expect("nested file checked out"),
        "deep\n"
    );
}

/// An annotated tag ref must be packaged as the tag object itself, followed by the closure of the
/// commit it names. Git must still report the ref type as `tag` after cloning from the bundle.
#[test]
fn bundle_annotated_tag_keeps_tag_object_through_git() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable, so bundle interoperability cannot be asserted");
        return;
    }

    let dir = test_temp_dir("bundle_head_");
    let repo = dir.path().join("repo");
    create_repo(&repo);
    commit_files(&repo, "init", &[("a.txt", "alpha\n")]);
    run_git_ok(&repo, &["tag", "-a", "v1.0", "-m", "release"]);
    commit_files(&repo, "second", &[("b.txt", "beta\n")]);

    let tag_oid = git_rev(&repo, "refs/tags/v1.0");
    let peeled_oid = git_rev(&repo, "refs/tags/v1.0^{commit}");
    assert_ne!(
        tag_oid, peeled_oid,
        "annotated tag must not equal its commit"
    );

    let bundle = dir.path().join("tag.bundle");
    let bundle_arg = bundle.to_str().expect("utf-8 temporary path");
    run_taxis_ok(&repo, &["bundle", "create", bundle_arg, "v1.0"]);

    let verify = run_git_ok(&repo, &["bundle", "verify", bundle_arg]);
    assert!(
        verify.contains("refs/tags/v1.0"),
        "git bundle verify did not list the annotated tag ref: {verify}"
    );

    let clone = dir.path().join("clone");
    run_git_ok(
        dir.path(),
        &[
            "clone",
            "-q",
            "--no-checkout",
            bundle_arg,
            clone.to_str().expect("utf-8 path"),
        ],
    );
    assert_eq!(git_rev(&clone, "refs/tags/v1.0"), tag_oid);
    assert_eq!(
        run_git_ok(&clone, &["cat-file", "-t", "refs/tags/v1.0"]).trim(),
        "tag"
    );
    assert_eq!(git_rev(&clone, "refs/tags/v1.0^{commit}"), peeled_oid);
}

/// HEAD may point at a non-default branch; the bundle must record HEAD and clone back detached at
/// the same commit with the same tree contents.
#[test]
fn bundle_head_on_non_default_branch_roundtrips() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable, so bundle interoperability cannot be asserted");
        return;
    }

    let dir = test_temp_dir("bundle_head_");
    let repo = dir.path().join("repo");
    create_repo(&repo);
    commit_files(&repo, "init", &[("main.txt", "main\n")]);
    run_git_ok(&repo, &["checkout", "-q", "-b", "feature"]);
    commit_files(&repo, "feature work", &[("feature.txt", "feature\n")]);
    assert_eq!(
        run_git_ok(&repo, &["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
        "feature"
    );

    let bundle = dir.path().join("feature.bundle");
    let bundle_arg = bundle.to_str().expect("utf-8 temporary path");
    run_taxis_ok(&repo, &["bundle", "create", bundle_arg, "HEAD"]);

    let clone = dir.path().join("clone");
    run_git_ok(
        dir.path(),
        &[
            "clone",
            "-q",
            bundle_arg,
            clone.to_str().expect("utf-8 path"),
        ],
    );
    assert_eq!(git_rev(&repo, "HEAD"), git_rev(&clone, "HEAD"));
    assert_tree_listing_matches(&repo, &clone, "HEAD");
    assert_eq!(
        fs::read_to_string(clone.join("feature.txt")).expect("feature branch file"),
        "feature\n"
    );
}

/// The smallest possible history (one commit, no parents) must still produce a complete bundle.
#[test]
fn bundle_single_commit_history_clones() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable, so bundle interoperability cannot be asserted");
        return;
    }

    let dir = test_temp_dir("bundle_head_");
    let repo = dir.path().join("repo");
    create_repo(&repo);
    commit_files(&repo, "only", &[("a.txt", "alpha\n")]);

    let bundle = dir.path().join("single.bundle");
    let bundle_arg = bundle.to_str().expect("utf-8 temporary path");
    run_taxis_ok(&repo, &["bundle", "create", bundle_arg, "HEAD"]);

    let verify = run_git_ok(&repo, &["bundle", "verify", bundle_arg]);
    assert!(
        verify.contains("complete history"),
        "git bundle verify rejected a single commit history: {verify}"
    );

    let clone = dir.path().join("clone");
    run_git_ok(
        dir.path(),
        &[
            "clone",
            "-q",
            bundle_arg,
            clone.to_str().expect("utf-8 path"),
        ],
    );
    assert_tree_listing_matches(&repo, &clone, "HEAD");
}

/// Git refuses to create a bundle from an unborn HEAD; Taxis must fail without leaving a file.
#[test]
fn bundle_refuses_empty_repository() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable, so bundle interoperability cannot be asserted");
        return;
    }

    let dir = test_temp_dir("bundle_head_");
    let repo = dir.path().join("repo");
    create_repo(&repo);
    let bundle = dir.path().join("empty.bundle");
    let bundle_arg = bundle.to_str().expect("utf-8 temporary path");

    let output = run_taxis(&repo, &["bundle", "create", bundle_arg, "HEAD"]);
    assert!(
        !output.status.success(),
        "an unborn HEAD must not produce a bundle"
    );
    assert!(
        !String::from_utf8_lossy(&output.stderr).trim().is_empty(),
        "a refused bundle must explain itself on stderr"
    );
    assert!(
        !bundle.exists(),
        "a refused bundle must not create the file"
    );
}

/// Prerequisite commits are recorded in the header (so Git can verify the bundle inside a repository
/// that already has them) and their history is excluded from the pack.
#[test]
fn bundle_prerequisites_are_recorded_and_fetched() {
    if !system_git_available() {
        eprintln!("skip: system git is unavailable, so bundle interoperability cannot be asserted");
        return;
    }

    let dir = test_temp_dir("bundle_head_");
    let repo = dir.path().join("repo");
    create_repo(&repo);
    commit_files(&repo, "base", &[("base.txt", "base\n")]);
    run_git_ok(&repo, &["tag", "base"]);
    commit_files(&repo, "second", &[("second.txt", "second\n")]);
    commit_files(&repo, "third", &[("third.txt", "third\n")]);
    let head_oid = git_rev(&repo, "HEAD");
    let base_oid = git_rev(&repo, "base");

    let bundle = dir.path().join("incremental.bundle");
    let bundle_arg = bundle.to_str().expect("utf-8 temporary path");
    run_taxis_ok(&repo, &["bundle", "create", bundle_arg, "main", "^base"]);

    let verify = run_git_ok(&repo, &["bundle", "verify", bundle_arg]);
    assert!(
        verify.to_lowercase().contains("requires"),
        "git bundle verify did not report a prerequisite: {verify}"
    );

    let json = run_taxis_ok(&repo, &["--json", "bundle", "verify", bundle_arg]);
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("verify JSON output");
    let prerequisites = parsed["prerequisites"]
        .as_array()
        .expect("prerequisites array");
    assert_eq!(prerequisites.len(), 1);
    assert_eq!(
        prerequisites[0].as_str().expect("prerequisite hex"),
        base_oid
    );
    let references = parsed["references"].as_array().expect("references array");
    assert_eq!(references.len(), 1);
    assert_eq!(
        references[0]["name"].as_str().expect("reference name"),
        "refs/heads/main"
    );

    // A repository lacking the prerequisite commits must reject the bundle, exactly like Git.
    let empty = dir.path().join("empty");
    create_repo(&empty);
    let refused = run_git(
        &empty,
        &[
            "fetch",
            "-q",
            bundle_arg,
            "refs/heads/main:refs/heads/imported",
        ],
    );
    assert!(
        !refused.status.success(),
        "a bundle whose prerequisites are missing must be refused"
    );
    assert!(
        String::from_utf8_lossy(&refused.stderr)
            .to_lowercase()
            .contains("prerequisite"),
        "the refusal must name the missing prerequisite: {}",
        String::from_utf8_lossy(&refused.stderr)
    );

    // A repository that already holds the prerequisite commits can apply the bundle.
    run_git_ok(
        &repo,
        &[
            "fetch",
            "-q",
            bundle_arg,
            "refs/heads/main:refs/heads/imported",
        ],
    );
    assert_eq!(git_rev(&repo, "imported"), head_oid);
    assert_eq!(
        run_git_ok(&repo, &["ls-tree", "-r", "--full-tree", "imported"]),
        run_git_ok(&repo, &["ls-tree", "-r", "--full-tree", "HEAD"]),
        "fetched prerequisite bundle tree diverges from the source"
    );
}

#[test]
fn quality_trace_and_audit_smoke_test() {
    let dir = test_temp_dir("quality_trace_");
    let repo = dir.path().join("repo");
    fs::create_dir_all(&repo).expect("create repo dir");
    run_taxis_ok(&repo, &["init"]);

    // Test text trace output
    let trace_out = run_taxis_ok(&repo, &["quality", "trace"]);
    assert!(trace_out.contains("TAXIS EVOLUTION QUALITY TRACE"));
    assert!(trace_out.contains("Pillar 1: Cryptographic Integrity"));
    assert!(trace_out.contains("Pillar 2: Invariants & Blind Mutation Canary"));
    assert!(trace_out.contains("Pillar 3: 5D Riemann Phase Space & Technical Debt"));

    // Test json trace output
    let trace_json = run_taxis_ok(&repo, &["--json", "quality", "trace"]);
    assert!(trace_json.contains("\"chain_verified\": true"));

    // Test audit output
    let audit_out = run_taxis_ok(&repo, &["quality", "audit"]);
    assert!(audit_out.contains("No audit records found"));
}
