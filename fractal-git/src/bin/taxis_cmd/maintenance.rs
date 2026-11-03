//! Module: taxis_cmd::maintenance — Working-Tree Cleanup, Object Integrity & Garbage Collection
//! File Path: src/bin/taxis_cmd/maintenance.rs
//! Architecture Role: Implements `taxis clean`, `taxis fsck`, and `taxis gc` as distinct commands
//!   instead of aliasing all three onto worktree container reclamation.
//! Dependencies & Triggers: Dispatched by `src/bin/taxis.rs` for `clean`, `fsck`, and `gc`.
//! Responsibilities: Remove untracked working-tree files/directories under path-jail guards,
//!   verify SHA-1 integrity and DAG connectivity across loose/packed objects, and consolidate ODB.
//! Exit Semantics & Design Rationale:
//!   - `clean` refuses to delete files unless `-f`/`--force` or `-n`/`--dry-run` is passed (exit 128).
//!   - `fsck` exits 0 when all objects and references are intact, or non-zero on corruption.
//!   - `gc` consolidates loose objects into verified packfiles and reclaims orphaned worktrees.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety and pack verification guard
//! - `FGT-OBJ-001`: Git object SHA-1 digest and framing verification guard
//! - `FGT-COR-001`: Core data model and error contract guard

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use fg_core::models::{compute_object_oid, FileMode, ObjectKind, Oid};
use fg_index::IgnoreMatcher;
use fg_native::RepoDocument;
use fg_object::borrowed::{GitCommitRef, GitTreeRef};
use fg_storage::{scan_loose_objects, OdbRouter, RepackEngine, RepackOptions};
use fractal_git::DiskRefStore;

use super::checkout::{load_index_entries, plan_worktree_path};
use super::common::{fail_fatal, fail_io, fail_usage, print_json, CliContext, EXIT_REJECTED};
use super::repo_view::RepoView;
use super::stage::{matches_any_pathspec, normalize_rel_spec};

/// Directory names never entered or removed by `taxis clean`.
const PROTECTED_DIRS: [&str; 2] = [".git", ".taxis"];

/// Parsed command-line options for `taxis clean`.
struct CleanOptions {
    force: bool,
    dry_run: bool,
    directories: bool,
    include_ignored: bool,
    quiet: bool,
    pathspecs: Vec<String>,
}

/// Candidate untracked item discovered during `taxis clean` traversal.
struct CleanTarget {
    rel_path: String,
    is_dir: bool,
}

/// Shared directory-walk context for `taxis clean`.
struct CleanWalkContext<'a> {
    work_root: &'a Path,
    tracked: &'a BTreeSet<String>,
    matcher: &'a IgnoreMatcher,
    options: &'a CleanOptions,
}

/// Dispatches `taxis clean`.
pub fn handle_clean(ctx: &CliContext) {
    let options = parse_clean_options(&ctx.args);
    if !options.force && !options.dry_run {
        fail_fatal(
            "clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean",
        );
    }

    let view = RepoView::open_or_exit(ctx);
    let index_map = load_index_entries(view.git_dir());
    let tracked: BTreeSet<String> = index_map.into_keys().collect();
    let matcher = match view.ignore_matcher() {
        Ok(loaded) => loaded,
        Err(err) => fail_fatal(err),
    };

    let mut targets = Vec::new();
    let walk_ctx = CleanWalkContext {
        work_root: view.work_root(),
        tracked: &tracked,
        matcher: &matcher,
        options: &options,
    };
    collect_clean_targets(&walk_ctx, "", &mut targets);

    for target in &targets {
        execute_clean_target(view.work_root(), target, &options);
    }
}

/// Parses command-line flags for `taxis clean`.
fn parse_clean_options(args: &[String]) -> CleanOptions {
    let mut force = false;
    let mut dry_run = false;
    let mut directories = false;
    let mut include_ignored = false;
    let mut quiet = false;
    let mut pathspecs = Vec::new();
    let mut after_double_dash = false;

    for arg in args {
        if after_double_dash {
            pathspecs.push(normalize_rel_spec(arg));
            continue;
        }
        match arg.as_str() {
            "--" => after_double_dash = true,
            "-f" | "--force" => force = true,
            "-n" | "--dry-run" => dry_run = true,
            "-d" => directories = true,
            "-x" => include_ignored = true,
            "-q" | "--quiet" => quiet = true,
            other if other.starts_with('-') && !other.starts_with("--") => {
                for ch in other[1..].chars() {
                    match ch {
                        'f' => force = true,
                        'n' => dry_run = true,
                        'd' => directories = true,
                        'x' => include_ignored = true,
                        'q' => quiet = true,
                        _ => fail_usage(format!("clean: unknown switch '{ch}'")),
                    }
                }
            }
            other if other.starts_with('-') => {
                fail_usage(format!("clean: unknown option '{other}'"));
            }
            other => pathspecs.push(normalize_rel_spec(other)),
        }
    }

    CleanOptions {
        force,
        dry_run,
        directories,
        include_ignored,
        quiet,
        pathspecs,
    }
}

/// Recursively collects untracked files and directories eligible for removal.
fn collect_clean_targets(
    walk_ctx: &CleanWalkContext<'_>,
    prefix: &str,
    out: &mut Vec<CleanTarget>,
) {
    let dir_path = if prefix.is_empty() {
        walk_ctx.work_root.to_path_buf()
    } else {
        walk_ctx.work_root.join(prefix)
    };
    let Ok(read_dir) = fs::read_dir(&dir_path) else {
        return;
    };
    let mut entries: Vec<(String, bool)> = Vec::new();
    for entry_result in read_dir {
        let Ok(entry) = entry_result else {
            continue;
        };
        let Some((name, child_rel, is_dir)) = describe_clean_child(prefix, &entry) else {
            continue;
        };
        if PROTECTED_DIRS.contains(&name.as_str()) {
            continue;
        }
        entries.push((child_rel, is_dir));
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));

    for (child_rel, is_dir) in entries {
        if is_dir {
            if !walk_ctx.options.include_ignored
                && walk_ctx.matcher.is_ignored(&child_rel, true)
                && !dir_contains_tracked(walk_ctx.tracked, &child_rel)
            {
                continue;
            }
            if walk_ctx.options.directories
                && !dir_contains_tracked(walk_ctx.tracked, &child_rel)
                && matches_any_pathspec(&child_rel, &walk_ctx.options.pathspecs)
            {
                out.push(CleanTarget {
                    rel_path: child_rel,
                    is_dir: true,
                });
            } else {
                collect_clean_targets(walk_ctx, &child_rel, out);
            }
        } else {
            if walk_ctx.tracked.contains(&child_rel) {
                continue;
            }
            if !walk_ctx.options.include_ignored && walk_ctx.matcher.is_ignored(&child_rel, false) {
                continue;
            }
            if matches_any_pathspec(&child_rel, &walk_ctx.options.pathspecs) {
                out.push(CleanTarget {
                    rel_path: child_rel,
                    is_dir: false,
                });
            }
        }
    }
}

/// Builds `(entry_name, relative_path, is_directory)` for one directory entry.
fn describe_clean_child(prefix: &str, entry: &fs::DirEntry) -> Option<(String, String, bool)> {
    let name = entry.file_name().to_string_lossy().into_owned();
    let file_type = entry.file_type().ok()?;
    let is_dir = file_type.is_dir() && !file_type.is_symlink();
    let child_rel = if prefix.is_empty() {
        name.clone()
    } else {
        format!("{prefix}/{name}")
    };
    Some((name, child_rel, is_dir))
}

/// Reports whether any tracked file resides under `dir_rel` via $O(\log T)$ prefix binary search.
fn dir_contains_tracked(tracked: &BTreeSet<String>, dir_rel: &str) -> bool {
    let prefix = format!("{dir_rel}/");
    tracked
        .range(prefix.clone()..)
        .next()
        .is_some_and(|first| first.starts_with(&prefix))
}

/// Prints or deletes one untracked target under a three-step path-containment guard.
fn execute_clean_target(work_root: &Path, target: &CleanTarget, options: &CleanOptions) {
    let suffix = if target.is_dir { "/" } else { "" };
    if options.dry_run {
        println!("Would remove {}{suffix}", target.rel_path);
        return;
    }
    let full_path = match plan_worktree_path(work_root, &target.rel_path) {
        Ok(planned) => planned,
        Err(detail) => fail_fatal(detail),
    };
    if full_path == work_root || !full_path.starts_with(work_root) {
        fail_fatal("refusing to remove path outside worktree boundary");
    }
    if target.is_dir {
        if let Err(err) = fs::remove_dir_all(&full_path) {
            fail_io("remove untracked directory", err);
        }
    } else if let Err(err) = fs::remove_file(&full_path) {
        fail_io("remove untracked file", err);
    }
    if !options.quiet {
        println!("Removing {}{suffix}", target.rel_path);
    }
}

/// Dispatches `taxis fsck`.
pub fn handle_fsck(ctx: &CliContext) {
    for arg in &ctx.args {
        match arg.as_str() {
            "--full" | "--connectivity-only" | "--strict" | "--no-dangling" | "--no-progress" => {}
            other if other.starts_with('-') => {
                fail_usage(format!("fsck: unknown option '{other}'"));
            }
            _ => {}
        }
    }

    let view = RepoView::open_or_exit(ctx);
    let mut errors: Vec<String> = Vec::new();
    let mut verified_objects = 0usize;

    verify_odb_objects(&view, &mut verified_objects, &mut errors);

    let decoded_loose = scan_loose_objects(view.git_dir()).map_or(0, |list| list.len());
    check_corrupt_loose_files(view.git_dir(), decoded_loose, &mut errors);
    verify_references(&view, &mut errors, &mut verified_objects);
    verify_native_container(view.git_dir(), &mut errors);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "fsck",
            "status": if errors.is_empty() { "ok" } else { "corrupt" },
            "verified_objects": verified_objects,
            "errors": errors,
        }));
    } else {
        for err in &errors {
            eprintln!("error: {err}");
        }
    }

    if !errors.is_empty() {
        std::process::exit(EXIT_REJECTED);
    }
}

/// Enumerates and verifies every object in the repository object store.
fn verify_odb_objects(view: &RepoView, verified_objects: &mut usize, errors: &mut Vec<String>) {
    let router = match OdbRouter::open(view.git_dir().join("objects")) {
        Ok(opened) => opened,
        Err(err) => {
            errors.push(format!("open object router: {err}"));
            return;
        }
    };
    let oids = match router.all_oids() {
        Ok(list) => list,
        Err(err) => {
            errors.push(format!("enumerate object store: {err}"));
            return;
        }
    };
    for oid in oids {
        match router.read(&oid) {
            Ok(Some(packed)) => {
                *verified_objects += 1;
                verify_single_object(view, (oid, packed.kind, &packed.payload), errors);
            }
            Ok(None) => errors.push(format!("missing object {}", oid.to_hex())),
            Err(err) => errors.push(format!("corrupt object {}: {err}", oid.to_hex())),
        }
    }
}

/// Verifies one object's SHA-1 digest and outgoing references.
fn verify_single_object(
    view: &RepoView,
    object_data: (Oid, ObjectKind, &[u8]),
    errors: &mut Vec<String>,
) {
    let (oid, kind, payload) = object_data;
    let actual = compute_object_oid(kind, payload);
    if actual != oid {
        errors.push(format!(
            "hash mismatch for object {}: computed {}",
            oid.to_hex(),
            actual.to_hex()
        ));
        return;
    }
    match kind {
        ObjectKind::Commit => verify_commit_links(view, (oid, payload), errors),
        ObjectKind::Tree => verify_tree_links(view, (oid, payload), errors),
        ObjectKind::Blob | ObjectKind::Tag => {}
    }
}

/// Verifies that a commit payload parses cleanly and its tree and parents exist.
fn verify_commit_links(view: &RepoView, commit_data: (Oid, &[u8]), errors: &mut Vec<String>) {
    let (commit_oid, payload) = commit_data;
    let Ok(commit_ref) = GitCommitRef::parse(payload) else {
        errors.push(format!(
            "commit {}: malformed commit payload",
            commit_oid.to_hex()
        ));
        return;
    };
    let tree_oid = commit_ref.tree_oid();
    if view.object(tree_oid).is_err() {
        errors.push(format!(
            "commit {}: missing tree {}",
            commit_oid.to_hex(),
            tree_oid.to_hex()
        ));
    }
    for parent in commit_ref.parents() {
        if view.object(&parent).is_err() {
            errors.push(format!(
                "commit {}: missing parent {}",
                commit_oid.to_hex(),
                parent.to_hex()
            ));
        }
    }
}

/// Verifies that a tree payload parses cleanly and all non-gitlink children exist.
fn verify_tree_links(view: &RepoView, tree_data: (Oid, &[u8]), errors: &mut Vec<String>) {
    let (tree_oid, payload) = tree_data;
    let tree_ref = GitTreeRef::from_bytes(payload);
    for entry_result in tree_ref.iter() {
        match entry_result {
            Ok(entry) => {
                if entry.mode != FileMode::Gitlink && view.object(&entry.oid).is_err() {
                    errors.push(format!(
                        "tree {}: missing entry '{}' ({})",
                        tree_oid.to_hex(),
                        entry.name,
                        entry.oid.to_hex()
                    ));
                }
            }
            Err(err) => {
                errors.push(format!("tree {}: corrupt entry ({err})", tree_oid.to_hex()));
            }
        }
    }
}

/// Detects loose object files under `objects/??/*` that failed zlib/header decoding.
fn check_corrupt_loose_files(git_dir: &Path, decoded_count: usize, errors: &mut Vec<String>) {
    let objects_dir = git_dir.join("objects");
    let Ok(entries) = fs::read_dir(&objects_dir) else {
        return;
    };
    let mut raw_file_count = 0usize;
    for entry_result in entries {
        let Ok(entry) = entry_result else {
            continue;
        };
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.len() != 2 || !name_str.chars().all(|ch| ch.is_ascii_hexdigit()) {
            continue;
        }
        let Ok(sub_entries) = fs::read_dir(entry.path()) else {
            continue;
        };
        for sub_result in sub_entries {
            let Ok(sub) = sub_result else {
                continue;
            };
            let sub_name = sub.file_name();
            let sub_str = sub_name.to_string_lossy();
            if sub_str.len() == 38 && sub_str.chars().all(|ch| ch.is_ascii_hexdigit()) {
                raw_file_count += 1;
            }
        }
    }
    if raw_file_count > decoded_count {
        let corrupt = raw_file_count - decoded_count;
        errors.push(format!(
            "{corrupt} loose object file(s) failed zlib or header verification"
        ));
    }
}

/// Verifies that every reference in the repository resolves to a readable object.
fn verify_references(view: &RepoView, errors: &mut Vec<String>, verified: &mut usize) {
    let ref_store = DiskRefStore::new(view.git_dir());
    let Ok(all_refs) = ref_store.list_all() else {
        return;
    };
    for (ref_name, oid) in all_refs {
        match view.object(&oid) {
            Ok(loaded) => {
                *verified += 1;
                verify_single_object(view, (oid, loaded.kind, &loaded.payload), errors);
            }
            Err(_) => {
                errors.push(format!(
                    "broken ref {ref_name}: points to missing object {}",
                    oid.to_hex()
                ));
            }
        }
    }
}

/// Verifies native `repo.txc` container section integrity when present.
fn verify_native_container(git_dir: &Path, errors: &mut Vec<String>) {
    let container_path = fg_native::container_path(git_dir);
    if !container_path.is_file() {
        return;
    }
    match RepoDocument::load(&container_path) {
        Ok(doc) => {
            for diagnosis in doc.diagnose() {
                errors.push(format!("container section integrity: {diagnosis}"));
            }
        }
        Err(err) => {
            errors.push(format!(
                "container decode {}: {err}",
                container_path.display()
            ));
        }
    }
}

/// Dispatches `taxis gc`.
pub fn handle_gc(ctx: &CliContext) {
    let mut quiet = false;
    let mut auto_only = false;
    for arg in &ctx.args {
        match arg.as_str() {
            "-q" | "--quiet" => quiet = true,
            "--auto" => auto_only = true,
            "--prune" | "--aggressive" => {}
            other if other.starts_with("--prune=") => {}
            other if other.starts_with('-') => {
                fail_usage(format!("gc: unknown option '{other}'"));
            }
            _ => {}
        }
    }

    let view = RepoView::open_or_exit(ctx);
    let options = RepackOptions::default();
    if auto_only && !RepackEngine::should_auto_repack(view.git_dir(), options.auto_repack_threshold)
    {
        if ctx.json_mode {
            print_json(&serde_json::json!({
                "engine": "taxis",
                "operation": "gc",
                "status": "skipped",
            }));
        }
        return;
    }

    let repack_report = match RepackEngine::repack_repository(view.git_dir(), &options) {
        Ok(report) => report,
        Err(err) => fail_io("gc repack repository", err),
    };

    if fg_native::container_path(view.git_dir()).is_file() {
        super::reclaim::handle_reclaim(ctx);
        return;
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "gc",
            "status": "ok",
            "objects_packed": repack_report.as_ref().map_or(0, |r| r.objects_packed),
            "loose_pruned": repack_report.as_ref().map_or(0, |r| r.loose_pruned),
        }));
    } else if !quiet {
        if let Some(report) = repack_report {
            println!(
                "Packed {} objects (pruned {} loose objects).",
                report.objects_packed, report.loose_pruned
            );
        }
    }
}

/// Traverses all objects reachable from `root_oids` and inserts their OIDs into `reachable`.
fn collect_reachable_objects(view: &RepoView, root_oids: &[Oid], reachable: &mut BTreeSet<Oid>) {
    let mut stack = root_oids.to_vec();
    while let Some(oid) = stack.pop() {
        if !reachable.insert(oid) {
            continue;
        }
        if let Ok(loaded_obj) = view.object(&oid) {
            match loaded_obj.kind {
                ObjectKind::Commit => {
                    if let Ok(commit_ref) = GitCommitRef::parse(&loaded_obj.payload) {
                        stack.push(*commit_ref.tree_oid());
                        for parent in commit_ref.parents() {
                            stack.push(parent);
                        }
                    }
                }
                ObjectKind::Tree => {
                    let tree_ref = GitTreeRef::from_bytes(&loaded_obj.payload);
                    for entry in tree_ref.iter().flatten() {
                        stack.push(entry.oid);
                    }
                }
                ObjectKind::Tag => {
                    if let Ok(tag) = fg_object::tag::GitTag::parse(&loaded_obj.payload) {
                        stack.push(tag.target_oid);
                    }
                }
                ObjectKind::Blob => {}
            }
        }
    }
}

/// Dispatches `taxis prune`.
pub fn handle_prune(ctx: &CliContext) {
    let mut dry_run = false;
    let mut verbose = false;

    for arg in &ctx.args {
        match arg.as_str() {
            "-n" | "--dry-run" => dry_run = true,
            "-v" | "--verbose" => verbose = true,
            "--progress" => {}
            other if other.starts_with("--expire") => {}
            other if other.starts_with('-') => {
                fail_usage(format!("prune: unknown option '{other}'"));
            }
            _ => {}
        }
    }

    let view = RepoView::open_or_exit(ctx);
    let mut reachable = BTreeSet::new();

    // 1. Collect from references
    let ref_store = DiskRefStore::new(view.git_dir());
    let all_refs = ref_store.list_all().unwrap_or_default();
    let mut root_oids: Vec<Oid> = all_refs.into_iter().map(|(_, oid)| oid).collect();

    // 2. Collect from HEAD if present
    if let Ok(Some(head)) = view.head_commit() {
        root_oids.push(head);
    }

    // Traverse reachable graph
    collect_reachable_objects(&view, &root_oids, &mut reachable);

    // 3. Collect from index entries
    let index_entries = load_index_entries(view.git_dir());
    for entry in index_entries.values() {
        reachable.insert(entry.oid);
    }

    // 4. Scan loose objects
    let loose = scan_loose_objects(view.git_dir()).unwrap_or_default();
    let mut pruned_count = 0usize;

    for (oid, _kind, _payload) in loose {
        if !reachable.contains(&oid) {
            pruned_count += 1;
            if verbose {
                println!("{}", oid.to_hex());
            }
            if !dry_run {
                let hex = oid.to_hex();
                let parent_dir = view.git_dir().join("objects").join(&hex[..2]);
                let obj_path = parent_dir.join(&hex[2..]);
                let _ = fs::remove_file(&obj_path);
                if let Ok(mut entries) = fs::read_dir(&parent_dir) {
                    if entries.next().is_none() {
                        let _ = fs::remove_dir(&parent_dir);
                    }
                }
            }
        }
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "prune",
            "dry_run": dry_run,
            "pruned_count": pruned_count,
        }));
    }
}
