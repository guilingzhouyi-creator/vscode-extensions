//! Module: taxis_cmd::log — Native `log` and `show`
//! File Path: src/bin/taxis_cmd/log.rs
//! Architecture Role: Renders commit history and single-commit inspection from the native object
//!   store, replacing the former `git log` subprocess.
//! Dependencies & Triggers: Dispatched by `taxis log` / `taxis show`; consumes `commit_walk` for the
//!   DAG and `diff` for the per-commit patch.
//! Responsibilities: History ordering, `--oneline` / `-<n>` / `--format` rendering, date formatting
//!   in the recorded timezone, and `show`'s header + patch composition.
//! Exit Semantics & Design Rationale:
//!   - History order is the walk order, not author time. A rebase rewrites author times and a merge
//!     can carry a parent newer than its child, so sorting by time produces an order no other Git
//!     tool agrees with.
//!   - Dates are rendered in the offset recorded in the commit, not in the local zone. The offset is
//!     part of the commit's bytes; rendering in a different zone makes two runs of the same command
//!     on two machines disagree about immutable data.
//!   - `--format` supports the placeholders that carry information a caller cannot derive
//!     otherwise. An unknown placeholder is an error rather than an empty string: silently printing
//!     nothing turns a typo into a column of blanks.
//!   - `show` without a patch flag prints the patch, because that is what the command means. A
//!     `--stat` request prints the summary instead; printing both would double-count the change.

use std::collections::HashSet;
use std::io::Write;

use fg_core::error::FractalResult;
use fg_core::models::{HorizonSpan, ObjectKind, Oid, ProjectionScope};
use fg_topology::DiskRefStore;
use fractal_git::constants::cli::CliTag;

use super::commit_walk::{walk_commits, walk_commits_within, CommitRecord, CommitWalk, WalkLimit};
use super::common::{fail_fatal, reject, CliContext};
use super::log_render::*;
use super::repo_view::RepoView;

/// Default number of commits `log` shows when no limit is given.
///
/// Git's default is unbounded, but an unbounded history walk over a large repository is what makes
/// an interactive command appear to hang. The limit is documented in `--help` and `--all` lifts it.
const DEFAULT_LOG_LIMIT: usize = 50;

/// Exit status Git uses when a revision or path matches nothing.
///
/// `log` exits with this rather than with the generic rejection status so that a caller distinguishing
/// "the revision does not exist" from "the flag is wrong" sees the same number Git would produce.
const EXIT_NO_MATCH: i32 = 128;

/// Which part of `show` to print.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShowPart {
    /// Header plus unified patch.
    Patch,
    /// Header plus `--stat` summary.
    Stat,
    /// Header only.
    HeaderOnly,
}

/// Dispatches `taxis log`.
pub fn handle_log(ctx: &CliContext) {
    let mut request = match LogRequest::parse(&ctx.args) {
        Ok(parsed) => parsed,
        Err(reason) => reject(CliTag::ERROR, reason),
    };
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };

    disambiguate_revision_pathspec(&view, &mut request);
    let Some(records) = load_log_records(ctx, &view, &request) else {
        return;
    };
    // The horizon is applied to the record set the walk produced. A depth horizon is pushed into
    // the walk itself (see `load_log_records`), so this call only handles the time-based case and
    // guards the depth case against a walk that could not honour the limit.
    let records = apply_horizon(records, request.horizon);
    let filtered_records = filter_log_records(&view, records, &request);
    let shown = &filtered_records[..filtered_records.len().min(request.limit)];

    if ctx.json_mode {
        report_log_json(shown, &request);
        if let Some(scope) = request.projection.as_ref() {
            report_slice_json(&view, shown, scope);
        }
        return;
    }
    render_log_entries(&view, shown, &request);
    if let Some(scope) = request.projection.as_ref() {
        render_slice_summary(&view, shown, scope);
    }
}

/// Applies a declared horizon to an already-loaded record set.
///
/// The walk loads a limited window with the newest commits first, so a depth horizon is a prefix of
/// that order. This is deliberately *not* a reachability claim: the dropped records still exist in
/// the repository. What changes is only what this invocation was asked to look at, and the caller
/// is told so by the summary line rather than being left to assume the history ended.
fn apply_horizon(records: Vec<CommitRecord>, horizon: HorizonSpan) -> Vec<CommitRecord> {
    match horizon {
        HorizonSpan::Full => records,
        HorizonSpan::Depth(depth) => records.into_iter().take(depth as usize).collect(),
        HorizonSpan::Recent { seconds } => {
            let Some(newest) = records.first().map(|record| record.committer_time) else {
                return records;
            };
            let cutoff = newest.saturating_sub(seconds as i64);
            records
                .into_iter()
                .take_while(|record| record.committer_time >= cutoff)
                .collect()
        }
    }
}

/// Prints the per-commit slice verdicts as JSON when `--scope` was given.
fn report_slice_json(view: &RepoView, records: &[CommitRecord], scope: &ProjectionScope) {
    let report = super::log_projection::classify_records(view, records, scope);
    for (record, verdict) in records.iter().zip(report.verdicts.iter()) {
        println!(
            "{{\"commit\":\"{}\",\"slice\":\"{}\",\"verdict\":\"{}\"}}",
            record.oid.to_hex(),
            scope.tier.as_str(),
            match verdict {
                super::log_projection::SliceVerdict::Visible => "visible",
                super::log_projection::SliceVerdict::OutsideScope => "outside-scope",
            }
        );
    }
}

/// Prints the slice summary below the rendered history.
fn render_slice_summary(view: &RepoView, records: &[CommitRecord], scope: &ProjectionScope) {
    let report = super::log_projection::classify_records(view, records, scope);
    println!();
    println!("{}", report.summary(scope));
    for (record, verdict) in records.iter().zip(report.verdicts.iter()) {
        if *verdict == super::log_projection::SliceVerdict::OutsideScope {
            println!(
                "  {} is present but outside this slice",
                &record.oid.to_hex()[..12]
            );
        }
    }
}

fn disambiguate_revision_pathspec(view: &RepoView, request: &mut LogRequest) {
    if request.revision_explicit
        && !request.revision.contains("..")
        && view.resolve(&request.revision).is_err()
        && view.work_root().join(&request.revision).exists()
    {
        let path_candidate = request.revision.clone();
        request.pathspecs.push(path_candidate);
        request.revision = "HEAD".to_string();
        request.revision_explicit = false;
    }
}

fn load_log_records(
    ctx: &CliContext,
    view: &RepoView,
    request: &LogRequest,
) -> Option<Vec<CommitRecord>> {
    // A depth horizon becomes a read budget, so the walk stops instead of finishing and discarding.
    // The `--max-count` limit participates for the same reason: both ask for a prefix, and reading
    // past a prefix is work whose result nobody sees.
    let limit = read_budget(request);
    if request.all {
        return load_all_log_records(ctx, view, request, limit);
    }
    if request.revision.contains("..") {
        return load_range_log_records(view, &request.revision);
    }
    if !request.revision_explicit && matches!(view.head_commit(), Ok(None)) {
        return Some(load_unborn_fallback_records(ctx, view, limit));
    }
    Some(load_single_revision_records(view, &request.revision, limit))
}

/// Translates the request's horizon and count limit into one read budget.
///
/// Takes the tighter of the two: `--horizon 10 -n 5` asks for the newer five, and reading ten to
/// print five is the cost this function exists to remove. A `Recent` horizon cannot be expressed as
/// a count — the boundary depends on timestamps that are only known after reading — so it stays
/// unbounded here and is trimmed afterwards.
fn read_budget(request: &LogRequest) -> WalkLimit {
    let by_horizon = match request.horizon {
        HorizonSpan::Depth(depth) => Some(depth as usize),
        HorizonSpan::Full | HorizonSpan::Recent { .. } => None,
    };
    let by_count = if request.limit == usize::MAX {
        None
    } else {
        Some(request.limit)
    };
    match (by_horizon, by_count) {
        (Some(a), Some(b)) => WalkLimit::MaxCommits(a.min(b)),
        (Some(a), None) => WalkLimit::MaxCommits(a),
        (None, Some(b)) => WalkLimit::MaxCommits(b),
        (None, None) => WalkLimit::Unbounded,
    }
}

fn load_all_log_records(
    ctx: &CliContext,
    view: &RepoView,
    request: &LogRequest,
    limit: WalkLimit,
) -> Option<Vec<CommitRecord>> {
    let starts = match collect_all_starts(view) {
        Ok(starts) => starts,
        Err(collect_err) => reject(CliTag::ERROR, collect_err),
    };
    if starts.is_empty() {
        if ctx.json_mode {
            report_log_json(&[], request);
        }
        return None;
    }
    match walk_commits_within(view, &starts, limit) {
        Ok(walked) => Some(apply_walk_truncation(walked)),
        Err(walk_err) => reject(CliTag::ERROR, walk_err),
    }
}

/// Turns a bounded walk into the record list the renderer consumes, reporting a truncated read.
///
/// A walk that stopped early is a prefix of the history. Saying so matters more than the count: a
/// reader who is not told will take the shorter list for the whole answer.
fn apply_walk_truncation(walked: CommitWalk) -> Vec<CommitRecord> {
    if walked.truncated {
        eprintln!(
            "note: stopped after {} commits because of the requested limit; older history not read",
            walked.records.len()
        );
    }
    walked.records
}

fn load_range_log_records(view: &RepoView, revision: &str) -> Option<Vec<CommitRecord>> {
    let (from_str, to_str) = revision.split_once("..")?;
    let from_rev = if from_str.is_empty() {
        "HEAD"
    } else {
        from_str
    };
    let to_rev = if to_str.is_empty() { "HEAD" } else { to_str };
    let to_oid = resolve_or_exit_no_match(view, to_rev);
    let from_oid = resolve_or_exit_no_match(view, from_rev);
    let walked = match walk_commits(view, &[to_oid]) {
        Ok(w) => w,
        Err(walk_err) => reject(CliTag::ERROR, walk_err),
    };
    let excluded: HashSet<Oid> = walk_commits(view, &[from_oid])
        .unwrap_or_default()
        .into_iter()
        .map(|c| c.oid)
        .collect();
    Some(
        walked
            .into_iter()
            .filter(|c| !excluded.contains(&c.oid))
            .collect(),
    )
}

fn load_unborn_fallback_records(
    ctx: &CliContext,
    view: &RepoView,
    limit: WalkLimit,
) -> Vec<CommitRecord> {
    let starts = match collect_all_starts(view) {
        Ok(found) => found,
        Err(collect_err) => reject(CliTag::ERROR, collect_err),
    };
    if !ctx.json_mode {
        eprintln!(
            "note: HEAD is unborn (no commit on the checked-out branch); showing all refs.\n\
             Use `taxis checkout <ref>` or name a revision to inspect one lineage."
        );
    }
    match walk_commits_within(view, &starts, limit) {
        Ok(walked) => walked.records,
        Err(walk_err) => reject(CliTag::ERROR, walk_err),
    }
}

fn load_single_revision_records(
    view: &RepoView,
    revision: &str,
    limit: WalkLimit,
) -> Vec<CommitRecord> {
    let start = resolve_or_exit_no_match(view, revision);
    match walk_commits_within(view, &[start], limit) {
        Ok(walked) => walked.records,
        Err(walk_err) => reject(CliTag::ERROR, walk_err),
    }
}

fn resolve_or_exit_no_match(view: &RepoView, revision: &str) -> Oid {
    match view.resolve(revision) {
        Ok(oid) => oid,
        Err(resolve_err) => {
            eprintln!("{} {}", CliTag::ERROR, resolve_err);
            std::process::exit(EXIT_NO_MATCH);
        }
    }
}

fn filter_log_records(
    view: &RepoView,
    records: Vec<CommitRecord>,
    request: &LogRequest,
) -> Vec<CommitRecord> {
    if request.pathspecs.is_empty() {
        return records;
    }
    if request.follow && request.pathspecs.len() == 1 {
        let mut followed_path = request.pathspecs[0].clone();
        return records
            .into_iter()
            .filter(|record| {
                super::path_filter::commit_modifies_followed_path(view, record, &mut followed_path)
                    .unwrap_or(true)
            })
            .collect();
    }
    records
        .into_iter()
        .filter(|record| {
            super::path_filter::commit_modifies_pathspecs(view, record, &request.pathspecs)
                .unwrap_or(true)
        })
        .collect()
}

/// Collects every commit tip reachable from the repository references for log --all.
///
/// Git's --all means "pretend every ref is listed on the command line", so tags are peeled to the
/// commits they point at and refs that name trees or blobs contribute nothing. HEAD is added even
/// when it is detached, because a detached checkout is still a tip git log --all shows.
pub(crate) fn collect_all_starts(view: &RepoView) -> FractalResult<Vec<Oid>> {
    let references = DiskRefStore::new(view.git_dir()).list_all()?;
    let mut starts: Vec<Oid> = Vec::new();
    let mut seen: HashSet<Oid> = HashSet::new();
    for (_name, oid) in references {
        let peeled = view.peel(&oid)?;
        let object = view.object(&peeled)?;
        if object.kind == ObjectKind::Commit && seen.insert(peeled) {
            starts.push(peeled);
        }
    }
    if let Some(head) = view.head_commit()? {
        if seen.insert(head) {
            starts.push(head);
        }
    }
    Ok(starts)
}

/// Output mode for inline commit diffs in `log`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LogDiffMode {
    Stat,
    NameOnly,
    NameStatus,
}

/// One parsed `log` invocation.
pub(crate) struct LogRequest {
    pub(crate) revision: String,
    /// Whether the caller named a revision, as opposed to defaulting to `HEAD`.
    ///
    /// Tracked because the two cases need different answers when `HEAD` is unborn: an explicit
    /// revision must fail loudly (the name was wrong), while a bare `log` should fall back to the
    /// refs that do hold commits.
    pub(crate) revision_explicit: bool,
    pub(crate) limit: usize,
    pub(crate) all: bool,
    pub(crate) oneline: bool,
    pub(crate) follow: bool,
    pub(crate) format: Option<String>,
    pub(crate) graph: bool,
    pub(crate) diff_mode: Option<LogDiffMode>,
    pub(crate) pathspecs: Vec<String>,
    /// Declared history horizon. `Full` (the default) keeps every reachable commit.
    pub(crate) horizon: HorizonSpan,
    /// Paths this node is allowed to see, and the tier it sees them at.
    ///
    /// Distinct from `pathspecs`, which *drops* commits that touched nothing matching. A projection
    /// *keeps* them and marks them out of scope, because a caller of a slice needs to know that work
    /// happened elsewhere rather than believing nothing happened at all.
    pub(crate) projection: Option<ProjectionScope>,
}

impl LogRequest {
    /// Parses flags and the optional revision.
    fn parse(args: &[String]) -> Result<Self, String> {
        // The slice flags are removed before the rest of the parse, so the option loop never meets a
        // token it does not know, and the slice's value is never mistaken for a revision or a
        // pathspec. One spelling across `log`, `diff`, and `show`, parsed in one place.
        let (remaining, projection) = super::scope_flag::strip_scope(args)?;
        let (options, mut pathspecs) = super::path_filter::split_args_at_dashdash(&remaining);
        let mut request = Self {
            revision: "HEAD".to_string(),
            revision_explicit: false,
            limit: DEFAULT_LOG_LIMIT,
            all: false,
            oneline: false,
            follow: false,
            format: None,
            graph: false,
            diff_mode: None,
            pathspecs: Vec::new(),
            horizon: HorizonSpan::Full,
            projection: None,
        };
        let mut cursor = 0usize;
        while cursor < options.len() {
            let argument = options[cursor].as_str();
            cursor += 1;
            request.apply_log_option(argument, &options, &mut cursor, &mut pathspecs)?;
        }
        request.pathspecs = pathspecs;
        request.projection = projection;
        Ok(request)
    }

    fn apply_log_option(
        &mut self,
        argument: &str,
        options: &[String],
        cursor: &mut usize,
        pathspecs: &mut Vec<String>,
    ) -> Result<(), String> {
        match argument {
            "--graph" => self.graph = true,
            "--stat" => self.diff_mode = Some(LogDiffMode::Stat),
            "--name-only" => self.diff_mode = Some(LogDiffMode::NameOnly),
            "--name-status" => self.diff_mode = Some(LogDiffMode::NameStatus),
            "--oneline" => self.oneline = true,
            "--follow" => self.follow = true,
            "--all" => {
                self.all = true;
                self.limit = usize::MAX;
            }
            "--format" | "--pretty" => {
                let value = options
                    .get(*cursor)
                    .ok_or_else(|| format!("{argument} requires a format string"))?;
                self.format = Some(value.clone());
                *cursor += 1;
            }
            "-n" | "--max-count" => {
                let value = options
                    .get(*cursor)
                    .ok_or_else(|| format!("{argument} requires a count"))?;
                self.limit = value
                    .parse()
                    .map_err(|parse_err| format!("{argument} requires a count: {parse_err}"))?;
                *cursor += 1;
            }
            "--horizon" => {
                let value = options
                    .get(*cursor)
                    .ok_or("--horizon requires a value: full, <n>, or <n>s")?;
                self.horizon = parse_horizon(value)?;
                *cursor += 1;
            }
            other => self.apply_prefixed_log_option(other, pathspecs)?,
        }
        Ok(())
    }

    fn apply_prefixed_log_option(
        &mut self,
        other: &str,
        pathspecs: &mut Vec<String>,
    ) -> Result<(), String> {
        if other.starts_with("-n=") || other.starts_with("--max-count=") {
            let val = other.split_once('=').map(|(_, v)| v).unwrap_or("");
            self.limit = val
                .parse()
                .map_err(|parse_err| format!("{other} requires a count: {parse_err}"))?;
        } else if let Some(rest) = other.strip_prefix("--horizon=") {
            self.horizon = parse_horizon(rest)?;
        } else if let Some(rest) = other.strip_prefix("--format=") {
            self.format = Some(rest.to_string());
        } else if let Some(rest) = other.strip_prefix("--pretty=") {
            self.format = Some(rest.to_string());
        } else if other.starts_with('-')
            && other.len() > 1
            && other[1..]
                .chars()
                .all(|character| character.is_ascii_digit())
        {
            self.limit = other[1..]
                .parse()
                .map_err(|parse_err| format!("'-{other}' is not a count: {parse_err}"))?;
        } else if other.starts_with('-') {
            return Err(format!("log does not support the flag '{other}'"));
        } else if self.revision_explicit {
            pathspecs.push(other.to_string());
        } else {
            self.revision = other.to_string();
            self.revision_explicit = true;
        }
        Ok(())
    }
}

/// Lightweight ASCII DAG renderer for `log --graph`.
pub(crate) struct GraphRenderer {
    active_columns: Vec<Oid>,
}

impl GraphRenderer {
    pub(crate) fn new() -> Self {
        Self {
            active_columns: Vec::new(),
        }
    }

    pub(crate) fn next_prefix(&mut self, record: &CommitRecord) -> (String, String) {
        let col_idx = match self.active_columns.iter().position(|&id| id == record.oid) {
            Some(idx) => idx,
            None => {
                self.active_columns.push(record.oid);
                self.active_columns.len() - 1
            }
        };

        let mut glyph = String::new();
        for (i, _) in self.active_columns.iter().enumerate() {
            if i == col_idx {
                glyph.push_str("* ");
            } else {
                glyph.push_str("| ");
            }
        }

        let mut cont = String::new();
        for _ in 0..self.active_columns.len() {
            cont.push_str("| ");
        }

        let mut new_columns = Vec::new();
        for (i, &col_oid) in self.active_columns.iter().enumerate() {
            if i == col_idx {
                for &parent in &record.parents {
                    if !new_columns.contains(&parent) {
                        new_columns.push(parent);
                    }
                }
            } else if !new_columns.contains(&col_oid) {
                new_columns.push(col_oid);
            }
        }
        self.active_columns = new_columns;

        (glyph, cont)
    }
}

pub(crate) struct ShowRequest {
    pub(crate) revision: String,
    pub(crate) part: ShowPart,
    pub(crate) context: usize,
}

/// Dispatches `taxis show`.
pub fn handle_show(ctx: &CliContext) {
    // `show` prints a patch, so a slice drops hunks rather than labelling commits. Same flags,
    // different consequence, and the command's own documentation says which.
    let (show_args, slice) = match super::scope_flag::strip_scope(&ctx.args) {
        Ok(parsed) => parsed,
        Err(reason) => reject(CliTag::ERROR, reason),
    };
    let request = parse_show_args(&show_args);
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };

    if try_show_blob_spec(&view, &request.revision) {
        return;
    }

    let commit = match view.resolve(&request.revision) {
        Ok(oid) => oid,
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };
    let records = match walk_commits(&view, &[commit]) {
        Ok(walked) => walked,
        Err(walk_err) => reject(CliTag::ERROR, walk_err),
    };
    let Some(record) = records.first() else {
        reject(CliTag::ERROR, "show resolved no commit");
    };

    if ctx.json_mode {
        report_show_json(record, request.part);
        return;
    }

    render_show_commit(&view, record, &request, slice.as_ref());
}

fn parse_show_args(args: &[String]) -> ShowRequest {
    let mut revision = "HEAD".to_string();
    let mut part = ShowPart::Patch;
    let mut context = 3usize;
    let mut cursor = 0usize;
    while cursor < args.len() {
        let argument = args[cursor].as_str();
        cursor += 1;
        match argument {
            "--stat" => part = ShowPart::Stat,
            "-s" | "--no-patch" => part = ShowPart::HeaderOnly,
            "--format" | "--pretty" => {
                if args.get(cursor).is_some() {
                    cursor += 1;
                }
            }
            other if other.starts_with("--format=") || other.starts_with("--pretty=") => {}
            other if other.starts_with("-U") && other.len() > 2 => {
                context = other[2..].parse().unwrap_or(3);
            }

            other if other.starts_with('-') => {
                reject(
                    CliTag::ERROR,
                    format!("show does not support the flag '{other}'"),
                );
            }
            other => revision = other.to_string(),
        }
    }
    ShowRequest {
        revision,
        part,
        context,
    }
}

fn try_show_blob_spec(view: &RepoView, revision: &str) -> bool {
    if !revision.contains(':') {
        return false;
    }
    let oid = match view.resolve_object_spec(revision) {
        Ok(oid) => oid,
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };
    let object = match view.object(&oid) {
        Ok(loaded_obj) => loaded_obj,
        Err(obj_err) => reject(CliTag::ERROR, obj_err),
    };
    if object.kind == ObjectKind::Blob {
        let _ = std::io::stdout().write_all(&object.payload);
        return true;
    }
    false
}

/// Parses a `--horizon` value.
///
/// Three shapes, and no fourth: `full` keeps every reachable commit, a bare integer is a commit
/// count, and an integer with a `s` suffix is a duration. Anything else is refused rather than
/// guessed, because a mistyped horizon silently truncates history and the caller would read the
/// short answer as the whole truth.
fn parse_horizon(value: &str) -> Result<HorizonSpan, String> {
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case("full") {
        return Ok(HorizonSpan::Full);
    }
    if let Some(seconds) = trimmed.strip_suffix('s') {
        let parsed: u64 = seconds
            .parse()
            .map_err(|parse_err| format!("--horizon duration is not a number: {parse_err}"))?;
        if parsed == 0 {
            return Err(String::from("--horizon duration must be greater than zero"));
        }
        return Ok(HorizonSpan::Recent { seconds: parsed });
    }
    let depth: u32 = trimmed
        .parse()
        .map_err(|parse_err| format!("--horizon accepts full, <n>, or <n>s: {parse_err}"))?;
    if depth == 0 {
        return Err(String::from("--horizon depth must be greater than zero"));
    }
    Ok(HorizonSpan::Depth(depth))
}

#[cfg(test)]
mod tests {
    use super::{
        civil_from_unix, format_date, format_iso, offset_text, render_format, short_oid,
        LogRequest, DEFAULT_LOG_LIMIT, EXIT_NO_MATCH,
    };
    use crate::taxis_cmd::commit_walk::CommitRecord;
    use fg_core::models::Oid;

    /// Width used by the fixtures: the workspace repository's resolved width.
    const TEST_WIDTH: usize = 8;

    fn sample_record() -> CommitRecord {
        CommitRecord {
            oid: Oid::from_bytes([0xab; 20]),
            tree: Oid::from_bytes([0xcd; 20]),
            parents: vec![Oid::from_bytes([0x11; 20]), Oid::from_bytes([0x22; 20])],
            author_name: "Name Here".to_string(),
            author_mailbox: "mail@example.test".to_string(),
            author_time: 1_792_676_032,
            author_offset_minutes: 480,
            committer_name: "Committer".to_string(),
            committer_mailbox: "committer@example.test".to_string(),
            committer_time: 1_792_676_032,
            committer_offset_minutes: 480,
            message: "subject line\n\nbody line\n".to_string(),
        }
    }

    #[test]
    fn the_default_limit_is_finite() {
        assert_eq!(DEFAULT_LOG_LIMIT, 50);
        assert_eq!(
            LogRequest::parse(&[]).expect("parse").limit,
            DEFAULT_LOG_LIMIT
        );
    }

    #[test]
    fn all_lifts_the_limit() {
        let request = LogRequest::parse(&["--all".to_string()]).expect("parse");
        assert_eq!(request.limit, usize::MAX);
    }

    #[test]
    fn a_numeric_flag_sets_the_limit() {
        let request = LogRequest::parse(&["-3".to_string()]).expect("parse");
        assert_eq!(request.limit, 3);
    }

    #[test]
    fn an_unknown_flag_is_rejected() {
        assert!(LogRequest::parse(&["--unknown-log-flag".to_string()]).is_err());
    }

    #[test]
    fn a_graph_flag_sets_graph_mode() {
        let request = LogRequest::parse(&["--graph".to_string()]).expect("parse");
        assert!(request.graph);
    }

    #[test]
    fn the_identity_placeholders_resolve() {
        let record = sample_record();
        let rendered = render_format("%h %s", &record, TEST_WIDTH).expect("render");
        assert_eq!(rendered, "abababab subject line");
    }

    #[test]
    fn every_parent_is_listed_by_the_capital_p_placeholder() {
        let rendered = render_format("%P", &sample_record(), TEST_WIDTH).expect("render");
        assert_eq!(rendered.split(' ').count(), 2);
    }

    #[test]
    fn an_unknown_placeholder_is_an_error() {
        assert!(render_format("%Q", &sample_record(), TEST_WIDTH).is_err());
    }

    #[test]
    fn a_literal_percent_is_preserved() {
        let rendered = render_format("100%% done", &sample_record(), TEST_WIDTH).expect("render");
        assert_eq!(rendered, "100% done");
    }

    #[test]
    fn the_abbreviation_matches_the_requested_width() {
        assert_eq!(
            short_oid(&Oid::from_bytes([0xab; 20]), TEST_WIDTH).len(),
            TEST_WIDTH
        );
        assert_eq!(short_oid(&Oid::from_bytes([0xab; 20]), 7).len(), 7);
    }

    #[test]
    fn the_unix_epoch_is_a_thursday() {
        let (year, month, day, hour, minute, second, weekday) = civil_from_unix(0);
        assert_eq!(
            (year, month, day, hour, minute, second),
            (1970, 1, 1, 0, 0, 0)
        );
        assert_eq!(weekday, 0);
    }

    #[test]
    fn a_known_timestamp_round_trips() {
        // 2026-10-22T13:33:52Z
        let (year, month, day, hour, minute, second, _) = civil_from_unix(1_792_676_032);
        assert_eq!((year, month, day), (2026, 10, 22));
        assert_eq!((hour, minute, second), (13, 33, 52));
    }

    #[test]
    fn a_positive_offset_shifts_the_rendered_time() {
        let text = format_date(1_792_676_032, 480);
        assert!(text.contains("21:33:52"), "got {text}");
        assert!(text.ends_with("+0800"), "got {text}");
    }

    #[test]
    fn iso_output_contains_a_colon_in_the_offset() {
        let text = format_iso(1_792_676_032, 480);
        assert_eq!(text, "2026-10-22T21:33:52+08:00");
    }

    #[test]
    fn negative_offsets_render_with_a_minus_sign() {
        assert_eq!(offset_text(-450), "-0730");
        assert_eq!(offset_text(0), "+0000");
    }

    #[test]
    fn the_git_no_match_status_is_documented() {
        assert_eq!(EXIT_NO_MATCH, 128);
    }
}
