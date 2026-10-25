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
use fg_topology::DiskRefStore;
use fractal_git::constants::cli::CliTag;

use super::commit_walk::parse_commit_record;
use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Dispatches `taxis bundle`.
pub fn handle_bundle(ctx: &CliContext) {
    if ctx.args.is_empty() {
        print_bundle_help();
        return;
    }

    let sub = ctx.args[0].as_str();
    let sub_args = &ctx.args[1..];

    match sub {
        "create" => handle_bundle_create(ctx, sub_args),
        "verify" => handle_bundle_verify(ctx, sub_args),
        "list-heads" => handle_bundle_list_heads(ctx, sub_args),
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
           list-heads <file>                     List references contained in a bundle"
    );
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
        } else {
            match view.resolve(rev) {
                Ok(oid) => {
                    let ref_name = match canonical_bundle_ref_name(&view, rev) {
                        Ok(name) => name,
                        Err(err) => reject(
                            CliTag::ERROR,
                            format!("resolve target reference '{rev}': {err}"),
                        ),
                    };
                    positive_refs.push((oid, ref_name));
                }
                Err(err) => reject(
                    CliTag::ERROR,
                    format!("resolve target revision '{rev}': {err}"),
                ),
            }
        }
    }

    if positive_refs.is_empty() {
        reject(CliTag::ERROR, "no positive revisions specified for bundle");
    }

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

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "status": "success",
            "file": target_file.to_string_lossy(),
            "references": positive_refs.iter().map(|(o, r)| serde_json::json!({ "oid": o.to_hex(), "name": r })).collect::<Vec<_>>(),
            "prerequisites": prerequisites.iter().map(|(o, _)| o.to_hex()).collect::<Vec<_>>(),
            "objects_packaged": report.object_count,
            "pack_checksum": report.pack_checksum.to_hex(),
        }));
    } else {
        println!(
            "Created bundle '{}' with {} refs and {} objects (pack checksum {})",
            target_file.display(),
            report.ref_count,
            report.object_count,
            &report.pack_checksum.to_hex()[..8]
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
                    return Err(FractalError::ObjectCodec(format!(
                        "revision object {} is a {}, but a bundle ref must name a commit",
                        current.to_hex(),
                        other.as_str()
                    )));
                }
            }
        }
        let commit_oid = commit_oid.ok_or_else(|| {
            FractalError::ObjectCodec(format!(
                "annotated tag chain starting at {} exceeds {PEEL_LIMIT} links",
                oid.to_hex()
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
            return Err(FractalError::ObjectCodec(format!(
                "object {} is a {}, not a tree",
                tree_oid.to_hex(),
                object.kind.as_str()
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
    while let Some(tree_oid) = stack.pop() {
        if excluded.contains(&tree_oid) || !visited.insert(tree_oid) {
            continue;
        }
        let object = view.object(&tree_oid)?;
        if object.kind != ObjectKind::Tree {
            return Err(FractalError::ObjectCodec(format!(
                "object {} is a {}, not a tree",
                tree_oid.to_hex(),
                object.kind.as_str()
            )));
        }
        let mut children: Vec<(FileMode, Oid, String)> = Vec::new();
        for entry in GitTreeRef::from_bytes(&object.payload).iter() {
            let entry = entry?;
            if entry.mode.is_tree() || entry.mode.has_blob() {
                children.push((entry.mode, entry.oid, entry.name.to_string()));
            }
        }
        for (mode, child_oid, name) in children {
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
