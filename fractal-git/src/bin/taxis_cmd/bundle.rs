//! Module: taxis_cmd::bundle — Native Git Bundle Command Dispatcher
//! File Path: src/bin/taxis_cmd/bundle.rs
//! Architecture Role: Dispatches `taxis bundle`, creating offline Git Bundle v2 packages with
//!   sliding-window delta-compressed packfiles and verifying bundle headers, prerequisites, and checksums.
//! Dependencies & Triggers: Dispatched by `taxis bundle`.
//! Responsibilities: CLI option parsing, reachable DAG object gathering, delta chain construction,
//!   and bundle container serialization and verification.
//! Exit Semantics & Design Rationale:
//!   - Git Bundle v2 specification compliance: interoperable with Git CLI (`git bundle verify`).
//!   - Supports `create`, `verify`, and `list-heads` subcommands.

use std::collections::{HashSet, VecDeque};
use std::fs::File;
use std::path::PathBuf;

use fg_algorithms::pack::{compute_basename_hash, find_pack_deltas, PackDeltaItem};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileMode, ObjectKind, Oid};
use fg_object::GitTreeRef;
use fg_storage::bundle::BundleEngine;
use fg_storage::in_place::{BundleConsumeOptions, InPlaceBundleConsumer};
use fg_topology::DiskRefStore;
use fractal_git::constants::cli::CliTag;

use super::commit_walk::parse_commit_record;
use super::common::{fail_usage, print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Dispatches `taxis bundle`.
pub fn handle_bundle(ctx: &CliContext) {
    if ctx.args.is_empty() {
        print_bundle_help();
        return;
    }

    let subcommand = ctx.args[0].as_str();
    let subcommand_args = &ctx.args[1..];

    match subcommand {
        "create" => handle_bundle_create(ctx, subcommand_args),
        "verify" => handle_bundle_verify(ctx, subcommand_args),
        "list-heads" => handle_bundle_list_heads(ctx, subcommand_args),
        "unbundle" | "apply" => handle_bundle_unbundle(ctx, subcommand_args),
        "-h" | "--help" | "help" => print_bundle_help(),
        other => reject(
            CliTag::ERROR,
            format!("unknown bundle subcommand '{other}'"),
        ),
    }
}

fn print_bundle_help() {
    println!(
        "Usage: taxis bundle <subcommand> [options]\n\n\
         Subcommands:\n\
           create <file> <git-rev-list-args>...  Create a Git bundle v2 file\n\
           verify <file>                         Verify bundle header, prerequisites, and packfile\n\
           list-heads <file>                     List references contained in a bundle\n\
           unbundle, apply <file> [--in-place]   Ingest Git bundle v2 into repository ODB\n\n\
         The unbundle command retains the source bundle by default; --in-place truncates it\n\
         only after the embedded pack trailer has been verified."
    );
}

/// Options accepted by the `taxis bundle unbundle` command.
struct BundleUnbundleOptions {
    /// Bundle file the caller wants ingested.
    bundle_file: PathBuf,
    /// Whether the consumed bundle may be truncated once its pack trailer is verified.
    truncate_source: bool,
}

/// Ingests a Git bundle v2 file into the repository ODB and advances references.
///
/// The source bundle is retained byte-for-byte by default so an ingest stays auditable and
/// retryable; `--in-place` opts into truncating it after verification.
fn handle_bundle_unbundle(ctx: &CliContext, args: &[String]) {
    if args.is_empty()
        || args
            .iter()
            .any(|arg| arg == "-h" || arg == "--help" || arg == "help")
    {
        println!(
            "Usage: taxis bundle unbundle <file> [--in-place]\n\n\
             Ingests Git bundle v2 into repository ODB and advances references.\n\
             The source bundle is retained by default; --in-place truncates it to zero bytes\n\
             only after the embedded pack trailer has been verified."
        );
        return;
    }

    let options = match parse_bundle_unbundle_options(args) {
        Ok(parsed_options) => parsed_options,
        Err(detail) => fail_usage(detail),
    };
    let bundle_file = options.bundle_file;
    if !bundle_file.is_file() {
        reject(
            CliTag::ERROR,
            format!(
                "bundle file '{}' does not exist or is not a file",
                bundle_file.display()
            ),
        );
    }

    let view = match RepoView::open(ctx) {
        Ok(repo_view) => repo_view,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let consume_options = BundleConsumeOptions {
        truncate_source: options.truncate_source,
    };
    match InPlaceBundleConsumer::consume_bundle(&bundle_file, view.git_dir(), &consume_options) {
        Ok(report) => {
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "status": "success",
                    "pack_oid": report.pack_oid.to_hex(),
                    "object_count": report.object_count,
                    "bundle_bytes_reclaimed": report.bundle_bytes_reclaimed,
                    "source_truncated": report.source_truncated,
                    "source_retained_bytes": report.source_retained_bytes,
                    "references_advanced": report.references_advanced.iter().map(|(name, oid)| {
                        serde_json::json!({
                            "ref": name,
                            "oid": oid.to_hex(),
                        })
                    }).collect::<Vec<_>>(),
                }));
            } else {
                println!("=== Taxis Bundle Ingestion ===");
                println!("Ingested Packfile:       {}", report.pack_oid.to_hex());
                println!("Objects Ingested:        {}", report.object_count);
                if report.source_truncated {
                    println!(
                        "Source Bundle:           truncated ({} bytes retained, {} bytes reclaimed)",
                        report.source_retained_bytes, report.bundle_bytes_reclaimed
                    );
                } else {
                    println!(
                        "Source Bundle:           retained ({} bytes)",
                        report.source_retained_bytes
                    );
                }
                println!(
                    "Bundle Space Reclaimed:  {} bytes",
                    report.bundle_bytes_reclaimed
                );
                println!("References Advanced:");
                for (name, oid) in &report.references_advanced {
                    println!("  {} -> {}", oid.to_hex(), name);
                }
            }
        }
        Err(err) => {
            reject(
                CliTag::ERROR,
                format!("consume bundle '{}': {err}", bundle_file.display()),
            );
        }
    }
}

/// Parses `taxis bundle unbundle` arguments into typed options.
fn parse_bundle_unbundle_options(args: &[String]) -> Result<BundleUnbundleOptions, String> {
    let mut bundle_file: Option<PathBuf> = None;
    let mut truncate_source = false;
    for argument in args {
        match argument.as_str() {
            "--in-place" => truncate_source = true,
            other if other.starts_with('-') => {
                return Err(format!(
                    "taxis bundle unbundle <file> [--in-place]: unknown option '{other}'"
                ));
            }
            other => {
                if bundle_file.is_some() {
                    return Err(
                        "taxis bundle unbundle <file> [--in-place]: exactly one bundle file is accepted"
                            .to_string(),
                    );
                }
                bundle_file = Some(PathBuf::from(other));
            }
        }
    }
    let bundle_file = match bundle_file {
        Some(file) => file,
        None => return Err("taxis bundle unbundle <file> [--in-place]".to_string()),
    };
    Ok(BundleUnbundleOptions {
        bundle_file,
        truncate_source,
    })
}

fn handle_bundle_create(ctx: &CliContext, args: &[String]) {
    if args.is_empty() {
        reject(
            CliTag::ERROR,
            "taxis bundle create requires a target file and revision arguments",
        );
    }

    let target_file = PathBuf::from(&args[0]);
    let rev_args = if args.len() > 1 {
        &args[1..]
    } else {
        &["HEAD".to_string()]
    };

    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let (positive_refs, negative_oids) = parse_bundle_revisions(&view, rev_args);
    let prerequisites = match prerequisite_entries(&view, &negative_oids) {
        Ok(entries) => entries,
        Err(err) => reject(CliTag::ERROR, format!("resolve prerequisites: {err}")),
    };

    // Collect every object the bundle must carry, minus the prerequisite closure
    let delta_items = match collect_reachable_objects(&view, &positive_refs, &prerequisites) {
        Ok(items) => items,
        Err(err) => reject(CliTag::ERROR, format!("collect bundle objects: {err}")),
    };
    if delta_items.is_empty() {
        reject(CliTag::ERROR, "no objects to package in bundle");
    }

    // Apply sliding-window delta compression
    let delta_chains = find_pack_deltas(delta_items, 10, 50);

    let mut file = match File::create(&target_file) {
        Ok(f) => f,
        Err(err) => reject(
            CliTag::ERROR,
            format!("create bundle file '{}': {err}", target_file.display()),
        ),
    };

    let report = match BundleEngine::write_bundle(
        &mut file,
        &prerequisites,
        &positive_refs,
        &delta_chains,
    ) {
        Ok(r) => r,
        Err(err) => reject(CliTag::ERROR, format!("write bundle: {err}")),
    };

    render_bundle_create_report(
        ctx,
        (&target_file, &positive_refs, &prerequisites),
        (report.ref_count, report.object_count, report.pack_checksum),
    );
}

fn parse_bundle_revisions(view: &RepoView, rev_args: &[String]) -> (Vec<(Oid, String)>, Vec<Oid>) {
    let mut positive_refs: Vec<(Oid, String)> = Vec::new();
    let mut negative_oids: Vec<Oid> = Vec::new();

    for rev in rev_args {
        if let Some(neg) = rev.strip_prefix('^') {
            match view.resolve(neg) {
                Ok(oid) => negative_oids.push(oid),
                Err(err) => reject(
                    CliTag::ERROR,
                    format!("resolve prerequisite revision '{neg}': {err}"),
                ),
            }
            continue;
        }
        let oid = match view.resolve(rev) {
            Ok(oid) => oid,
            Err(err) => reject(
                CliTag::ERROR,
                format!("resolve target revision '{rev}': {err}"),
            ),
        };
        let ref_name = match canonical_bundle_ref_name(view, rev) {
            Ok(name) => name,
            Err(err) => reject(
                CliTag::ERROR,
                format!("resolve target reference '{rev}': {err}"),
            ),
        };
        positive_refs.push((oid, ref_name));
    }

    if positive_refs.is_empty() {
        reject(CliTag::ERROR, "no positive revisions specified for bundle");
    }
    (positive_refs, negative_oids)
}

type BundleCreateMeta<'a> = (
    &'a std::path::Path,
    &'a [(Oid, String)],
    &'a [(Oid, String)],
);

fn render_bundle_create_report(
    ctx: &CliContext,
    bundle_meta: BundleCreateMeta<'_>,
    counts: (usize, usize, Oid),
) {
    let (target_file, positive_refs, prerequisites) = bundle_meta;
    let (ref_count, object_count, pack_checksum) = counts;
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "status": "success",
            "file": target_file.to_string_lossy(),
            "references": positive_refs.iter().map(|(o, r)| serde_json::json!({ "oid": o.to_hex(), "name": r })).collect::<Vec<_>>(),
            "prerequisites": prerequisites.iter().map(|(o, _)| o.to_hex()).collect::<Vec<_>>(),
            "objects_packaged": object_count,
            "pack_checksum": pack_checksum.to_hex(),
        }));
    } else {
        println!(
            "Created bundle '{}' with {} refs and {} objects (pack checksum {})",
            target_file.display(),
            ref_count,
            object_count,
            &pack_checksum.to_hex()[..8]
        );
    }
}

fn handle_bundle_verify(ctx: &CliContext, args: &[String]) {
    if args.is_empty() {
        reject(
            CliTag::ERROR,
            "taxis bundle verify requires a bundle file path",
        );
    }

    let bundle_file = PathBuf::from(&args[0]);
    let mut file = match File::open(&bundle_file) {
        Ok(f) => f,
        Err(err) => reject(
            CliTag::ERROR,
            format!("open bundle file '{}': {err}", bundle_file.display()),
        ),
    };

    let header = match BundleEngine::read_header(&mut file) {
        Ok(h) => h,
        Err(err) => reject(CliTag::ERROR, format!("verify bundle header: {err}")),
    };

    let pack_checksum = match BundleEngine::verify_pack_checksum(&mut file, header.pack_offset) {
        Ok(c) => c,
        Err(err) => reject(CliTag::ERROR, format!("verify embedded packfile: {err}")),
    };

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "status": "valid",
            "file": bundle_file.to_string_lossy(),
            "version": header.version,
            "references": header.references.iter().map(|(o, r)| serde_json::json!({ "oid": o.to_hex(), "name": r })).collect::<Vec<_>>(),
            "prerequisites": header.prerequisites.iter().map(|o| o.to_hex()).collect::<Vec<_>>(),
            "pack_object_count": header.pack_object_count,
            "pack_checksum": pack_checksum.to_hex(),
        }));
    } else {
        println!(
            "The bundle contains these {} refs:",
            header.references.len()
        );
        for (oid, ref_name) in &header.references {
            println!("{} {}", oid.to_hex(), ref_name);
        }

        if !header.prerequisites.is_empty() {
            println!(
                "The bundle requires these {} prerequisites:",
                header.prerequisites.len()
            );
            for prereq in &header.prerequisites {
                println!("{}", prereq.to_hex());
            }
        }

        println!("'{}' is okay", bundle_file.display());
    }
}

fn handle_bundle_list_heads(ctx: &CliContext, args: &[String]) {
    if args.is_empty() {
        reject(
            CliTag::ERROR,
            "taxis bundle list-heads requires a bundle file path",
        );
    }

    let bundle_file = PathBuf::from(&args[0]);
    let mut file = match File::open(&bundle_file) {
        Ok(f) => f,
        Err(err) => reject(
            CliTag::ERROR,
            format!("open bundle file '{}': {err}", bundle_file.display()),
        ),
    };

    let header = match BundleEngine::read_header(&mut file) {
        Ok(h) => h,
        Err(err) => reject(CliTag::ERROR, format!("read bundle header: {err}")),
    };

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "references": header.references.iter().map(|(o, r)| serde_json::json!({ "oid": o.to_hex(), "name": r })).collect::<Vec<_>>()
        }));
    } else {
        for (oid, ref_name) in &header.references {
            println!("{} {}", oid.to_hex(), ref_name);
        }
    }
}

/// Resolves a revision argument to the canonical reference name recorded in the bundle header.
///
/// Git bundles only name references (or `HEAD`): an arbitrary expression is rejected because the
/// header has no place to store it. Short names expand against the live reference table in Git's
/// own disambiguation order (heads before tags before remotes).
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] when no reference carries the requested name.
fn canonical_bundle_ref_name(view: &RepoView, revision: &str) -> FractalResult<String> {
    if revision == "HEAD" {
        return Ok("HEAD".to_string());
    }
    let references = DiskRefStore::new(view.git_dir()).list_all()?;
    if revision.starts_with("refs/") {
        if references.iter().any(|(name, _)| name == revision) {
            return Ok(revision.to_string());
        }
    } else {
        for prefix in ["refs/heads/", "refs/tags/", "refs/remotes/"] {
            for (name, _) in &references {
                if name.strip_prefix(prefix) == Some(revision) {
                    return Ok(name.clone());
                }
            }
        }
    }
    Err(FractalError::ObjectCodec(format!(
        "revision '{revision}' does not name a reference; bundles record references, not expressions"
    )))
}

/// Peels prerequisite revisions to commits and captures the informational subject line.
///
/// Git prints the commit subject after each prerequisite id so a human can read the bundle; the
/// receiving side trusts only the id. A prerequisite that is not commit-ish keeps an empty subject
/// instead of failing, because Git never validates the trailing text.
fn prerequisite_entries(
    view: &RepoView,
    negative_oids: &[Oid],
) -> FractalResult<Vec<(Oid, String)>> {
    let mut entries = Vec::with_capacity(negative_oids.len());
    for oid in negative_oids {
        let peeled = view.peel(oid)?;
        let object = view.object(&peeled)?;
        let subject = if object.kind == ObjectKind::Commit {
            parse_commit_record(peeled, &object.payload)
                .map(|record| record.subject().to_string())
                .unwrap_or_default()
        } else {
            String::new()
        };
        entries.push((peeled, subject));
    }
    Ok(entries)
}

/// Upper bound on the annotated-tag chain a bundle ref may resolve through.
const PEEL_LIMIT: usize = 8;

/// Collects every object a bundle must carry, minus the prerequisite closure.
///
/// The receiving repository already holds each prerequisite's commits, trees, and blobs, so
/// sending them again would duplicate history. Positive references are peeled through annotated
/// tag chains: the tag object enters the pack first, followed by the commit, every nested tree,
/// and every blob it reaches.
///
/// # Errors
///
/// Fails when an object cannot be read or a positive reference peels to something other than a
/// commit, because such a bundle would not name a checkout-able history.
fn collect_reachable_objects(
    view: &RepoView,
    positive_refs: &[(Oid, String)],
    prerequisites: &[(Oid, String)],
) -> FractalResult<Vec<PackDeltaItem>> {
    let prerequisite_oids: Vec<Oid> = prerequisites.iter().map(|(oid, _)| *oid).collect();
    let excluded = collect_excluded_objects(view, &prerequisite_oids)?;

    let mut visited: HashSet<Oid> = HashSet::new();
    let mut items: Vec<PackDeltaItem> = Vec::new();
    let mut commit_queue: VecDeque<Oid> = VecDeque::new();

    for (oid, _) in positive_refs {
        let mut current = *oid;
        let mut commit_oid = None;
        for _ in 0..PEEL_LIMIT {
            let object = view.object(&current)?;
            match object.kind {
                ObjectKind::Tag => {
                    let target = tag_target_oid(&object.payload)?;
                    if visited.insert(current) {
                        items.push(pack_item(current, ObjectKind::Tag, object.payload, 0));
                    }
                    current = target;
                }
                ObjectKind::Commit => {
                    commit_oid = Some(current);
                    break;
                }
                other => {
                    let current_hex = current.to_hex();
                    let kind_str = other.as_str();
                    return Err(FractalError::ObjectCodec(format!(
                        "revision object {current_hex} is a {kind_str}, but a bundle ref must name a commit"
                    )));
                }
            }
        }
        let commit_oid = commit_oid.ok_or_else(|| {
            let oid_hex = oid.to_hex();
            FractalError::ObjectCodec(format!(
                "annotated tag chain starting at {oid_hex} exceeds {PEEL_LIMIT} links"
            ))
        })?;
        if !excluded.contains(&commit_oid) && visited.insert(commit_oid) {
            commit_queue.push_back(commit_oid);
        }
    }

    while let Some(current) = commit_queue.pop_front() {
        let object = view.object(&current)?;
        let record = parse_commit_record(current, &object.payload)?;
        items.push(pack_item(current, ObjectKind::Commit, object.payload, 0));
        add_tree_closure(view, record.tree, &excluded, &mut visited, &mut items)?;
        for parent in record.parents {
            if !excluded.contains(&parent) && visited.insert(parent) {
                commit_queue.push_back(parent);
            }
        }
    }

    Ok(items)
}

/// Collects the complete object closure of the prerequisite commits.
fn collect_excluded_objects(view: &RepoView, prerequisites: &[Oid]) -> FractalResult<HashSet<Oid>> {
    let mut excluded: HashSet<Oid> = HashSet::new();
    let mut queue: VecDeque<Oid> = prerequisites.iter().copied().collect();
    while let Some(current) = queue.pop_front() {
        if !excluded.insert(current) {
            continue;
        }
        let object = view.object(&current)?;
        if object.kind != ObjectKind::Commit {
            continue;
        }
        let record = parse_commit_record(current, &object.payload)?;
        add_tree_oids(view, record.tree, &mut excluded)?;
        for parent in record.parents {
            queue.push_back(parent);
        }
    }
    Ok(excluded)
}

/// Inserts a tree and every object below it into `oids`.
fn add_tree_oids(view: &RepoView, root: Oid, oids: &mut HashSet<Oid>) -> FractalResult<()> {
    let mut stack = vec![root];
    while let Some(tree_oid) = stack.pop() {
        if !oids.insert(tree_oid) {
            continue;
        }
        let object = view.object(&tree_oid)?;
        if object.kind != ObjectKind::Tree {
            let tree_hex = tree_oid.to_hex();
            let kind_str = object.kind.as_str();
            return Err(FractalError::ObjectCodec(format!(
                "object {tree_hex} is a {kind_str}, not a tree"
            )));
        }
        for entry in GitTreeRef::from_bytes(&object.payload).iter() {
            let entry = entry?;
            if entry.mode.is_tree() {
                stack.push(entry.oid);
            } else if entry.mode.has_blob() {
                oids.insert(entry.oid);
            }
        }
    }
    Ok(())
}

/// Adds one tree's object closure to the bundle, skipping objects the receiver already has.
fn add_tree_closure(
    view: &RepoView,
    root: Oid,
    excluded: &HashSet<Oid>,
    visited: &mut HashSet<Oid>,
    items: &mut Vec<PackDeltaItem>,
) -> FractalResult<()> {
    let mut stack = vec![root];
    // Hoisted out of the walk so descending into a tree does not allocate a fresh child list on
    // every iteration; the buffer is reused and cleared instead.
    let mut children: Vec<(FileMode, Oid, String)> = Vec::new();
    while let Some(tree_oid) = stack.pop() {
        if excluded.contains(&tree_oid) || !visited.insert(tree_oid) {
            continue;
        }
        let object = view.object(&tree_oid)?;
        if object.kind != ObjectKind::Tree {
            let tree_hex = tree_oid.to_hex();
            let kind_str = object.kind.as_str();
            return Err(FractalError::ObjectCodec(format!(
                "object {tree_hex} is a {kind_str}, not a tree"
            )));
        }
        children.clear();
        for entry in GitTreeRef::from_bytes(&object.payload).iter() {
            let entry = entry?;
            if entry.mode.is_tree() || entry.mode.has_blob() {
                children.push((entry.mode, entry.oid, entry.name.to_string()));
            }
        }
        for (mode, child_oid, name) in children.drain(..) {
            if mode.is_tree() {
                stack.push(child_oid);
                continue;
            }
            if excluded.contains(&child_oid) || !visited.insert(child_oid) {
                continue;
            }
            let payload = view.blob_payload(&child_oid)?;
            items.push(pack_item(
                child_oid,
                ObjectKind::Blob,
                payload,
                compute_basename_hash(&name),
            ));
        }
        items.push(pack_item(tree_oid, ObjectKind::Tree, object.payload, 0));
    }
    Ok(())
}

/// Reads the target object id out of an annotated tag payload.
fn tag_target_oid(payload: &[u8]) -> FractalResult<Oid> {
    let text = std::str::from_utf8(payload)
        .map_err(|err| FractalError::ObjectCodec(format!("tag payload is not UTF-8: {err}")))?;
    for line in text.lines() {
        if line.is_empty() {
            break;
        }
        if let Some(value) = line.strip_prefix("object ") {
            return Oid::from_hex(value.trim());
        }
    }
    Err(FractalError::ObjectCodec(
        "tag payload has no 'object' header".to_string(),
    ))
}

/// Builds one pack input item for the delta-chain planner.
fn pack_item(oid: Oid, kind: ObjectKind, payload: Vec<u8>, basename_hash: u32) -> PackDeltaItem {
    PackDeltaItem {
        oid,
        kind,
        payload,
        basename_hash,
    }
}
