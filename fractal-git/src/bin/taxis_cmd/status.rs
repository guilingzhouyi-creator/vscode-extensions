//! Module: taxis_cmd::status — Three-Way Status Report
//! File Path: src/bin/taxis_cmd/status.rs
//! Architecture Role: Compares `HEAD`, the index, and the worktree, which is the definition of a
//!   status report. Produces `--porcelain=v1 -z` output compatible with Git's.
//! Dependencies & Triggers: Dispatched by `taxis status`; also supplies the file list `diff` walks.
//! Responsibilities: Status entry abstraction, CLI option dispatch, and porcelain rendering.
//! Exit Semantics & Design Rationale:
//!   - Supports human-readable Git-compatible porcelain, short, long, and JSON outputs.
//!   - Logic decoupled into `status_collect` and `status_render` to enforce single responsibility.

use fractal_git::constants::cli::CliTag;

use super::common::{fail_fatal, print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::status_render::{branch_header, render_long};

pub use super::status_collect::collect_status;
use super::tree_view::write_record;

/// Status code for an unmodified side.
pub const CODE_UNCHANGED: char = ' ';

/// Status code for an added path.
pub const CODE_ADDED: char = 'A';

/// Status code for a modified path.
pub const CODE_MODIFIED: char = 'M';

/// Status code for a deleted path.
pub const CODE_DELETED: char = 'D';

/// Status code for a path that survived a rename.
pub const CODE_RENAMED: char = 'R';

/// Status code marking a merge conflict.
pub const CODE_UNMERGED: char = 'U';

/// Index-side character reserved for untracked paths.
pub const CODE_UNTRACKED: char = '?';

const OPT_NUL: &str = "-z";
const OPT_VERBOSE_SHORT: &str = "-v";
const OPT_VERBOSE_LONG: &str = "--verbose";
const OPT_LONG: &str = "--long";
const OPT_SHORT: &str = "--short";
const OPT_SHORT_FLAG: &str = "-s";
const OPT_PORCELAIN: &str = "--porcelain";
const OPT_PORCELAIN_V1: &str = "--porcelain=v1";
const OPT_BRANCH: &str = "--branch";
const OPT_BRANCH_SHORT: &str = "-b";

/// One report line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusEntry {
    /// Index-side status character.
    pub index_code: char,
    /// Worktree-side status character.
    pub worktree_code: char,
    /// Repository-relative path with `/` separators. For a rename this is the new path.
    pub path: String,
    /// Path the file came from when this entry is a rename; `None` for every other status.
    pub rename_from: Option<String>,
    /// Similarity on Git's 0..=60000 scale when this entry is a rename; `None` otherwise.
    pub score: Option<u32>,
}

impl StatusEntry {
    /// Creates an entry from its two codes and path.
    pub fn new(index_code: char, worktree_code: char, path: impl Into<String>) -> Self {
        Self {
            index_code,
            worktree_code,
            path: path.into(),
            rename_from: None,
            score: None,
        }
    }

    /// Creates an entry that records a rename from `from` to `path`.
    pub fn with_rename(
        index_code: char,
        worktree_code: char,
        path: impl Into<String>,
        from: impl Into<String>,
        score: u32,
    ) -> Self {
        Self {
            index_code,
            worktree_code,
            path: path.into(),
            rename_from: Some(from.into()),
            score: Some(score),
        }
    }

    /// Renders the two-character code Git prints.
    pub fn code(&self) -> String {
        if self.index_code == CODE_UNTRACKED {
            return "??".to_string();
        }
        format!("{}{}", self.index_code, self.worktree_code)
    }

    /// Renders the record text without its terminator.
    pub fn record_text(&self, nul_terminated: bool) -> String {
        let code = self.code();
        match (&self.rename_from, nul_terminated) {
            (Some(from), false) => format!("{code} {from} -> {}", self.path),
            _ => format!("{code} {}", self.path),
        }
    }

    /// Reports whether this entry describes an unresolved merge conflict.
    pub fn is_conflicted(&self) -> bool {
        self.index_code == CODE_UNMERGED || self.worktree_code == CODE_UNMERGED
    }

    /// Reports whether the change is staged.
    pub fn is_staged(&self) -> bool {
        self.index_code != CODE_UNCHANGED && self.index_code != CODE_UNTRACKED
    }

    /// Reports whether the change exists only in the worktree.
    pub fn is_unstaged(&self) -> bool {
        self.worktree_code != CODE_UNCHANGED && self.index_code != CODE_UNTRACKED
    }

    /// Reports whether this path is untracked.
    pub fn is_untracked(&self) -> bool {
        self.index_code == CODE_UNTRACKED
    }
}

/// Output flavour for `taxis status`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StatusFormat {
    /// Human-readable long form, the default.
    Long,
    /// One record per path.
    Short,
    /// Porcelain v1, the stable machine form.
    Porcelain,
}

struct ParsedStatusFlags {
    nul_terminated: bool,
    format: StatusFormat,
    show_branch: bool,
}

fn parse_status_flags(args: &[String]) -> Result<ParsedStatusFlags, String> {
    let mut flags = ParsedStatusFlags {
        nul_terminated: false,
        format: StatusFormat::Long,
        show_branch: false,
    };

    for argument in args {
        match argument.as_str() {
            OPT_NUL => flags.nul_terminated = true,
            OPT_LONG | OPT_VERBOSE_SHORT | OPT_VERBOSE_LONG => flags.format = StatusFormat::Long,
            OPT_SHORT | OPT_SHORT_FLAG => flags.format = StatusFormat::Short,
            OPT_PORCELAIN | OPT_PORCELAIN_V1 => flags.format = StatusFormat::Porcelain,
            OPT_BRANCH_SHORT | OPT_BRANCH => flags.show_branch = true,
            other if other.starts_with('-') => return Err(other.to_string()),
            _ => {}
        }
    }
    Ok(flags)
}

fn render_status_by_format(
    view: &RepoView,
    entries: &[StatusEntry],
    flags: &ParsedStatusFlags,
) {
    match flags.format {
        StatusFormat::Long => render_long(view, entries),
        StatusFormat::Short | StatusFormat::Porcelain => {
            render_records(view, entries, flags.nul_terminated, flags.show_branch);
        }
    }
}

/// Dispatches `taxis status`.
pub fn handle_status(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };

    let flags = match parse_status_flags(&ctx.args) {
        Ok(f) => f,
        Err(flag) => reject(
            CliTag::ERROR,
            format!("status does not support the flag '{flag}'"),
        ),
    };

    let entries = match collect_status(&view) {
        Ok(collected) => collected,
        Err(status_err) => reject(CliTag::ERROR, status_err),
    };

    if ctx.json_mode {
        report_json(&view, &entries);
        return;
    }

    render_status_by_format(&view, &entries, &flags);
}

/// Renders the record-per-line forms.
fn render_records(
    view: &RepoView,
    entries: &[StatusEntry],
    nul_terminated: bool,
    show_branch: bool,
) {
    let mut sink = std::io::stdout();
    if show_branch {
        let _ = write_record(&mut sink, &branch_header(view), nul_terminated);
    }
    for entry in entries {
        let _ = write_record(
            &mut sink,
            &entry.record_text(nul_terminated),
            nul_terminated,
        );
        if nul_terminated {
            if let Some(from) = &entry.rename_from {
                let _ = write_record(&mut sink, from, true);
            }
        }
    }
}

/// Renders the status report as JSON.
fn report_json(view: &RepoView, entries: &[StatusEntry]) {
    let rendered: Vec<serde_json::Value> = entries
        .iter()
        .map(|entry| {
            serde_json::json!({
                "code": entry.code(),
                "path": entry.path,
                "staged": entry.is_staged(),
                "unstaged": entry.is_unstaged(),
                "untracked": entry.is_untracked(),
                "conflicted": entry.is_conflicted(),
            })
        })
        .collect();
    let payload = serde_json::json!({
        "engine": "taxis",
        "operation": "status",
        "git_dir": view.git_dir().display().to_string(),
        "pack_count": view.pack_count(),
        "entry_count": rendered.len(),
        "entries": rendered,
    });
    print_json(&payload);
}

#[cfg(test)]
#[path = "status_tests.rs"]
mod tests;
