//! Module: taxis_cmd::diff — Native Unified Diff
//! File Path: src/bin/taxis_cmd/diff.rs
//! Architecture Role: Produces `git diff`-shaped unified patches from the native object store and
//!   the worktree, using the Myers engine in `fg-algorithms`.
//! Dependencies & Triggers: Dispatched by `taxis diff`; reads what `status` classifies.
//! Responsibilities: Select the two sides being compared, read their bytes, render `-U<context>`
//!   hunks, and emit the `diff --git` / `---` / `+++` preamble.
//! Exit Semantics & Design Rationale:
//!   - The three comparisons a diff can mean are named explicitly: index against `HEAD` (staged),
//!     worktree against the index (unstaged, the default), and two revisions against each other.
//!     A command that guessed would give a different answer depending on whether the index happened
//!     to be dirty, and the caller could not tell which comparison it received.
//!   - A deleted side is rendered against empty content rather than skipped. Skipping it makes a
//!     deletion invisible in the patch, and a patch that omits deletions cannot be applied.
//!   - Binary content is reported as `Binary files ... differ` instead of being run through the line
//!     diff. Running it produces hunks with no newlines that no patch tool accepts.
//!   - The exit status is 0 whether or not files differ, and becomes 1 only under `--exit-code` or
//!     `--quiet`. Git reserves the status for those two flags so that `diff` can be used for display
//!     without a pager or a hook treating every ordinary edit as a failure; `--quiet` additionally
//!     suppresses the report, which is what makes it usable as a bare predicate.

use std::collections::BTreeMap;
use std::fs;

use fg_algorithms::{detect_renames, BlobRef};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{compute_object_oid, FileMode, IndexStage, ObjectKind};
use fg_index::{AttributeSet, GitIndex};
use fractal_git::constants::cli::CliTag;

use super::checkout::plan_worktree_path;
use super::common::{fail_fatal, reject, CliContext};
use super::diff_render::{report_json, report_text};
use super::repo_view::RepoView;
use super::tree_view::{
    flatten_commit_tree, flatten_tree_for_diff, stat_cache_trusted, SideBlob, TreeEntry,
};

/// Default number of context lines around each hunk.
const DEFAULT_CONTEXT: usize = 3;

/// Sentinel that names an empty tree on either side of a revision comparison.
///
/// A root commit has no parent, so its left side has no tree at all. Passing the well-known empty
/// tree object id would work only when that object happens to be present in the store; a repository
/// created by a minimal writer may never have written it. A sentinel that the comparison resolves to
/// an empty path map needs no object and cannot fail for a missing one.
pub const EMPTY_TREE_MARKER: &str = ":0000000000000000000000000000000000000000";

/// Ceiling on the context any caller may request.
const MAX_CONTEXT: usize = 4096;

/// Which two states the patch compares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffScope {
    /// Worktree against the index.
    Worktree,
    /// Index against the `HEAD` tree.
    Staged,
    /// One revision against the worktree, which is what `diff <commit>` means.
    CommitToWorktree,
    /// One revision against the index, which is what `diff --cached <commit>` means.
    CommitToIndex,
    /// Two revisions against each other.
    Revisions,
}

/// One file's comparison: its two sides, the path and mode each side records, and — when the two
/// sides are the same file under two names — how similar they are.
///
/// The paths are kept per side because a rename makes them differ, and Git labels the `diff --git`
/// line, the `---`/`+++` pair, and the `rename from`/`rename to` lines from the side each belongs to.
/// A single path cannot express that: it would label both sides with the new name and turn a rename
/// into an in-place edit of a file that never existed under the old name.
///
/// The modes are likewise per side, because Git compares them to decide three separate things: which
/// `new file` / `deleted file` / `old mode` lines to print, whether the `index` line carries a mode at
/// all, and whether a pure mode change is itself the whole diff.
pub(crate) struct FileComparison {
    /// Path on the old side. Equal to [`Self::new_path`] unless this pair is a rename.
    pub(crate) old_path: String,
    /// Path on the new side. Equal to [`Self::old_path`] unless this pair is a rename.
    pub(crate) new_path: String,
    pub(crate) old_text: Option<Vec<u8>>,
    pub(crate) new_text: Option<Vec<u8>>,
    pub(crate) old_mode: Option<fg_core::models::FileMode>,
    pub(crate) new_mode: Option<fg_core::models::FileMode>,
    /// Similarity on Git's scale when the pair was matched as a rename; `None` otherwise.
    pub(crate) score: Option<u32>,
}

impl FileComparison {
    /// Returns the single-letter Git status code ('A', 'M', 'D', 'R').
    pub(crate) fn status_code(&self) -> &'static str {
        if self.score.is_some() {
            "R"
        } else if self.old_text.is_none() {
            "A"
        } else if self.new_text.is_none() {
            "D"
        } else {
            "M"
        }
    }

    /// Returns the path a single-path output uses: the new one when the file exists, else the old.
    ///
    /// `--name-only`, `--stat`, and the JSON report name one path per entry, and Git names the
    /// surviving side — a deletion is the only case where that is the old path.
    pub(crate) fn path(&self) -> &str {
        match self.new_text.is_some() {
            true => &self.new_path,
            false => &self.old_path,
        }
    }

    /// Reports whether either side is binary, by Git's definition.
    ///
    /// Git sniffs only the first 8,000 bytes (`FIRST_FEW_BYTES` in `xdiff-interface.c`) for a NUL
    /// and treats everything past that as text regardless. Scanning the whole payload would call a
    /// file binary that Git renders as a patch whenever the NUL happens to sit deeper than 8 KB, and
    /// the two tools would then disagree about the shape of the output for the same file.
    pub(crate) fn is_binary(&self) -> bool {
        const FIRST_FEW_BYTES: usize = 8000;
        [self.old_text.as_deref(), self.new_text.as_deref()]
            .into_iter()
            .flatten()
            .any(|bytes| bytes[..bytes.len().min(FIRST_FEW_BYTES)].contains(&0))
    }

    /// Reports whether the two sides record different modes.
    pub(crate) fn mode_changed(&self) -> bool {
        match (self.old_mode, self.new_mode) {
            (Some(old), Some(new)) => old != new,
            _ => false,
        }
    }

    /// Renders one side as text, using an empty string when the side is absent.
    pub(crate) fn side_text(&self, old: bool) -> String {
        let bytes = if old {
            self.old_text.as_deref()
        } else {
            self.new_text.as_deref()
        };
        match bytes {
            Some(payload) => String::from_utf8_lossy(payload).into_owned(),
            None => String::new(),
        }
    }
}

/// Parses the argument list into a scope, context width, and optional revision pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DiffRequest {
    pub(crate) scope: DiffScope,
    pub(crate) context: usize,
    pub(crate) revisions: Vec<String>,
    pub(crate) pathspecs: Vec<String>,
    pub(crate) nul_terminated: bool,
    pub(crate) name_only: bool,
    pub(crate) name_status: bool,
    pub(crate) stat_only: bool,
    /// Whether patch headers print bare paths instead of the a/ and b/ prefixed forms.
    pub(crate) no_prefix: bool,
    /// Whether a difference should make the process exit with status 1.
    ///
    /// Plain `git diff` prints the patch and exits 0 even when files differ; only `--exit-code`
    /// and `--quiet` turn the difference into a status. Exiting 1 unconditionally makes every
    /// caller that runs `diff` for display — a pager, a hook, a script that captures output —
    /// treat an ordinary edit as a failure.
    pub(crate) exit_code: bool,
    /// Whether to suppress the report entirely; `--quiet` implies it.
    pub(crate) quiet: bool,
}

impl Default for DiffRequest {
    fn default() -> Self {
        Self {
            scope: DiffScope::Worktree,
            context: DEFAULT_CONTEXT,
            revisions: Vec::new(),
            pathspecs: Vec::new(),
            nul_terminated: false,
            name_only: false,
            name_status: false,
            stat_only: false,
            no_prefix: false,
            exit_code: false,
            quiet: false,
        }
    }
}

/// Dispatches `taxis diff`.
pub fn handle_diff(ctx: &CliContext) {
    let request = match parse_request(&ctx.args) {
        Ok(parsed) => parsed,
        Err(reason) => reject(CliTag::ERROR, reason),
    };
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };

    let comparisons = match collect_comparisons(&view, &request) {
        Ok(collected) => collected,
        Err(diff_err) => reject(CliTag::ERROR, diff_err),
    };

    if ctx.json_mode {
        report_json(&view, &request, &comparisons);
    } else if !request.quiet {
        let width = super::abbrev::abbreviation_width(view.approximate_object_count());
        report_text(&request, &comparisons, width);
    }

    if request.exit_code && !comparisons.is_empty() {
        std::process::exit(1);
    }
}

/// Compares two revisions and writes the patch to stdout.
///
/// Exposed so `show` reuses this renderer instead of composing its own. A second renderer would be a
/// second definition of what a patch looks like, and the two would drift on the first change to
/// either.
///
/// # Errors
///
/// Propagates object reads and tree decoding; an unreadable revision stops the comparison rather
/// than producing a patch that silently omits a file.
pub fn run_revision_diff(
    view: &RepoView,
    left: &str,
    right: &str,
    args: &[String],
) -> FractalResult<()> {
    let mut cli_args: Vec<String> = args.to_vec();
    cli_args.push(left.to_string());
    cli_args.push(right.to_string());
    let request = parse_request(&cli_args).map_err(FractalError::ObjectCodec)?;
    let comparisons = collect_comparisons(view, &request)?;
    let width = super::abbrev::abbreviation_width(view.approximate_object_count());
    report_text(&request, &comparisons, width);
    Ok(())
}

/// Parses flags and revisions.
fn parse_request(args: &[String]) -> Result<DiffRequest, String> {
    let (options, pathspecs) = super::path_filter::split_args_at_dashdash(args);
    let mut request = DiffRequest {
        pathspecs,
        ..DiffRequest::default()
    };

    for argument in &options {
        apply_diff_option_token(&mut request, argument)?;
    }

    finalize_diff_scope(&mut request)?;
    Ok(request)
}

/// Applies one option or revision token to [`DiffRequest`].
fn apply_diff_option_token(request: &mut DiffRequest, argument: &str) -> Result<(), String> {
    match argument {
        "--cached" | "--staged" => request.scope = DiffScope::Staged,
        "-z" => request.nul_terminated = true,
        "--name-only" => request.name_only = true,
        "--name-status" => request.name_status = true,
        "--stat" => request.stat_only = true,
        "--exit-code" => request.exit_code = true,
        "--quiet" => {
            request.exit_code = true;
            request.quiet = true;
        }
        "--no-prefix" => request.no_prefix = true,
        "--prefix" => request.no_prefix = false,
        "--no-color" | "--color=never" => {}
        "-U" => request.context = DEFAULT_CONTEXT,
        other => apply_diff_parameterized_or_rev(request, other)?,
    }
    Ok(())
}

/// Applies `-U<n>`, `--unified=<n>`, or records a positional revision argument.
fn apply_diff_parameterized_or_rev(
    request: &mut DiffRequest,
    argument: &str,
) -> Result<(), String> {
    if let Some(rest) = argument.strip_prefix("-U") {
        request.context = parse_context(rest)?;
        return Ok(());
    }
    if let Some(rest) = argument.strip_prefix("--unified=") {
        request.context = parse_context(rest)?;
        return Ok(());
    }
    if argument.starts_with('-') && argument.len() > 1 {
        return Err(format!("diff does not support the flag '{argument}'"));
    }
    request.revisions.push(argument.to_string());
    Ok(())
}

/// Resolves the final [`DiffScope`] once all revisions have been collected.
fn finalize_diff_scope(request: &mut DiffRequest) -> Result<(), String> {
    if request.revisions.len() > 2 {
        return Err(format!(
            "diff accepts at most two revisions, got {}",
            request.revisions.len()
        ));
    }
    if request.revisions.len() == 2 {
        request.scope = DiffScope::Revisions;
    } else if request.revisions.len() == 1 {
        request.scope = match request.scope {
            DiffScope::Staged => DiffScope::CommitToIndex,
            _ => DiffScope::CommitToWorktree,
        };
    }
    Ok(())
}

/// Parses a context width.
fn parse_context(text: &str) -> Result<usize, String> {
    let width: usize = text
        .trim()
        .parse()
        .map_err(|parse_err| format!("'-U{text}' is not a context width: {parse_err}"))?;
    if width > MAX_CONTEXT {
        return Err(format!(
            "context width {width} exceeds the {MAX_CONTEXT} ceiling"
        ));
    }
    Ok(width)
}

/// Gathers the files the request compares.
///
/// Every scope is the same operation on two snapshots, so all five go through [`compare_snapshots`].
/// Spelling them out separately is what let `diff <commit>` compare two trees instead of a tree and
/// the worktree, and the difference was invisible until a repository had a staged deletion whose file
/// was still on disk.
///
/// # Errors
///
/// Propagates object reads, worktree I/O, and revision resolution.
pub(crate) fn collect_comparisons(
    view: &RepoView,
    request: &DiffRequest,
) -> FractalResult<Vec<FileComparison>> {
    let index = match view.index()? {
        Some(loaded) => loaded,
        None => empty_index()?,
    };
    let attributes = view.attributes()?;
    let index_map = index_object_map(&index);
    let revision = request.revisions.first().map(String::as_str);
    let (old, new) = match request.scope {
        DiffScope::Worktree => (
            Snapshot::objects(view, index_map),
            worktree_snapshot(view, &index, &attributes)?,
        ),
        DiffScope::Staged => (head_snapshot(view)?, Snapshot::objects(view, index_map)),
        DiffScope::CommitToWorktree => (
            Snapshot::objects(view, resolve_tree_map(view, revision.unwrap_or("HEAD"))?),
            worktree_snapshot(view, &index, &attributes)?,
        ),
        DiffScope::CommitToIndex => (
            Snapshot::objects(view, resolve_tree_map(view, revision.unwrap_or("HEAD"))?),
            Snapshot::objects(view, index_map),
        ),
        DiffScope::Revisions => {
            let left = request
                .revisions
                .first()
                .map(String::as_str)
                .unwrap_or("HEAD");
            let right = request
                .revisions
                .get(1)
                .map(String::as_str)
                .unwrap_or("HEAD");
            (
                Snapshot::objects(view, resolve_tree_map(view, left)?),
                Snapshot::objects(view, resolve_tree_map(view, right)?),
            )
        }
    };
    let mut comparisons = compare_snapshots(&old, &new)?;
    if !request.pathspecs.is_empty() {
        comparisons.retain(|comparison| {
            super::path_filter::matches_any_pathspec(&comparison.new_path, &request.pathspecs)
                || super::path_filter::matches_any_pathspec(
                    &comparison.old_path,
                    &request.pathspecs,
                )
        });
    }
    Ok(comparisons)
}

/// One side of a comparison: the paths it holds, and where their bytes come from.
struct Snapshot<'a> {
    entries: BTreeMap<String, TreeEntry>,
    source: PayloadSource<'a>,
}

/// Where a snapshot's payloads are read from.
#[derive(Clone, Copy)]
enum PayloadSource<'a> {
    /// Objects in the repository store, addressed by the id the entry records.
    Objects(&'a RepoView),
    /// Files in the working tree, addressed by path and converted as Git would store them.
    Worktree {
        view: &'a RepoView,
        attributes: &'a AttributeSet,
    },
}

impl<'a> Snapshot<'a> {
    /// Builds a snapshot over already-resolved tree entries.
    fn objects(view: &'a RepoView, entries: BTreeMap<String, TreeEntry>) -> Self {
        Self {
            entries,
            source: PayloadSource::Objects(view),
        }
    }

    /// Reads the payload one entry contributes.
    ///
    /// The two sources read differently on purpose: an object is addressed by its id, which the
    /// entry already carries, while a worktree file is addressed by its path and has no id until it
    /// is hashed. Sharing one accessor keeps the comparison from having to know which side it holds.
    ///
    /// The worktree side is *converted*, not read raw. Git diffs the normalised bytes, so a `.ps1`
    /// declared `text eol=crlf` whose worktree copy uses CRLF has to render as no change at all when
    /// its content matches; reading raw bytes would render it as a full rewrite of every line.
    ///
    /// # Errors
    ///
    /// Propagates object reads and worktree I/O.
    fn payload(&self, path: &str, entry: &TreeEntry) -> FractalResult<Vec<u8>> {
        match self.source {
            PayloadSource::Objects(view) => view.payload_for(entry.mode, &entry.oid),
            PayloadSource::Worktree { view, attributes } => {
                view.worktree_payload(path, entry.mode, Some(&entry.oid), attributes)
            }
        }
    }
}

/// Builds the `HEAD` snapshot, which is empty for a repository with no commits.
///
/// # Errors
///
/// Propagates reference and object failures.
fn head_snapshot(view: &RepoView) -> FractalResult<Snapshot<'_>> {
    let entries = match view.effective_head_commit()? {
        Some((_, commit)) => flatten_commit_tree(view, &commit)?,
        None => BTreeMap::new(),
    };
    Ok(Snapshot::objects(view, entries))
}

/// Builds a snapshot of the worktree, restricted to the paths the index tracks.
///
/// The restriction is what makes an untracked file invisible to `diff`, which is Git's behaviour: a
/// directory listing would report every scratch file as a new addition. Paths the index records but
/// the filesystem no longer has are dropped, which is how a deletion reaches the comparison.
///
/// The stat cache is consulted before hashing so an unchanged file costs one `stat` rather than a
/// full read, and a file whose only change is its mode keeps the recorded id — matching Git, which
/// reports `MODE_CHANGED` without rehashing.
///
/// # Errors
///
/// Propagates worktree I/O. A file that cannot be read is an error rather than an empty side,
/// because treating it as empty would silently report a content rewrite.
fn worktree_snapshot<'a>(
    view: &'a RepoView,
    index: &GitIndex,
    attributes: &'a AttributeSet,
) -> FractalResult<Snapshot<'a>> {
    let mut entries = BTreeMap::new();
    let index_timestamp = view.index_file_timestamp();
    for staged in index.entries_at_stage(IndexStage::Normal) {
        if staged.mode == FileMode::Gitlink {
            continue;
        }
        let absolute = match plan_worktree_path(view.work_root(), &staged.path) {
            Ok(absolute) => absolute,
            Err(detail) => return Err(FractalError::PolicyViolation(detail)),
        };
        let metadata = match fs::symlink_metadata(&absolute) {
            Ok(found) => found,
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(io_err) => return Err(FractalError::Io(io_err)),
        };
        let mode = match worktree_mode(view, &staged.path, staged.mode)? {
            Some(found) => found,
            None => continue,
        };
        let oid = match stat_cache_trusted(staged, &metadata, index_timestamp) {
            true => staged.oid,
            false => {
                // Hashing goes through the same conversion the comparison renders, so a file whose
                // only difference is line endings keeps the recorded id and drops out of the patch.
                let payload =
                    view.worktree_payload(&staged.path, mode, Some(&staged.oid), attributes)?;
                compute_object_oid(ObjectKind::Blob, &payload)
            }
        };
        entries.insert(staged.path.clone(), TreeEntry { mode, oid });
    }
    Ok(Snapshot {
        entries,
        source: PayloadSource::Worktree { view, attributes },
    })
}

/// Compares two snapshots, pairing deletions with creations as renames where they match.
///
/// The comparison runs in two stages, and the second cannot be folded into the first: a rename is a
/// deletion and a creation that look unrelated until their payloads are compared, so the pairing has
/// to happen after every path is classified but before any patch is rendered. Rendering first would
/// emit a delete patch and a create patch for what is one moved file.
///
/// # Errors
///
/// Propagates payload reads for every path that differs.
fn compare_snapshots(old: &Snapshot<'_>, new: &Snapshot<'_>) -> FractalResult<Vec<FileComparison>> {
    let mut comparisons: Vec<FileComparison> = Vec::new();
    let mut deleted: Vec<SideBlob> = Vec::new();
    let mut created: Vec<SideBlob> = Vec::new();
    let mut paths: Vec<&String> = old.entries.keys().chain(new.entries.keys()).collect();
    paths.sort();
    paths.dedup();

    for path in paths {
        let old_entry = old.entries.get(path);
        let new_entry = new.entries.get(path);
        if old_entry == new_entry {
            continue;
        }
        match (old_entry, new_entry) {
            (Some(entry), None) => deleted.push(SideBlob {
                path: path.clone(),
                entry: *entry,
                payload: old.payload(path, entry)?,
            }),
            (None, Some(entry)) => created.push(SideBlob {
                path: path.clone(),
                entry: *entry,
                payload: new.payload(path, entry)?,
            }),
            (Some(left), Some(right)) => comparisons.push(FileComparison {
                old_path: path.clone(),
                new_path: path.clone(),
                old_text: Some(old.payload(path, left)?),
                new_text: Some(new.payload(path, right)?),
                old_mode: Some(left.mode),
                new_mode: Some(right.mode),
                score: None,
            }),
            (None, None) => {}
        }
    }

    let sources: Vec<BlobRef<'_>> = deleted
        .iter()
        .map(|blob| BlobRef {
            path: &blob.path,
            mode: blob.entry.mode,
            oid: blob.entry.oid,
            payload: &blob.payload,
        })
        .collect();
    let dests: Vec<BlobRef<'_>> = created
        .iter()
        .map(|blob| BlobRef {
            path: &blob.path,
            mode: blob.entry.mode,
            oid: blob.entry.oid,
            payload: &blob.payload,
        })
        .collect();
    let hits = detect_renames(&sources, &dests);

    let mut paired_sources = vec![false; deleted.len()];
    for (dest_index, hit) in hits.iter().enumerate() {
        let hit = match hit {
            Some(found) => found,
            None => continue,
        };
        let source = &deleted[hit.source];
        let dest = &created[dest_index];
        paired_sources[hit.source] = true;
        comparisons.push(FileComparison {
            old_path: source.path.clone(),
            new_path: dest.path.clone(),
            old_text: Some(source.payload.clone()),
            new_text: Some(dest.payload.clone()),
            old_mode: Some(source.entry.mode),
            new_mode: Some(dest.entry.mode),
            score: Some(hit.score),
        });
    }
    for (index, blob) in deleted.into_iter().enumerate() {
        if paired_sources[index] {
            continue;
        }
        comparisons.push(FileComparison {
            old_path: blob.path.clone(),
            new_path: blob.path,
            old_text: Some(blob.payload),
            new_text: None,
            old_mode: Some(blob.entry.mode),
            new_mode: None,
            score: None,
        });
    }
    for (index, blob) in created.into_iter().enumerate() {
        if hits[index].is_some() {
            continue;
        }
        comparisons.push(FileComparison {
            old_path: blob.path.clone(),
            new_path: blob.path,
            old_text: None,
            new_text: Some(blob.payload),
            old_mode: None,
            new_mode: Some(blob.entry.mode),
            score: None,
        });
    }
    // Git lists a comparison by the path it produces, which for a rename is the new one. Sorting by
    // anything else puts a moved file where neither `git diff` nor a reader scanning for a name
    // would look for it.
    comparisons.sort_by(|left, right| left.new_path.cmp(&right.new_path));
    Ok(comparisons)
}

/// Reads the mode the worktree currently reports for `path`, or `None` when the path is gone.
///
/// A path that is gone has no mode, which is what makes a deletion distinguishable from an empty
/// file. The classification itself is [`super::tree_view::worktree_mode`]: `status` and `diff` must
/// agree on whether a file's mode changed, and two implementations would drift on the first
/// `core.filemode` or platform-specific rule either of them learned.
///
/// # Errors
///
/// Returns [`FractalError::PolicyViolation`] for a staged path that escapes the worktree. Reporting
/// it as `None` would render the entry as a deletion, which is exactly the silent skip a path
/// escape relies on to stay unnoticed.
fn worktree_mode(view: &RepoView, path: &str, staged: FileMode) -> FractalResult<Option<FileMode>> {
    let absolute =
        plan_worktree_path(view.work_root(), path).map_err(FractalError::PolicyViolation)?;
    let Ok(metadata) = fs::symlink_metadata(absolute) else {
        return Ok(None);
    };
    Ok(Some(super::tree_view::worktree_mode(
        &metadata,
        staged,
        view.config().trust_executable_bit(),
    )))
}

/// Maps every staged path to the tree entry it records.
fn index_object_map(index: &GitIndex) -> BTreeMap<String, TreeEntry> {
    let mut map = BTreeMap::new();
    for entry in index.entries() {
        map.insert(
            entry.path.clone(),
            TreeEntry {
                mode: entry.mode,
                oid: entry.oid,
            },
        );
    }
    map
}

/// Builds an empty index for a repository whose index file is absent.
///
/// # Errors
///
/// Returns [`FractalError::CorruptStore`] if the empty header cannot be parsed, which would mean the
/// index decoder rejects its own canonical empty form.
fn empty_index() -> FractalResult<GitIndex> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"DIRC");
    bytes.extend_from_slice(&2u32.to_be_bytes());
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.extend_from_slice(&[0u8; 20]);
    GitIndex::parse(bytes, std::path::PathBuf::from("<absent>"))
}

/// Flattens a revision to its path map.
///
/// [`EMPTY_TREE_MARKER`] resolves to an empty map without touching the object store, which is how a
/// root commit gets a left side.
fn resolve_tree_map(view: &RepoView, revision: &str) -> FractalResult<BTreeMap<String, TreeEntry>> {
    if revision == EMPTY_TREE_MARKER {
        return Ok(BTreeMap::new());
    }
    let commit = view.resolve(revision)?;
    let peeled = view.peel(&commit)?;
    let object = view.object(&peeled)?;
    if object.kind == fg_core::models::ObjectKind::Tree {
        let mut flat = BTreeMap::new();
        flatten_tree_for_diff(view, &peeled, "", &mut flat)?;
        return Ok(flat);
    }
    flatten_commit_tree(view, &peeled)
}

/// Computes the abbreviated id of one side: the empty blob for present-but-empty, zeros for absent.
pub(crate) fn object_id_for(payload: Option<&[u8]>) -> String {
    match payload {
        Some(bytes) => compute_object_oid(fg_core::models::ObjectKind::Blob, bytes).to_hex(),
        None => "0".repeat(40),
    }
}

#[cfg(test)]
mod tests {
    use super::{object_id_for, parse_request, DiffScope};

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn the_default_scope_is_the_worktree() {
        let request = parse_request(&[]).expect("parse");
        assert_eq!(request.scope, DiffScope::Worktree);
        assert_eq!(request.context, 3);
    }

    #[test]
    fn the_cached_flag_selects_the_index_against_head() {
        let request = parse_request(&strings(&["--cached"])).expect("parse");
        assert_eq!(request.scope, DiffScope::Staged);
    }

    #[test]
    fn two_revisions_select_the_revision_scope() {
        let request = parse_request(&strings(&["HEAD~1", "HEAD"])).expect("parse");
        assert_eq!(request.scope, DiffScope::Revisions);
        assert_eq!(request.revisions, strings(&["HEAD~1", "HEAD"]));
    }

    #[test]
    fn one_revision_selects_the_commit_to_worktree_scope() {
        // `diff <commit>` compares that commit against the worktree. Treating it as a revision pair
        // would silently drop every uncommitted edit from the patch.
        let request = parse_request(&strings(&["HEAD~1"])).expect("parse");
        assert_eq!(request.scope, DiffScope::CommitToWorktree);
        assert_eq!(request.revisions, strings(&["HEAD~1"]));
    }

    #[test]
    fn one_revision_with_cached_selects_the_commit_to_index_scope() {
        let request = parse_request(&strings(&["--cached", "HEAD~1"])).expect("parse");
        assert_eq!(request.scope, DiffScope::CommitToIndex);
    }

    #[test]
    fn a_lone_cached_flag_stays_relative_to_head() {
        let request = parse_request(&strings(&["--cached"])).expect("parse");
        assert_eq!(request.scope, DiffScope::Staged);
    }

    #[test]
    fn a_context_flag_changes_the_width() {
        let request = parse_request(&strings(&["-U5"])).expect("parse");
        assert_eq!(request.context, 5);
    }

    #[test]
    fn an_unparsable_context_flag_is_rejected() {
        assert!(parse_request(&strings(&["-Uabc"])).is_err());
    }

    #[test]
    fn more_than_two_revisions_is_rejected() {
        assert!(parse_request(&strings(&["a", "b", "c"])).is_err());
    }

    #[test]
    fn an_unknown_flag_is_rejected() {
        assert!(parse_request(&strings(&["--word-diff"])).is_err());
    }

    #[test]
    fn an_absent_side_hashes_to_zeroes() {
        assert_eq!(object_id_for(None), "0".repeat(40));
    }

    #[test]
    fn a_present_empty_side_hashes_the_empty_blob() {
        let empty = object_id_for(Some(b""));
        assert_eq!(
            empty,
            fg_core::models::compute_object_oid(fg_core::models::ObjectKind::Blob, b"").to_hex()
        );
        assert_eq!(empty.len(), 40);
    }
}
