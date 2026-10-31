//! Module: taxis_cmd::index_plumbing — Git Plumbing Index, Tree & Revision Commands
//! File Path: src/bin/taxis_cmd/index_plumbing.rs
//! Architecture Role: Implements low-level Git plumbing commands (`write-tree`, `commit-tree`,
//!   `update-index`, and `rev-parse`) for scriptable offline Git workflows and CI tooling.
//! Dependencies & Triggers: Dispatched by `src/bin/taxis.rs` for `write-tree`, `commit-tree`,
//!   `update-index`, and `rev-parse`.
//! Responsibilities: Materialize index trees into loose tree objects, construct raw commit objects
//!   with explicit parent chains, mutate index records directly, and resolve revision expressions.
//! Exit Semantics & Design Rationale:
//!   - Exits 0 and prints canonical 40-character SHA-1 digests (or requested repository metadata).
//!   - Exits 128 on fatal missing objects/revisions (or 1 under `rev-parse --verify -q`).
//!   - Exits 129 on malformed command-line flags.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-IDX-001`: DIRC v2 index binary framing guard
//! - `FGT-OBJ-001`: Git tree and commit byte-parity serialization guard
//! - `FGT-COR-001`: Core data model and error contract guard

use std::fs;
use std::io::{self, Read};
use std::path::Path;

use fg_core::constants::git::OBJ_BLOB;
use fg_core::models::{current_unix_seconds, FileMode, GitSignature, IndexStage, Oid};
use fg_core::traits::OdbStore;
use fg_index::{InMemoryIndexTree, IndexEntry};
use fg_object::GitCommit;
use fg_storage::commit_materializer::{persist_commit_object, persist_index_tree};
use fractal_git::LooseOdb;

use super::abbrev::{abbreviate, abbreviation_width};
use super::checkout::{load_index_entries, plan_worktree_path, worktree_stat};
use super::common::{fail_fatal, fail_usage, CliContext, EXIT_REJECTED};
use super::repo_view::RepoView;
use super::stage::{normalize_rel_spec, persist_index_state};
use super::tree_view::worktree_mode;

/// Dispatches `taxis write-tree`.
pub fn handle_write_tree(ctx: &CliContext) {
    for arg in &ctx.args {
        if arg == "--missing-ok" {
            continue;
        }
        if arg.starts_with('-') {
            fail_usage(format!("write-tree: unknown option '{arg}'"));
        }
    }

    let view = RepoView::open_or_exit(ctx);
    let index_opt = match view.index() {
        Ok(loaded) => loaded,
        Err(err) => fail_fatal(err),
    };
    let mut mem_tree = InMemoryIndexTree::new();
    if let Some(index) = index_opt {
        for entry in index.entries() {
            if entry.stage != IndexStage::Normal {
                fail_fatal("cannot write-tree with unmerged index entries");
            }
            if let Err(err) = mem_tree.stage_oid(&entry.path, entry.mode, entry.oid) {
                fail_fatal(err);
            }
        }
    }

    let odb = LooseOdb::new(view.git_dir());
    let root_oid = persist_index_tree(&mem_tree, &odb).unwrap_or_else(|err| fail_fatal(err));
    println!("{}", root_oid.to_hex());
}

/// Dispatches `taxis commit-tree`.
pub fn handle_commit_tree(ctx: &CliContext) {
    let mut tree_arg: Option<String> = None;
    let mut parent_args: Vec<String> = Vec::new();
    let mut message_parts: Vec<String> = Vec::new();
    let mut cursor = 0;

    while cursor < ctx.args.len() {
        let arg = &ctx.args[cursor];
        match arg.as_str() {
            "-p" => {
                cursor += 1;
                let Some(parent_str) = ctx.args.get(cursor) else {
                    fail_usage("commit-tree: -p requires a parent commit id");
                };
                parent_args.push(parent_str.clone());
            }
            "-m" => {
                cursor += 1;
                let Some(msg) = ctx.args.get(cursor) else {
                    fail_usage("commit-tree: -m requires a message argument");
                };
                message_parts.push(msg.clone());
            }
            other if other.starts_with('-') => {
                fail_usage(format!("commit-tree: unknown option '{other}'"));
            }
            other => {
                if tree_arg.is_some() {
                    fail_usage("commit-tree: multiple tree arguments supplied");
                }
                tree_arg = Some(other.to_string());
            }
        }
        cursor += 1;
    }

    let Some(raw_tree) = tree_arg else {
        fail_usage("usage: git commit-tree <tree> [(-p <parent>)...] [(-m <message>)...]");
    };

    let view = RepoView::open_or_exit(ctx);
    let (_, tree_oid) = match view.resolve_tree(&raw_tree) {
        Ok(resolved) => resolved,
        Err(err) => fail_fatal(err),
    };

    let mut parents = Vec::with_capacity(parent_args.len());
    for parent_spec in &parent_args {
        let resolved = match view.resolve(parent_spec) {
            Ok(oid) => oid,
            Err(err) => fail_fatal(err),
        };
        parents.push(resolved);
    }

    let message = resolve_commit_tree_message(&message_parts);
    let author = resolve_git_signature(
        &view,
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_AUTHOR_DATE",
    );
    let committer = resolve_git_signature(
        &view,
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_COMMITTER_DATE",
    );

    let commit = GitCommit::new(tree_oid, parents, author, committer, message, None);
    let odb = LooseOdb::new(view.git_dir());
    let commit_oid = persist_commit_object(&commit, &odb).unwrap_or_else(|err| fail_fatal(err));
    println!("{}", commit_oid.to_hex());
}

/// Resolves the message body for `commit-tree` from `-m` flags or standard input.
fn resolve_commit_tree_message(message_parts: &[String]) -> String {
    if !message_parts.is_empty() {
        let mut combined = message_parts.join("\n\n");
        if !combined.ends_with('\n') {
            combined.push('\n');
        }
        return combined;
    }
    let mut stdin_bytes = Vec::new();
    if let Err(err) = io::stdin().read_to_end(&mut stdin_bytes) {
        fail_fatal(format!("failed to read commit message from stdin: {err}"));
    }
    String::from_utf8_lossy(&stdin_bytes).into_owned()
}

/// Resolves a Git author or committer signature from environment variables or repository config.
pub(crate) fn resolve_git_signature(
    view: &RepoView,
    name_env: &str,
    email_env: &str,
    date_env: &str,
) -> GitSignature {
    let name = std::env::var(name_env)
        .ok()
        .filter(|val| !val.trim().is_empty())
        .or_else(|| read_repo_config_value(view.git_dir(), "user.name"))
        .unwrap_or_else(|| "Taxis User".to_string());
    let email = std::env::var(email_env)
        .ok()
        .filter(|val| !val.trim().is_empty())
        .or_else(|| read_repo_config_value(view.git_dir(), "user.email"))
        .unwrap_or_else(|| "taxis@local".to_string());
    let (timestamp_sec, tz_offset) = std::env::var(date_env)
        .ok()
        .and_then(|raw| parse_git_date(&raw))
        .unwrap_or_else(|| (current_unix_seconds(), "+0000".to_string()));

    GitSignature {
        name,
        email,
        timestamp_sec,
        tz_offset,
    }
}

/// Reads a single key from `<git_dir>/config` via `fg_index::config::read_value`.
fn read_repo_config_value(git_dir: &Path, spec: &str) -> Option<String> {
    let key = fg_index::config::ConfigKey::parse(spec).ok()?;
    fg_index::config::read_value(&git_dir.join("config"), &key)
        .ok()
        .flatten()
        .filter(|val| !val.trim().is_empty())
}

/// Parses `"<unix_sec> <tz>"` or ISO-8601 date strings into `(seconds, tz_offset)`.
fn parse_git_date(raw: &str) -> Option<(i64, String)> {
    let trimmed = raw.trim();
    if let Some((sec_str, tz_str)) = trimmed.split_once(' ') {
        if let Ok(sec) = sec_str.trim().parse::<i64>() {
            return Some((sec, tz_str.trim().to_string()));
        }
    }
    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Some((parsed.timestamp(), parsed.format("%z").to_string()));
    }
    if let Ok(parsed) = chrono::DateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S%z") {
        return Some((parsed.timestamp(), parsed.format("%z").to_string()));
    }
    None
}

/// Dispatches `taxis update-index`.
pub fn handle_update_index(ctx: &CliContext) {
    let view = RepoView::open_or_exit(ctx);
    let mut index_map = load_index_entries(view.git_dir());
    let attributes = match view.attributes() {
        Ok(loaded) => loaded,
        Err(err) => fail_fatal(err),
    };
    let odb = LooseOdb::new(view.git_dir());
    let mut allow_add = false;
    let mut allow_remove = false;
    let mut cursor = 0;

    while cursor < ctx.args.len() {
        let arg = &ctx.args[cursor];
        match arg.as_str() {
            "--add" => allow_add = true,
            "--remove" | "--force-remove" => allow_remove = true,
            "--refresh" | "-q" => {}
            "--cacheinfo" => {
                cursor += 1;
                cursor += apply_cacheinfo_arg(&ctx.args[cursor..], &mut index_map);
                continue;
            }
            other if other.starts_with('-') => {
                fail_usage(format!("update-index: unknown option '{other}'"));
            }
            file_arg => {
                update_index_path(
                    (&view, &odb, &attributes),
                    (file_arg, allow_add, allow_remove),
                    &mut index_map,
                );
            }
        }
        cursor += 1;
    }

    persist_index_state(view.git_dir(), &index_map);
}

/// Parses `--cacheinfo <mode>,<oid>,<path>` or `--cacheinfo <mode> <oid> <path>`.
fn apply_cacheinfo_arg(
    remaining: &[String],
    index_map: &mut std::collections::BTreeMap<String, IndexEntry>,
) -> usize {
    let Some(first) = remaining.first() else {
        fail_usage("update-index: --cacheinfo requires arguments");
    };
    let (mode_str, oid_str, path_str, consumed) = if first.contains(',') {
        let parts: Vec<&str> = first.splitn(3, ',').collect();
        if parts.len() != 3 {
            fail_usage("update-index: malformed --cacheinfo <mode>,<oid>,<path>");
        }
        (parts[0], parts[1], parts[2], 1)
    } else {
        if remaining.len() < 3 {
            fail_usage("update-index: --cacheinfo requires <mode> <oid> <path>");
        }
        (
            remaining[0].as_str(),
            remaining[1].as_str(),
            remaining[2].as_str(),
            3,
        )
    };

    let mode = parse_octal_file_mode(mode_str);
    let oid = match Oid::from_hex(oid_str) {
        Ok(parsed) => parsed,
        Err(err) => fail_fatal(format!(
            "update-index: invalid object id '{oid_str}': {err}"
        )),
    };
    let rel_path = normalize_rel_spec(path_str);
    index_map.insert(
        rel_path.clone(),
        IndexEntry {
            path: rel_path,
            mode,
            oid,
            stage: IndexStage::Normal,
            size: 0,
            mtime_seconds: 0,
            mtime_nanos: 0,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        },
    );
    consumed
}

/// Parses a Git mode string (`100644`, `100755`, `120000`, `160000`) into [`FileMode`].
fn parse_octal_file_mode(raw: &str) -> FileMode {
    match raw.trim_start_matches('0') {
        "100755" | "755" => FileMode::ExecutableFile,
        "120000" => FileMode::Symlink,
        "160000" => FileMode::Gitlink,
        _ => FileMode::RegularFile,
    }
}

/// Updates or removes one path in `index_map` for `taxis update-index`.
fn update_index_path(
    repo_env: (&RepoView, &LooseOdb, &fg_index::AttributeSet),
    path_and_flags: (&str, bool, bool),
    index_map: &mut std::collections::BTreeMap<String, IndexEntry>,
) {
    let (view, odb, attributes) = repo_env;
    let (raw_path, allow_add, allow_remove) = path_and_flags;
    let rel_path = normalize_rel_spec(raw_path);
    let full_path = match plan_worktree_path(view.work_root(), &rel_path) {
        Ok(planned) => planned,
        Err(detail) => fail_fatal(detail),
    };
    if !full_path.exists() && !full_path.is_symlink() {
        if allow_remove {
            index_map.remove(&rel_path);
            return;
        }
        fail_fatal(format!(
            "update-index: '{rel_path}' does not exist and --remove not passed"
        ));
    }
    if !index_map.contains_key(&rel_path) && !allow_add {
        fail_fatal(format!(
            "update-index: '{rel_path}' is not in the index and --add not passed"
        ));
    }
    let metadata = match fs::symlink_metadata(&full_path) {
        Ok(meta) => meta,
        Err(err) => fail_fatal(err),
    };
    let prev = index_map.get(&rel_path);
    let mode = worktree_mode(
        &metadata,
        prev.map_or(FileMode::RegularFile, |entry| entry.mode),
        view.config().trust_executable_bit(),
    );
    let payload =
        match view.worktree_payload(&rel_path, mode, prev.map(|entry| &entry.oid), attributes) {
            Ok(bytes) => bytes,
            Err(err) => fail_fatal(err),
        };
    let blob_oid = match odb.write_object(OBJ_BLOB, &payload) {
        Ok(oid) => oid,
        Err(err) => fail_fatal(err),
    };
    let (size, mtime_seconds, mtime_nanos) = worktree_stat(&full_path, payload.len() as u32);
    index_map.insert(
        rel_path.clone(),
        IndexEntry {
            path: rel_path,
            mode,
            oid: blob_oid,
            stage: IndexStage::Normal,
            size,
            mtime_seconds,
            mtime_nanos,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        },
    );
}

/// Dispatches `taxis rev-parse`.
pub fn handle_rev_parse(ctx: &CliContext) {
    let view = RepoView::open_or_exit(ctx);
    let mut verify = false;
    let mut quiet = false;
    let mut abbrev_ref = false;
    let mut short_len: Option<usize> = None;
    let mut revisions: Vec<String> = Vec::new();

    for arg in &ctx.args {
        match arg.as_str() {
            "--verify" => verify = true,
            "-q" | "--quiet" => quiet = true,
            "--abbrev-ref" | "--abbrev-ref=strict" | "--abbrev-ref=loose" => abbrev_ref = true,
            "--short" => short_len = Some(abbreviation_width(view.approximate_object_count())),
            "--git-dir"
            | "--absolute-git-dir"
            | "--show-toplevel"
            | "--is-inside-work-tree"
            | "--is-inside-git-dir"
            | "--is-bare-repository" => {
                print_rev_parse_repo_query(&view, arg);
            }
            other if other.starts_with("--short=") => {
                let requested = other["--short=".len()..].parse::<usize>().unwrap_or(7);
                short_len = Some(requested.clamp(4, 40));
            }
            other if other.starts_with('-') => {
                fail_usage(format!("rev-parse: unknown option '{other}'"));
            }
            rev => revisions.push(rev.to_string()),
        }
    }

    if verify && revisions.len() != 1 {
        if quiet {
            std::process::exit(EXIT_REJECTED);
        }
        fail_fatal("Needed a single revision");
    }

    for rev in &revisions {
        resolve_and_print_rev(&view, rev, (abbrev_ref, short_len, verify, quiet));
    }
}

/// Prints a repository metadata query flag (`--git-dir`, `--show-toplevel`, etc.).
fn print_rev_parse_repo_query(view: &RepoView, flag: &str) {
    match flag {
        "--git-dir" => println!("{}", format_git_dir_output(view.git_dir())),
        "--absolute-git-dir" => {
            let abs = view
                .git_dir()
                .canonicalize()
                .unwrap_or_else(|_| view.git_dir().to_path_buf());
            println!("{}", normalize_display_path(&abs));
        }
        "--show-toplevel" => {
            let abs = view
                .work_root()
                .canonicalize()
                .unwrap_or_else(|_| view.work_root().to_path_buf());
            println!("{}", normalize_display_path(&abs));
        }
        "--is-inside-work-tree" => println!("true"),
        "--is-inside-git-dir" => println!("false"),
        "--is-bare-repository" => {
            let bare = read_repo_config_value(view.git_dir(), "core.bare").is_some_and(|val| {
                matches!(val.to_ascii_lowercase().as_str(), "true" | "1" | "yes")
            });
            println!("{bare}");
        }
        _ => {}
    }
}

/// Resolves and prints one revision argument for `taxis rev-parse`.
fn resolve_and_print_rev(view: &RepoView, rev: &str, opts: (bool, Option<usize>, bool, bool)) {
    let (abbrev_ref, short_len, verify, quiet) = opts;
    if abbrev_ref && (rev == "HEAD" || rev == "@") {
        match view.head_branch() {
            Ok(Some((branch, _))) => {
                println!("{branch}");
                return;
            }
            Ok(None) => {
                if view.head_commit().ok().flatten().is_some() {
                    println!("HEAD");
                    return;
                }
            }
            Err(_) => {}
        }
    }

    match view.resolve_object_spec(rev) {
        Ok(oid) => {
            if abbrev_ref {
                let short_ref = rev
                    .strip_prefix("refs/heads/")
                    .or_else(|| rev.strip_prefix("refs/tags/"))
                    .or_else(|| rev.strip_prefix("refs/remotes/"))
                    .unwrap_or(rev);
                println!("{short_ref}");
            } else if let Some(width) = short_len {
                println!("{}", abbreviate(&oid, width));
            } else {
                println!("{}", oid.to_hex());
            }
        }
        Err(_) => {
            if quiet {
                std::process::exit(EXIT_REJECTED);
            }
            if verify {
                fail_fatal("Needed a single revision");
            }
            fail_fatal(format!(
                "ambiguous argument '{rev}': unknown revision or path not in the working tree."
            ));
        }
    }
}

/// Formats `--git-dir` output relative to the current directory when inside the worktree.
fn format_git_dir_output(git_dir: &Path) -> String {
    if let Ok(cwd) = std::env::current_dir() {
        if let Ok(rel) = git_dir.strip_prefix(&cwd) {
            return normalize_display_path(rel);
        }
    }
    normalize_display_path(git_dir)
}

/// Normalizes Windows extended-length prefixes (`\\?\`) and backslashes to forward slashes.
fn normalize_display_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let stripped = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
    stripped.replace('\\', "/")
}
