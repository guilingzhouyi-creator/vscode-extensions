//! Test Suite: Hosted Small Project Repository Git Parity — Lifecycle & Metadata
//! File Path: tests/rust/test_hosted_git_parity.rs
//! Architecture Role: End-to-end integration test suite verifying Taxis equivalence with system Git across positional init, effective HEAD, short SHA fanout, rename log --follow, describe --tags, status --porcelain=v2, and count-objects/repack.
//! Dependencies & Triggers: Mounted in `tests/integration_cli.rs`.
//! Responsibilities: Assert deterministic behavioral and binary format parity with Git.
//! Exit Semantics & Design Rationale: Fails immediately if any command diverges from Git semantics.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-OBJ-001`: Git object binary equivalence guard

use std::fs;

use crate::cli_harness::{compliant_msg, run_taxis, run_taxis_ok, test_temp_dir};

#[test]
fn test_init_positional_directory_and_effective_head_lifecycle() {
    let tmp = test_temp_dir("hosted_init_pos_");
    let project_dir = tmp.path().join("mini-service");

    let init_out = run_taxis_ok(tmp.path(), &["init", "mini-service"]);
    assert!(
        init_out.contains("Initialized") || project_dir.join(".taxis").is_dir(),
        "positional init <dir> must initialize target directory"
    );

    fs::create_dir_all(project_dir.join("src")).expect("create src dir");
    fs::write(
        project_dir.join("src/lib.rs"),
        "pub fn greet() -> &'static str { \"v1\" }\n",
    )
    .expect("write lib.rs");
    run_taxis_ok(&project_dir, &["add", "src/lib.rs"]);
    let msg1 = compliant_msg("feat(src): add initial greet implementation", "greet");
    run_taxis_ok(&project_dir, &["commit", "-m", &msg1]);

    // Effective HEAD fallback must allow log and status to see the cell commit while HEAD is unborn
    let log_out = run_taxis_ok(&project_dir, &["log", "--oneline"]);
    assert!(
        log_out.contains("add initial greet implementation"),
        "log must resolve effective HEAD from cell sandbox: {log_out}"
    );

    // Short SHA disambiguation (7-char prefix)
    let first_token = log_out
        .split_whitespace()
        .next()
        .expect("commit hash token");
    let short_prefix = &first_token[..7];
    let full_oid = run_taxis_ok(&project_dir, &["rev-parse", short_prefix]);
    assert_eq!(
        full_oid.len(),
        40,
        "rev-parse on 7-char short SHA must return 40-hex OID"
    );
    assert!(full_oid.starts_with(short_prefix));

    // Non-existent short SHA must fail cleanly
    let bad_sha = run_taxis(&project_dir, &["rev-parse", "deadbeef99"]);
    assert!(
        !bad_sha.status.success(),
        "non-existent short SHA must fail rev-parse"
    );

    // Ambiguous short SHA prefix (two loose objects sharing 7-hex prefix "deadbee") must be rejected
    let bucket_dir = project_dir.join(".taxis/objects/de");
    fs::create_dir_all(&bucket_dir).expect("create fanout bucket");
    fs::write(
        bucket_dir.join("adbee111111111111111111111111111111111"),
        b"",
    )
    .expect("seed candidate 1");
    fs::write(
        bucket_dir.join("adbee222222222222222222222222222222222"),
        b"",
    )
    .expect("seed candidate 2");
    let ambig_out = run_taxis(&project_dir, &["rev-parse", "deadbee"]);
    assert!(
        !ambig_out.status.success(),
        "ambiguous short SHA prefix must fail rev-parse"
    );
    let ambig_stderr = String::from_utf8_lossy(&ambig_out.stderr);
    assert!(
        ambig_stderr.contains("ambiguous"),
        "ambiguous short SHA must report 'ambiguous', got: {ambig_stderr}"
    );
}

#[test]
fn test_mv_rename_log_follow_and_describe_tags() {
    let tmp = test_temp_dir("hosted_follow_tags_");
    let repo = tmp.path().join("app");
    run_taxis_ok(tmp.path(), &["init", "app"]);

    fs::write(repo.join("util.rs"), "pub fn compute() -> u32 { 42 }\n").expect("write util.rs");
    run_taxis_ok(&repo, &["add", "util.rs"]);
    let m1 = compliant_msg("feat(util): create initial compute helper", "compute");
    run_taxis_ok(&repo, &["commit", "-m", &m1]);

    // Create annotated tag v0.1.0
    run_taxis_ok(&repo, &["tag", "-a", "v0.1.0", "-m", "Release 0.1.0"]);
    let desc_exact = run_taxis_ok(&repo, &["describe"]);
    assert_eq!(desc_exact, "v0.1.0");

    // Rename util.rs -> engine.rs and commit
    run_taxis_ok(&repo, &["mv", "util.rs", "engine.rs"]);
    let m2 = compliant_msg("refactor(engine): rename util.rs to engine.rs", "compute");
    run_taxis_ok(&repo, &["commit", "-m", &m2]);

    // Create lightweight tag v0.2.0-lw
    run_taxis_ok(&repo, &["tag", "v0.2.0-lw"]);
    let desc_tags = run_taxis_ok(&repo, &["describe", "--tags"]);
    assert_eq!(desc_tags, "v0.2.0-lw");

    // Verify log --follow tracks across rename
    let follow_out = run_taxis_ok(&repo, &["log", "--follow", "--oneline", "engine.rs"]);
    let follow_lines: Vec<&str> = follow_out.lines().collect();
    assert_eq!(
        follow_lines.len(),
        2,
        "log --follow must traverse across file rename: {follow_out}"
    );
}

#[test]
fn test_status_porcelain_v2_and_count_objects_repack() {
    let tmp = test_temp_dir("hosted_status_repack_");
    let repo = tmp.path().join("svc");
    run_taxis_ok(tmp.path(), &["init", "svc"]);

    fs::write(repo.join("README.md"), "# Service\n").expect("write README");
    run_taxis_ok(&repo, &["add", "README.md"]);
    let m1 = compliant_msg("docs(readme): initialize service documentation", "Service");
    run_taxis_ok(&repo, &["commit", "-m", &m1]);

    // Modify tracked file and add untracked file
    fs::write(repo.join("README.md"), "# Service v2\n").expect("modify README");
    fs::write(repo.join("untracked.txt"), "scratch\n").expect("write untracked");

    let p2_out = run_taxis_ok(&repo, &["status", "--porcelain=v2", "--branch"]);
    assert!(
        p2_out.contains("# branch.oid ") && p2_out.contains("# branch.head "),
        "porcelain v2 --branch must emit branch headers: {p2_out}"
    );
    assert!(
        p2_out
            .lines()
            .any(|l| l.starts_with("1 .M ") && l.ends_with(" README.md")),
        "porcelain v2 must report unstaged modification as '1 .M': {p2_out}"
    );
    assert!(
        p2_out.lines().any(|l| l == "? untracked.txt"),
        "porcelain v2 must report untracked file as '? untracked.txt': {p2_out}"
    );

    // Repack and verify count-objects -v reports non-zero in-pack objects
    run_taxis_ok(&repo, &["repack"]);
    let count_out = run_taxis_ok(&repo, &["count-objects", "-v"]);
    assert!(
        count_out.contains("in-pack:")
            && count_out.contains("packs:")
            && count_out.contains("garbage: 0"),
        "count-objects -v must report standard Git keys: {count_out}"
    );
    let in_pack_val: usize = count_out
        .lines()
        .find_map(|l| l.strip_prefix("in-pack:").map(str::trim))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    assert!(
        in_pack_val > 0,
        "in-pack count after repack must be > 0, got: {count_out}"
    );
}
