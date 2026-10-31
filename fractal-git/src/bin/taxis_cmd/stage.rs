//! Module: taxis_cmd::stage — Working Tree & Index Staging Commands
//! File Path: src/bin/taxis_cmd/stage.rs
//! Architecture Role: Implements native Git staging and working-copy porcelain commands (`add`,
//!   `rm`, `mv`, and `restore`) directly over the binary DIRC v2 index and loose object store.
//! Dependencies & Triggers: Dispatched by `src/bin/taxis.rs` for `add`, `rm`, `mv`, and `restore`.
//! Responsibilities: Stage working-tree additions/modifications/deletions into `.git/index`,
//!   remove or rename tracked entries, and restore working-tree or index state from tree snapshots.
//! Exit Semantics & Design Rationale:
//!   - Exits 128 on fatal pathspec or repository errors, matching Git's error contract.
//!   - Exits 129 on malformed command-line usage.
//!   - Synchronizes both `.git/index` and the native `repo.txc` container index when present.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-IDX-001`: DIRC v2 index binary framing and stage-0 ordering guard
//! - `FGT-OBJ-001`: Canonical Git blob serialization guard
//! - `FGT-STO-001`: Atomic index and working-tree mutation guard

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use fg_core::constants::git::OBJ_BLOB;
use fg_core::models::{FileMode, IndexStage, Oid};
use fg_core::traits::OdbStore;
use fg_index::{AttributeSet, IgnoreMatcher, IndexEntry};
use fractal_git::LooseOdb;

use super::checkout::{load_index_entries, plan_worktree_path, update_dirc_index, worktree_stat};
use super::common::{fail_fatal, fail_io, fail_usage, CliContext};
use super::repo_view::RepoView;
use super::tree_view::{flatten_tree_for_diff, stat_cache_trusted, worktree_mode, TreeEntry};

/// Directory names excluded when walking the working tree for `taxis add`.
const SKIP_DIRS: [&str; 2] = [".git", ".taxis"];

/// Shared staging context for `taxis add` and `taxis commit -a`.
struct StageContext<'a> {
    view: &'a RepoView,
    odb: &'a LooseOdb,
    attributes: &'a AttributeSet,
    index_timestamp: Option<u64>,
}

/// Shared directory-walk context for `collect_worktree_files`.
struct WorktreeWalkContext<'a> {
    work_root: &'a Path,
    matcher: &'a IgnoreMatcher,
    tracked: &'a BTreeSet<String>,
    force: bool,
}

/// Parsed command-line options for `taxis add`.
struct AddOptions {
    all: bool,
    update: bool,
    force: bool,
    dry_run: bool,
    pathspecs: Vec<String>,
}

/// Dispatches `taxis add`.
pub fn handle_add(ctx: &CliContext) {
    let options = parse_add_options(&ctx.args);
    if !options.all && !options.update && options.pathspecs.is_empty() {
        fail_usage("Nothing specified, nothing added.\nMaybe you wanted to say 'git add .'?");
    }

    let view = RepoView::open_or_exit(ctx);
    let mut index_map = load_index_entries(view.git_dir());
    let matcher = match view.ignore_matcher() {
        Ok(loaded) => loaded,
        Err(err) => fail_fatal(err),
    };
    let attributes = match view.attributes() {
        Ok(loaded) => loaded,
        Err(err) => fail_fatal(err),
    };
    let tracked_before: BTreeSet<String> = index_map.keys().cloned().collect();
    let odb = LooseOdb::new(view.git_dir());
    let s_ctx = StageContext {
        view: &view,
        odb: &odb,
        attributes: &attributes,
        index_timestamp: view.index_file_timestamp(),
    };

    if options.update && !options.all {
        stage_tracked_updates(&s_ctx, &options, &mut index_map);
    } else {
        let walk_ctx = WorktreeWalkContext {
            work_root: view.work_root(),
            matcher: &matcher,
            tracked: &tracked_before,
            force: options.force,
        };
        stage_pathspecs_or_all(&s_ctx, (&walk_ctx, &options), &mut index_map);
    }

    if !options.dry_run {
        persist_index_state(view.git_dir(), &index_map);
    }
}

/// Stages modifications and deletions of already-tracked files (`taxis commit -a` / `--all`).
pub(crate) fn stage_tracked_for_commit(ctx: &CliContext) {
    let view = RepoView::open_or_exit(ctx);
    let mut index_map = load_index_entries(view.git_dir());
    let attributes = match view.attributes() {
        Ok(loaded) => loaded,
        Err(err) => fail_fatal(err),
    };
    let odb = LooseOdb::new(view.git_dir());
    let s_ctx = StageContext {
        view: &view,
        odb: &odb,
        attributes: &attributes,
        index_timestamp: view.index_file_timestamp(),
    };
    let options = AddOptions {
        all: false,
        update: true,
        force: false,
        dry_run: false,
        pathspecs: Vec::new(),
    };
    stage_tracked_updates(&s_ctx, &options, &mut index_map);
    persist_index_state(view.git_dir(), &index_map);
}

/// Parses command-line arguments for `taxis add`.
fn parse_add_options(args: &[String]) -> AddOptions {
    let mut options = AddOptions {
        all: false,
        update: false,
        force: false,
        dry_run: false,
        pathspecs: Vec::new(),
    };
    let mut after_double_dash = false;

    for arg in args {
        if after_double_dash {
            options.pathspecs.push(normalize_rel_spec(arg));
            continue;
        }
        match arg.as_str() {
            "--" => after_double_dash = true,
            "--all" | "--no-ignore-removal" => options.all = true,
            "--update" => options.update = true,
            "--force" => options.force = true,
            "--dry-run" => options.dry_run = true,
            "--verbose" => {}
            other if other.starts_with('-') && !other.starts_with("--") && other.len() > 1 => {
                apply_add_short_flags(&other[1..], &mut options);
            }
            other if other.starts_with('-') => {
                fail_usage(format!("add: unknown option '{other}'"));
            }
            other => options.pathspecs.push(normalize_rel_spec(other)),
        }
    }

    options
}

/// Applies bundled short flags (`-Af`, `-un`, etc.) for `taxis add`.
fn apply_add_short_flags(cluster: &str, options: &mut AddOptions) {
    for ch in cluster.chars() {
        match ch {
            'A' => options.all = true,
            'u' => options.update = true,
            'f' => options.force = true,
            'n' => options.dry_run = true,
            'v' => {}
            _ => fail_usage(format!("add: unknown option '-{ch}'")),
        }
    }
}

/// Stages modifications and deletions for already-tracked entries (`taxis add -u`).
fn stage_tracked_updates(
    s_ctx: &StageContext<'_>,
    options: &AddOptions,
    index_map: &mut BTreeMap<String, IndexEntry>,
) {
    let tracked_paths: Vec<String> = index_map.keys().cloned().collect();
    for rel_path in &tracked_paths {
        if !matches_any_pathspec(rel_path, &options.pathspecs) {
            continue;
        }
        let full_path = s_ctx.view.work_root().join(rel_path);
        if full_path.is_file() || full_path.is_symlink() {
            if !options.dry_run {
                stage_single_file(s_ctx, rel_path, index_map);
            }
        } else {
            index_map.remove(rel_path);
        }
    }
}

/// Stages working-tree files and tracked deletions for `taxis add -A` or explicit pathspecs.
fn stage_pathspecs_or_all(
    s_ctx: &StageContext<'_>,
    walk_and_options: (&WorktreeWalkContext<'_>, &AddOptions),
    index_map: &mut BTreeMap<String, IndexEntry>,
) {
    let (walk_ctx, options) = walk_and_options;
    let mut worktree_files = Vec::new();
    collect_worktree_files(walk_ctx, "", &mut worktree_files);

    for spec in &options.pathspecs {
        if !spec.is_empty() && !spec_matches_anything(spec, &worktree_files, walk_ctx.tracked) {
            fail_fatal(format!("pathspec '{spec}' did not match any files"));
        }
    }

    for rel_path in &worktree_files {
        if !options.all && !matches_any_pathspec(rel_path, &options.pathspecs) {
            continue;
        }
        if !options.dry_run {
            stage_single_file(s_ctx, rel_path, index_map);
        }
    }

    for tracked in walk_ctx.tracked {
        if !options.all && !matches_any_pathspec(tracked, &options.pathspecs) {
            continue;
        }
        let full_path = s_ctx.view.work_root().join(tracked);
        if !full_path.exists() && !full_path.is_symlink() {
            index_map.remove(tracked);
        }
    }
}

/// Checks whether a pathspec matches at least one discovered worktree file or tracked entry.
fn spec_matches_anything(
    spec: &str,
    worktree_files: &[String],
    tracked_before: &BTreeSet<String>,
) -> bool {
    worktree_files
        .iter()
        .any(|path| path_matches_spec(path, spec))
        || tracked_before
            .iter()
            .any(|path| path_matches_spec(path, spec))
}

/// Recursively collects candidate working-tree file paths relative to `work_root`.
fn collect_worktree_files(walk_ctx: &WorktreeWalkContext<'_>, prefix: &str, out: &mut Vec<String>) {
    let dir_path = if prefix.is_empty() {
        walk_ctx.work_root.to_path_buf()
    } else {
        walk_ctx.work_root.join(prefix)
    };
    let Ok(read_dir) = fs::read_dir(&dir_path) else {
        return;
    };
    let mut children: Vec<(String, PathBuf, bool)> = Vec::new();
    for entry_result in read_dir {
        let Ok(entry) = entry_result else {
            continue;
        };
        let Some((name, child_rel, is_dir)) = describe_dir_child(prefix, &entry) else {
            continue;
        };
        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        children.push((child_rel, entry.path(), is_dir));
    }
    children.sort_by(|left, right| left.0.cmp(&right.0));

    for (child_rel, _, is_dir) in children {
        if is_dir {
            if !walk_ctx.force
                && walk_ctx.matcher.is_ignored(&child_rel, true)
                && !has_tracked_under(walk_ctx.tracked, &child_rel)
            {
                continue;
            }
            collect_worktree_files(walk_ctx, &child_rel, out);
        } else {
            if !walk_ctx.force
                && !walk_ctx.tracked.contains(&child_rel)
                && walk_ctx.matcher.is_ignored(&child_rel, false)
            {
                continue;
            }
            out.push(child_rel);
        }
    }
}

/// Builds the relative path and directory flag for one `DirEntry`.
fn describe_dir_child(prefix: &str, entry: &fs::DirEntry) -> Option<(String, String, bool)> {
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

/// Reports whether any tracked path lives inside `dir_rel` via $O(\log T)$ prefix binary search.
fn has_tracked_under(tracked: &BTreeSet<String>, dir_rel: &str) -> bool {
    let prefix = format!("{dir_rel}/");
    tracked
        .range(prefix.clone()..)
        .next()
        .is_some_and(|first| first.starts_with(&prefix))
}

/// Hashes one working-tree file, writes its blob to the ODB, and updates `index_map`.
fn stage_single_file(
    s_ctx: &StageContext<'_>,
    rel_path: &str,
    index_map: &mut BTreeMap<String, IndexEntry>,
) {
    let full_path = match plan_worktree_path(s_ctx.view.work_root(), rel_path) {
        Ok(planned) => planned,
        Err(detail) => fail_fatal(detail),
    };
    let metadata = match fs::symlink_metadata(&full_path) {
        Ok(meta) => meta,
        Err(err) => fail_fatal(format!("unable to stat '{rel_path}': {err}")),
    };
    let previous = index_map.get(rel_path);
    let previous_mode = previous.map_or(FileMode::RegularFile, |entry| entry.mode);
    let mode = worktree_mode(
        &metadata,
        previous_mode,
        s_ctx.view.config().trust_executable_bit(),
    );
    if let Some(prev) = previous {
        if prev.stage == IndexStage::Normal
            && prev.mode == mode
            && stat_cache_trusted(prev, &metadata, s_ctx.index_timestamp)
            && (s_ctx.odb.has_object(&prev.oid) || s_ctx.view.object(&prev.oid).is_ok())
        {
            return;
        }
    }
    let previous_oid = previous.map(|entry| &entry.oid);
    let payload = match s_ctx
        .view
        .worktree_payload(rel_path, mode, previous_oid, s_ctx.attributes)
    {
        Ok(bytes) => bytes,
        Err(err) => fail_fatal(format!("unable to read '{rel_path}': {err}")),
    };
    let blob_oid = match s_ctx.odb.write_object(OBJ_BLOB, &payload) {
        Ok(oid) => oid,
        Err(err) => fail_fatal(format!("unable to write blob for '{rel_path}': {err}")),
    };
    let (size, mtime_seconds, mtime_nanos) = worktree_stat(&full_path, payload.len() as u32);
    index_map.insert(
        rel_path.to_string(),
        IndexEntry {
            path: rel_path.to_string(),
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

/// Dispatches `taxis rm`.
pub fn handle_rm(ctx: &CliContext) {
    let mut cached = false;
    let mut recursive = false;
    let mut quiet = false;
    let mut ignore_unmatch = false;
    let mut pathspecs = Vec::new();
    let mut after_double_dash = false;

    for arg in &ctx.args {
        if after_double_dash {
            pathspecs.push(normalize_rel_spec(arg));
            continue;
        }
        match arg.as_str() {
            "--" => after_double_dash = true,
            "--cached" => cached = true,
            "--force" => {}
            "--quiet" => quiet = true,
            "--ignore-unmatch" => ignore_unmatch = true,
            other if other.starts_with('-') && !other.starts_with("--") && other.len() > 1 => {
                for ch in other[1..].chars() {
                    match ch {
                        'r' => recursive = true,
                        'f' => {}
                        'q' => quiet = true,
                        _ => fail_usage(format!("rm: unknown option '-{ch}'")),
                    }
                }
            }
            other if other.starts_with('-') => {
                fail_usage(format!("rm: unknown option '{other}'"));
            }
            other => pathspecs.push(normalize_rel_spec(other)),
        }
    }

    if pathspecs.is_empty() {
        fail_usage("usage: git rm [<options>] [--] <file>...");
    }

    let view = RepoView::open_or_exit(ctx);
    let mut index_map = load_index_entries(view.git_dir());
    let to_remove = resolve_rm_targets(&index_map, &pathspecs, (recursive, ignore_unmatch));

    for path in &to_remove {
        index_map.remove(path);
        if !cached {
            remove_worktree_file_and_empty_parents(view.work_root(), path);
        }
        if !quiet {
            println!("rm '{path}'");
        }
    }

    persist_index_state(view.git_dir(), &index_map);
}

/// Resolves index paths matched by `taxis rm` pathspecs.
fn resolve_rm_targets(
    index_map: &BTreeMap<String, IndexEntry>,
    pathspecs: &[String],
    flags: (bool, bool),
) -> Vec<String> {
    let (recursive, ignore_unmatch) = flags;
    let mut matched = BTreeSet::new();
    for spec in pathspecs {
        let mut found_for_spec = false;
        for tracked in index_map.keys() {
            if tracked == spec {
                matched.insert(tracked.clone());
                found_for_spec = true;
            } else if path_matches_spec(tracked, spec) {
                if !recursive {
                    fail_fatal(format!("not removing '{spec}' recursively without -r"));
                }
                matched.insert(tracked.clone());
                found_for_spec = true;
            }
        }
        if !found_for_spec && !ignore_unmatch {
            fail_fatal(format!("pathspec '{spec}' did not match any files"));
        }
    }
    matched.into_iter().collect()
}

/// Dispatches `taxis mv`.
pub fn handle_mv(ctx: &CliContext) {
    let mut force = false;
    let mut positional = Vec::new();
    let mut after_double_dash = false;

    for arg in &ctx.args {
        if after_double_dash {
            positional.push(normalize_rel_spec(arg));
            continue;
        }
        match arg.as_str() {
            "--" => after_double_dash = true,
            "--force" => force = true,
            "--verbose" => {}
            other if other.starts_with('-') && !other.starts_with("--") && other.len() > 1 => {
                for ch in other[1..].chars() {
                    match ch {
                        'f' => force = true,
                        'k' | 'v' => {}
                        _ => fail_usage(format!("mv: unknown option '-{ch}'")),
                    }
                }
            }
            other if other.starts_with('-') => {
                fail_usage(format!("mv: unknown option '{other}'"));
            }
            other => positional.push(normalize_rel_spec(other)),
        }
    }

    if positional.len() != 2 {
        fail_usage("usage: git mv [<options>] <source>... <destination>");
    }

    let source = &positional[0];
    let raw_dest = &positional[1];
    let view = RepoView::open_or_exit(ctx);
    let mut index_map = load_index_entries(view.git_dir());
    let dest = resolve_mv_destination(view.work_root(), source, raw_dest);

    let Some(mut entry) = index_map.remove(source) else {
        fail_fatal(format!("bad source, source={source}, destination={dest}"));
    };
    let src_full = match plan_worktree_path(view.work_root(), source) {
        Ok(planned) => planned,
        Err(detail) => fail_fatal(detail),
    };
    let dst_full = match plan_worktree_path(view.work_root(), &dest) {
        Ok(planned) => planned,
        Err(detail) => fail_fatal(detail),
    };
    if dst_full.exists() && !force {
        fail_fatal(format!(
            "destination exists, source={source}, destination={dest}"
        ));
    }
    if let Some(parent) = dst_full.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            fail_io("create destination directory", err);
        }
    }
    if let Err(err) = fs::rename(&src_full, &dst_full) {
        fail_io("rename working-tree file", err);
    }
    let (size, mtime_seconds, mtime_nanos) = worktree_stat(&dst_full, entry.size);
    entry.path = dest.clone();
    entry.size = size;
    entry.mtime_seconds = mtime_seconds;
    entry.mtime_nanos = mtime_nanos;
    index_map.insert(dest, entry);
    persist_index_state(view.git_dir(), &index_map);
}

/// Resolves the destination relative path when `<destination>` names an existing directory.
fn resolve_mv_destination(work_root: &Path, source: &str, raw_dest: &str) -> String {
    let candidate = work_root.join(raw_dest);
    if candidate.is_dir() {
        let base = Path::new(source)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| source.to_string());
        if raw_dest.is_empty() {
            base
        } else {
            format!("{raw_dest}/{base}")
        }
    } else {
        raw_dest.to_string()
    }
}

/// Dispatches `taxis restore`.
pub fn handle_restore(ctx: &CliContext) {
    let mut source_rev: Option<String> = None;
    let mut staged = false;
    let mut worktree = false;
    let mut pathspecs = Vec::new();
    let mut after_double_dash = false;
    let mut cursor = 0;

    while cursor < ctx.args.len() {
        let arg = &ctx.args[cursor];
        if after_double_dash {
            pathspecs.push(normalize_rel_spec(arg));
            cursor += 1;
            continue;
        }
        match arg.as_str() {
            "--" => after_double_dash = true,
            "--staged" => staged = true,
            "--worktree" => worktree = true,
            "--quiet" => {}
            "-s" | "--source" => {
                cursor += 1;
                let Some(val) = ctx.args.get(cursor) else {
                    fail_usage("restore: --source requires a tree-ish argument");
                };
                source_rev = Some(val.clone());
            }
            other if other.starts_with("--source=") => {
                source_rev = Some(other["--source=".len()..].to_string());
            }
            other if other.starts_with("-s") && other.len() > 2 => {
                source_rev = Some(other[2..].to_string());
            }
            other if other.starts_with('-') && !other.starts_with("--") && other.len() > 1 => {
                apply_restore_short_flags(&other[1..], &mut staged, &mut worktree);
            }
            other if other.starts_with('-') => {
                fail_usage(format!("restore: unknown option '{other}'"));
            }
            other => pathspecs.push(normalize_rel_spec(other)),
        }
        cursor += 1;
    }

    if pathspecs.is_empty() {
        fail_usage("you must specify path(s) to restore");
    }
    if !staged && !worktree {
        worktree = true;
    }

    let view = RepoView::open_or_exit(ctx);
    let mut index_map = load_index_entries(view.git_dir());

    if staged {
        let rev = source_rev.as_deref().unwrap_or("HEAD");
        restore_index_from_tree(&view, (rev, &pathspecs), &mut index_map);
        persist_index_state(view.git_dir(), &index_map);
    }

    if worktree {
        if let Some(ref rev) = source_rev {
            restore_worktree_from_tree(&view, (rev, &pathspecs, staged), &mut index_map);
        } else {
            restore_worktree_from_index(&view, &pathspecs, &index_map);
        }
    }
}

/// Applies bundled short flags (`-SW`, `-WS`, `-Sq`) for `taxis restore`.
fn apply_restore_short_flags(cluster: &str, staged: &mut bool, worktree: &mut bool) {
    for ch in cluster.chars() {
        match ch {
            'S' => *staged = true,
            'W' => *worktree = true,
            'q' => {}
            _ => fail_usage(format!("restore: unknown option '-{ch}'")),
        }
    }
}

/// Restores matching index entries from a tree-ish revision (`taxis restore --staged`).
fn restore_index_from_tree(
    view: &RepoView,
    rev_and_specs: (&str, &[String]),
    index_map: &mut BTreeMap<String, IndexEntry>,
) {
    let (rev, pathspecs) = rev_and_specs;
    let source_tree = load_revision_tree_or_empty(view, rev);
    let candidates: BTreeSet<String> = source_tree
        .keys()
        .chain(index_map.keys())
        .cloned()
        .collect();

    for path in &candidates {
        if !matches_any_pathspec(path, pathspecs) {
            continue;
        }
        if let Some(tree_entry) = source_tree.get(path) {
            let full_path = view.work_root().join(path);
            let (size, mtime_seconds, mtime_nanos) = worktree_stat(&full_path, 0);
            index_map.insert(
                path.clone(),
                IndexEntry {
                    path: path.clone(),
                    mode: tree_entry.mode,
                    oid: tree_entry.oid,
                    stage: IndexStage::Normal,
                    size,
                    mtime_seconds,
                    mtime_nanos,
                    assume_valid: false,
                    skip_worktree: false,
                    intent_to_add: false,
                },
            );
        } else {
            index_map.remove(path);
        }
    }
}

/// Restores matching worktree files from a tree-ish revision (`taxis restore --source=<rev>`).
fn restore_worktree_from_tree(
    view: &RepoView,
    rev_specs_staged: (&str, &[String], bool),
    index_map: &mut BTreeMap<String, IndexEntry>,
) {
    let (rev, pathspecs, also_staged) = rev_specs_staged;
    let (_, tree_oid) = match view.resolve_tree(rev) {
        Ok(resolved) => resolved,
        Err(err) => fail_fatal(err),
    };
    let mut source_tree = BTreeMap::new();
    if let Err(err) = flatten_tree_for_diff(view, &tree_oid, "", &mut source_tree) {
        fail_fatal(err);
    }
    for (path, tree_entry) in &source_tree {
        if !matches_any_pathspec(path, pathspecs) {
            continue;
        }
        write_blob_to_worktree(view, path, (tree_entry.mode, &tree_entry.oid));
        if also_staged {
            let full_path = view.work_root().join(path);
            let (size, mtime_seconds, mtime_nanos) = worktree_stat(&full_path, 0);
            index_map.insert(
                path.clone(),
                IndexEntry {
                    path: path.clone(),
                    mode: tree_entry.mode,
                    oid: tree_entry.oid,
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
    }
    if also_staged {
        persist_index_state(view.git_dir(), index_map);
    }
}

/// Restores matching worktree files from `.git/index` (`taxis restore <path>`).
fn restore_worktree_from_index(
    view: &RepoView,
    pathspecs: &[String],
    index_map: &BTreeMap<String, IndexEntry>,
) {
    for spec in pathspecs {
        if !index_map.keys().any(|path| path_matches_spec(path, spec)) {
            fail_fatal(format!(
                "pathspec '{spec}' did not match any file(s) known to git"
            ));
        }
    }
    for (path, entry) in index_map {
        if !matches_any_pathspec(path, pathspecs) {
            continue;
        }
        write_blob_to_worktree(view, path, (entry.mode, &entry.oid));
    }
}

/// Writes one blob from the ODB into the working tree at `rel_path`.
fn write_blob_to_worktree(view: &RepoView, rel_path: &str, mode_and_oid: (FileMode, &Oid)) {
    let (mode, oid) = mode_and_oid;
    let full_path = match plan_worktree_path(view.work_root(), rel_path) {
        Ok(planned) => planned,
        Err(detail) => fail_fatal(detail),
    };
    if let Some(parent) = full_path.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            fail_io("create parent directory", err);
        }
    }
    let payload = match view.blob_payload(oid) {
        Ok(bytes) => bytes,
        Err(err) => fail_fatal(err),
    };
    if let Err(err) = fs::write(&full_path, &payload) {
        fail_io("write restored file", err);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if mode == FileMode::ExecutableFile {
            let _ = fs::set_permissions(&full_path, fs::Permissions::from_mode(0o755));
        }
    }
    #[cfg(not(unix))]
    let _ = mode;
}

/// Loads the flattened tree of `rev`, returning an empty map when `HEAD` is unborn.
fn load_revision_tree_or_empty(view: &RepoView, rev: &str) -> BTreeMap<String, TreeEntry> {
    if rev == "HEAD" {
        if let Ok(None) = view.head_commit() {
            return BTreeMap::new();
        }
    }
    let (_, tree_oid) = match view.resolve_tree(rev) {
        Ok(resolved) => resolved,
        Err(err) => fail_fatal(err),
    };
    let mut tree = BTreeMap::new();
    if let Err(err) = flatten_tree_for_diff(view, &tree_oid, "", &mut tree) {
        fail_fatal(err);
    }
    tree
}

/// Deletes one working-tree file and prunes any empty parent directories up to `work_root`.
fn remove_worktree_file_and_empty_parents(work_root: &Path, rel_path: &str) {
    let full_path = match plan_worktree_path(work_root, rel_path) {
        Ok(planned) => planned,
        Err(detail) => fail_fatal(detail),
    };
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

/// Persists `index_map` to `.git/index` and synchronizes `repo.txc` when present.
pub(crate) fn persist_index_state(git_dir: &Path, index_map: &BTreeMap<String, IndexEntry>) {
    let entries: Vec<IndexEntry> = index_map.values().cloned().collect();
    update_dirc_index(git_dir, &entries);
}

/// Normalizes a CLI pathspec to forward slashes and strips leading `./` or trailing `/`.
pub(crate) fn normalize_rel_spec(raw: &str) -> String {
    let forward = raw.replace('\\', "/");
    let stripped = forward.strip_prefix("./").unwrap_or(&forward);
    if stripped == "." {
        String::new()
    } else {
        stripped.trim_matches('/').to_string()
    }
}

/// Reports whether `rel_path` matches any pathspec in `specs` (empty `specs` matches everything).
pub(crate) fn matches_any_pathspec(rel_path: &str, specs: &[String]) -> bool {
    if specs.is_empty() {
        return true;
    }
    specs.iter().any(|spec| path_matches_spec(rel_path, spec))
}

/// Reports whether `rel_path` equals `spec` or lives inside directory `spec`.
pub(crate) fn path_matches_spec(rel_path: &str, spec: &str) -> bool {
    if spec.is_empty() || rel_path == spec {
        return true;
    }
    rel_path
        .strip_prefix(spec)
        .is_some_and(|rest| rest.starts_with('/'))
}
