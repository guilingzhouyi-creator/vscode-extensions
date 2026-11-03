//! Test Suite: Engineering Edition Capability Contract
//! File Path: tests/rust/test_edition_capability.rs
//!
//! The engineering edition must be honest about what it cannot do. Two properties are pinned here,
//! both of which were violated before this suite existed:
//!
//! 1. A capability that is absent is *named* in output, not merely absent from it, so a reader can
//!    tell "not supported here" from "I forgot to look".
//! 2. A command that could not do its job exits non-zero. `push` returning success while printing
//!    that it had not pushed is the defect that made `push && deploy` deploy an unsent commit.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Creates a temporary directory inside the crate's `target/` tree.
///
/// Kept out of the system temp root because `init --dev` refuses to place a repository outside the
/// workspace, and a test that fought that guard would be testing the guard's absence rather than the
/// behaviour under test.
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

/// Initializes a dev repository at `root`.
fn init_repo(root: &Path) {
    let status = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(["init", "--dev", "--workspace"])
        .arg(root)
        .current_dir(root)
        .status()
        .expect("init must run");
    assert!(status.success(), "init --dev must succeed");
}

/// Appends a remote stanza to the repository configuration.
fn add_remote(root: &Path, name: &str, url: &str) {
    let config = root.join(".taxis").join("config");
    let mut handle = std::fs::OpenOptions::new()
        .append(true)
        .open(&config)
        .expect("config must exist after init");
    write!(handle, "\n[remote \"{name}\"]\n\turl = {url}\n").expect("append remote stanza");
}

/// Runs taxis inside `root`, returning the exit code and combined output.
fn run_in(root: &Path, args: &[&str]) -> (i32, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .current_dir(root)
        .output()
        .expect("taxis must run");
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    (output.status.code().unwrap_or(-1), combined)
}

#[test]
fn version_names_the_edition_and_every_capability() {
    let dir = test_temp_dir("edition-version-");
    let (code, text) = run_in(dir.path(), &["version"]);
    assert_eq!(code, 0);
    assert!(
        text.contains("engineering"),
        "the edition must be stated so a reader learns the tier without reading source:\n{text}"
    );
    // Disabled capabilities are printed too. Omitting them would leave the reader to infer a "no"
    // from silence, which is the failure mode this test exists to prevent.
    assert!(
        text.contains("network_transport=false"),
        "a disabled capability must be reported as false, not omitted:\n{text}"
    );
    assert!(
        text.contains("local_git_parity=true"),
        "the capability the edition does provide must also be stated:\n{text}"
    );
}

#[test]
fn banner_announces_the_engineering_edition() {
    let dir = test_temp_dir("edition-help-");
    let (_, text) = run_in(dir.path(), &["help"]);
    assert!(
        text.contains("engineering edition"),
        "every invocation should disclose the tier; a user who reads only the banner is still told:\n{text}"
    );
    assert!(
        !text.contains("runs seamlessly"),
        "the help text must not promise seamless git compatibility; measured coverage is partial:\n{text}"
    );
}

#[test]
fn network_push_refuses_with_a_non_zero_status() {
    let dir = test_temp_dir("edition-push-");
    init_repo(dir.path());
    add_remote(dir.path(), "net", "https://example.invalid/x.git");

    let (code, text) = run_in(dir.path(), &["push", "net"]);
    assert_ne!(
        code, 0,
        "a push that did not happen must not report success:\n{text}"
    );
    assert!(
        text.contains("network_transport"),
        "the refusal must name the missing capability:\n{text}"
    );
    assert!(
        text.contains("UNAVAILABLE"),
        "the refusal must be distinguishable from a permission denial:\n{text}"
    );
}

#[test]
fn unknown_remote_name_is_not_silently_treated_as_a_url() {
    let dir = test_temp_dir("edition-ghost-");
    init_repo(dir.path());

    let (code, text) = run_in(dir.path(), &["push", "ghost"]);
    assert_ne!(code, 0, "a mistyped remote name must fail:\n{text}");
    assert!(
        text.contains("does not appear to be a git repository"),
        "the message must say the remote is unknown, in git's own wording:\n{text}"
    );
}

#[test]
fn missing_local_path_reports_fatal_rather_than_unavailable() {
    let dir = test_temp_dir("edition-missing-");
    init_repo(dir.path());
    add_remote(dir.path(), "gone", "/nonexistent/no-repo-here");

    let (code, text) = run_in(dir.path(), &["push", "gone"]);
    assert_eq!(
        code, 128,
        "a missing path is a repository failure (128), not an unavailable capability (69):\n{text}"
    );
    assert!(
        text.contains("no such path"),
        "the message must identify what was not found:\n{text}"
    );
}

#[test]
fn fetch_and_pull_are_equally_honest() {
    let dir = test_temp_dir("edition-fetch-");
    init_repo(dir.path());
    add_remote(dir.path(), "net", "ssh://example.invalid/x.git");

    for command in ["fetch", "pull"] {
        let (code, text) = run_in(dir.path(), &[command, "net"]);
        assert_ne!(code, 0, "'{command}' must not report success:\n{text}");
        assert!(
            text.contains("network_transport"),
            "'{command}' must name the missing capability:\n{text}"
        );
    }
}
