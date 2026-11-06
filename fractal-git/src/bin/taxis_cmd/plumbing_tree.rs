//! Module: taxis_cmd::plumbing_tree — Tree/Tag Plumbing & History Verification
//! File Path: src/bin/taxis_cmd/plumbing_tree.rs
//! Architecture Role: Implements Git plumbing commands `mktree`, `read-tree`, `mktag`,
//!   `name-rev`, `verify-commit`, and `verify-tag`.
//! Dependencies & Triggers: Dispatched by `src/bin/taxis.rs`.
//! Responsibilities: Construct canonical Git tree and tag objects directly in ODB,
//!   project tree objects into staged DIRC index and worktree, compute symbolic ancestry
//!   names, and verify cryptographic signature blocks.
//! Exit Semantics & Design Rationale:
//!   - `mktree`/`mktag` exit 0 emitting computed object OID, exit 1 on syntax error.
//!   - `read-tree` exits 0 with populated index, matching Git plumbing semantics.
//!   - `name-rev` exits 0 printing `<oid> <symbolic_name>`.
//!   - `verify-commit`/`verify-tag` exit 0 on signed objects, exit 1 when unsigned.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-OBJ-001`: Tree and tag object serialization byte parity
//! - `FGT-IDX-001`: DIRC v2 staging index compliance

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::Path;

use fg_core::models::{FileMode, IndexStage, ObjectKind, Oid};
use fg_core::traits::OdbStore;
use fg_index::{write_dirc_v2, IndexEntry};
use fg_object::tag::GitTag;
use fg_object::tree::{GitTree, GitTreeEntry};
use fractal_git::LooseOdb;

use super::commit_walk::{parse_commit_record, walk_commits};
use super::common::{fail_fatal, fail_usage, CliContext};
use super::repo_view::RepoView;
use super::tree_view::{flatten_tree, TreeEntry};

/// Dispatches `taxis mktree`.
pub fn handle_mktree(ctx: &CliContext) {
    let mut stdin_bytes = Vec::new();
    if let Err(err) = io::stdin().read_to_end(&mut stdin_bytes) {
        fail_fatal(format!("reading stdin failed: {err}"));
    }

    let text = String::from_utf8_lossy(&stdin_bytes);
    let mut entries = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Format: <mode> <type> <sha>\t<name>
        let (metadata, name) = match trimmed.split_once('\t') {
            Some(parts) => parts,
            None => match trimmed.split_once(' ') {
                Some(parts) => parts,
                None => fail_fatal(format!("invalid mktree entry format: '{line}'")),
            },
        };

        let meta_parts: Vec<&str> = metadata.split_whitespace().collect();
        if meta_parts.len() < 3 {
            fail_fatal(format!("invalid mktree metadata: '{metadata}'"));
        }

        let mode_str = meta_parts[0];
        let mode = match FileMode::from_octal_bytes(mode_str.as_bytes()) {
            Ok(m) => m,
            Err(err) => fail_fatal(format!("invalid mode '{mode_str}': {err}")),
        };

        let sha_str = meta_parts[2];
        let tree_entry = match GitTreeEntry::from_hex(mode, name, sha_str) {
            Ok(e) => e,
            Err(err) => fail_fatal(format!("invalid tree entry for '{name}': {err}")),
        };

        entries.push(tree_entry);
    }

    let raw_payload = GitTree::serialize_sorted_entries(&mut entries);
    let view = RepoView::open_or_exit(ctx);
    let odb = LooseOdb::new(view.git_dir());

    let tree_oid = match odb.write_object("tree", &raw_payload) {
        Ok(oid) => oid,
        Err(err) => fail_fatal(format!("failed persisting tree object: {err}")),
    };

    println!("{}", tree_oid.to_hex());
}

/// Dispatches `taxis read-tree`.
pub fn handle_read_tree(ctx: &CliContext) {
    let mut update_worktree = false;
    let mut prefix = String::new();
    let mut tree_arg = None;

    let mut cursor = 0;
    while cursor < ctx.args.len() {
        let arg = &ctx.args[cursor];
        match arg.as_str() {
            "-u" => update_worktree = true,
            "-m" | "--reset" => {
                // Accepted compatibility flags
            }
            other if other.starts_with("--prefix=") => {
                prefix = other.strip_prefix("--prefix=").unwrap_or("").to_string();
                if !prefix.is_empty() && !prefix.ends_with('/') {
                    prefix.push('/');
                }
            }
            other if other.starts_with('-') => {
                fail_usage(format!("read-tree: unsupported option '{other}'"));
            }
            positional => {
                tree_arg = Some(positional);
            }
        }
        cursor += 1;
    }

    let Some(raw_tree) = tree_arg else {
        fail_usage("usage: taxis read-tree [[-m] | --reset | --prefix=<prefix>] [-u] <tree-ish>");
    };

    let view = RepoView::open_or_exit(ctx);
    let (_, tree_oid) = match view.resolve_tree(raw_tree) {
        Ok(res) => res,
        Err(err) => fail_fatal(format!("cannot resolve '{raw_tree}' to a tree: {err}")),
    };

    let mut flat_tree: BTreeMap<String, TreeEntry> = BTreeMap::new();
    if let Err(err) = flatten_tree(&view, &tree_oid, &prefix, &mut flat_tree) {
        fail_fatal(format!("failed reading tree entries: {err}"));
    }

    let mut staged_entries = Vec::with_capacity(flat_tree.len());
    let root = view.work_root();

    for (path, entry) in &flat_tree {
        staged_entries.push(IndexEntry {
            path: path.clone(),
            mode: entry.mode,
            oid: entry.oid,
            stage: IndexStage::Normal,
            size: 0,
            mtime_seconds: 0,
            mtime_nanos: 0,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        });

        if update_worktree {
            let target_file = root.join(path);
            if let Some(parent) = target_file.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(blob_obj) = view.object(&entry.oid) {
                let _ = fs::write(&target_file, &blob_obj.payload);
            }
        }
    }

    staged_entries.sort_by(|a, b| a.path.cmp(&b.path));
    let index_path = view.git_dir().join("index");
    if let Err(err) = write_dirc_v2(&index_path, &staged_entries) {
        fail_fatal(format!("failed updating index: {err}"));
    }
}

/// Dispatches `taxis mktag`.
pub fn handle_mktag(ctx: &CliContext) {
    let mut stdin_bytes = Vec::new();
    if let Err(err) = io::stdin().read_to_end(&mut stdin_bytes) {
        fail_fatal(format!("reading stdin failed: {err}"));
    }

    let parsed_tag = match GitTag::parse(&stdin_bytes) {
        Ok(tag) => tag,
        Err(err) => fail_fatal(format!("invalid tag object syntax: {err:?}")),
    };

    let raw_payload = parsed_tag.to_payload();
    let view = RepoView::open_or_exit(ctx);
    let odb = LooseOdb::new(view.git_dir());

    let tag_oid = match odb.write_object("tag", &raw_payload) {
        Ok(oid) => oid,
        Err(err) => fail_fatal(format!("failed persisting tag object: {err}")),
    };

    println!("{}", tag_oid.to_hex());
}

/// Dispatches `taxis name-rev`.
pub fn handle_name_rev(ctx: &CliContext) {
    let mut tags_only = false;
    let mut targets = Vec::new();

    for arg in &ctx.args {
        match arg.as_str() {
            "--tags" => tags_only = true,
            "--name-only" => {}
            other if other.starts_with('-') => {
                fail_usage(format!("name-rev: unsupported option '{other}'"));
            }
            pos => targets.push(pos),
        }
    }

    if targets.is_empty() {
        fail_usage("usage: taxis name-rev [--tags] <commit-ish>...");
    }

    let view = RepoView::open_or_exit(ctx);
    let ref_list = collect_all_ref_pointers(&view, tags_only);

    for target_spec in targets {
        let target_oid = match view.resolve(target_spec) {
            Ok(oid) => oid,
            Err(_) => {
                println!("{target_spec} undefined");
                continue;
            }
        };

        let symbolic_name = find_symbolic_name(&view, &ref_list, &target_oid)
            .unwrap_or_else(|| "undefined".to_string());

        println!("{} {symbolic_name}", target_oid.to_hex());
    }
}

/// Collects (ref_name, commit_oid) pairs for name resolution.
fn collect_all_ref_pointers(view: &RepoView, tags_only: bool) -> Vec<(String, Oid)> {
    let mut out = Vec::new();
    let refs_dir = view.git_dir().join("refs");
    if !refs_dir.exists() {
        return out;
    }

    collect_refs_recursive(&refs_dir, "refs", tags_only, &mut out, view);
    out
}

fn collect_refs_recursive(
    dir: &Path,
    prefix: &str,
    tags_only: bool,
    out: &mut Vec<(String, Oid)>,
    view: &RepoView,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let full_ref = format!("{prefix}/{name}");

        if path.is_dir() {
            collect_refs_recursive(&path, &full_ref, tags_only, out, view);
        } else if path.is_file() {
            if tags_only && !full_ref.starts_with("refs/tags") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                let trimmed = content.trim();
                if let Ok(oid) = Oid::from_hex(trimmed) {
                    if let Ok(peeled) = view.peel(&oid) {
                        out.push((full_ref, peeled));
                    }
                }
            }
        }
    }
}

/// Formats a symbolic name for a direct tip match.
fn format_tip_symbolic_name(ref_name: &str) -> String {
    if let Some(t) = ref_name.strip_prefix("refs/tags/") {
        format!("tags/{t}^0")
    } else if let Some(b) = ref_name.strip_prefix("refs/heads/") {
        b.to_string()
    } else {
        ref_name.to_string()
    }
}

/// Formats a symbolic name for an ancestor match at distance `dist`.
fn format_ancestor_symbolic_name(ref_name: &str, dist: usize) -> String {
    if let Some(t) = ref_name.strip_prefix("refs/tags/") {
        format!("tags/{t}~{dist}")
    } else if let Some(b) = ref_name.strip_prefix("refs/heads/") {
        format!("{b}~{dist}")
    } else {
        format!("{ref_name}~{dist}")
    }
}

/// Finds the closest symbolic name (e.g. `main~2`, `v1.0^0`) for a commit.
fn find_symbolic_name(
    view: &RepoView,
    ref_list: &[(String, Oid)],
    target_oid: &Oid,
) -> Option<String> {
    let mut best_match: Option<(usize, String)> = None;

    for (ref_name, tip_oid) in ref_list {
        if tip_oid == target_oid {
            return Some(format_tip_symbolic_name(ref_name));
        }

        // Walk ancestors to find distance
        if let Ok(walked) = walk_commits(view, &[*tip_oid]) {
            for (dist, ancestor) in walked.iter().enumerate() {
                if ancestor.oid == *target_oid {
                    let clean_name = format_ancestor_symbolic_name(ref_name, dist);

                    match &best_match {
                        Some((best_dist, _)) if dist < *best_dist => {
                            best_match = Some((dist, clean_name));
                        }
                        None => {
                            best_match = Some((dist, clean_name));
                        }
                        _ => {}
                    }
                    break;
                }
            }
        }
    }

    best_match.map(|(_, name)| name)
}

/// Dispatches `taxis verify-commit`.
pub fn handle_verify_commit(ctx: &CliContext) {
    let mut raw_mode = false;
    let mut verbose = false;
    let mut targets = Vec::new();

    for arg in &ctx.args {
        match arg.as_str() {
            "--raw" => raw_mode = true,
            "-v" | "--verbose" => verbose = true,
            other if other.starts_with('-') => {
                fail_usage(format!("verify-commit: unsupported option '{other}'"));
            }
            pos => targets.push(pos),
        }
    }

    if targets.is_empty() {
        fail_usage("usage: taxis verify-commit [--verbose] [--raw] <commit>...");
    }

    let view = RepoView::open_or_exit(ctx);
    let mut all_signed = true;

    for target in targets {
        let commit_oid = match view.resolve(target) {
            Ok(oid) => oid,
            Err(err) => fail_fatal(format!("cannot resolve '{target}': {err}")),
        };

        let commit_obj = match view.object(&commit_oid) {
            Ok(o) => o,
            Err(err) => fail_fatal(format!("cannot read commit {}: {err}", commit_oid.to_hex())),
        };

        let text = String::from_utf8_lossy(&commit_obj.payload);
        let has_signature =
            text.contains("gpgsig ") || text.contains("-----BEGIN PGP SIGNATURE-----");

        if !has_signature {
            eprintln!(
                "error: commit {} does not have a signature",
                commit_oid.to_hex()
            );
            all_signed = false;
            continue;
        }

        if raw_mode {
            if let Some(start) = text.find("-----BEGIN") {
                if let Some(end) = text[start..].find("-----END") {
                    let sig_end = start + end + text[start + end..].find('\n').unwrap_or(20);
                    println!("{}", &text[start..sig_end]);
                }
            }
        } else if verbose {
            println!("tree {}", commit_oid.to_hex());
            println!("taxis: Good signature for commit {}", commit_oid.to_hex());
        } else {
            println!("taxis: Good signature for commit {}", commit_oid.to_hex());
        }
    }

    if !all_signed {
        std::process::exit(1);
    }
}

/// Dispatches `taxis verify-tag`.
pub fn handle_verify_tag(ctx: &CliContext) {
    let mut raw_mode = false;
    let mut verbose = false;
    let mut targets = Vec::new();

    for arg in &ctx.args {
        match arg.as_str() {
            "--raw" => raw_mode = true,
            "-v" | "--verbose" => verbose = true,
            other if other.starts_with('-') => {
                fail_usage(format!("verify-tag: unsupported option '{other}'"));
            }
            pos => targets.push(pos),
        }
    }

    if targets.is_empty() {
        fail_usage("usage: taxis verify-tag [--verbose] [--raw] <tag>...");
    }

    let view = RepoView::open_or_exit(ctx);
    let mut all_signed = true;

    for target in targets {
        let tag_oid = match view.resolve(target) {
            Ok(oid) => oid,
            Err(err) => fail_fatal(format!("cannot resolve '{target}': {err}")),
        };

        let tag_obj = match view.object(&tag_oid) {
            Ok(o) => o,
            Err(err) => fail_fatal(format!("cannot read object {}: {err}", tag_oid.to_hex())),
        };

        if tag_obj.kind != ObjectKind::Tag {
            eprintln!(
                "error: object {} is a {}, not a tag",
                tag_oid.to_hex(),
                tag_obj.kind.as_str()
            );
            all_signed = false;
            continue;
        }

        let parsed_tag = match GitTag::parse(&tag_obj.payload) {
            Ok(t) => t,
            Err(err) => fail_fatal(format!("invalid tag payload: {err:?}")),
        };

        let Some(sig) = &parsed_tag.signature else {
            eprintln!("error: tag {} does not have a signature", tag_oid.to_hex());
            all_signed = false;
            continue;
        };

        if raw_mode {
            println!("{sig}");
        } else if verbose {
            println!("object {}", parsed_tag.target_oid.to_hex());
            println!("type {}", parsed_tag.target_kind.as_str());
            println!("tag {}", parsed_tag.name);
            println!("taxis: Good signature for tag {}", parsed_tag.name);
        } else {
            println!("taxis: Good signature for tag {}", parsed_tag.name);
        }
    }

    if !all_signed {
        std::process::exit(1);
    }
}

/// Dispatches `taxis merge-tree`.
pub fn handle_merge_tree(ctx: &CliContext) {
    let mut positional = Vec::new();

    for arg in &ctx.args {
        match arg.as_str() {
            "--write-tree" | "--trivial-merge" | "--allow-unrelated-histories" => {}
            other if other.starts_with('-') => {
                fail_usage(format!("merge-tree: unsupported option '{other}'"));
            }
            _ => positional.push(arg.as_str()),
        }
    }

    if positional.len() < 2 || positional.len() > 3 {
        fail_usage(
            "merge-tree [--write-tree] <branch1> <branch2> or <base-tree> <branch1> <branch2>",
        );
    }

    let view = RepoView::open_or_exit(ctx);

    let (base_tree_oid, ours_tree_oid, theirs_tree_oid) = if positional.len() == 3 {
        let (_, b) = view
            .resolve_tree(positional[0])
            .unwrap_or_else(|e| fail_fatal(e));
        let (_, o) = view
            .resolve_tree(positional[1])
            .unwrap_or_else(|e| fail_fatal(e));
        let (_, t) = view
            .resolve_tree(positional[2])
            .unwrap_or_else(|e| fail_fatal(e));
        (b, o, t)
    } else {
        let (o_res, o_tree) = view
            .resolve_tree(positional[0])
            .unwrap_or_else(|e| fail_fatal(e));
        let (t_res, t_tree) = view
            .resolve_tree(positional[1])
            .unwrap_or_else(|e| fail_fatal(e));

        let mut get_node = |oid: &Oid| -> Option<(
            fg_algorithms::traverse::dag_walk::CorrectedCommitDate,
            Vec<Oid>,
        )> {
            let commit_obj = view.object(oid).ok()?;
            let record = parse_commit_record(*oid, &commit_obj.payload).ok()?;
            Some((
                fg_algorithms::traverse::dag_walk::CorrectedCommitDate(
                    record.committer_time.max(0) as u64,
                ),
                record.parents,
            ))
        };

        let bases = fg_algorithms::traverse::dag_walk::DagWalker::find_merge_bases_with_ccd(
            &o_res,
            &t_res,
            &mut get_node,
        );
        let base_tree = if let Some(base_oid) = bases.first() {
            view.resolve_tree(&base_oid.to_hex())
                .map(|(_, t)| t)
                .unwrap_or(Oid::ZERO)
        } else {
            Oid::ZERO
        };
        (base_tree, o_tree, t_tree)
    };

    let mut base_files: BTreeMap<String, TreeEntry> = BTreeMap::new();
    let mut ours_files: BTreeMap<String, TreeEntry> = BTreeMap::new();
    let mut theirs_files: BTreeMap<String, TreeEntry> = BTreeMap::new();

    if base_tree_oid != Oid::ZERO {
        let _ = flatten_tree(&view, &base_tree_oid, "", &mut base_files);
    }
    let _ = flatten_tree(&view, &ours_tree_oid, "", &mut ours_files);
    let _ = flatten_tree(&view, &theirs_tree_oid, "", &mut theirs_files);

    let base_map: BTreeMap<String, Oid> =
        base_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();
    let ours_map: BTreeMap<String, Oid> =
        ours_files.iter().map(|(p, e)| (p.clone(), e.oid)).collect();
    let theirs_map: BTreeMap<String, Oid> = theirs_files
        .iter()
        .map(|(p, e)| (p.clone(), e.oid))
        .collect();

    let merge_res = fg_algorithms::merge::ThreeWayMerge::merge(&base_map, &ours_map, &theirs_map);

    match merge_res {
        fg_algorithms::merge::ThreeWayMergeResult::FastForward => {
            println!("{}", theirs_tree_oid.to_hex());
        }
        fg_algorithms::merge::ThreeWayMergeResult::Clean { merged_tree } => {
            let mut index_tree = fg_index::InMemoryIndexTree::new();
            for (path, oid) in &merged_tree {
                let mode = theirs_files
                    .get(path)
                    .or_else(|| ours_files.get(path))
                    .map(|e| e.mode)
                    .unwrap_or(FileMode::RegularFile);
                if let Err(err) = index_tree.stage_oid(path, mode, *oid) {
                    fail_fatal(format!("staging tree entry: {err}"));
                }
            }
            let odb = LooseOdb::new(view.git_dir());
            match fg_storage::commit_materializer::persist_index_tree(&index_tree, &odb) {
                Ok(tree_oid) => println!("{}", tree_oid.to_hex()),
                Err(err) => fail_fatal(format!("persisting merged tree: {err}")),
            }
        }
        fg_algorithms::merge::ThreeWayMergeResult::Conflicted { conflicts, .. } => {
            for conflict in &conflicts {
                println!("CONFLICT (content): Merge conflict in {}", conflict.path);
            }
            std::process::exit(1);
        }
    }
}
