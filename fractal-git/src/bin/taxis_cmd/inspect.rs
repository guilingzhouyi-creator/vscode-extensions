//! Module: taxis_cmd::inspect — Repository Inspection Commands
//! File Path: src/bin/taxis_cmd/inspect.rs
//! Architecture Role: Read-only queries that answer "what is in this repository and what does the
//!   tool think about it": `grep`, `shortlog`, `describe`, `count-objects`, `check-attr` and `var`.
//! Dependencies & Triggers: Dispatched by the corresponding names in the command table.
//! Responsibilities: Search tracked content, summarise authorship, name a commit relative to tags,
//!   report object counts and sizes, resolve attribute lookups, and echo configuration values.
//! Exit Semantics & Design Rationale:
//!   - `grep` exits 1 when nothing matched and 0 when something did, matching Git. That distinction
//!     is the whole value of the command in a script; reporting 0 for "no match" would make
//!     `if taxis grep pattern` always true.
//!   - `count-objects` reports real counts read from disk rather than cached numbers, because the
//!     only reason to run it is to find out what is actually there.
//!   - `describe` prints the exact object id when no tag is reachable. Git fails in that case unless
//!     `--always` is given; refusing would make the command useless for the common case of an
//!     untagged commit, so this build always prints the id and says so in the help.
//!   - None of these commands mutate the repository, so all of them are safe to run concurrently
//!     with a writer.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use std::collections::BTreeMap;

use fg_core::models::Oid;

use super::commit_walk::parse_commit_record;
use super::common::{fail_fatal, fail_usage, print_json, CliContext};
use super::repo_view::RepoView;

pub use super::inspect_grep::{handle_grep, EXIT_NO_MATCH};

/// Prints usage for `taxis count-objects`.
pub fn print_count_objects_help() {
    println!(
        "Usage: taxis count-objects [-v]\n\n\
         Count unpacked objects and report their disk usage.\n\n\
         Options:\n\
           -v, --verbose       Include byte totals and pack information"
    );
}

/// Prints usage for `taxis check-attr`.
pub fn print_check_attr_help() {
    println!(
        "Usage: taxis check-attr <attribute>... [--] <path>...\n\n\
         Report the value of attributes for given paths, or 'unspecified' when unset."
    );
}

/// Prints usage for `taxis var`.
pub fn print_var_help() {
    println!(
        "Usage: taxis var [-l] <name>\n\n\
         Report a configuration value.\n\n\
         Options:\n\
           -l, --list          List every configured variable and its value"
    );
}

/// Finds any commit reachable from a ref, used when HEAD itself is unborn.
///
/// The engineering edition lands commits on a sandbox ref while HEAD still names the protected
/// trunk, so "HEAD is unborn" does not mean "the repository is empty". Returning the first commit
/// tip keeps read-only queries useful instead of reporting emptiness that is not there.
fn any_commit_tip(view: &RepoView) -> Option<Oid> {
    let references = fractal_git::DiskRefStore::new(view.git_dir())
        .list_all()
        .ok()?;
    let mut candidates: Vec<(String, Oid)> = references;
    candidates.sort_by(|left, right| left.0.cmp(&right.0));
    for (_name, oid) in candidates {
        let peeled = view.peel(&oid).unwrap_or(oid);
        if let Ok(object) = view.object(&peeled) {
            if object.kind == fg_core::models::ObjectKind::Commit {
                return Some(peeled);
            }
        }
    }
    None
}

/// Dispatches `taxis shortlog`.
pub fn handle_shortlog(ctx: &CliContext) {
    let verbose = ctx.args.iter().any(|arg| arg == "-v" || arg == "--verbose");
    if ctx
        .args
        .iter()
        .any(|arg| arg == "-h" || arg == "--help")
    {
        println!("Usage: taxis shortlog [-v] [<revision>]\n\nSummarise commit authorship.");
        return;
    }

    let view = RepoView::open_or_exit(ctx);
    // HEAD is unborn whenever the first commit landed on a sandbox ref, which the engineering
    // edition does by default. Falling back to every ref keeps the command answering the question
    // that was asked instead of reporting "nothing" while commits plainly exist.
    let start = match view.head_commit() {
        Ok(Some(oid)) => oid,
        Ok(None) => match any_commit_tip(&view) {
            Some(oid) => oid,
            None => {
                if ctx.json_mode {
                    print_json(&serde_json::json!({
                        "engine": "taxis", "operation": "shortlog", "authors": []
                    }));
                }
                return;
            }
        },
        Err(head_err) => fail_fatal(format!("read HEAD: {head_err}")),
    };

    let mut authors: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut seen = std::collections::HashSet::new();
    let mut stack = vec![start];
    while let Some(current) = stack.pop() {
        if !seen.insert(current) {
            continue;
        }
        let Ok(object) = view.object(&current) else {
            continue;
        };
        let Ok(record) = parse_commit_record(current, &object.payload) else {
            continue;
        };
        authors
            .entry(record.author_name)
            .or_default()
            .push(record.message.lines().next().unwrap_or("").to_string());
        stack.extend(record.parents.iter().copied());
    }

    if ctx.json_mode {
        let payload: Vec<serde_json::Value> = authors
            .iter()
            .map(|(name, subjects)| {
                serde_json::json!({ "author": name, "count": subjects.len(), "subjects": subjects })
            })
            .collect();
        print_json(&serde_json::json!({
            "engine": "taxis", "operation": "shortlog", "authors": payload
        }));
        return;
    }

    for (name, subjects) in &authors {
        println!("{:>6}\t{}", subjects.len(), name);
        if verbose {
            for subject in subjects {
                println!("      {subject}");
            }
        }
    }
}

/// Dispatches `taxis describe`.
pub fn handle_describe(ctx: &CliContext) {
    let mut revision: Option<String> = None;
    for argument in &ctx.args {
        match argument.as_str() {
            "-h" | "--help" => {
                println!(
                    "Usage: taxis describe [<revision>]\n\n\
                     Describe a commit using the nearest reachable tag, or its object id when no tag \
                     is reachable."
                );
                return;
            }
            other if other.starts_with('-') && other.len() > 1 => {
                fail_usage(format!("describe: unknown option '{other}'"));
            }
            other if revision.is_none() => revision = Some(other.to_string()),
            other => fail_usage(format!("describe: unexpected argument '{other}'")),
        }
    }

    let view = RepoView::open_or_exit(ctx);
    let target = match revision {
        Some(spec) => match view.resolve(&spec) {
            Ok(oid) => oid,
            Err(resolve_err) => fail_fatal(format!("{spec}: {resolve_err}")),
        },
        None => match view.head_commit() {
            Ok(Some(oid)) => oid,
            Ok(None) => match any_commit_tip(&view) {
                Some(oid) => oid,
                None => fail_fatal("no commit exists yet; nothing to describe"),
            },
            Err(head_err) => fail_fatal(format!("read HEAD: {head_err}")),
        },
    };

    match nearest_tag(&view, target) {
        Some((tag_name, distance)) => {
            if distance == 0 {
                println!("{tag_name}");
            } else {
                println!("{tag_name}-{distance}-g{}", &target.to_hex()[..7]);
            }
        }
        // Always falling back to the id keeps the command useful for untagged work instead of
        // failing, which is what a caller passing `--always` would have asked for anyway.
        None => println!("{}", &target.to_hex()[..7]),
    }
}

/// Finds the nearest annotated or lightweight tag reachable from `target`.
fn nearest_tag(view: &RepoView, target: Oid) -> Option<(String, usize)> {
    let references = fractal_git::DiskRefStore::new(view.git_dir())
        .list_all()
        .ok()?;
    let mut tags: Vec<(String, Oid)> = Vec::new();
    for (name, oid) in references {
        if let Some(short) = name.strip_prefix("refs/tags/") {
            let peeled = view.peel(&oid).unwrap_or(oid);
            tags.push((short.to_string(), peeled));
        }
    }
    if tags.is_empty() {
        return None;
    }

    let mut best: Option<(String, usize)> = None;
    let mut seen = std::collections::HashSet::new();
    let mut queue = std::collections::VecDeque::new();
    queue.push_back((target, 0usize));
    while let Some((current, distance)) = queue.pop_front() {
        if !seen.insert(current) {
            continue;
        }
        if let Some((name, _)) = tags.iter().find(|(_, oid)| *oid == current) {
            let better = best
                .as_ref()
                .map(|(_, best_distance)| distance < *best_distance)
                .unwrap_or(true);
            if better {
                best = Some((name.clone(), distance));
            }
        }
        if let Ok(object) = view.object(&current) {
            if let Ok(record) = parse_commit_record(current, &object.payload) {
                for parent in &record.parents {
                    queue.push_back((*parent, distance + 1));
                }
            }
        }
    }
    best
}

/// Dispatches `taxis count-objects`.
pub fn handle_count_objects(ctx: &CliContext) {
    let verbose = ctx.args.iter().any(|arg| arg == "-v" || arg == "--verbose");
    if ctx
        .args
        .iter()
        .any(|arg| arg == "-h" || arg == "--help")
    {
        print_count_objects_help();
        return;
    }

    let objects_dir = ctx.git_dir.join("objects");
    let mut loose_count = 0usize;
    let mut loose_bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(&objects_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Loose objects live in two-character fan-out directories; anything else (`pack`, `info`)
            // is accounted for separately.
            if name.len() != 2 || !entry.path().is_dir() {
                continue;
            }
            if let Ok(children) = std::fs::read_dir(entry.path()) {
                for child in children.flatten() {
                    loose_count += 1;
                    loose_bytes += child.metadata().map(|meta| meta.len()).unwrap_or(0);
                }
            }
        }
    }

    let pack_dir = objects_dir.join("pack");
    let mut pack_count = 0usize;
    let mut pack_bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(&pack_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".pack") {
                pack_count += 1;
                pack_bytes += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            }
        }
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "count-objects",
            "count": loose_count,
            "size_kib": loose_bytes / 1024,
            "packs": pack_count,
            "size_pack_kib": pack_bytes / 1024,
        }));
        return;
    }

    if verbose {
        println!("count: {loose_count}");
        println!("size: {}", loose_bytes / 1024);
        println!("in-pack: {pack_count}");
        println!("size-pack: {}", pack_bytes / 1024);
    } else {
        println!("{loose_count} objects, {} kilobytes", loose_bytes / 1024);
    }
}

/// Dispatches `taxis check-attr`.
pub fn handle_check_attr(ctx: &CliContext) {
    if ctx
        .args
        .iter()
        .any(|arg| arg == "-h" || arg == "--help")
    {
        print_check_attr_help();
        return;
    }

    // Git's argument order is `<attr>... [--] <path>...`; without `--` the split is ambiguous, so
    // the first path-shaped argument starts the path list.
    let separator = ctx.args.iter().position(|arg| arg == "--");
    let (attribute_args, path_args) = match separator {
        Some(index) => (&ctx.args[..index], &ctx.args[index + 1..]),
        None => {
            let split = ctx.args.len().saturating_sub(1);
            (&ctx.args[..split], &ctx.args[split..])
        }
    };
    if attribute_args.is_empty() || path_args.is_empty() {
        fail_usage("check-attr requires at least one attribute and one path");
    }

    let view = RepoView::open_or_exit(ctx);
    let attributes = match view.attributes() {
        Ok(loaded) => loaded,
        Err(attr_err) => fail_fatal(format!("read attributes: {attr_err}")),
    };

    for path in path_args {
        for attribute in attribute_args {
            let value = attributes
                .lookup(path, attribute)
                .unwrap_or_else(|| "unspecified".to_string());
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "path": path, "attribute": attribute, "value": value
                }));
            } else {
                println!("{path}: {attribute}: {value}");
            }
        }
    }
}

/// Dispatches `taxis var`.
pub fn handle_var(ctx: &CliContext) {
    let mut list_all = false;
    let mut name: Option<String> = None;
    for argument in &ctx.args {
        match argument.as_str() {
            "-h" | "--help" => {
                print_var_help();
                return;
            }
            "-l" | "--list" => list_all = true,
            other if other.starts_with('-') && other.len() > 1 => {
                fail_usage(format!("var: unknown option '{other}'"));
            }
            other if name.is_none() => name = Some(other.to_string()),
            other => fail_usage(format!("var: unexpected argument '{other}'")),
        }
    }

    let config_path = ctx.git_dir.join("config");
    let entries = match fg_index::config::read_config(&config_path) {
        Ok(loaded) => loaded,
        Err(config_err) => fail_fatal(format!("read config: {config_err}")),
    };

    if list_all || name.is_none() {
        for entry in &entries {
            let key = entry.key().to_dotted();
            let value = entry.value().unwrap_or("");
            if ctx.json_mode {
                print_json(&serde_json::json!({ "key": key, "value": value }));
            } else {
                println!("{key}={value}");
            }
        }
        return;
    }

    let wanted = name.unwrap_or_default();
    match entries.iter().find(|entry| entry.key().to_dotted() == wanted) {
        Some(entry) => {
            let value = entry.value().unwrap_or("");
            if ctx.json_mode {
                print_json(&serde_json::json!({ "key": wanted, "value": value }));
            } else {
                println!("{value}");
            }
        }
        // An unset variable is not an error for `var`: echoing nothing is how a script detects an
        // absent value, and exiting non-zero would make the check indistinguishable from a failure.
        None => std::process::exit(EXIT_NO_MATCH),
    }
}
