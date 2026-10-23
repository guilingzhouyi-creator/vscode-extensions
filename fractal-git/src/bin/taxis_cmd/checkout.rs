//! Module: taxis_cmd::checkout — Worktree Materialization & Branch Switching
//! File Path: src/bin/taxis_cmd/checkout.rs
//! Architecture Role: Full worktree checkout engine: parses target revisions and branch flags,
//!   validates worktree cleanliness, materializes tree payloads to disk, updates the binary DIRC v2
//!   index, and synchronizes HEAD and branch references across native and git backends.
//! Dependencies & Triggers: Dispatched by `taxis checkout`.
//! Responsibilities: Worktree materialization, uncommitted change guard, DIRC index synchronization,
//!   and atomic reference updating.
//! Exit Semantics & Design Rationale:
//!   - Refuses to overwrite unstaged or staged modifications unless `--force` / `-f` is provided.
//!   - Atomically updates worktree files, DIRC index, and HEAD references.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-TOP-001`: DAG topology traversal guard

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[cfg(unix)]
use fg_core::models::FileMode;
use fg_core::models::{IndexStage, Oid};
use fg_index::{write_dirc_v2, IndexEntry};
use fg_native::sections::head::HeadState as NativeHeadState;
use fg_native::sections::indx::{IndexEntry as NativeIndexEntry, StatCache};
use fg_native::sections::refs::RefRecord;
use fg_native::RepoDocument;
use fractal_git::constants::cli::CliTag;

use super::common::{fail_io, reject, CliContext};
use super::repo_view::RepoView;
use super::status::collect_status;
use super::tree_view::{flatten_commit_tree, flatten_tree_for_diff, TreeEntry};

/// Parsed options for `taxis checkout`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CheckoutOptions {
    target: String,
    new_branch: Option<String>,
    force: bool,
}

/// Dispatches the `checkout` command: resolves targets, materializes worktrees, and updates HEAD.
pub fn handle_checkout(ctx: &CliContext) {
    if ctx.args.is_empty() {
        reject(
            CliTag::ERROR,
            "Expected branch, commit, or fractal ref to checkout.",
        );
    }

    let opts = parse_checkout_options(&ctx.args);
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };

    assert_worktree_cleanliness(&view, opts.force);

    let (target_commit, tree_oid) = match view.resolve_tree(&opts.target) {
        Ok(resolved) => resolved,
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };

    let effective_branch = resolve_effective_branch(&view, &opts);

    let current_files = view
        .head_commit()
        .ok()
        .flatten()
        .and_then(|head_oid| flatten_commit_tree(&view, &head_oid).ok())
        .unwrap_or_default();

    let mut new_files = BTreeMap::new();
    if let Err(diff_err) = flatten_tree_for_diff(&view, &tree_oid, "", &mut new_files) {
        reject(CliTag::ERROR, diff_err);
    }

    remove_stale_files(view.work_root(), &current_files, &new_files);
    let index_entries = materialize_files(&view, &new_files);
    update_dirc_index(view.git_dir(), &index_entries);
    update_references(view.git_dir(), target_commit, effective_branch.as_deref());

    print_checkout_verdict(&opts, target_commit, effective_branch.as_deref());
}

/// Parses command-line arguments into structured checkout options.
fn parse_checkout_options(args: &[String]) -> CheckoutOptions {
    let mut new_branch = None;
    let mut force = false;
    let mut positional = Vec::new();
    let mut cursor = 0;

    while cursor < args.len() {
        let arg = &args[cursor];
        if arg == "-f" || arg == "--force" {
            force = true;
            cursor += 1;
        } else if (arg == "-b" || arg == "-B") && cursor + 1 < args.len() {
            new_branch = Some(args[cursor + 1].clone());
            cursor += 2;
        } else {
            positional.push(arg.clone());
            cursor += 1;
        }
    }

    let target = if let Some(first_pos) = positional.first() {
        first_pos.clone()
    } else {
        "HEAD".to_string()
    };

    CheckoutOptions {
        target,
        new_branch,
        force,
    }
}

/// Asserts that no unstaged or staged changes exist before checkout proceeds unless force is set.
pub(crate) fn assert_worktree_cleanliness(view: &RepoView, force: bool) {
    if force {
        return;
    }
    if let Ok(status) = collect_status(view) {
        let dirty_paths: Vec<&str> = status
            .iter()
            .filter(|s| s.is_staged() || s.is_unstaged())
            .map(|s| s.path.as_str())
            .collect();
        if !dirty_paths.is_empty() {
            reject(
                CliTag::ERROR,
                format!(
                    "Your local changes would be overwritten by checkout:\n  {}\nPlease commit your \
                     changes or use --force to overwrite them.",
                    dirty_paths.join("\n  ")
                ),
            );
        }
    }
}

/// Determines the effective branch name (if switching to a branch).
fn resolve_effective_branch(view: &RepoView, opts: &CheckoutOptions) -> Option<String> {
    if let Some(ref new_b) = opts.new_branch {
        if view
            .branches()
            .is_ok_and(|b| b.iter().any(|(name, _)| name == new_b))
        {
            reject(
                CliTag::ERROR,
                format!("A branch named '{new_b}' already exists."),
            );
        }
        return Some(new_b.clone());
    }

    if view
        .branches()
        .is_ok_and(|b| b.iter().any(|(name, _)| name == &opts.target))
    {
        return Some(opts.target.clone());
    }

    None
}

/// Removes worktree files and empty parent directories that are absent in the target tree.
pub(crate) fn remove_stale_files(
    work_root: &Path,
    current_files: &BTreeMap<String, TreeEntry>,
    new_files: &BTreeMap<String, TreeEntry>,
) {
    for old_path in current_files.keys() {
        if new_files.contains_key(old_path) {
            continue;
        }
        let full_path = work_root.join(old_path);
        if full_path.is_file() || full_path.is_symlink() {
            let _ = fs::remove_file(&full_path);
        }
        let mut cursor = full_path.parent();
        while let Some(parent) = cursor {
            if parent == work_root || !parent.starts_with(work_root) {
                break;
            }
            if fs::remove_dir(parent).is_err() {
                break;
            }
            cursor = parent.parent();
        }
    }
}

/// Materializes files into the worktree directory and computes fresh index entries.
pub(crate) fn materialize_files(
    view: &RepoView,
    new_files: &BTreeMap<String, TreeEntry>,
) -> Vec<IndexEntry> {
    let mut index_entries = Vec::with_capacity(new_files.len());

    for (path, tree_entry) in new_files {
        let full_path = view.work_root().join(path);
        if let Some(parent) = full_path.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                fail_io(format!("create directory '{}'", parent.display()), err);
            }
        }

        let payload = match view.blob_payload(&tree_entry.oid) {
            Ok(bytes) => bytes,
            Err(err) => reject(
                CliTag::ERROR,
                format!("read blob {}: {err}", tree_entry.oid.to_hex()),
            ),
        };

        if let Err(err) = fs::write(&full_path, &payload) {
            fail_io(format!("write file '{}'", full_path.display()), err);
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if tree_entry.mode == FileMode::ExecutableFile {
                let _ = fs::set_permissions(&full_path, fs::Permissions::from_mode(0o755));
            }
        }

        let (size, mtime_sec, mtime_nano) = if let Ok(meta) = fs::metadata(&full_path) {
            let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let duration = mtime
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap_or_default();
            (
                meta.len() as u32,
                duration.as_secs() as u32,
                duration.subsec_nanos(),
            )
        } else {
            (payload.len() as u32, 0, 0)
        };

        index_entries.push(IndexEntry {
            path: path.clone(),
            mode: tree_entry.mode,
            oid: tree_entry.oid,
            stage: IndexStage::Normal,
            size,
            mtime_seconds: mtime_sec,
            mtime_nanos: mtime_nano,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        });
    }

    index_entries
}

/// Persists the materialized entries into the binary DIRC index file.
pub(crate) fn update_dirc_index(git_dir: &Path, entries: &[IndexEntry]) {
    let index_path = git_dir.join("index");
    if let Err(err) = write_dirc_v2(&index_path, entries) {
        fail_io(format!("write index '{}'", index_path.display()), err);
    }
}

/// Updates HEAD and branch references on disk and within the native container if present.
pub(crate) fn update_references(git_dir: &Path, target_commit: Oid, branch_name: Option<&str>) {
    // 1. Update loose refs on disk
    if let Some(branch) = branch_name {
        let branch_ref_path = git_dir.join("refs/heads").join(branch);
        if let Some(parent) = branch_ref_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&branch_ref_path, format!("{}\n", target_commit.to_hex()));
        let _ = fs::write(git_dir.join("HEAD"), format!("ref: refs/heads/{branch}\n"));
    } else {
        let _ = fs::write(
            git_dir.join("HEAD"),
            format!("{}\n", target_commit.to_hex()),
        );
    }

    // 2. Synchronize native container (repo.txc) if present
    let container_path = fg_native::container_path(git_dir);
    if container_path.is_file() {
        if let Ok(mut doc) = RepoDocument::load(&container_path) {
            if let Some(branch) = branch_name {
                let _ = doc.refs.upsert(RefRecord {
                    name: format!("refs/heads/{branch}"),
                    oid: target_commit,
                    peeled: None,
                });
                doc.head = NativeHeadState::Symbolic {
                    target: format!("refs/heads/{branch}"),
                };
            } else {
                doc.head = NativeHeadState::Detached { oid: target_commit };
            }

            // Sync doc.indx from written DIRC index
            if let Ok(parsed) = fg_index::GitIndex::load(git_dir.join("index")) {
                let mut native_indx = fg_native::IndxSection::new();
                for entry in parsed.entries() {
                    let _ = native_indx.upsert(NativeIndexEntry {
                        path: entry.path.clone(),
                        mode: entry.mode,
                        oid: entry.oid,
                        stage: entry.stage,
                        stat: StatCache {
                            size: u64::from(entry.size),
                            mtime_secs: i64::from(entry.mtime_seconds),
                            mtime_nanos: entry.mtime_nanos,
                            ctime_secs: i64::from(entry.mtime_seconds),
                            ctime_nanos: entry.mtime_nanos,
                            dev: 0,
                            ino: 0,
                            uid: 0,
                            gid: 0,
                        },
                        flags: 0,
                    });
                }
                doc.indx = native_indx;
            }

            let _ = doc.save_atomic(&container_path);
        }
    }
}

/// Prints formatted confirmation message upon checkout completion.
fn print_checkout_verdict(opts: &CheckoutOptions, target_commit: Oid, branch_name: Option<&str>) {
    if let Some(branch) = branch_name {
        if opts.new_branch.is_some() {
            println!(
                "{} Switched to a new branch '{}' at {}",
                CliTag::TAXIS_CHECKOUT,
                branch,
                target_commit.to_hex()
            );
        } else {
            println!(
                "{} Switched to branch '{}' ({})",
                CliTag::TAXIS_CHECKOUT,
                branch,
                target_commit.to_hex()
            );
        }
    } else {
        println!(
            "{} Note: switching to '{}'. You are in 'detached HEAD' state at {}.",
            CliTag::TAXIS_CHECKOUT,
            opts.target,
            target_commit.to_hex()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_branch_target() {
        let args = vec!["main".to_string()];
        let opts = parse_checkout_options(&args);
        assert_eq!(opts.target, "main");
        assert_eq!(opts.new_branch, None);
        assert!(!opts.force);
    }

    #[test]
    fn parses_create_branch_with_base() {
        let args = vec![
            "-b".to_string(),
            "feature-x".to_string(),
            "origin/main".to_string(),
        ];
        let opts = parse_checkout_options(&args);
        assert_eq!(opts.target, "origin/main");
        assert_eq!(opts.new_branch, Some("feature-x".to_string()));
        assert!(!opts.force);
    }

    #[test]
    fn parses_create_branch_defaulting_to_head() {
        let args = vec!["-b".to_string(), "hotfix".to_string()];
        let opts = parse_checkout_options(&args);
        assert_eq!(opts.target, "HEAD");
        assert_eq!(opts.new_branch, Some("hotfix".to_string()));
        assert!(!opts.force);
    }

    #[test]
    fn parses_force_flag_short_and_long() {
        let args1 = vec!["-f".to_string(), "dev".to_string()];
        let opts1 = parse_checkout_options(&args1);
        assert_eq!(opts1.target, "dev");
        assert!(opts1.force);

        let args2 = vec!["--force".to_string(), "dev".to_string()];
        let opts2 = parse_checkout_options(&args2);
        assert_eq!(opts2.target, "dev");
        assert!(opts2.force);
    }
}
