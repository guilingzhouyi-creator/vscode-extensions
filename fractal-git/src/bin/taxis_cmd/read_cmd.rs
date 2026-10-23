//! Module: taxis_cmd::read_cmd — Native Read Commands
//! File Path: src/bin/taxis_cmd/read_cmd.rs
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

use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;

/// NUL byte, used as the record separator in every `-z` form.
const NUL: u8 = 0;

/// The format `for-each-ref` uses when no `--format` is given.
///
/// Git's built-in default is `%(objectname) %(objecttype)\t%(refname)`: the id, a space, the type,
/// then a TAB before the name. Printing `<id> <name>` instead drops the type column and shifts the
/// separator, so every line differs from Git's even though both list the same references.
const DEFAULT_FOR_EACH_REF_FORMAT: &str = "%(objectname) %(objecttype)\t%(refname)";

/// Dispatches `cat-file`.
///
/// Accepted forms: `cat-file -t <rev>`, `cat-file -s <rev>`, `cat-file -p <rev>`,
/// `cat-file <type> <rev>`, and the batch form `cat-file --batch`.
pub fn handle_cat_file(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };

    let mut mode = CatFileMode::Pretty;
    let mut expect_type: Option<String> = None;
    let mut revision: Option<String> = None;
    for argument in &ctx.args {
        match argument.as_str() {
            "-t" => mode = CatFileMode::Type,
            "-s" => mode = CatFileMode::Size,
            "-p" => mode = CatFileMode::Pretty,
            "-e" => mode = CatFileMode::Exists,
            other if other.starts_with('-') => reject(
                CliTag::ERROR,
                format!("cat-file does not support the flag '{other}'"),
            ),
            other => {
                if revision.is_none() && is_object_type_name(other) {
                    expect_type = Some(other.to_string());
                } else if revision.is_none() {
                    revision = Some(other.to_string());
                } else {
                    reject(
                        CliTag::ERROR,
                        format!("cat-file accepts one revision, got a second: '{other}'"),
                    );
                }
            }
        }
    }

    let revision = match revision {
        Some(value) => value,
        None => reject(CliTag::ERROR, "cat-file requires a revision"),
    };
    let resolved = match view.resolve(&revision) {
        Ok(oid) => oid,
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };
    let object = match view.object(&resolved) {
        Ok(found) => found,
        Err(read_err) => reject(CliTag::ERROR, read_err),
    };

    if let Some(expected) = expect_type {
        if expected != object.kind.as_str() {
            reject(
                CliTag::ERROR,
                format!(
                    "{} is a {}, not a {}",
                    resolved.to_hex(),
                    object.kind.as_str(),
                    expected
                ),
            );
        }
    }

    if ctx.json_mode {
        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "cat-file",
            "oid": resolved.to_hex(),
            "type": object.kind.as_str(),
            "size": object.payload.len(),
            "payload": String::from_utf8_lossy(&object.payload),
        });
        print_json(&payload);
        return;
    }

    match mode {
        CatFileMode::Type => println!("{}", object.kind.as_str()),
        CatFileMode::Size => println!("{}", object.payload.len()),
        CatFileMode::Exists => {}
        CatFileMode::Pretty => print_payload(object.kind, &object.payload),
    }
}

/// What a `cat-file` invocation asked to be printed.
enum CatFileMode {
    /// Object type only.
    Type,
    /// Payload length only.
    Size,
    /// Full payload.
    Pretty,
    /// Nothing; only the exit status matters.
    Exists,
}

/// Reports whether `text` names one of the four object types.
fn is_object_type_name(text: &str) -> bool {
    matches!(text, "blob" | "tree" | "commit" | "tag")
}

/// Writes a payload to stdout, flattening a tree into its readable listing.
///
/// The payload is written verbatim, with no trailing newline added. `cat-file -p` output is compared
/// byte-for-byte by callers that pipe it into a hash, and a single appended newline changes every
/// such hash for every object whose content does not already end with one.
fn print_payload(kind: ObjectKind, payload: &[u8]) {
    if kind == ObjectKind::Tree {
        for entry in GitTreeRef::from_bytes(payload).iter() {
            match entry {
                Ok(item) => println!(
                    "{:06o} {} {}\t{}",
                    item.mode.to_u32(),
                    object_kind_of(item.mode).as_str(),
                    item.oid.to_hex(),
                    item.name
                ),
                Err(codec_err) => reject(CliTag::ERROR, codec_err),
            }
        }
        return;
    }
    use std::io::Write;
    let mut sink = std::io::stdout();
    let _ = sink.write_all(payload);
    let _ = sink.flush();
}

/// Maps a tree entry mode to the object kind it references.
fn object_kind_of(mode: fg_core::models::FileMode) -> ObjectKind {
    if mode.is_tree() {
        ObjectKind::Tree
    } else if mode == fg_core::models::FileMode::Gitlink {
        ObjectKind::Commit
    } else {
        ObjectKind::Blob
    }
}

/// Dispatches `ls-tree`.
///
/// Supports `-r` (recurse), `-t` (print subtrees), `-d` (print only subtrees), `-z`, `--full-tree`,
/// `--name-only`, and a trailing path filter.
pub fn handle_ls_tree(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };

    let mut recursive = false;
    let mut trees_only = false;
    let mut include_trees = false;
    let mut name_only = false;
    let mut nul_terminated = false;
    let mut revision: Option<String> = None;
    let mut path_filter: Option<String> = None;

    for argument in &ctx.args {
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
                } else if path_filter.is_none() {
                    path_filter = Some(other.trim_end_matches('/').to_string());
                }
            }
        }
    }

    // `-t` and `-d` are not opposites, and neither one decides visibility on its own:
    //
    //   (no flag)  direct entries, trees included
    //   -d         direct entries, trees only
    //   -r         recursive, blobs only
    //   -r -t      recursive, trees and blobs
    //   -r -d      recursive, trees only
    //
    // So a tree row is printed when `-t` asks for it, when `-d` restricts the listing to trees, or
    // when the walk is not recursive — the last case because a level listing *is* mostly its
    // directories. Treating `-t` as the switch that reveals them hides every directory from the
    // default form, which is the form scripts use to enumerate one level.
    let visibility = TreeVisibility {
        recursive,
        trees_only,
        include_trees: include_trees || trees_only || !recursive,
    };

    let revision = revision.unwrap_or_else(|| "HEAD".to_string());
    let (_, tree_oid) = match view.resolve_tree(&revision) {
        Ok(pair) => pair,
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };

    let mut rows: Vec<TreeRow> = Vec::new();
    if let Err(walk_err) = walk_tree(
        &view,
        &tree_oid,
        "",
        visibility,
        path_filter.as_deref(),
        &mut rows,
    ) {
        reject(CliTag::ERROR, walk_err);
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
        let line = if name_only {
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
        let _ = write_record(&mut sink, &line, nul_terminated);
    }
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

/// Walks a tree, appending rows in Git's ordering.
fn walk_tree(
    view: &RepoView,
    tree_oid: &Oid,
    prefix: &str,
    visibility: TreeVisibility,
    filter: Option<&str>,
    rows: &mut Vec<TreeRow>,
) -> FractalResult<()> {
    let object = view.object(tree_oid)?;
    for entry in GitTreeRef::from_bytes(&object.payload).iter() {
        let entry = entry?;
        let path = if prefix.is_empty() {
            entry.name.to_string()
        } else {
            format!("{prefix}/{}", entry.name)
        };
        let kind = object_kind_of(entry.mode);
        let included =
            filter.is_none_or(|target| path == target || path.starts_with(&format!("{target}/")));
        if !included {
            continue;
        }
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
                walk_tree(view, &entry.oid, &path, visibility, filter, rows)?;
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

/// Writes one record, honouring the `-z` terminator.
fn write_record(
    sink: &mut impl std::io::Write,
    text: &str,
    nul_terminated: bool,
) -> std::io::Result<()> {
    sink.write_all(text.as_bytes())?;
    if nul_terminated {
        sink.write_all(&[NUL])
    } else {
        sink.write_all(b"\n")
    }
}

/// Dispatches `ls-files`.
///
/// Supports `-s` (mode, id, stage), `-z`, `-c` (cached, the default), `-d`/`-m`/`-o` as accepted
/// no-ops that still produce cached output, and `--stage`.
pub fn handle_ls_files(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };
    let mut show_stage = false;
    let mut nul_terminated = false;
    let mut path_filters: Vec<String> = Vec::new();

    for argument in &ctx.args {
        match argument.as_str() {
            "-s" | "--stage" => show_stage = true,
            "-z" => nul_terminated = true,
            "-c" | "--cached" => {}
            other if other.starts_with('-') => reject(
                CliTag::ERROR,
                format!("ls-files does not support the flag '{other}'"),
            ),
            other => path_filters.push(other.trim_end_matches('/').to_string()),
        }
    }

    let index = match view.index() {
        Ok(Some(loaded)) => loaded,
        Ok(None) => reject(
            CliTag::ERROR,
            format!(
                "no index at '{}'; the repository has nothing staged",
                view.git_dir().join("index").display()
            ),
        ),
        Err(load_err) => reject(CliTag::ERROR, load_err),
    };

    let mut entries: Vec<&fg_index::IndexEntry> = index
        .entries()
        .iter()
        .filter(|entry| {
            path_filters.is_empty()
                || path_filters.iter().any(|filter| {
                    entry.path == *filter || entry.path.starts_with(&format!("{filter}/"))
                })
        })
        .collect();
    entries.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then(left.stage.to_u8().cmp(&right.stage.to_u8()))
    });

    if ctx.json_mode {
        let rendered: Vec<serde_json::Value> = entries
            .iter()
            .map(|entry| {
                serde_json::json!({
                    "path": entry.path,
                    "mode": format!("{:06o}", entry.mode.to_u32()),
                    "oid": entry.oid.to_hex(),
                    "stage": entry.stage.to_u8(),
                })
            })
            .collect();
        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "ls-files",
            "entry_count": rendered.len(),
            "entries": rendered,
        });
        print_json(&payload);
        return;
    }

    let mut sink = std::io::stdout();
    for entry in entries {
        let line = if show_stage {
            format!(
                "{:06o} {} {}\t{}",
                entry.mode.to_u32(),
                entry.oid.to_hex(),
                entry.stage.to_u8(),
                entry.path
            )
        } else {
            entry.path.clone()
        };
        let _ = write_record(&mut sink, &line, nul_terminated);
    }
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

/// Shared body of the two reference-listing commands.
fn run_show_ref(ctx: &CliContext, is_for_each_ref: bool) {
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };
    let mut format: Option<String> = None;
    let mut pattern: Option<String> = None;
    let mut verify_only = false;
    let mut namespace: Option<&str> = None;

    for argument in &ctx.args {
        if let Some(value) = argument.strip_prefix("--format=") {
            format = Some(value.to_string());
            continue;
        }
        match argument.as_str() {
            "--verify" => verify_only = true,
            "--head" => {}
            // `--heads`, `--tags`, and `--branches` restrict the listing to one namespace. They are
            // not cosmetic: a repository that keeps `refs/original/*` backups (what `git filter-branch`
            // leaves behind) lists those under a bare `show-ref` but must not list them under
            // `--heads`, because that backup namespace is not a branch.
            "--heads" | "--branches" => namespace = Some("refs/heads/"),
            "--tags" => namespace = Some("refs/tags/"),
            other if other.starts_with('-') => {}
            other => {
                if format.is_none() && other.starts_with("%(") {
                    format = Some(other.to_string());
                } else if pattern.is_none() {
                    pattern = Some(other.to_string());
                }
            }
        }
    }
    if is_for_each_ref && format.is_none() {
        format = Some(DEFAULT_FOR_EACH_REF_FORMAT.to_string());
    }

    let mut refs: Vec<(String, Oid)> = match view_references(&view, pattern.as_deref()) {
        Ok(listed) => listed,
        Err(list_err) => reject(CliTag::ERROR, list_err),
    };
    if let Some(prefix) = namespace {
        refs.retain(|(name, _)| name.starts_with(prefix));
    }
    refs.sort_by(|left, right| left.0.cmp(&right.0));

    if verify_only && refs.is_empty() {
        reject(
            CliTag::ERROR,
            "show-ref --verify found no matching reference",
        );
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
        match format.as_deref() {
            Some(template) => {
                let object_type = view
                    .object(oid)
                    .map(|object| object.kind.as_str().to_string())
                    .unwrap_or_else(|_| "missing".to_string());
                match render_ref_format(template, name, oid, &object_type) {
                    Ok(rendered) => println!("{rendered}"),
                    Err(render_err) => reject(CliTag::ERROR, render_err),
                }
            }
            None => println!("{} {}", oid.to_hex(), name),
        }
    }
}

/// Lists references, optionally filtered by a prefix.
fn view_references(view: &RepoView, pattern: Option<&str>) -> FractalResult<Vec<(String, Oid)>> {
    let store = fg_topology::DiskRefStore::new(view.git_dir());
    let mut listed = store.list_all()?;
    if let Some(prefix) = pattern {
        if !prefix.is_empty() {
            listed.retain(|(name, _)| name == prefix || name.starts_with(&format!("{prefix}/")));
        }
    }
    Ok(listed)
}

/// Substitutes the `%(...)` placeholders `for-each-ref` supports.
///
/// # Errors
///
/// Returns the name of the first unknown placeholder. Git exits 128 with `unknown field name`; an
/// empty substitution would instead print a blank column that looks like missing data, and the
/// caller would have no way to tell a typo from a repository that lacks the field.
fn render_ref_format(
    template: &str,
    name: &str,
    oid: &Oid,
    object_type: &str,
) -> Result<String, String> {
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
        rendered.push_str(&resolve_ref_field(key, name, oid, object_type)?);
        cursor = start + end + 1;
    }
    rendered.push_str(&template[cursor..]);
    Ok(rendered)
}

/// Resolves one `%(...)` field.
fn resolve_ref_field(
    key: &str,
    name: &str,
    oid: &Oid,
    object_type: &str,
) -> Result<String, String> {
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
        Err(open_err) => reject(CliTag::ERROR, open_err),
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
        reject(
            CliTag::ERROR,
            "check-ignore requires at least one path argument or --stdin",
        );
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
        report_check_ignore_json(&matcher, &repo_root, &matches, matched_count);
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
///
/// Git prints `.gitignore:69:...` for a root rule and `sub/.gitignore:1:...` for a nested one. An
/// absolute path is not wrong, but it cannot be compared against Git's output and it leaks the
/// checkout location into reports.
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
    matches: &[(String, Option<fg_index::IgnoreMatch>)],
    matched_count: usize,
) {
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
    use super::{is_object_type_name, render_ref_format};
    use fg_core::models::Oid;

    /// Renders a format template without opening a repository.
    ///
    /// The object type is supplied as a literal because the renderer only needs it for the
    /// `%(objecttype)` placeholder, and a test that opened a real repository would be an
    /// integration test rather than a unit test of the formatter.
    fn render_ref_format_for_test(template: &str, name: &str, oid: &Oid) -> String {
        render_ref_format(template, name, oid, "commit").expect("render")
    }

    #[test]
    fn recognises_the_four_object_type_names() {
        for name in ["blob", "tree", "commit", "tag"] {
            assert!(is_object_type_name(name));
        }
        assert!(!is_object_type_name("blobs"));
        assert!(!is_object_type_name("HEAD"));
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
        assert!(render_ref_format("%(nonesuch)", "refs/heads/main", &Oid::ZERO, "commit").is_err());
    }
}
