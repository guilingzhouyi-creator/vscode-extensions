//! Module: taxis_cmd::refs — Reference Plumbing and History Commands
//! File Path: src/bin/taxis_cmd/refs.rs
//! Architecture Role: Implements the reference-level commands scripts depend on: writing refs,
//!   reading and setting symbolic refs, comparing commit ancestry, and reading the reflog.
//! Dependencies & Triggers: Dispatched by `taxis update-ref`, `taxis symbolic-ref`,
//!   `taxis merge-base` and `taxis reflog`.
//! Responsibilities: Validate ref names, advance or delete a ref under the ref store's own locking,
//!   resolve symbolic targets, compute merge bases, and project the operation ledger as a reflog.
//! Exit Semantics & Design Rationale:
//!   - `update-ref` refuses a malformed ref name and a dangling target, because both produce a
//!     repository later commands cannot open. Git's wording is matched so existing scripts keep
//!     matching on it.
//!   - `symbolic-ref` on a detached HEAD is an error, not an empty success: the caller asked which
//!     branch HEAD names, and refusing beats printing nothing.
//!   - `merge-base` exits 1 with no output when there is no common ancestor, matching Git, so a
//!     script's `if git merge-base a b` test keeps its meaning.
//!   - `reflog` is projected from the operation ledger instead of a second append-only file. The
//!     ledger already records every branch target and a timestamp per mutation; maintaining a
//!     parallel history would let the two disagree, and that disagreement would surface exactly
//!     when someone is recovering from a mistake.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TOP-001`: DAG topology traversal guard

use std::collections::HashSet;

use fg_core::models::{ObjectKind, Oid};
use fg_topology::DiskRefStore;
use fractal_git::constants::cli::CliTag;
use fractal_git::RefStore;

use super::commit_walk::parse_commit_record;
use super::common::{fail_fatal, fail_usage, reject, CliContext};
use super::repo_view::RepoView;

/// Exit status Git uses when a ref operation finds nothing to report.
const EXIT_NO_MATCH: i32 = 1;

pub use super::reflog::handle_reflog;

/// Prints usage for `taxis update-ref`.
pub fn print_update_ref_help() {
    println!(
        "Usage: taxis update-ref [-d] <ref> [<new-value>] [<old-value>]\n\n\
         Update the object name stored in a reference.\n\n\
         Options:\n\
           -d, --delete        Delete <ref> instead of updating it\n\
           -h, --help          Show this help message"
    );
}

/// Prints usage for `taxis symbolic-ref`.
pub fn print_symbolic_ref_help() {
    println!(
        "Usage: taxis symbolic-ref [-q] [--short] [-d] <name> [<ref>]\n\n\
         Read or set the symbolic reference <name>.\n\n\
         Options:\n\
           -q, --quiet         Suppress the error when <name> is not symbolic\n\
           --short             Format symbolic target as short branch/ref name\n\
           -d, --delete        Delete the symbolic reference\n\
           -h, --help          Show this help message"
    );
}

/// Prints usage for `taxis merge-base`.
pub fn print_merge_base_help() {
    println!(
        "Usage: taxis merge-base [--is-ancestor] <commit> <commit>\n\n\
         Find the best common ancestor of two commits.\n\n\
         Options:\n\
           --is-ancestor       Exit 0 when the first commit is an ancestor of the second\n\
           -h, --help          Show this help message"
    );
}

/// Dispatches `taxis update-ref`.
pub fn handle_update_ref(ctx: &CliContext) {
    let mut delete = false;
    let mut positional: Vec<String> = Vec::new();
    for argument in &ctx.args {
        match argument.as_str() {
            "-h" | "--help" => {
                print_update_ref_help();
                return;
            }
            "-d" | "--delete" => delete = true,
            other if other.starts_with('-') && other.len() > 1 => {
                fail_usage(format!("update-ref: unknown option '{other}'"));
            }
            other => positional.push(other.to_string()),
        }
    }

    let Some(ref_name) = positional.first() else {
        fail_usage("update-ref requires a reference name");
    };
    if let Err(reason) = validate_ref_name(ref_name) {
        fail_fatal(reason);
    }

    let ref_store = DiskRefStore::new(&ctx.git_dir);

    if delete {
        delete_ref(&ref_store, ref_name, positional.get(1));
    }

    let Some(new_value) = positional.get(1) else {
        // With no value Git prints the current one; that is a read, not a no-op, and returning
        // silently would look identical to a successful update.
        print_current_ref(&ref_store, ref_name);
    };

    write_ref(ctx, &ref_store, ref_name, new_value, positional.get(2));
}

/// Deletes a ref, honouring the optional expected-value guard.
fn delete_ref(ref_store: &DiskRefStore, ref_name: &str, expected: Option<&String>) -> ! {
    let previous = match ref_store.get_ref(ref_name) {
        Ok(Some(oid)) => oid,
        Ok(None) => fail_fatal(format!("cannot lock ref '{ref_name}': no such ref")),
        Err(read_err) => fail_fatal(format!("read ref '{ref_name}': {read_err}")),
    };
    // Git's old-value argument is a compare-and-swap guard; honouring it is what makes `update-ref`
    // safe for concurrent agents, so a mismatch must abort rather than delete blindly.
    if let Some(expected_text) = expected {
        assert_expected_value(ref_name, expected_text, Some(previous));
    }
    match ref_store.delete_ref(ref_name) {
        Ok(true) => {
            fg_core::diag_info!("refs", "deleted ref {ref_name} (was {})", previous.to_hex());
            std::process::exit(0)
        }
        Ok(false) => fail_fatal(format!("cannot lock ref '{ref_name}': no such ref")),
        Err(delete_err) => fail_fatal(format!("delete ref '{ref_name}': {delete_err}")),
    }
}

/// Prints the current value of a ref, exiting 1 when it does not exist.
fn print_current_ref(ref_store: &DiskRefStore, ref_name: &str) -> ! {
    match ref_store.get_ref(ref_name) {
        Ok(Some(oid)) => {
            println!("{}", oid.to_hex());
            std::process::exit(0)
        }
        Ok(None) => std::process::exit(EXIT_NO_MATCH),
        Err(read_err) => fail_fatal(format!("read ref '{ref_name}': {read_err}")),
    }
}

/// Resolves the target and advances the ref.
fn write_ref(
    ctx: &CliContext,
    ref_store: &DiskRefStore,
    ref_name: &str,
    new_value: &str,
    expected: Option<&String>,
) -> ! {
    let view = RepoView::open_or_exit(ctx);
    let target = match resolve_any_object(&view, new_value) {
        Ok(oid) => oid,
        Err(resolve_err) => fail_fatal(format!("{new_value}: {resolve_err}")),
    };

    let previous = ref_store.get_ref(ref_name).ok().flatten();
    if let Some(expected_text) = expected {
        assert_expected_value(ref_name, expected_text, previous);
    }

    match ref_store.update_ref(ref_name, &target, previous.as_ref()) {
        Ok(()) => {
            fg_core::diag_info!(
                "refs",
                "updated ref {ref_name}: {} -> {}",
                previous
                    .map(|oid| oid.to_hex())
                    .unwrap_or_else(|| "(none)".to_string()),
                target.to_hex()
            );
            std::process::exit(0)
        }
        Err(update_err) => fail_fatal(format!("update ref '{ref_name}': {update_err}")),
    }
}

/// Parsed options for `taxis symbolic-ref`.
struct SymbolicRefOptions {
    quiet: bool,
    short: bool,
    delete: bool,
    positional: Vec<String>,
}

/// Dispatches `taxis symbolic-ref`.
///
/// Only `HEAD` is supported as a symbolic target. Arbitrary symrefs are representable in the store —
/// the reader already resolves chains — but there is no writer for them, and inventing one here
/// would put a second symref implementation beside the reader that has to agree with it. Refusing
/// by name is honest; a silent write that the resolver ignores would not be.
pub fn handle_symbolic_ref(ctx: &CliContext) {
    let Some(opts) = parse_symbolic_ref_args(&ctx.args) else {
        print_symbolic_ref_help();
        return;
    };

    let Some(name) = opts.positional.first() else {
        fail_usage("symbolic-ref requires a reference name");
    };

    let view = RepoView::open_or_exit(ctx);
    let ref_store = DiskRefStore::new(view.git_dir());

    if opts.delete {
        delete_symbolic_ref(&ref_store, name, opts.quiet);
        return;
    }

    if let Some(target) = opts.positional.get(1) {
        match ref_store.write_symbolic_ref(name, target) {
            Ok(()) => {
                fg_core::diag_info!("refs", "pointed {name} at {target}");
                return;
            }
            Err(set_err) => fail_fatal(format!("set {name}: {set_err}")),
        }
    }

    read_and_print_symbolic_ref(&ref_store, name, (opts.short, opts.quiet));
}

/// Parses command-line options for `taxis symbolic-ref`, returning `None` if `--help` was requested.
fn parse_symbolic_ref_args(args: &[String]) -> Option<SymbolicRefOptions> {
    let mut opts = SymbolicRefOptions {
        quiet: false,
        short: false,
        delete: false,
        positional: Vec::new(),
    };
    let mut cursor = 0;
    while cursor < args.len() {
        match args[cursor].as_str() {
            "-h" | "--help" => return None,
            "-q" | "--quiet" => opts.quiet = true,
            "--short" => opts.short = true,
            "-d" | "--delete" => opts.delete = true,
            "-m" if cursor + 1 < args.len() => cursor += 1,
            other if other.starts_with('-') && other.len() > 1 => {
                fail_usage(format!("symbolic-ref: unknown option '{other}'"));
            }
            other => opts.positional.push(other.to_string()),
        }
        cursor += 1;
    }
    Some(opts)
}

/// Deletes a symbolic reference, honouring `-q`.
fn delete_symbolic_ref(ref_store: &DiskRefStore, name: &str, quiet: bool) {
    match ref_store.delete_ref(name) {
        Ok(true) => {}
        Ok(false) if quiet => {}
        Ok(false) => reject(CliTag::ERROR, format!("fatal: Cannot delete {name}")),
        Err(err) => fail_fatal(format!("delete {name}: {err}")),
    }
}

/// Reads and prints a symbolic reference target.
fn read_and_print_symbolic_ref(ref_store: &DiskRefStore, name: &str, flags: (bool, bool)) {
    let (short, quiet) = flags;
    match ref_store.read_symbolic_ref(name) {
        Ok(Some(target)) => {
            if short {
                let stripped = target
                    .strip_prefix("refs/heads/")
                    .or_else(|| target.strip_prefix("refs/remotes/"))
                    .or_else(|| target.strip_prefix("refs/tags/"))
                    .unwrap_or(&target);
                println!("{stripped}");
            } else {
                println!("{target}");
            }
        }
        Ok(None) if quiet => std::process::exit(EXIT_NO_MATCH),
        Ok(None) => reject(
            CliTag::ERROR,
            format!("fatal: ref {name} is not a symbolic ref"),
        ),
        Err(err) => fail_fatal(format!("read {name}: {err}")),
    }
}

/// Dispatches `taxis merge-base`.
pub fn handle_merge_base(ctx: &CliContext) {
    let mut is_ancestor = false;
    let mut positional: Vec<String> = Vec::new();
    for argument in &ctx.args {
        match argument.as_str() {
            "-h" | "--help" => {
                print_merge_base_help();
                return;
            }
            "--is-ancestor" => is_ancestor = true,
            other if other.starts_with('-') && other.len() > 1 => {
                fail_usage(format!("merge-base: unknown option '{other}'"));
            }
            other => positional.push(other.to_string()),
        }
    }

    if positional.len() < 2 {
        fail_usage("merge-base requires two commits");
    }

    let view = RepoView::open_or_exit(ctx);
    let left = resolve_commit(&view, &positional[0]);
    let right = resolve_commit(&view, &positional[1]);

    if is_ancestor {
        // A predicate reported through the exit status and nothing else. Printing the ref name here
        // would corrupt a shell conditional's intent, because `--is-ancestor` answers a yes/no
        // question and callers only read the status.
        let verdict = ancestor_reachability(&view, &right).contains(&left);
        std::process::exit(if verdict { 0 } else { EXIT_NO_MATCH });
    }

    match best_common_ancestor(&view, &left, &right) {
        Some(base) => println!("{}", base.to_hex()),
        None => std::process::exit(EXIT_NO_MATCH),
    }
}

/// Rejects reference names that cannot be stored or that Git itself forbids.
fn validate_ref_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("invalid ref name: it is empty".to_string());
    }
    if name.starts_with('/') || name.ends_with('/') || name.ends_with('.') {
        return Err(format!(
            "'{name}' is not a valid ref name: it may not start or end with '/' or end with '.'"
        ));
    }
    if name.contains("..") || name.contains("//") || name.contains("@{") {
        return Err(format!(
            "'{name}' is not a valid ref name: it may not contain '..', '//' or '@{{'"
        ));
    }
    if name.chars().any(|character| {
        character.is_control()
            || matches!(character, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\')
    }) {
        return Err(format!(
            "'{name}' is not a valid ref name: it contains a character Git forbids"
        ));
    }
    Ok(())
}

/// Enforces the compare-and-swap guard passed as the old-value argument.
fn assert_expected_value(ref_name: &str, expected_text: &str, actual: Option<Oid>) {
    if expected_text == "0000000000000000000000000000000000000000" {
        // The all-zero sentinel means "must not exist yet", which is how a caller creates a ref
        // atomically without clobbering a concurrent writer.
        if actual.is_some() {
            fail_fatal(format!(
                "cannot lock ref '{ref_name}': reference already exists"
            ));
        }
        return;
    }
    let expected = match Oid::from_hex(expected_text) {
        Ok(oid) => oid,
        Err(parse_err) => fail_fatal(format!("{expected_text}: {parse_err}")),
    };
    if actual != Some(expected) {
        fail_fatal(format!(
            "cannot lock ref '{ref_name}': is at {} but expected {expected_text}",
            actual
                .map(|oid| oid.to_hex())
                .unwrap_or_else(|| "(none)".to_string())
        ));
    }
}

/// Resolves a revision or an object id to any object the repository holds.
fn resolve_any_object(view: &RepoView, spec: &str) -> Result<Oid, String> {
    if let Ok(oid) = Oid::from_hex(spec) {
        if view.object(&oid).is_ok() {
            return Ok(oid);
        }
    }
    view.resolve(spec).map_err(|err| err.to_string())
}

/// Resolves a revision that must name a commit.
fn resolve_commit(view: &RepoView, spec: &str) -> Oid {
    let oid = match resolve_any_object(view, spec) {
        Ok(resolved) => resolved,
        Err(reason) => fail_fatal(format!("{spec}: {reason}")),
    };
    match view.object(&oid) {
        Ok(object) if object.kind == ObjectKind::Commit => oid,
        Ok(_) => fail_fatal(format!("{spec}: not a commit")),
        Err(object_err) => fail_fatal(format!("{spec}: {object_err}")),
    }
}

/// Collects every commit reachable from `tip`, including `tip` itself.
fn ancestor_reachability(view: &RepoView, tip: &Oid) -> HashSet<Oid> {
    let mut seen = HashSet::new();
    let mut stack = vec![*tip];
    while let Some(current) = stack.pop() {
        if !seen.insert(current) {
            continue;
        }
        if let Ok(object) = view.object(&current) {
            if let Ok(record) = parse_commit_record(current, &object.payload) {
                stack.extend(record.parents.iter().copied());
            }
        }
    }
    seen
}

/// Finds the best common ancestor: a common one that no other common ancestor supersedes.
fn best_common_ancestor(view: &RepoView, left: &Oid, right: &Oid) -> Option<Oid> {
    let left_ancestors = ancestor_reachability(view, left);
    let right_ancestors = ancestor_reachability(view, right);
    let mut common: Vec<Oid> = left_ancestors
        .intersection(&right_ancestors)
        .copied()
        .collect();
    if common.is_empty() {
        return None;
    }
    if common.len() == 1 {
        return common.pop();
    }

    // An ancestor that is itself reachable from another common ancestor is not "best": the later one
    // is strictly closer to both tips, which is what `git merge-base` reports.
    let mut best: Vec<Oid> = Vec::new();
    for candidate in &common {
        let dominated = common.iter().any(|other| {
            other != candidate && ancestor_reachability(view, other).contains(candidate)
        });
        if !dominated {
            best.push(*candidate);
        }
    }
    best.sort_unstable_by_key(|oid| oid.to_hex());
    best.into_iter().next()
}
