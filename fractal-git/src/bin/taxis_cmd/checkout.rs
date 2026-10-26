//! Module: taxis_cmd::checkout — Worktree Materialization & Branch Switching
//! File Path: src/bin/taxis_cmd/checkout.rs
//! Architecture Role: Full worktree checkout engine: parses target revisions and branch flags,
//!   validates worktree cleanliness, materializes tree payloads to disk, updates the binary DIRC v2
//!   index, and synchronizes HEAD and branch references across native and git backends.
//! Dependencies & Triggers: Dispatched by `taxis checkout`.
//! Responsibilities: Worktree materialization, uncommitted change guard, DIRC index synchronization,
//!   and atomic reference updating.
//! Exit Semantics & Design Rationale:
//!   - Carries uncommitted changes across a switch when the path is identical in both trees and
//!     refuses only when the switch would overwrite them, matching Git; `--force` / `-f` overrides.
//!   - Atomically updates worktree files, DIRC index, and HEAD references.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-TOP-001`: DAG topology traversal guard

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(unix)]
use fg_core::models::FileMode;
use fg_core::models::{safe_join, IndexStage, Oid};
use fg_index::{write_dirc_v2, DirtyCollision, DirtyCollisionKind, DirtyWorktreeGuard, IndexEntry};
use fg_native::sections::head::HeadState as NativeHeadState;
use fg_native::sections::indx::{IndexEntry as NativeIndexEntry, StatCache};
use fg_native::sections::refs::RefRecord;
use fg_native::RepoDocument;
use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, RefStore};

use super::common::{fail_fatal, fail_io, reject, CliContext};
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
        Err(open_err) => fail_fatal(open_err),
    };

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

    let previous_head = view
        .head_commit()
        .ok()
        .flatten()
        .map(|head_oid| head_oid.to_hex())
        .unwrap_or_else(|| "0".repeat(40));

    let mut new_files = BTreeMap::new();
    if let Err(diff_err) = flatten_tree_for_diff(&view, &tree_oid, "", &mut new_files) {
        reject(CliTag::ERROR, diff_err);
    }

    let carried = check_switch_conflicts(&view, &current_files, &new_files, opts.force);
    // Resolve the target tree before deleting anything: one hostile path must abort the switch
    // while the worktree still describes the old tree, not after the stale files are already
    // gone. remove_stale_files only guards the paths it deletes, so the target side is checked
    // here first.
    if let Err(detail) =
        preflight_worktree_paths(view.work_root(), new_files.keys().map(String::as_str))
    {
        reject(CliTag::ERROR, detail);
    }
    remove_stale_files(view.work_root(), &current_files, &new_files);
    let existing_index = load_index_entries(view.git_dir());
    let index_entries = materialize_files_preserving(&view, &new_files, &carried, &existing_index);
    update_dirc_index(view.git_dir(), &index_entries);
    update_references(
        view.git_dir(),
        view.work_root(),
        target_commit,
        effective_branch.as_deref(),
    );

    let hook_runner = super::git_hooks::discover(view.git_dir(), view.work_root());
    super::git_hooks::run_post_hook(
        &hook_runner,
        "post-checkout",
        &[previous_head, target_commit.to_hex(), "1".to_string()],
    );

    let target_subject = view
        .object(&target_commit)
        .ok()
        .and_then(|object| commit_subject(&object.payload));
    print_checkout_verdict(
        &opts,
        target_commit,
        effective_branch.as_deref(),
        target_subject.as_deref(),
    );
}

/// Extracts the subject line Git names in its detached-HEAD report.
///
/// The header block ends at the first blank line; the subject is the first non-empty line of what
/// follows. A commit message in a legacy encoding is decoded lossily because this string is only
/// ever shown to a human, never compared as data.
fn commit_subject(payload: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(payload);
    let body = text
        .split_once("\n\n")
        .map_or(text.as_ref(), |(_, body)| body);
    let subject = body.lines().next().unwrap_or("").trim();
    if subject.is_empty() {
        None
    } else {
        Some(subject.to_string())
    }
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

/// Refuses a switch that would overwrite local work, returning the paths left untouched.
///
/// Git carries uncommitted changes across a branch switch whenever a path is identical in both
/// trees and refuses only when the switch would replace the edit. Rejecting on any dirty path
/// forced `--force` for edits that do not intersect the switch at all, and losing them is exactly
/// what the guard exists to prevent.
fn check_switch_conflicts(
    view: &RepoView,
    current_files: &BTreeMap<String, TreeEntry>,
    new_files: &BTreeMap<String, TreeEntry>,
    force: bool,
) -> BTreeSet<String> {
    let changed: BTreeSet<String> = current_files
        .iter()
        .filter_map(|(path, head)| match new_files.get(path) {
            Some(target) if same_tree_entry(head, target) => None,
            _ => Some(path.clone()),
        })
        .chain(
            new_files
                .keys()
                .filter(|path| !current_files.contains_key(*path))
                .cloned(),
        )
        .collect();
    let status = collect_status(view).unwrap_or_default();
    let mut collisions = Vec::new();
    for entry in &status {
        if entry.is_untracked() && new_files.contains_key(&entry.path) {
            collisions.push(DirtyCollision::new(
                entry.path.as_str(),
                DirtyCollisionKind::UntrackedOverwritten,
            ));
        } else if !entry.is_untracked() && changed.contains(&entry.path) {
            collisions.push(DirtyCollision::new(
                entry.path.as_str(),
                DirtyCollisionKind::UnstagedModified,
            ));
        }
    }
    if !force && !collisions.is_empty() {
        let msg = DirtyWorktreeGuard::format_rejection(&collisions, "checkout");
        reject(CliTag::ERROR, msg);
    }
    new_files
        .keys()
        .filter(|path| {
            current_files
                .get(*path)
                .is_some_and(|head| same_tree_entry(head, &new_files[*path]))
        })
        .cloned()
        .collect()
}

/// Reports whether two tree entries record the same payload and file kind.
fn same_tree_entry(left: &TreeEntry, right: &TreeEntry) -> bool {
    left.oid == right.oid && left.mode == right.mode
}

/// Loads the normal-stage index entries keyed by path, tolerating a missing or unreadable index.
fn load_index_entries(git_dir: &Path) -> BTreeMap<String, IndexEntry> {
    fg_index::GitIndex::load(git_dir.join("index"))
        .map(|index| {
            index
                .entries()
                .iter()
                .filter(|entry| entry.stage == IndexStage::Normal)
                .map(|entry| (entry.path.clone(), entry.clone()))
                .collect()
        })
        .unwrap_or_default()
}

/// Asserts that no unstaged or staged changes exist before checkout proceeds unless force is set.
pub(crate) fn assert_worktree_cleanliness(view: &RepoView, force: bool) {
    if force {
        return;
    }
    if let Ok(status) = collect_status(view) {
        let mut collisions = Vec::new();
        for s in &status {
            if s.is_staged() {
                collisions.push(DirtyCollision::new(
                    s.path.as_str(),
                    DirtyCollisionKind::StagedModified,
                ));
            } else if s.is_unstaged() {
                collisions.push(DirtyCollision::new(
                    s.path.as_str(),
                    DirtyCollisionKind::UnstagedModified,
                ));
            }
        }
        if !collisions.is_empty() {
            let msg = DirtyWorktreeGuard::format_rejection(&collisions, "checkout");
            reject(CliTag::ERROR, msg);
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

/// Resolves a repository-relative tree path under the worktree root through the shared path jail.
///
/// A tree imported from an untrusted source can name `..`, an absolute path, a drive letter, or a
/// Windows device node. Joining such a spelling would place the write or deletion outside the
/// worktree, so every materialization and reclamation path goes through [`safe_join`] first. The
/// caller receives a `[PATH_ESCAPE]` rejection instead of a skipped entry: skipping would leave the
/// index and the worktree describing two different trees without telling anyone.
pub(crate) fn plan_worktree_path(work_root: &Path, rel: &str) -> Result<PathBuf, String> {
    safe_join(work_root, rel).map_err(|err| format!("[PATH_ESCAPE] {err}"))
}

/// Checks every path a command is about to act on before it mutates the worktree or index.
///
/// A reset rewrites the whole worktree, so one invalid path discovered late would leave the
/// repository half-switched. Callers run this first and turn the reported escape into a rejection
/// while nothing has been touched yet.
pub(crate) fn preflight_worktree_paths<'a>(
    work_root: &Path,
    paths: impl IntoIterator<Item = &'a str>,
) -> Result<(), String> {
    for path in paths {
        plan_worktree_path(work_root, path)?;
    }
    Ok(())
}

/// Removes worktree files and empty parent directories that are absent in the target tree.
pub(crate) fn remove_stale_files(
    work_root: &Path,
    current_files: &BTreeMap<String, TreeEntry>,
    new_files: &BTreeMap<String, TreeEntry>,
) {
    // Resolve every stale entry before deleting the first one: a rejection half-way through the
    // loop would leave a partially cleaned worktree and an error the caller cannot undo.
    let stale_paths: Vec<PathBuf> = current_files
        .keys()
        .filter(|old_path| !new_files.contains_key(*old_path))
        .map(|old_path| match plan_worktree_path(work_root, old_path) {
            Ok(full_path) => full_path,
            Err(detail) => reject(CliTag::ERROR, detail),
        })
        .collect();

    for full_path in stale_paths {
        if full_path.is_file() || full_path.is_symlink() {
            let _ = fs::remove_file(&full_path);
        }
        // Reuse the jailed path for the empty-parent walk: joining `old_path` again here would
        // reintroduce exactly the unchecked spelling the planner rejected.
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
    materialize_files_preserving(view, new_files, &BTreeSet::new(), &BTreeMap::new())
}

/// Materializes files while leaving carried paths and their recorded index entries untouched.
fn materialize_files_preserving(
    view: &RepoView,
    new_files: &BTreeMap<String, TreeEntry>,
    carried: &BTreeSet<String>,
    existing_index: &BTreeMap<String, IndexEntry>,
) -> Vec<IndexEntry> {
    // Resolve every entry before writing the first byte: with an invalid path anywhere in the
    // tree, rejecting up front leaves the worktree exactly as it was instead of half-materialized.
    let planned_paths: Vec<(&String, &TreeEntry, PathBuf)> = new_files
        .iter()
        .map(
            |(path, tree_entry)| match plan_worktree_path(view.work_root(), path) {
                Ok(full_path) => (path, tree_entry, full_path),
                Err(detail) => reject(CliTag::ERROR, detail),
            },
        )
        .collect();

    let mut index_entries = Vec::with_capacity(new_files.len());

    for (path, tree_entry, full_path) in planned_paths {
        if carried.contains(path) && full_path.exists() && !full_path.is_symlink() {
            // The path is identical in both trees, so the switch has no reason to touch it. Reuse
            // the recorded entry when there is one, because a staged edit lives in the index and
            // rewriting the file would discard the worktree side of it.
            match existing_index.get(path) {
                Some(existing) => index_entries.push(existing.clone()),
                None => index_entries.push(describe_worktree_file(&full_path, path, tree_entry)),
            }
            continue;
        }
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

        let (size, mtime_sec, mtime_nano) = worktree_stat(&full_path, payload.len() as u32);

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

/// Records the stat cache of a carried file whose index entry was never written.
fn describe_worktree_file(full_path: &Path, path: &str, tree_entry: &TreeEntry) -> IndexEntry {
    let (size, mtime_seconds, mtime_nanos) = worktree_stat(full_path, 0);
    IndexEntry {
        path: path.to_string(),
        mode: tree_entry.mode,
        oid: tree_entry.oid,
        stage: IndexStage::Normal,
        size,
        mtime_seconds,
        mtime_nanos,
        assume_valid: false,
        skip_worktree: false,
        intent_to_add: false,
    }
}

/// Reads the stat cache tuple for a worktree file, falling back to the payload length.
fn worktree_stat(full_path: &Path, fallback_size: u32) -> (u32, u32, u32) {
    let Ok(meta) = fs::metadata(full_path) else {
        return (fallback_size, 0, 0);
    };
    let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    let duration = mtime
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    (
        meta.len() as u32,
        duration.as_secs() as u32,
        duration.subsec_nanos(),
    )
}

/// Persists the materialized entries into the binary DIRC index file.
pub(crate) fn update_dirc_index(git_dir: &Path, entries: &[IndexEntry]) {
    let index_path = git_dir.join("index");
    if let Err(err) = write_dirc_v2(&index_path, entries) {
        fail_io(format!("write index '{}'", index_path.display()), err);
    }
}

/// Writes the branch reference and HEAD through the ref store, returning the first failure.
fn write_references(
    ref_store: &DiskRefStore,
    target_commit: Oid,
    branch_name: Option<&str>,
) -> Option<String> {
    match branch_name {
        Some(branch) => {
            let reference = format!("refs/heads/{branch}");
            if let Err(err) = ref_store.update_ref(&reference, &target_commit, None) {
                return Some(format!("update branch reference '{reference}': {err}"));
            }
            if let Err(err) = ref_store.update_head_symbolic(&reference) {
                return Some(format!("update symbolic HEAD '{reference}': {err}"));
            }
        }
        None => {
            if let Err(err) = ref_store.update_head_detached(&target_commit) {
                return Some(format!("update detached HEAD: {err}"));
            }
        }
    }
    None
}

/// Updates HEAD and branch references on disk and within the native container if present.
///
/// A reference-transaction hook may veto the update, so the preparing and prepared
/// phases run before anything durable changes; a veto records the aborted phase and
/// fails the command, while I/O errors do the same after the fact.
pub(crate) fn update_references(
    git_dir: &Path,
    work_root: &Path,
    target_commit: Oid,
    branch_name: Option<&str>,
) {
    let ref_store = DiskRefStore::new(git_dir);
    let hook_runner = super::git_hooks::discover(git_dir, work_root);
    let previous_head = ref_store.get_ref("HEAD").ok().flatten();
    let branch_update = branch_name.map(|branch| {
        let reference = format!("refs/heads/{branch}");
        let previous = ref_store.get_ref(&reference).ok().flatten();
        super::git_hooks::ReferenceUpdate {
            previous,
            next: target_commit.to_hex(),
            name: reference,
        }
    });
    let head_next = branch_update
        .as_ref()
        .map(|update| format!("ref: {}", update.name))
        .unwrap_or_else(|| target_commit.to_hex());
    let head_update = [super::git_hooks::ReferenceUpdate {
        previous: previous_head,
        next: head_next,
        name: "HEAD".to_string(),
    }];
    let prepared_updates = branch_update
        .clone()
        .map(|update| vec![update])
        .unwrap_or_else(|| head_update.to_vec());

    if !super::git_hooks::run_reference_transaction(&hook_runner, "preparing", &head_update) {
        let _ = super::git_hooks::run_reference_transaction(&hook_runner, "aborted", &head_update);
        reject(
            CliTag::ERROR,
            "reference-transaction hook rejected the reference update",
        );
    }
    if !super::git_hooks::run_reference_transaction(&hook_runner, "prepared", &prepared_updates) {
        let _ =
            super::git_hooks::run_reference_transaction(&hook_runner, "aborted", &prepared_updates);
        reject(
            CliTag::ERROR,
            "reference-transaction hook rejected the reference update",
        );
    }

    let write_error = write_references(&ref_store, target_commit, branch_name);
    if let Some(detail) = write_error {
        let _ =
            super::git_hooks::run_reference_transaction(&hook_runner, "aborted", &prepared_updates);
        reject(CliTag::ERROR, detail);
    }
    let _ =
        super::git_hooks::run_reference_transaction(&hook_runner, "committed", &prepared_updates);

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

/// Prints the confirmation Git writes to stderr after a successful checkout.
///
/// Git keeps stdout empty so a caller that captures it (`dir=$(git checkout -b b)`) never picks up
/// a human sentence. The detached form reports the new commit as "HEAD is now at <short> <subject>";
/// the longer detached-HEAD advice paragraph is suppressed here because Git only prints it once per
/// repository and its exact wording depends on the advice.* configuration.
fn print_checkout_verdict(
    opts: &CheckoutOptions,
    target_commit: Oid,
    branch_name: Option<&str>,
    subject: Option<&str>,
) {
    match branch_name {
        Some(branch) if opts.new_branch.is_some() => {
            eprintln!("Switched to a new branch '{branch}'");
        }
        Some(branch) => eprintln!("Switched to branch '{branch}'"),
        None => {
            let short = &target_commit.to_hex()[..7];
            match subject {
                Some(subject) => eprintln!("HEAD is now at {short} {subject}"),
                None => eprintln!("HEAD is now at {short}"),
            }
        }
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

    #[test]
    fn plan_worktree_path_accepts_ordinary_relative_paths() {
        let root = Path::new("/work/repo");
        for rel in ["a.txt", "src/main.rs", "src/deep/mod.rs", ".gitmodules"] {
            let resolved = plan_worktree_path(root, rel).expect("valid tree path");
            assert_eq!(resolved, root.join(rel));
        }
    }

    #[test]
    fn plan_worktree_path_rejects_traversal_and_absolute_spellings() {
        let root = Path::new(concat!("C:", "/work/repo"));
        for rel in [
            "../evil",
            "../../etc/passwd",
            "/abs",
            concat!("C:", "/x"),
            "a\\b",
            "src/../../evil",
            "src/./main.rs",
            "src//main.rs",
        ] {
            let failure = plan_worktree_path(root, rel).expect_err("path must be rejected");
            assert!(
                failure.starts_with("[PATH_ESCAPE]"),
                "rejection must carry the PATH_ESCAPE tag, got: {failure}"
            );
        }
    }

    #[test]
    fn plan_worktree_path_rejects_windows_reinterpretation() {
        let root = Path::new(concat!("C:", "/work/repo"));
        for rel in [
            "CON",
            "src/aux",
            "file:stream",
            "src/trailing.",
            "src/trailing ",
        ] {
            assert!(plan_worktree_path(root, rel).is_err(), "accepted '{rel}'");
        }
    }

    #[test]
    fn preflight_worktree_paths_reports_the_first_escape() {
        let root = Path::new(concat!("C:", "/work/repo"));
        assert!(preflight_worktree_paths(root, ["a.txt", "src/main.rs"]).is_ok());
        let failure = preflight_worktree_paths(root, ["a.txt", "../../escape", "b.txt"])
            .expect_err("an escape anywhere in the batch must reject the whole batch");
        assert!(failure.starts_with("[PATH_ESCAPE]"), "got: {failure}");
    }

    #[test]
    fn rejected_paths_never_touch_the_filesystem() {
        let test_base = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&test_base);
        let root = tempfile::Builder::new()
            .tempdir_in(&test_base)
            .expect("temporary worktree root");
        let outside = root.path().parent().expect("parent of the temporary root");
        let canary = outside.join("path-jail-canary.txt");
        assert!(!canary.exists(), "canary file must not pre-exist");

        for rel in [
            "../path-jail-canary.txt",
            "/tmp/path-jail-canary.txt",
            concat!("C:", "/x"),
            "a\\b",
            "CON",
            "file:stream",
        ] {
            assert!(
                plan_worktree_path(root.path(), rel).is_err(),
                "accepted '{rel}'"
            );
        }

        let entries: Vec<_> = std::fs::read_dir(root.path())
            .expect("read worktree root")
            .collect();
        assert!(
            entries.is_empty(),
            "rejected paths created files in the worktree"
        );
        assert!(!canary.exists(), "rejected path escaped the worktree");
    }
}
