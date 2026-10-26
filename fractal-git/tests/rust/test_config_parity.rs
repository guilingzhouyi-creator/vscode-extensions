//! Module: tests::test_config_parity — Config Rewrites Versus the Git Reference Baseline
//! File Path: tests/rust/test_config_parity.rs
//! Architecture Role: Proves fg-index config reading and writing agree with the system git binary
//!   in both directions: values taxis writes are what git reads, and values git writes are what
//!   taxis reads, including quoting, comments, CRLF style, duplicates and dotted subsections.
//! Dependencies & Triggers: Runs under cargo test --test test_config_parity; the library-level
//!   tests skip explicitly when no git binary is available, and the CLI probe only runs when
//!   TAXIS_BIN points at a built taxis executable.
//! Responsibilities: Byte-exact value round trips, comment and order preservation, duplicate
//!   collapse, append and unset semantics, atomic temporary-file cleanup, and subsection wiring.
//! Exit Semantics & Design Rationale: Every expectation comes from running git on the same file.
//!   Re-asserting this crate's own quoting rules would let a shared mistake pass unnoticed.
//!
//! Domain Governance Rules: FGT-COR-001 (differential parity), FGT-IDX-001.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

use fg_index::config::{
    read_config, read_value, set_value, unset_value, ConfigKey, ConfigWriteMode,
};

/// Monotonic counter keeping scratch directory names unique within one process.
static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Values that exercise every quoting decision the Git writer makes.
const REFERENCE_VALUES: [&str; 11] = [
    "plain",
    "a b",
    " a ",
    "a#b",
    "x;y",
    "q\"z",
    "a\\b",
    "line1\nline2",
    "tab\there",
    "",
    "dash-value",
];

/// Creates a unique scratch directory, preferring the DOS 8.3 safe temp root on Windows.
fn scratch_dir(label: &str) -> PathBuf {
    let count = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    let _ = fs::create_dir_all(&base);
    let path = base.join(format!(
        "taxis_config_{}_{}_{}",
        std::process::id(),
        count,
        label
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("scratch directory");
    path
}

/// Reports whether a usable system git binary is present.
fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Runs git config --file <config> --get <key>.
fn git_get(config: &Path, key: &str) -> Output {
    Command::new("git")
        .arg("config")
        .arg("--file")
        .arg(config)
        .arg("--get")
        .arg(key)
        .output()
        .expect("the system git binary must be runnable")
}

/// Runs git config --file <config> --add <key> <value>.
fn git_add(config: &Path, key: &str, value: &str) -> Output {
    Command::new("git")
        .arg("config")
        .arg("--file")
        .arg(config)
        .arg("--add")
        .arg(key)
        .arg(value)
        .output()
        .expect("the system git binary must be runnable")
}

/// Runs git config --file <config> --get-all <key>.
fn git_get_all(config: &Path, key: &str) -> Output {
    Command::new("git")
        .arg("config")
        .arg("--file")
        .arg(config)
        .arg("--get-all")
        .arg(key)
        .output()
        .expect("the system git binary must be runnable")
}

/// Parses a key specification that the test expects to be valid.
fn key(spec: &str) -> ConfigKey {
    ConfigKey::parse(spec).unwrap_or_else(|error| panic!("key {spec} must parse: {error}"))
}

/// Reads one config file as UTF-8.
fn read_text(path: &Path) -> String {
    fs::read_to_string(path).expect("config file must be readable")
}

#[test]
fn values_written_by_taxis_are_exactly_what_git_reads() {
    if !git_available() {
        eprintln!("[skip] test_config_parity: no system git binary on PATH");
        return;
    }
    let directory = scratch_dir("taxis_write_git_read");
    for (index, value) in REFERENCE_VALUES.iter().enumerate() {
        let config = directory.join(format!("config_{index}"));
        set_value(&config, &key("core.k"), value, ConfigWriteMode::Replace)
            .expect("taxis must write the value");
        let output = git_get(&config, "core.k");
        assert!(output.status.success(), "git could not read {value:?}");
        let expected = format!("{value}\n");
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            expected,
            "git re-read a different value than taxis wrote for {value:?}"
        );
    }
}

#[test]
fn values_written_by_git_are_exactly_what_taxis_reads() {
    if !git_available() {
        eprintln!("[skip] test_config_parity: no system git binary on PATH");
        return;
    }
    let directory = scratch_dir("git_write_taxis_read");
    for (index, value) in REFERENCE_VALUES.iter().enumerate() {
        let config = directory.join(format!("config_{index}"));
        let output = git_add(&config, "core.k", value);
        assert!(output.status.success(), "git failed to write {value:?}");
        let stored = read_value(&config, &key("core.k")).expect("taxis must read the value");
        assert_eq!(
            stored.as_deref(),
            Some(*value),
            "taxis re-read {value:?} as {stored:?}"
        );
    }
}

#[test]
fn a_quoted_subsection_key_is_visible_to_git_under_its_dotted_name() {
    if !git_available() {
        eprintln!("[skip] test_config_parity: no system git binary on PATH");
        return;
    }
    let directory = scratch_dir("subsection_visibility");
    let config = directory.join("config");
    let spec = "submodule.\"q\".url";
    set_value(
        &config,
        &key(spec),
        "https://example.invalid/q.git",
        ConfigWriteMode::Replace,
    )
    .expect("taxis must write the subsection entry");
    let output = git_get(&config, "submodule.q.url");
    assert!(
        output.status.success(),
        "git rejected the written config file"
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "https://example.invalid/q.git\n"
    );
    let listed = Command::new("git")
        .arg("config")
        .arg("--file")
        .arg(&config)
        .arg("--list")
        .output()
        .expect("git --list");
    assert!(listed.status.success());
    assert!(String::from_utf8_lossy(&listed.stdout)
        .contains("submodule.q.url=https://example.invalid/q.git"));
}

#[test]
fn a_multilevel_subsection_written_by_git_is_read_back_by_taxis() {
    if !git_available() {
        eprintln!("[skip] test_config_parity: no system git binary on PATH");
        return;
    }
    let directory = scratch_dir("multilevel_subsection");
    let config = directory.join("config");
    let output = git_add(
        &config,
        "submodule.libs.engine.url",
        "https://example.invalid/engine.git",
    );
    assert!(
        output.status.success(),
        "git failed to write the subsection entry"
    );
    let stored = read_value(&config, &key("submodule.libs.engine.url"))
        .expect("taxis must read the subsection entry");
    assert_eq!(
        stored.as_deref(),
        Some("https://example.invalid/engine.git")
    );
}

#[test]
fn rewriting_preserves_comments_blank_lines_and_key_order() {
    let directory = scratch_dir("rewrite_preserves");
    let config = directory.join("config");
    let original = "[core]\n\tfilemode = true\n# keep this comment\n\n\tautocrlf = input\n";
    fs::write(&config, original).expect("seed config");
    set_value(
        &config,
        &key("core.filemode"),
        "false",
        ConfigWriteMode::Replace,
    )
    .expect("taxis must rewrite the entry");
    let expected = "[core]\n\tfilemode = false\n# keep this comment\n\n\tautocrlf = input\n";
    assert_eq!(read_text(&config), expected);
    if git_available() {
        let output = git_get(&config, "core.filemode");
        assert_eq!(String::from_utf8_lossy(&output.stdout), "false\n");
        let auto = git_get(&config, "core.autocrlf");
        assert_eq!(String::from_utf8_lossy(&auto.stdout), "input\n");
    } else {
        eprintln!("[skip] git cross-check of preserved file: no system git binary on PATH");
    }
}

#[test]
fn updating_a_duplicate_key_collapses_it_to_one_entry() {
    if !git_available() {
        eprintln!("[skip] test_config_parity: no system git binary on PATH");
        return;
    }
    let directory = scratch_dir("duplicate_collapse");
    let config = directory.join("config");
    fs::write(&config, "[core]\n\tfilemode = true\n\tfilemode = false\n").expect("seed config");
    set_value(
        &config,
        &key("core.filemode"),
        "true",
        ConfigWriteMode::Replace,
    )
    .expect("taxis must collapse the duplicate");
    assert_eq!(read_text(&config), "[core]\n\tfilemode = true\n");
    let all = git_get_all(&config, "core.filemode");
    assert_eq!(
        String::from_utf8_lossy(&all.stdout),
        "true\n",
        "git still sees duplicates"
    );
}

#[test]
fn appended_values_are_all_visible_to_git() {
    if !git_available() {
        eprintln!("[skip] test_config_parity: no system git binary on PATH");
        return;
    }
    let directory = scratch_dir("append_values");
    let config = directory.join("config");
    fs::write(&config, "[core]\n\tfilemode = true\n").expect("seed config");
    set_value(&config, &key("core.hook"), "first", ConfigWriteMode::Add).expect("first append");
    set_value(&config, &key("core.hook"), "second", ConfigWriteMode::Add).expect("second append");
    let all = git_get_all(&config, "core.hook");
    assert_eq!(String::from_utf8_lossy(&all.stdout), "first\nsecond\n");
    let entries = read_config(&config).expect("taxis must list the entries");
    let hooks = entries
        .iter()
        .filter(|entry| entry.dotted_key() == "core.hook")
        .count();
    assert_eq!(hooks, 2);
}

#[test]
fn unset_removes_every_matching_entry_and_git_confirms_absence() {
    if !git_available() {
        eprintln!("[skip] test_config_parity: no system git binary on PATH");
        return;
    }
    let directory = scratch_dir("unset_entries");
    let config = directory.join("config");
    fs::write(
        &config,
        "[core]\n\tfilemode = true\n\tfilemode = false\n\tautocrlf = input\n",
    )
    .expect("seed config");
    let removed = unset_value(&config, &key("core.filemode"), None).expect("taxis must unset");
    assert_eq!(removed, 2);
    assert_eq!(read_text(&config), "[core]\n\tautocrlf = input\n");
    let output = git_get(&config, "core.filemode");
    assert!(!output.status.success(), "git still finds an unset key");
    let kept = git_get(&config, "core.autocrlf");
    assert_eq!(String::from_utf8_lossy(&kept.stdout), "input\n");
}

#[test]
fn rewriting_a_crlf_file_keeps_crlf_and_stays_git_readable() {
    if !git_available() {
        eprintln!("[skip] test_config_parity: no system git binary on PATH");
        return;
    }
    let directory = scratch_dir("crlf_round_trip");
    let config = directory.join("config");
    fs::write(&config, "[core]\r\n\tfilemode = true\r\n").expect("seed config");
    set_value(
        &config,
        &key("core.filemode"),
        "false",
        ConfigWriteMode::Replace,
    )
    .expect("taxis must rewrite a CRLF file");
    assert_eq!(read_text(&config), "[core]\r\n\tfilemode = false\r\n");
    let output = git_get(&config, "core.filemode");
    assert_eq!(String::from_utf8_lossy(&output.stdout), "false\n");
}

#[test]
fn atomic_rewrites_leave_no_temporary_file_behind() {
    let directory = scratch_dir("atomic_cleanup");
    let config = directory.join("config");
    fs::write(&config, "[core]\n\tfilemode = true\n").expect("seed config");
    set_value(
        &config,
        &key("core.filemode"),
        "false",
        ConfigWriteMode::Replace,
    )
    .expect("taxis must rewrite the entry");
    unset_value(&config, &key("core.filemode"), None).expect("taxis must unset the entry");
    let leftovers: Vec<String> = fs::read_dir(&directory)
        .expect("scratch directory must be listable")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains("taxis-tmp"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "temporary files leaked: {leftovers:?}"
    );
}

#[test]
fn a_failed_write_never_creates_a_partial_file() {
    let directory = scratch_dir("failed_write");
    let missing = directory.join("absent").join("config");
    let outcome = set_value(
        &missing,
        &key("core.filemode"),
        "false",
        ConfigWriteMode::Replace,
    );
    assert!(
        outcome.is_err(),
        "writing into a missing directory must fail"
    );
    assert!(
        !missing.exists(),
        "a failed write must not create the target file"
    );
}

#[test]
fn the_cli_writes_what_git_reads_when_taxis_binary_is_provided() {
    let Ok(binary) = std::env::var("TAXIS_BIN") else {
        eprintln!("[skip] test_config_parity CLI probe: TAXIS_BIN is not set");
        return;
    };
    let binary_path = PathBuf::from(&binary);
    if !binary_path.is_file() {
        eprintln!("[skip] test_config_parity CLI probe: {binary} does not exist");
        return;
    }
    if !git_available() {
        eprintln!("[skip] test_config_parity CLI probe: no system git binary on PATH");
        return;
    }
    let directory = scratch_dir("cli_subsection");
    let git_dir = directory.join(".git");
    fs::create_dir_all(git_dir.join("objects")).expect("git directory");
    fs::create_dir_all(git_dir.join("refs")).expect("refs directory");
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("HEAD");
    fs::write(
        git_dir.join("config"),
        "[core]\n\trepositoryformatversion = 0\n\tbare = false\n",
    )
    .expect("seed config");

    let written = Command::new(&binary_path)
        .arg("config")
        .arg("submodule.\"q\".url")
        .arg("https://example.invalid/q.git")
        .current_dir(&directory)
        .output()
        .expect("taxis binary must be runnable");
    assert!(
        written.status.success(),
        "taxis config failed: {}",
        String::from_utf8_lossy(&written.stderr)
    );

    let config = git_dir.join("config");
    let read_back = git_get(&config, "submodule.q.url");
    assert!(
        read_back.status.success(),
        "git rejected the config taxis wrote: {}",
        String::from_utf8_lossy(&read_back.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&read_back.stdout),
        "https://example.invalid/q.git\n"
    );

    let got = Command::new(&binary_path)
        .arg("config")
        .arg("--get")
        .arg("submodule.q.url")
        .current_dir(&directory)
        .output()
        .expect("taxis binary must be runnable");
    assert!(got.status.success());
    assert_eq!(
        String::from_utf8_lossy(&got.stdout),
        "https://example.invalid/q.git\n"
    );

    let missing = Command::new(&binary_path)
        .arg("config")
        .arg("--get")
        .arg("submodule.absent.url")
        .current_dir(&directory)
        .output()
        .expect("taxis binary must be runnable");
    assert_eq!(missing.status.code(), Some(1), "a missing key must exit 1");
}
