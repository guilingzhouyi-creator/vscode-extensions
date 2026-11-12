//! Module: taxis_cmd::clone — Offline Local & Bundle Repository Clone Dispatcher
//! File Path: src/bin/taxis_cmd/clone.rs
//! Architecture Role: Implements `taxis clone` directly over Taxis's existing storage, index,
//!   reference, and checkout engines (`InPlaceBundleConsumer`, `OdbRouter`, `clone_file_cow`,
//!   `LooseOdb`, `DiskRefStore`, `fg_index::config`, and `checkout`).
//! Dependencies & Triggers: Dispatched by `src/bin/taxis.rs` for `clone`.
//! Responsibilities: Clone local `.git` / bare / `.taxis` repositories or offline Git Bundle v2
//!   packages into a new bare or non-bare repository, configure `remote.<origin>`, and materialize
//!   the checked-out working tree and DIRC v2 index.
//! Exit Semantics & Design Rationale:
//!   - Local packfiles are projected via OS-level CoW (`clone_file_cow`) with loose ODB fallback.
//!   - Bundle sources are ingested via `InPlaceBundleConsumer::consume_bundle` without mutating
//!     the source bundle file.
//!   - Unmounted remote network schemes report structured offline diagnostics and exit non-zero.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety and CoW projection guard
//! - `FGT-OBJ-001`: Canonical Git object framing guard
//! - `FGT-COR-001`: Core data model and error contract guard

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use fg_core::models::Oid;
use fg_core::traits::RefStore;
use fg_index::config::{set_value, ConfigKey, ConfigWriteMode};
use fg_storage::in_place::{BundleConsumeOptions, InPlaceBundleConsumer};
use fg_storage::{clone_file_cow, LooseOdb, OdbRouter};
use fractal_git::DiskRefStore;

use super::checkout::{materialize_files, update_dirc_index};
use super::common::{fail_fatal, fail_io, fail_usage, print_json, CliContext};
use super::repo_view::RepoView;
use super::tree_view::flatten_commit_tree;

/// Parsed command-line options for `taxis clone`.
struct CloneOptions {
    source: String,
    destination: PathBuf,
    origin_name: String,
    branch: Option<String>,
    bare: bool,
    no_checkout: bool,
    quiet: bool,
}

/// Summary of refs and HEAD resolved from a clone source.
struct ClonedRefState {
    default_branch: String,
    head_oid: Option<Oid>,
    object_count: usize,
}

/// Dispatches `taxis clone`.
pub fn handle_clone(ctx: &CliContext) {
    let options = parse_clone_options(&ctx.args);
    ensure_destination_available(&options.destination);

    let source_path = resolve_local_source_path(&options.source);
    let Some(local_source) = source_path else {
        super::remote::fail_network_unavailable(
            ctx,
            "clone",
            &options.source,
            "Clone using native `git clone <url> <dir>` or package an offline bundle (`git bundle create`), then run `taxis clone <local-path-or-bundle> <dir>`.",
        );
    };

    let git_dir = initialize_clone_git_dir(&options.destination, options.bare);
    configure_clone_remote(&git_dir, &options.origin_name, &local_source, options.bare);

    if !options.quiet && !ctx.json_mode {
        println!("Cloning into '{}'...", options.destination.display());
    }

    let ref_state = if local_source.is_file() {
        clone_from_bundle(&local_source, &git_dir, &options)
    } else if local_source.is_dir() {
        clone_from_directory(&local_source, &git_dir, &options)
    } else {
        fail_fatal(format!("repository '{}' does not exist", options.source))
    };

    if !options.bare && !options.no_checkout {
        if let Some(commit_oid) = ref_state.head_oid {
            checkout_cloned_worktree(&git_dir, commit_oid);
        }
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "clone",
            "status": "ok",
            "source": local_source.display().to_string(),
            "destination": options.destination.display().to_string(),
            "bare": options.bare,
            "branch": ref_state.default_branch,
            "head_oid": ref_state.head_oid.map(|oid| oid.to_hex()),
            "objects": ref_state.object_count,
        }));
    }
}

/// Parses command-line options for `taxis clone`.
fn parse_clone_options(args: &[String]) -> CloneOptions {
    let mut origin_name = "origin".to_string();
    let mut branch: Option<String> = None;
    let mut bare = false;
    let mut no_checkout = false;
    let mut quiet = false;
    let mut positional: Vec<String> = Vec::new();
    let mut after_double_dash = false;
    let mut cursor = 0;

    while cursor < args.len() {
        let arg = &args[cursor];
        if after_double_dash {
            positional.push(arg.clone());
            cursor += 1;
            continue;
        }
        match arg.as_str() {
            "--" => after_double_dash = true,
            "--bare" => bare = true,
            "-n" | "--no-checkout" => no_checkout = true,
            "-q" | "--quiet" => quiet = true,
            "-l" | "--local" | "--no-hardlinks" => {}
            "-o" | "--origin" => {
                cursor += 1;
                let Some(val) = args.get(cursor) else {
                    fail_usage("clone: --origin requires a remote name");
                };
                origin_name = val.clone();
            }
            "-b" | "--branch" => {
                cursor += 1;
                let Some(val) = args.get(cursor) else {
                    fail_usage("clone: --branch requires a branch or tag name");
                };
                branch = Some(val.clone());
            }
            other if other.starts_with('-') => {
                fail_unknown_clone_option(other);
            }
            other => positional.push(other.to_owned()),
        }
        cursor += 1;
    }

    let Some(source) = positional.first().cloned() else {
        fail_usage("usage: git clone [<options>] [--] <repo> [<dir>]");
    };
    let destination = match positional.get(1) {
        Some(explicit) => PathBuf::from(explicit),
        None => derive_default_clone_dir(&source, bare),
    };

    CloneOptions {
        source,
        destination,
        origin_name,
        branch,
        bare,
        no_checkout,
        quiet,
    }
}

/// Exits with usage status 129 when an unknown option is supplied to `taxis clone`.
fn fail_unknown_clone_option(option: &str) -> ! {
    fail_usage(format!("clone: unknown option '{option}'"))
}

/// Derives the target directory name from `<repo>` when `<dir>` is omitted.
fn derive_default_clone_dir(source: &str, bare: bool) -> PathBuf {
    let trimmed = source.trim_end_matches(['/', '\\']);
    let leaf = trimmed.rsplit(['/', '\\']).next().unwrap_or("repository");
    let stem = leaf
        .strip_suffix(".bundle")
        .or_else(|| leaf.strip_suffix(".git"))
        .unwrap_or(leaf);
    let base = if stem.is_empty() { "repository" } else { stem };
    if bare {
        PathBuf::from(format!("{base}.git"))
    } else {
        PathBuf::from(base)
    }
}

/// Refuses to overwrite a non-empty destination directory, matching `git clone`.
fn ensure_destination_available(dest: &Path) {
    if !dest.exists() {
        return;
    }
    if dest.is_file() {
        fail_fatal(format!(
            "destination path '{}' already exists and is not an empty directory.",
            dest.display()
        ));
    }
    if let Ok(mut entries) = fs::read_dir(dest) {
        if entries.next().is_some() {
            fail_fatal(format!(
                "destination path '{}' already exists and is not an empty directory.",
                dest.display()
            ));
        }
    }
}

/// Resolves a local path or `file://` URL, returning `None` for external network schemes.
fn resolve_local_source_path(source: &str) -> Option<PathBuf> {
    if source.starts_with("https://")
        || source.starts_with("http://")
        || source.starts_with("ssh://")
        || source.starts_with("git://")
        || (source.contains('@') && source.contains(':') && !Path::new(source).exists())
    {
        return None;
    }
    let raw = if let Some(rest) = source.strip_prefix("file://") {
        if cfg!(windows) {
            rest.strip_prefix('/').unwrap_or(rest)
        } else {
            rest
        }
    } else {
        source
    };
    let candidate = PathBuf::from(raw);
    Some(candidate.canonicalize().unwrap_or(candidate))
}

/// Creates the target `.git` (or bare root) directory scaffold.
fn initialize_clone_git_dir(destination: &Path, bare: bool) -> PathBuf {
    let git_dir = if bare {
        destination.to_path_buf()
    } else {
        destination.join(".git")
    };
    for subdir in [
        "objects/pack",
        "objects/info",
        "refs/heads",
        "refs/tags",
        "refs/remotes",
    ] {
        if let Err(err) = fs::create_dir_all(git_dir.join(subdir)) {
            fail_io("initialize clone directory", err);
        }
    }
    let config_body = format!(
        "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = {bare}\n\tlogallrefupdates = {}\n",
        !bare
    );
    if let Err(err) = fs::write(git_dir.join("config"), config_body) {
        fail_io("write clone config", err);
    }
    git_dir
}

/// Writes `remote.<origin>.url` and `remote.<origin>.fetch` via `fg_index::config`.
fn configure_clone_remote(git_dir: &Path, origin_name: &str, source_path: &Path, bare: bool) {
    let config_path = git_dir.join("config");
    let url_str = source_path.to_string_lossy().replace('\\', "/");
    let stripped_url = url_str.strip_prefix("//?/").unwrap_or(&url_str);
    if let Ok(url_key) = ConfigKey::new("remote", Some(origin_name), "url") {
        let _ = set_value(
            &config_path,
            &url_key,
            stripped_url,
            ConfigWriteMode::Replace,
        );
    }
    let fetch_spec = if bare {
        "+refs/*:refs/*".to_string()
    } else {
        format!("+refs/heads/*:refs/remotes/{origin_name}/*")
    };
    if let Ok(fetch_key) = ConfigKey::new("remote", Some(origin_name), "fetch") {
        let _ = set_value(
            &config_path,
            &fetch_key,
            &fetch_spec,
            ConfigWriteMode::Replace,
        );
    }
}

/// Clones from a Git Bundle v2 file using `InPlaceBundleConsumer::consume_bundle`.
fn clone_from_bundle(
    bundle_file: &Path,
    dest_git_dir: &Path,
    options: &CloneOptions,
) -> ClonedRefState {
    let consume_opts = BundleConsumeOptions {
        truncate_source: false,
    };
    let report =
        match InPlaceBundleConsumer::consume_bundle(bundle_file, dest_git_dir, &consume_opts) {
            Ok(ingested) => ingested,
            Err(err) => fail_fatal(format!(
                "failed to unbundle '{}': {err}",
                bundle_file.display()
            )),
        };

    let ref_store = DiskRefStore::new(dest_git_dir);
    for (ref_name, oid) in &report.references_advanced {
        mirror_cloned_ref(
            &ref_store,
            ref_name,
            oid,
            &options.origin_name,
            options.bare,
        );
    }

    let (default_branch, head_oid) =
        select_clone_head(&report.references_advanced, options.branch.as_deref(), None);
    write_cloned_head(&ref_store, &default_branch, head_oid);
    write_origin_head_symref(
        dest_git_dir,
        &options.origin_name,
        &default_branch,
        head_oid,
        options.bare,
    );

    ClonedRefState {
        default_branch,
        head_oid,
        object_count: report.object_count as usize,
    }
}

/// Clones from a local `.git`, bare, or `.taxis` repository directory.
fn clone_from_directory(
    source_dir: &Path,
    dest_git_dir: &Path,
    options: &CloneOptions,
) -> ClonedRefState {
    let src_ctx = CliContext {
        git_dir: source_dir.to_path_buf(),
        json_mode: false,
        args: Vec::new(),
    };
    let src_view = match RepoView::open(&src_ctx) {
        Ok(opened) => opened,
        Err(err) => fail_fatal(format!(
            "repository '{}' is not a valid git or taxis repository: {err}",
            source_dir.display()
        )),
    };

    let object_count = copy_repository_objects(src_view.git_dir(), dest_git_dir);
    let mut src_refs = DiskRefStore::new(src_view.git_dir())
        .list_all()
        .unwrap_or_default();
    synthesize_cell_heads(&mut src_refs);
    let src_head_branch = src_view.head_branch().ok().flatten().map(|(name, _)| name);
    let src_head_commit = src_view
        .effective_head_commit()
        .ok()
        .flatten()
        .map(|(_, oid)| oid);

    let dest_ref_store = DiskRefStore::new(dest_git_dir);
    for (ref_name, oid) in &src_refs {
        mirror_cloned_ref(
            &dest_ref_store,
            ref_name,
            oid,
            &options.origin_name,
            options.bare,
        );
    }

    let (default_branch, mut head_oid) = select_clone_head(
        &src_refs,
        options.branch.as_deref(),
        src_head_branch.as_deref(),
    );
    if head_oid.is_none() && options.branch.is_none() {
        head_oid = src_head_commit;
    }
    write_cloned_head(&dest_ref_store, &default_branch, head_oid);
    write_origin_head_symref(
        dest_git_dir,
        &options.origin_name,
        &default_branch,
        head_oid,
        options.bare,
    );

    ClonedRefState {
        default_branch,
        head_oid,
        object_count,
    }
}

/// Projects `refs/fractal/cell/<cell>/<branch>` into `refs/heads/<branch>` when `refs/heads/<branch>` is absent.
fn synthesize_cell_heads(src_refs: &mut Vec<(String, Oid)>) {
    let mut additions: Vec<(String, Oid)> = Vec::new();
    for (name, oid) in src_refs.iter() {
        if let Some(rest) = name.strip_prefix("refs/fractal/cell/") {
            if let Some((_cell, branch)) = rest.split_once('/') {
                let head_ref = format!("refs/heads/{branch}");
                if !branch.is_empty() && !src_refs.iter().any(|(existing, _)| existing == &head_ref)
                {
                    additions.push((head_ref, *oid));
                }
            }
        }
    }
    for (head_ref, oid) in additions {
        if !src_refs.iter().any(|(existing, _)| existing == &head_ref) {
            src_refs.push((head_ref, oid));
        }
    }
}

/// Writes `refs/remotes/<origin>/HEAD` symbolic reference for non-bare clones.
fn write_origin_head_symref(
    dest_git_dir: &Path,
    origin_name: &str,
    default_branch: &str,
    head_oid: Option<Oid>,
    bare: bool,
) {
    if bare || head_oid.is_none() {
        return;
    }
    let remote_head_dir = dest_git_dir.join("refs/remotes").join(origin_name);
    let _ = fs::create_dir_all(&remote_head_dir);
    let remote_head_file = remote_head_dir.join("HEAD");
    let content = format!("ref: refs/remotes/{origin_name}/{default_branch}\n");
    let _ = fs::write(remote_head_file, content);
}

/// Copies packfiles via CoW (`clone_file_cow`) and writes any unpacked objects via `OdbRouter`.
fn copy_repository_objects(src_git_dir: &Path, dest_git_dir: &Path) -> usize {
    let src_pack_dir = src_git_dir.join("objects/pack");
    let dest_pack_dir = dest_git_dir.join("objects/pack");
    if let Ok(entries) = fs::read_dir(&src_pack_dir) {
        for entry_result in entries.flatten() {
            let src_file = entry_result.path();
            if src_file.is_file() {
                let dst_file = dest_pack_dir.join(entry_result.file_name());
                let _ = clone_file_cow(&src_file, &dst_file);
            }
        }
    }

    let Ok(src_router) = OdbRouter::open(src_git_dir.join("objects")) else {
        return 0;
    };
    let Ok(dest_router) = OdbRouter::open(dest_git_dir.join("objects")) else {
        return 0;
    };
    let Ok(all_oids) = src_router.all_oids() else {
        return 0;
    };
    for oid in &all_oids {
        copy_single_missing_object(&src_router, &dest_router, dest_git_dir, oid);
    }
    all_oids.len()
}

/// Copies one object from `src_router` into `dest_git_dir` if `dest_router` does not have it yet.
fn copy_single_missing_object(
    src_router: &OdbRouter,
    dest_router: &OdbRouter,
    dest_git_dir: &Path,
    oid: &Oid,
) {
    if dest_router.read(oid).ok().flatten().is_some() {
        return;
    }
    let Ok(Some(packed)) = src_router.read(oid) else {
        return;
    };
    let mut raw_object = Vec::with_capacity(32 + packed.payload.len());
    if write!(
        raw_object,
        "{} {}\0",
        packed.kind.as_str(),
        packed.payload.len()
    )
    .is_ok()
    {
        raw_object.extend_from_slice(&packed.payload);
        let _ = LooseOdb::write_loose_object_raw(dest_git_dir, oid, &raw_object);
    }
}

/// Mirrors one source reference into `refs/remotes/<origin>/*` (or directly under `--bare`).
fn mirror_cloned_ref(
    dest_refs: &DiskRefStore,
    ref_name: &str,
    oid: &Oid,
    origin_name: &str,
    bare: bool,
) {
    if bare {
        if ref_name.starts_with("refs/") {
            let _ = dest_refs.update_ref(ref_name, oid, None);
        }
        return;
    }
    if let Some(branch) = ref_name.strip_prefix("refs/heads/") {
        let remote_ref = format!("refs/remotes/{origin_name}/{branch}");
        let _ = dest_refs.update_ref(&remote_ref, oid, None);
    } else if ref_name.starts_with("refs/tags/") {
        let _ = dest_refs.update_ref(ref_name, oid, None);
    }
}

/// Selects the initial branch name and commit OID for the cloned repository.
fn select_clone_head(
    refs: &[(String, Oid)],
    requested_branch: Option<&str>,
    source_head_branch: Option<&str>,
) -> (String, Option<Oid>) {
    if let Some(branch) = requested_branch {
        let branch_ref = format!("refs/heads/{branch}");
        let tag_ref = format!("refs/tags/{branch}");
        if let Some((_, oid)) = refs
            .iter()
            .find(|(name, _)| name == &branch_ref || name == &tag_ref)
        {
            return (branch.to_string(), Some(*oid));
        }
        fail_fatal(format!("Remote branch {branch} not found in upstream"));
    }

    if let Some(head_branch) = source_head_branch {
        let full = format!("refs/heads/{head_branch}");
        let oid = refs
            .iter()
            .find(|(name, _)| name == &full)
            .map(|(_, oid)| *oid);
        return (head_branch.to_string(), oid);
    }

    for candidate in ["main", "master"] {
        let full = format!("refs/heads/{candidate}");
        if let Some((_, oid)) = refs.iter().find(|(name, _)| name == &full) {
            return (candidate.to_string(), Some(*oid));
        }
    }

    if let Some((name, oid)) = refs
        .iter()
        .find(|(name, _)| name.starts_with("refs/heads/"))
    {
        let short = name.strip_prefix("refs/heads/").unwrap_or("main");
        return (short.to_string(), Some(*oid));
    }

    if let Some((_, oid)) = refs.iter().find(|(name, _)| name == "HEAD") {
        return ("main".to_string(), Some(*oid));
    }

    ("main".to_string(), None)
}

/// Writes `refs/heads/<branch>` and symbolic `HEAD` into the cloned repository.
fn write_cloned_head(ref_store: &DiskRefStore, branch: &str, head_oid: Option<Oid>) {
    let branch_ref = format!("refs/heads/{branch}");
    if let Some(oid) = head_oid {
        let _ = ref_store.update_ref(&branch_ref, &oid, None);
    }
    let _ = ref_store.update_head_symbolic(&branch_ref);
}

/// Materializes the checked-out working tree and writes `.git/index` via `checkout` helpers.
fn checkout_cloned_worktree(git_dir: &Path, commit_oid: Oid) {
    let clone_ctx = CliContext {
        git_dir: git_dir.to_path_buf(),
        json_mode: false,
        args: Vec::new(),
    };
    let view = match RepoView::open(&clone_ctx) {
        Ok(opened) => opened,
        Err(err) => fail_fatal(err),
    };
    let files = match flatten_commit_tree(&view, &commit_oid) {
        Ok(flattened) => flattened,
        Err(err) => fail_fatal(err),
    };
    let index_entries = materialize_files(&view, &files);
    update_dirc_index(view.git_dir(), &index_entries);
}
