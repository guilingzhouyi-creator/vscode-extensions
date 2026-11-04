//! Module: taxis_cmd::read — Native Read Commands
//! File Path: src/bin/taxis_cmd/read.rs
//! Architecture Role: The object-level inspection commands — `cat-file`, `ls-tree`, `ls-files`,
//!   `show-ref`, `for-each-ref`, and `check-ignore` — implemented against the native object router
//!   and index reader.
//! Dependencies & Triggers: Dispatched from `taxis.rs` for every one of those subcommands.
//! Responsibilities: Argument parsing per command, byte-exact output in the `-z` forms, and JSON
//!   rendering under `--json`.
//! Exit Semantics & Design Rationale:
//!   - No command here invokes a child process. These six used to reach `git` through the generic
//!     passthrough, which made them work only on machines with Git installed and made every failure
//!     report Git's message rather than the repository's actual state.
//!   - `check-ignore` exits 1 when no path matches, and 0 when at least one does. That is Git's
//!     contract, and scripts depend on it; returning 0 with empty output would tell a caller that a
//!     build artifact is ignored when it is about to be committed.
//!   - `-z` output uses NUL terminators and no quoting. The human-readable form quotes paths with
//!     special characters, and a caller that asked for `-z` cannot parse the quoted form.
//!   - `cat-file -p` prints the payload; `-t` prints only the type. `-s` is accepted because it is
//!     the natural companion, and it is cheap once the object is in hand.

use fg_core::error::FractalResult;
use fg_core::models::{ObjectKind, Oid};
use fg_index::IgnoreMatcher;
use fg_object::GitTreeRef;
use fractal_git::constants::cli::CliTag;

use std::path::Path;

use super::common::{fail_fatal, fail_usage, print_json, reject, CliContext, EXIT_REJECTED};
pub use super::read_cat_file::handle_cat_file;
use super::read_cat_file::{object_kind_of, well_formed_object_name};
use super::repo_view::RepoView;
use super::tree_view::write_record;

/// The format `for-each-ref` uses when no `--format` is given.
///
/// Git's built-in default is `%(objectname) %(objecttype)\t%(refname)`: the id, a space, the type,
/// then a TAB before the name. Printing `<id> <name>` instead drops the type column and shifts the
/// separator, so every line differs from Git's even though both list the same references.
const DEFAULT_FOR_EACH_REF_FORMAT: &str = "%(objectname) %(objecttype)\t%(refname)";

/// Parsed CLI options for `ls-tree`.
struct LsTreeOptions {
    visibility: TreeVisibility,
    explicit_trees: bool,
    name_only: bool,
    nul_terminated: bool,
    revision: Option<String>,
    paths: Vec<String>,
}

/// Parses command-line flags and pathspecs for `ls-tree`.
fn parse_ls_tree_options(args: &[String]) -> LsTreeOptions {
    let mut recursive = false;
    let mut trees_only = false;
    let mut include_trees = false;
    let mut name_only = false;
    let mut nul_terminated = false;
    let mut revision: Option<String> = None;
    let mut paths: Vec<String> = Vec::new();

    for argument in args {
        match argument.as_str() {
            "-r" => recursive = true,
            "-t" => include_trees = true,
            "-d" => trees_only = true,
            "-z" => nul_terminated = true,
            "--full-tree" => {}
            "--name-only" | "--name-status" => name_only = true,
            other if other.starts_with('-') => reject(
                CliTag::ERROR,
                format!("ls-tree does not support the flag '{other}'"),
            ),
            other => {
                if revision.is_none() {
                    revision = Some(other.to_string());
                } else {
                    paths.push(other.to_string());
                }
            }
        }
    }

    LsTreeOptions {
        visibility: TreeVisibility {
            recursive,
            trees_only,
            include_trees: include_trees || trees_only || !recursive,
        },
        explicit_trees: include_trees,
        name_only,
        nul_terminated,
        revision,
        paths,
    }
}

/// Dispatches `ls-tree`.
///
/// Supports `-r` (recurse), `-t` (print subtrees), `-d` (print only subtrees), `-z`, `--full-tree`,
/// `--name-only`, and a trailing path filter.
pub fn handle_ls_tree(ctx: &CliContext) {
    let view = RepoView::open_or_exit(ctx);
    let opts = parse_ls_tree_options(&ctx.args);

    let Some(revision) = opts.revision else {
        fail_usage("taxis ls-tree [<options>] <tree-ish> [<path>...]");
    };
    let (_, tree_oid) = match view.resolve_tree(&revision) {
        Ok(pair) => pair,
        Err(_) => ls_tree_target_failure(&view, &revision),
    };

    let mut rows: Vec<TreeRow> = Vec::new();
    if opts.paths.is_empty() {
        if let Err(walk_err) = collect_tree_rows(&view, (&tree_oid, "", opts.visibility), &mut rows)
        {
            reject(CliTag::ERROR, walk_err);
        }
    } else {
        for spec in &opts.paths {
            if let Err(walk_err) = collect_path_rows(
                &view,
                (&tree_oid, spec, opts.visibility, opts.explicit_trees),
                &mut rows,
            ) {
                reject(CliTag::ERROR, walk_err);
            }
        }
        rows.sort_by_cached_key(tree_order_key);
        rows.dedup_by(|left, right| left.path == right.path);
    }

    if ctx.json_mode {
        let rendered: Vec<serde_json::Value> = rows
            .iter()
            .map(|row| {
                serde_json::json!({
                    "mode": format!("{:06o}", row.mode),
                    "type": row.kind.as_str(),
                    "oid": row.oid.to_hex(),
                    "path": row.path,
                })
            })
            .collect();
        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "ls-tree",
            "revision": revision,
            "entry_count": rendered.len(),
            "entries": rendered,
        });
        print_json(&payload);
        return;
    }

    let mut sink = std::io::stdout();
    for row in &rows {
        let line = if opts.name_only {
            row.path.clone()
        } else {
            format!(
                "{:06o} {} {}\t{}",
                row.mode,
                row.kind.as_str(),
                row.oid.to_hex(),
                row.path
            )
        };
        let _ = write_record(&mut sink, &line, opts.nul_terminated);
    }
}

/// Terminates the way Git does when an `ls-tree` tree-ish does not produce a tree.
///
/// Git separates two failures that a single error value would merge: a name it cannot turn into an
/// object at all is reported as "Not a valid object name" (128), while a name it can resolve to a
/// blob, a tag of a blob, or an absent well-formed id is reported as "not a tree object" (128).
/// Scripts assert on the status, but the distinction is what tells a typo from a wrong argument
/// kind, so both are reproduced here.
fn ls_tree_target_failure(view: &RepoView, revision: &str) -> ! {
    if well_formed_object_name(revision) || view.resolve_object_spec(revision).is_ok() {
        fail_fatal("not a tree object");
    }
    fail_fatal(format!("Not a valid object name {revision}"))
}

/// One `ls-tree` output row.
struct TreeRow {
    mode: u32,
    kind: ObjectKind,
    oid: Oid,
    path: String,
}

/// Which entries an `ls-tree` invocation prints.
///
/// The three flags do not form a single toggle, so they are carried as three independent facts
/// instead of one boolean: recursion decides whether a subtree is descended into at all, `-d`
/// removes blobs from the listing, and a non-recursive listing always shows the trees it stopped at
/// (`include_trees`). Collapsing them into `show_trees: bool` is what made `-t` a no-op and made the
/// default form hide every directory.
#[derive(Debug, Clone, Copy)]
struct TreeVisibility {
    /// Whether to descend into subtrees.
    recursive: bool,
    /// Whether blobs are excluded, which `-d` requests.
    trees_only: bool,
    /// Whether a tree row is printed when one is reached.
    include_trees: bool,
}

impl TreeVisibility {
    /// Reports whether a row for `kind` belongs in the output.
    fn shows(&self, kind: ObjectKind) -> bool {
        match kind {
            ObjectKind::Tree => self.include_trees,
            _ => !self.trees_only,
        }
    }
}

/// Collects every row a whole-tree listing prints, in Git's canonical order.
fn collect_tree_rows(
    view: &RepoView,
    tree_prefix_vis: (&Oid, &str, TreeVisibility),
    rows: &mut Vec<TreeRow>,
) -> FractalResult<()> {
    let (tree_oid, prefix, visibility) = tree_prefix_vis;
    let object = view.object(tree_oid)?;
    for entry in GitTreeRef::from_bytes(&object.payload).iter() {
        let entry = entry?;
        let path = if prefix.is_empty() {
            entry.name.to_string()
        } else {
            format!("{prefix}/{}", entry.name)
        };
        let kind = object_kind_of(entry.mode);
        if kind == ObjectKind::Tree {
            if visibility.shows(kind) {
                rows.push(TreeRow {
                    mode: entry.mode.to_u32(),
                    kind,
                    oid: entry.oid,
                    path: path.clone(),
                });
            }
            if visibility.recursive {
                collect_tree_rows(view, (&entry.oid, &path, visibility), rows)?;
            }
            continue;
        }
        if !visibility.shows(kind) {
            continue;
        }
        rows.push(TreeRow {
            mode: entry.mode.to_u32(),
            kind,
            oid: entry.oid,
            path,
        });
    }
    Ok(())
}

/// Resolves one `ls-tree` path argument and collects the rows it selects.
fn collect_path_rows(
    view: &RepoView,
    query: (&Oid, &str, TreeVisibility, bool),
    rows: &mut Vec<TreeRow>,
) -> FractalResult<()> {
    let (root_oid, spec, visibility, explicit_trees) = query;
    let lists_contents = spec.ends_with('/');
    let trimmed = spec.trim_end_matches('/');
    let segments: Vec<&str> = trimmed
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.is_empty() {
        return Ok(());
    }
    let mut current = *root_oid;
    let mut path = String::new();
    let mut leaf: Option<(u32, ObjectKind, Oid)> = None;
    for (index, segment) in segments.iter().enumerate() {
        let object = view.object(&current)?;
        let Some(entry) = GitTreeRef::from_bytes(&object.payload).find_entry(segment)? else {
            return Ok(());
        };
        if index == 0 {
            path = entry.name.to_string();
        } else {
            path.push('/');
            path.push_str(entry.name);
        }
        let kind = object_kind_of(entry.mode);
        if index + 1 == segments.len() {
            leaf = Some((entry.mode.to_u32(), kind, entry.oid));
            break;
        }
        if kind != ObjectKind::Tree {
            return Ok(());
        }
        current = entry.oid;
    }
    let Some((mode, kind, oid)) = leaf else {
        return Ok(());
    };
    if lists_contents {
        if kind != ObjectKind::Tree {
            return Ok(());
        }
        if explicit_trees {
            rows.push(TreeRow {
                mode,
                kind,
                oid,
                path: path.clone(),
            });
        }
        collect_tree_rows(view, (&oid, &path, visibility), rows)?;
        return Ok(());
    }
    if visibility.shows(kind) {
        rows.push(TreeRow {
            mode,
            kind,
            oid,
            path: path.clone(),
        });
    }
    if kind == ObjectKind::Tree && visibility.recursive {
        collect_tree_rows(view, (&oid, &path, visibility), rows)?;
    }
    Ok(())
}

/// Builds the byte key Git sorts tree entries by.
fn tree_order_key(row: &TreeRow) -> Vec<u8> {
    let mut key = row.path.as_bytes().to_vec();
    if row.kind == ObjectKind::Tree {
        key.push(b'/');
    }
    key
}

/// Dispatches `ls-files`.
///
/// Supports `-s` (mode, id, stage), `-z`, `-c` (cached, the default), and `--stage`. The worktree-side
/// Dispatches `ls-files` via the dedicated `ls_files` handler module.
pub fn handle_ls_files(ctx: &CliContext) {
    super::list_files::handle_ls_files(ctx);
}

/// Dispatches `show-ref` and `for-each-ref`.
///
/// Both read the reference store directly. `show-ref` prints `<oid> <refname>`; `for-each-ref`
/// defaults to Git's `%(objectname) %(objecttype)\t%(refname)` and honours an explicit `--format`
/// with the `%(...)` placeholders and a `--sort` key.
pub fn handle_show_ref(ctx: &CliContext) {
    run_show_ref(ctx, false)
}

/// Dispatches `for-each-ref`, which differs from `show-ref` only in its default line format.
pub fn handle_for_each_ref(ctx: &CliContext) {
    run_show_ref(ctx, true)
}

/// Parsed options for `show-ref` and `for-each-ref`.
struct ShowRefOptions<'a> {
    format: Option<String>,
    patterns: Vec<String>,
    verify_only: bool,
    include_head: bool,
    namespace: Option<&'a str>,
}

/// Parses command-line options for `show-ref` / `for-each-ref`.
fn parse_show_ref_options(args: &[String], is_for_each_ref: bool) -> ShowRefOptions<'static> {
    let mut format: Option<String> = None;
    let mut patterns: Vec<String> = Vec::new();
    let mut verify_only = false;
    let mut include_head = false;
    let mut namespace: Option<&'static str> = None;

    for argument in args {
        if let Some(value) = argument.strip_prefix("--format=") {
            format = Some(value.to_string());
            continue;
        }
        match argument.as_str() {
            "--verify" => verify_only = true,
            "--head" if !is_for_each_ref => include_head = true,
            "--heads" | "--branches" => namespace = Some("refs/heads/"),
            "--tags" => namespace = Some("refs/tags/"),
            "--" => {}
            other if other.starts_with('-') => reject_unknown_ref_option(other, is_for_each_ref),
            other => {
                if format.is_none() && other.starts_with("%(") {
                    format = Some(other.to_string());
                } else {
                    patterns.push(other.to_string());
                }
            }
        }
    }
    if is_for_each_ref && format.is_none() {
        format = Some(DEFAULT_FOR_EACH_REF_FORMAT.to_string());
    }
    ShowRefOptions {
        format,
        patterns,
        verify_only,
        include_head,
        namespace,
    }
}

/// Shared body of the two reference-listing commands.
fn run_show_ref(ctx: &CliContext, is_for_each_ref: bool) {
    let view = RepoView::open_or_exit(ctx);
    let opts = parse_show_ref_options(&ctx.args, is_for_each_ref);

    let mut refs: Vec<(String, Oid)> = match view_references(&view, &opts.patterns) {
        Ok(listed) => listed,
        Err(list_err) => reject(CliTag::ERROR, list_err),
    };
    if let Some(prefix) = opts.namespace {
        refs.retain(|(name, _)| name.starts_with(prefix));
    }
    refs.sort_by(|left, right| left.0.cmp(&right.0));

    if opts.verify_only {
        refs = verify_exact_refs(&view, &refs, &opts.patterns);
    }
    if opts.include_head {
        match view.head_commit() {
            Ok(Some(head_oid)) => {
                if !refs.iter().any(|(name, _)| name == "HEAD") {
                    refs.insert(0, ("HEAD".to_string(), head_oid));
                }
            }
            Ok(None) => {}
            Err(head_err) => fail_fatal(head_err),
        }
    }
    if !opts.verify_only && !is_for_each_ref && refs.is_empty() && !ctx.json_mode {
        std::process::exit(EXIT_REJECTED);
    }

    if ctx.json_mode {
        let rendered: Vec<serde_json::Value> = refs
            .iter()
            .map(|(name, oid)| {
                serde_json::json!({
                    "ref": name,
                    "oid": oid.to_hex(),
                })
            })
            .collect();
        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "show-ref",
            "ref_count": rendered.len(),
            "refs": rendered,
        });
        print_json(&payload);
        return;
    }

    for (name, oid) in &refs {
        match opts.format.as_deref() {
            Some(template) => {
                let object_type = view
                    .object(oid)
                    .map(|object| object.kind.as_str().to_string())
                    .unwrap_or_else(|_| "missing".to_string());
                match render_ref_format(template, (name, oid, &object_type)) {
                    Ok(rendered) => println!("{rendered}"),
                    Err(render_err) => reject(CliTag::ERROR, render_err),
                }
            }
            None => println!("{} {}", oid.to_hex(), name),
        }
    }
}

/// Lists references, optionally filtered by one or more patterns.
///
/// Git matches a pattern against the full reference name and against its tail, which is why
/// `show-ref main` finds `refs/heads/main`. Several patterns are a union, not an intersection; a
/// caller that passes both `main` and a tag name expects both rows.
fn view_references(view: &RepoView, patterns: &[String]) -> FractalResult<Vec<(String, Oid)>> {
    let store = fg_topology::DiskRefStore::new(view.git_dir());
    let mut listed = store.list_all()?;
    if !patterns.is_empty() {
        listed.retain(|(name, _)| {
            patterns
                .iter()
                .any(|pattern| reference_matches(name, pattern))
        });
    }
    Ok(listed)
}

/// Reports whether `name` matches one `show-ref` pattern.
fn reference_matches(name: &str, pattern: &str) -> bool {
    pattern.is_empty() || name == pattern || name.ends_with(&format!("/{pattern}"))
}

/// Restricts a listing to the references named exactly.
///
/// show-ref --verify matches no patterns: the argument must be the full reference name. Git exits
/// 128 with "not a valid ref" otherwise, and callers rely on that to tell a typo from an absent
/// reference, so a prefix match here would report success for a name that does not exist. HEAD is
/// accepted as a pseudo-reference and resolves through the current branch.
fn verify_exact_refs(
    view: &RepoView,
    refs: &[(String, Oid)],
    patterns: &[String],
) -> Vec<(String, Oid)> {
    if patterns.is_empty() {
        // Git treats a bare `--verify` as a fatal usage error (128), not a command-line shape error
        // (129); scripts distinguish the two when they assert on status alone.
        fail_fatal("--verify requires a reference");
    }
    let mut verified = Vec::with_capacity(patterns.len());
    for pattern in patterns {
        if pattern == "HEAD" {
            match view.head_commit() {
                Ok(Some(head_oid)) => verified.push(("HEAD".to_string(), head_oid)),
                Ok(None) => fail_fatal("'HEAD' - not a valid ref"),
                Err(head_err) => fail_fatal(head_err),
            }
            continue;
        }
        match refs.iter().find(|(name, _)| name == pattern) {
            Some(found) => verified.push(found.clone()),
            None => fail_fatal(format!("'{pattern}' - not a valid ref")),
        }
    }
    verified
}

/// Rejects an option the reference listing does not implement.
///
/// Git exits 129 with its usage text. Ignoring the option would print a listing that looks complete
/// while dropping the restriction the caller asked for.
fn reject_unknown_ref_option(option: &str, is_for_each_ref: bool) -> ! {
    eprintln!("error: unknown option `{}`", option.trim_start_matches('-'));
    if is_for_each_ref {
        fail_usage("taxis for-each-ref [--format=<format>] [<pattern>...]")
    } else {
        fail_usage("taxis show-ref [--head] [--heads] [--tags] [--] [<pattern>...]")
    }
}

/// Substitutes the `%(...)` placeholders `for-each-ref` supports.
///
/// # Errors
///
/// Returns the name of the first unknown placeholder. Git exits 128 with `unknown field name`; an
/// empty substitution would instead print a blank column that looks like missing data, and the
/// caller would have no way to tell a typo from a repository that lacks the field.
fn render_ref_format(template: &str, ref_data: (&str, &Oid, &str)) -> Result<String, String> {
    let mut rendered = String::with_capacity(template.len() + 48);
    let mut cursor = 0usize;
    while let Some(start) = template[cursor..].find("%(") {
        let start = cursor + start;
        rendered.push_str(&template[cursor..start]);
        let Some(end) = template[start..].find(')') else {
            rendered.push_str(&template[start..]);
            return Ok(rendered);
        };
        let key = &template[start + 2..start + end];
        rendered.push_str(&resolve_ref_field(key, ref_data)?);
        cursor = start + end + 1;
    }
    rendered.push_str(&template[cursor..]);
    Ok(rendered)
}

/// Resolves one `%(...)` field.
fn resolve_ref_field(key: &str, ref_data: (&str, &Oid, &str)) -> Result<String, String> {
    let (name, oid, object_type) = ref_data;
    let value = match key {
        "refname" => name.to_string(),
        "refname:short" => name
            .strip_prefix("refs/heads/")
            .or_else(|| name.strip_prefix("refs/tags/"))
            .or_else(|| name.strip_prefix("refs/remotes/"))
            .unwrap_or(name)
            .to_string(),
        "objectname" => oid.to_hex(),
        "objectname:short" => oid.to_hex().chars().take(7).collect(),
        "objecttype" => object_type.to_string(),
        other => {
            return Err(format!(
                "unknown field name: {other}; supported: %(refname) %(refname:short) \
                 %(objectname) %(objectname:short) %(objecttype)"
            ))
        }
    };
    Ok(value)
}

/// Dispatches `check-ignore`.
///
/// Reads paths from arguments or from `--stdin`. With `-v`, prints the deciding rule as
/// `<source>:<line>:<pattern>\t<path>`, using the pattern text exactly as the file wrote it.
///
/// A path matched only by a negation is reported when `--no-index` or `-v` is in effect and the
/// rule re-includes the path. That is Git's behaviour and it is the behaviour that answers the
/// question a caller actually asks: "which rule decides this path", not "is this path excluded".
pub fn handle_check_ignore(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };
    let mut verbose = false;
    let mut stdin_mode = false;
    let mut no_index = false;
    let mut paths: Vec<String> = Vec::new();

    for argument in &ctx.args {
        match argument.as_str() {
            "-v" | "--verbose" => verbose = true,
            "--stdin" => stdin_mode = true,
            "--no-index" => no_index = true,
            "-q" | "--quiet" | "-n" | "--non-matching" => {}
            other if other.starts_with('-') => reject(
                CliTag::ERROR,
                format!("check-ignore does not support the flag '{other}'"),
            ),
            other => paths.push(other.to_string()),
        }
    }

    if stdin_mode {
        let mut buffer = String::new();
        if let Err(read_err) = std::io::Read::read_to_string(&mut std::io::stdin(), &mut buffer) {
            reject(CliTag::ERROR, format!("read paths from stdin: {read_err}"));
        }
        for line in buffer.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                paths.push(trimmed.to_string());
            }
        }
    }

    if paths.is_empty() {
        fail_fatal("no path specified");
    }

    let matcher = match view.ignore_matcher() {
        Ok(loaded) => loaded,
        Err(load_err) => reject(CliTag::ERROR, load_err),
    };
    let repo_root = view.work_root().to_path_buf();
    let report_negations = verbose || no_index;

    let mut matches: Vec<(String, Option<fg_index::IgnoreMatch>)> = Vec::new();
    let mut matched_count = 0usize;
    for path in &paths {
        let normalized = path.replace('\\', "/");
        let is_directory = repo_root.join(&normalized).is_dir();
        let decided = matcher.decide(&normalized, is_directory);
        if decided.is_some()
            && (report_negations || decided.as_ref().is_some_and(|hit| hit.ignored))
        {
            matched_count += 1;
        }
        matches.push((normalized, decided));
    }

    if ctx.json_mode {
        report_check_ignore_json(&matcher, &repo_root, (&matches, matched_count));
        if matched_count == 0 {
            std::process::exit(1);
        }
        return;
    }

    for (path, decided) in &matches {
        let Some(hit) = decided.as_ref() else {
            continue;
        };
        if !report_negations && !hit.ignored {
            continue;
        }
        if verbose {
            println!(
                "{}:{}:{}\t{}",
                display_rule_source(&repo_root, &hit.pattern.source),
                hit.pattern.line,
                hit.pattern.raw,
                path
            );
        } else {
            println!("{path}");
        }
    }

    if matched_count == 0 {
        std::process::exit(1);
    }
}

/// Renders a pattern file's path the way Git does: repository-relative with forward slashes.
fn display_rule_source(repo_root: &Path, source: &Path) -> String {
    match source.strip_prefix(repo_root) {
        Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
        Err(_) => source.to_string_lossy().replace('\\', "/"),
    }
}

/// Renders the JSON form of `check-ignore`.
fn report_check_ignore_json(
    matcher: &IgnoreMatcher,
    repo_root: &Path,
    matches_and_count: (&[(String, Option<fg_index::IgnoreMatch>)], usize),
) {
    let (matches, matched_count) = matches_and_count;
    let rendered: Vec<serde_json::Value> = matches
        .iter()
        .map(|(path, decided)| {
            serde_json::json!({
                "path": path,
                "ignored": decided.as_ref().is_some_and(|hit| hit.ignored),
                "source": decided
                    .as_ref()
                    .map(|hit| display_rule_source(repo_root, &hit.pattern.source)),
                "line": decided.as_ref().map(|hit| hit.pattern.line),
                "pattern": decided.as_ref().map(|hit| hit.pattern.raw.clone()),
            })
        })
        .collect();
    let payload = serde_json::json!({
        "engine": "taxis",
        "operation": "check-ignore",
        "matched": matched_count,
        "rule_count": matcher.rule_count(),
        "paths": rendered,
    });
    print_json(&payload);
}

#[cfg(test)]
mod tests {
    use super::{reference_matches, render_ref_format};
    use fg_core::models::Oid;

    /// Renders a format template without opening a repository.
    ///
    /// The object type is supplied as a literal because the renderer only needs it for the
    /// `%(objecttype)` placeholder, and a test that opened a real repository would be an
    /// integration test rather than a unit test of the formatter.
    fn render_ref_format_for_test(template: &str, name: &str, oid: &Oid) -> String {
        render_ref_format(template, (name, oid, "commit")).expect("render")
    }

    #[test]
    fn renders_the_refname_and_objectname_placeholders() {
        let oid = Oid::from_bytes([0xab; 20]);
        let rendered =
            render_ref_format_for_test("%(objectname) %(refname)", "refs/heads/main", &oid);
        assert_eq!(rendered, format!("{} refs/heads/main", oid.to_hex()));
    }

    #[test]
    fn renders_the_short_forms() {
        let oid = Oid::from_bytes([0xab; 20]);
        let rendered = render_ref_format_for_test(
            "%(refname:short)|%(objectname:short)",
            "refs/heads/main",
            &oid,
        );
        assert_eq!(rendered, "main|abababa");
    }

    #[test]
    fn an_unknown_placeholder_is_rejected() {
        // Git exits 128 with "unknown field name"; an empty substitution would print a blank column
        // that a caller cannot distinguish from missing data.
        assert!(
            render_ref_format("%(nonesuch)", ("refs/heads/main", &Oid::ZERO, "commit")).is_err()
        );
    }

    #[test]
    fn recognises_a_reference_by_full_name_or_by_its_tail() {
        assert!(reference_matches("refs/heads/main", "refs/heads/main"));
        // `show-ref main` finds `refs/heads/main`: Git matches the tail of the full name, which is
        // the form a person types, without letting a prefix match a neighbouring branch.
        assert!(reference_matches("refs/heads/main", "main"));
        // Git matches the tail of the full name, so a branch nested under another name still
        // matches: `git show-ref main` lists both refs/heads/main and refs/heads/feature/main.
        assert!(reference_matches("refs/heads/feature/main", "main"));
        assert!(!reference_matches("refs/heads/mainline", "main"));
        assert!(reference_matches("refs/tags/v1.0.0", "v1.0.0"));
    }
}
