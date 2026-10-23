//! Module: taxis_cmd::diff_render — Patch Text, Stat, and JSON Rendering
//! File Path: src/bin/taxis_cmd/diff_render.rs
//! Architecture Role: Turns a list of comparisons into the bytes `git diff` would print, in all
//!   three output modes (`--name-only`, `--stat`, and the unified patch).
//! Dependencies & Triggers: Called by `diff_cmd` for `taxis diff` and by `show`.
//! Responsibilities: Emit the `diff --git` preamble, the metadata block, the `---`/`+++` pair, the
//!   hunks, the `--stat` rows, and the JSON report.
//! Exit Semantics & Design Rationale:
//!   - Rendering is separated from comparison because the two fail differently. A comparison either
//!     finds a pair or does not; a renderer has to reproduce byte-level formatting that Git's writer
//!     decides line by line, and keeping the two in one module made the file's budget force the
//!     formatting rules to be abbreviated. Split, each half fits under the size ceiling without
//!     either half losing the comments that explain why a line looks the way it does.
//!   - Every formatting decision here is stated as a comparison against Git's own writer rather than
//!     as a local preference, because the acceptance test for this module is byte equality.

use fg_algorithms::{
    text_ends_with_newline, PatchGenerator, PatchLineRef, UnifiedPatchRef, MAX_RENAME_SCORE,
};

use super::common::print_json;
use super::diff_cmd::{DiffRequest, DiffScope, FileComparison};
use super::repo_view::RepoView;

/// Label Git prints for a side that does not exist.
const DEV_NULL: &str = "/dev/null";

/// Label Git prints for a deleted-side path.
const OLD_SIDE: &str = "---";

/// Marker Git prints for an added-side path.
const NEW_SIDE: &str = "+++";

/// Marker Git prints after a line whose file continues past it without a terminator.
const NO_NEWLINE_MARKER: &str = "\\ No newline at end of file";

/// Context width used when counting lines for `--stat`.
const STAT_CONTEXT: usize = 3;

/// Ceiling on the length of a hunk section heading, in bytes.
///
/// Git copies the heading into an 80-byte buffer (`struct func_line { char buf[80]; }` in
/// `xdiff/xemit.c`), so a longer line is cut rather than dropped. The cap exists so a minified or
/// generated line cannot make one hunk header thousands of bytes long.
pub(crate) const MAX_HEADING_LEN: usize = 80;

/// Renders the text patch.
pub(crate) fn report_text(request: &DiffRequest, comparisons: &[FileComparison], width: usize) {
    let mut sink = std::io::stdout();
    let layout = StatLayout::measure(comparisons, terminal_columns());
    for comparison in comparisons {
        if request.name_only {
            let _ = super::status_cmd::write_record(
                &mut sink,
                comparison.path(),
                request.nul_terminated,
            );
            continue;
        }

        let old_text = comparison.side_text(true);
        let new_text = comparison.side_text(false);

        if request.stat_only {
            write_stat_line(&mut sink, comparison, layout, request.nul_terminated);
            continue;
        }

        let header = format!(
            "diff --git a/{} b/{}",
            comparison.old_path, comparison.new_path
        );
        let _ = super::status_cmd::write_record(&mut sink, &header, request.nul_terminated);

        // A pure mode change has no content difference, so Git prints the metadata and stops. The
        // `index` line is part of that metadata only when the ids differ; for a mode-only change they
        // are equal and Git's `oideq` guard suppresses the line, leaving `old mode` / `new mode`
        // alone. Emitting an `index` line there would claim an object change that did not happen.
        //
        // The fast path is restricted to a comparison whose two sides share a path. A rename with a
        // mode change is *also* content-identical, but Git still prints `similarity index` and the
        // `rename from`/`rename to` pair before the mode lines, so taking the short path there drops
        // the only lines that say the file moved.
        if comparison.mode_changed()
            && comparison.old_text == comparison.new_text
            && comparison.score.is_none()
        {
            write_mode_only_header(&mut sink, comparison, request.nul_terminated);
            continue;
        }

        if comparison.is_binary() {
            write_file_header(&mut sink, comparison, width, request.nul_terminated);
            let _ = super::status_cmd::write_record(
                &mut sink,
                &format!(
                    "Binary files {} and {} differ",
                    side_label(comparison, true),
                    side_label(comparison, false)
                ),
                request.nul_terminated,
            );
            continue;
        }

        let patch = PatchGenerator::generate_patch_ref_with_context(
            comparison.path(),
            &old_text,
            &new_text,
            request.context,
        );
        if patch.hunks.is_empty() {
            // An absent side has no lines, so creating or deleting an empty file yields no hunks.
            // Git still prints the metadata that explains the change — that is the only record a
            // reader gets — while `---`/`+++` stay out because they introduce hunks that do not
            // exist here. Suppressing the whole entry would drop the file from the output entirely.
            // A rename is the other header-only case: the ids are equal, so there is nothing to
            // patch, yet the header is the whole report.
            if comparison.old_text.is_none()
                || comparison.new_text.is_none()
                || comparison.score.is_some()
            {
                write_file_header(&mut sink, comparison, width, request.nul_terminated);
            }
            continue;
        }
        write_file_header(&mut sink, comparison, width, request.nul_terminated);
        write_path_lines(&mut sink, comparison, request.nul_terminated);
        render_patch(
            &mut sink,
            &patch,
            &old_text,
            &new_text,
            request.nul_terminated,
        );
    }
    if request.stat_only && !comparisons.is_empty() {
        write_stat_summary(&mut sink, comparisons, request.nul_terminated);
    }
}
/// Writes the metadata of a comparison whose only change is the recorded mode.
fn write_mode_only_header(
    sink: &mut impl std::io::Write,
    comparison: &FileComparison,
    nul_terminated: bool,
) {
    let render = |mode: Option<fg_core::models::FileMode>| match mode {
        Some(value) => format!("{:06o}", value.to_u32()),
        None => String::new(),
    };
    let _ = super::status_cmd::write_record(
        sink,
        &format!("old mode {}", render(comparison.old_mode)),
        nul_terminated,
    );
    let _ = super::status_cmd::write_record(
        sink,
        &format!("new mode {}", render(comparison.new_mode)),
        nul_terminated,
    );
}

/// Renders one side's label for a `Binary files` line, using `/dev/null` for an absent side.
fn side_label(comparison: &FileComparison, old: bool) -> String {
    match old {
        true => match comparison.old_text.is_some() {
            true => format!("a/{}", comparison.old_path),
            false => DEV_NULL.to_string(),
        },
        false => match comparison.new_text.is_some() {
            true => format!("b/{}", comparison.new_path),
            false => DEV_NULL.to_string(),
        },
    }
}

/// Writes the metadata Git prints between `diff --git` and the hunks.
///
/// The line set is decided by the pair, not by a fixed template, because Git's own writer
/// (`fill_metainfo` in `diff.c`) branches on the pair's shape:
///
/// - A created file gets `new file mode`; a deleted one gets `deleted file mode`.
/// - Both sides existing and differing in mode gets `old mode` and `new mode`.
/// - A matched rename gets `similarity index`, `rename from`, and `rename to`, printed **after** the
///   mode lines and **before** the `index` line — so a rename that also changed the mode reads
///   `old mode` / `new mode` / `similarity index` / `rename from` / `rename to` / `index`.
/// - The `index` line prints a mode **only when the two sides record the same one**. A deletion
///   records `000000` on the new side, so the comparison fails and the mode is omitted — which is
///   why `git show` prints `index fbbee86..0000000` with no trailing `100644`.
/// - The `index` line itself is suppressed when the two ids are equal. A pure rename has the same
///   blob on both sides, so printing `index abc..abc` would claim an object change that did not
///   happen; a rename with edits has different ids and does get the line.
/// - A binary pair prints the same `index` line, then `Binary files ... differ`. Emitting only the
///   latter leaves a header no patch tool can attribute to an object.
fn write_file_header(
    sink: &mut impl std::io::Write,
    comparison: &FileComparison,
    width: usize,
    nul_terminated: bool,
) {
    let mode_text = |mode: Option<fg_core::models::FileMode>| match mode {
        Some(value) => format!("{:06o}", value.to_u32()),
        None => String::new(),
    };
    match (&comparison.old_text, &comparison.new_text) {
        (None, Some(_)) => {
            let _ = super::status_cmd::write_record(
                sink,
                &format!("new file mode {}", mode_text(comparison.new_mode)),
                nul_terminated,
            );
        }
        (Some(_), None) => {
            let _ = super::status_cmd::write_record(
                sink,
                &format!("deleted file mode {}", mode_text(comparison.old_mode)),
                nul_terminated,
            );
        }
        _ if comparison.mode_changed() => {
            let _ = super::status_cmd::write_record(
                sink,
                &format!("old mode {}", mode_text(comparison.old_mode)),
                nul_terminated,
            );
            let _ = super::status_cmd::write_record(
                sink,
                &format!("new mode {}", mode_text(comparison.new_mode)),
                nul_terminated,
            );
        }
        _ => {}
    }
    if let Some(score) = comparison.score {
        let _ = super::status_cmd::write_record(
            sink,
            &format!("similarity index {}%", score * 100 / MAX_RENAME_SCORE),
            nul_terminated,
        );
        let _ = super::status_cmd::write_record(
            sink,
            &format!("rename from {}", comparison.old_path),
            nul_terminated,
        );
        let _ = super::status_cmd::write_record(
            sink,
            &format!("rename to {}", comparison.new_path),
            nul_terminated,
        );
    }
    // A side that does not exist hashes to zeros, and a side that exists but is empty hashes to the
    // empty blob. Substituting one for the other makes a creation look like an edit of an empty
    // file, which changes how a patch tool treats it.
    let old_oid = super::diff_cmd::object_id_for(comparison.old_text.as_deref());
    let new_oid = super::diff_cmd::object_id_for(comparison.new_text.as_deref());
    if old_oid == new_oid {
        return;
    }
    let shared_mode = match comparison.old_mode == comparison.new_mode {
        true => match comparison.old_mode {
            Some(value) => format!(" {:06o}", value.to_u32()),
            None => String::new(),
        },
        false => String::new(),
    };
    let _ = super::status_cmd::write_record(
        sink,
        &format!(
            "index {}..{}{shared_mode}",
            super::abbrev::abbreviate_hex(&old_oid, width),
            super::abbrev::abbreviate_hex(&new_oid, width)
        ),
        nul_terminated,
    );
}

/// Writes the `---` and `+++` lines that introduce a file's hunks.
///
/// Git writes the bare `/dev/null` for an absent side, without the `a/` or `b/` prefix. Prefixing it
/// produces `a//dev/null`, a path that exists nowhere and that no patch tool recognizes as a
/// creation marker.
fn write_path_lines(
    sink: &mut impl std::io::Write,
    comparison: &FileComparison,
    nul_terminated: bool,
) {
    let old_label = match comparison.old_text.is_some() {
        true => format!("a/{}", comparison.old_path),
        false => DEV_NULL.to_string(),
    };
    let new_label = match comparison.new_text.is_some() {
        true => format!("b/{}", comparison.new_path),
        false => DEV_NULL.to_string(),
    };
    let _ =
        super::status_cmd::write_record(sink, &format!("{OLD_SIDE} {old_label}"), nul_terminated);
    let _ =
        super::status_cmd::write_record(sink, &format!("{NEW_SIDE} {new_label}"), nul_terminated);
}

/// Writes the hunks of one patch, honouring the requested context width.
///
/// Both sides are needed, not just the old one: Git annotates a line with `\ No newline at end of
/// file` when the file it came from does not end in a terminator, and which side that is depends on
/// the line — a deletion answers to the old file, an addition to the new one, a context line to
/// both at once. Rendering the marker from the old side alone would put it on added lines that do
/// end in a newline, and a patch tool that trusts the annotation would then drop the terminator.
fn render_patch(
    sink: &mut impl std::io::Write,
    patch: &UnifiedPatchRef<'_>,
    old_text: &str,
    new_text: &str,
    nul_terminated: bool,
) {
    let old_lines: Vec<&str> = fg_algorithms::split_lines(old_text);
    // The marker belongs to the file's last line only. A hunk that stops short of the end says
    // nothing about the terminator, and marking an interior line would be a claim about bytes the
    // hunk does not contain.
    let old_total = old_lines.len();
    let new_total = fg_algorithms::split_lines(new_text).len();
    let old_terminated = text_ends_with_newline(old_text);
    let new_terminated = text_ends_with_newline(new_text);
    // The heading is stateful across hunks, mirroring `funclineprev` in `xdl_emit_diff`. A hunk
    // whose own range holds no candidate keeps the previous hunk's heading rather than dropping it,
    // because Git only overwrites its `func_line` buffer when a search succeeds. Starting the bound
    // at `-1` is what lets the first hunk search all the way to the top of the file.
    let mut funclineprev: isize = -1;
    let mut heading: Option<&str> = None;
    for hunk in &patch.hunks {
        // Git searches from `s1 - 1`, one line above the hunk's first old line, and remembers that
        // same value as the next hunk's exclusive lower bound.
        let search_start = heading_search_start(hunk.old_start, hunk.old_count) - 1;
        if let Some(found) = hunk_section_heading(&old_lines, search_start, funclineprev) {
            heading = Some(found);
        }
        funclineprev = search_start;
        // A side whose count is exactly one omits the `,1`. Git's unified format defines the count
        // as optional and its writer drops it in that case; printing it makes the header differ on
        // every single-line change, which is most of them.
        let old_range = render_range(hunk.old_start, hunk.old_count);
        let new_range = render_range(hunk.new_start, hunk.new_count);
        let header = format!(
            "@@ -{old_range} +{new_range} @@{}",
            heading.map(|text| format!(" {text}")).unwrap_or_default()
        );
        let _ = super::status_cmd::write_record(sink, &header, nul_terminated);
        let mut old_cursor = hunk.old_start;
        let mut new_cursor = hunk.new_start;
        for line in &hunk.lines {
            let (rendered, missing_old, missing_new) = match line {
                PatchLineRef::Context(text) => (
                    format!(" {text}"),
                    old_cursor == old_total && !old_terminated,
                    new_cursor == new_total && !new_terminated,
                ),
                PatchLineRef::Addition(text) => (
                    format!("+{text}"),
                    false,
                    new_cursor == new_total && !new_terminated,
                ),
                PatchLineRef::Deletion(text) => (
                    format!("-{text}"),
                    old_cursor == old_total && !old_terminated,
                    false,
                ),
            };
            let _ = super::status_cmd::write_record(sink, &rendered, nul_terminated);
            // A context line at the end of both files satisfies both conditions at once, and Git
            // prints the marker once. Emitting it per side would duplicate the line.
            if missing_old || missing_new {
                let _ = super::status_cmd::write_record(sink, NO_NEWLINE_MARKER, nul_terminated);
            }
            match line {
                PatchLineRef::Context(_) => {
                    old_cursor += 1;
                    new_cursor += 1;
                }
                PatchLineRef::Addition(_) => new_cursor += 1,
                PatchLineRef::Deletion(_) => old_cursor += 1,
            }
        }
    }
}

/// Renders one side of a hunk header, omitting the count when it is exactly one.
fn render_range(start: usize, count: usize) -> String {
    if count == 1 {
        start.to_string()
    } else {
        format!("{start},{count}")
    }
}

/// Returns `s1`, the 0-based index of a hunk's first old line.
///
/// `xdl_emit_diff` searches for a heading from `s1 - 1`, and remembers that value as the next hunk's
/// exclusive lower bound. A hunk that only adds lines has no first old line, so its recorded start is
/// already the index it would be inserted after; a hunk with old lines records a 1-based start.
/// Converting both cases here keeps them from drifting apart at each call site.
pub(crate) fn heading_search_start(old_start: usize, old_count: usize) -> isize {
    let s1 = match old_count {
        0 => old_start,
        _ => old_start.saturating_sub(1),
    };
    s1 as isize
}

/// Finds the section heading Git prints after `@@`: the nearest preceding line that begins a
/// declaration, truncated to [`MAX_HEADING_LEN`] bytes.
///
/// `start` is the 0-based index the search begins at, one line above the hunk's first line, and
/// `floor` is the exclusive lower bound — the index the previous hunk started its own search from.
/// Git threads that bound through `funclineprev` in `xdl_emit_diff`; without it a file whose hunks
/// are far apart would repeat the first hunk's heading for every later one, which is what a caller
/// diffing against `git diff` sees as noise. Both are `isize` because the first hunk's bound is
/// `-1`, a value no index can hold.
///
/// A trailing semicolon is *not* disqualifying — `use std::collections::BTreeMap;` is a heading in
/// Rust files — so excluding those would drop the heading on exactly the lines that carry it.
pub(crate) fn hunk_section_heading<'a>(
    old_lines: &[&'a str],
    start: isize,
    floor: isize,
) -> Option<&'a str> {
    let mut index = start;
    while index > floor && index >= 0 {
        let line = match old_lines.get(index as usize) {
            Some(found) => *found,
            None => break,
        };
        let first = match line.chars().next() {
            Some(character) => character,
            None => {
                index -= 1;
                continue;
            }
        };
        if first.is_ascii_alphabetic() || first == '_' || first == '$' {
            return Some(truncate_heading(line));
        }
        index -= 1;
    }
    None
}

/// Cuts a heading to [`MAX_HEADING_LEN`] bytes the way Git's `def_ff` does.
///
/// The order is truncate-then-strip, not strip-then-truncate. Git copies at most 80 bytes into its
/// buffer and only then walks back over trailing whitespace, so a line whose 80th byte is a space
/// loses that space *after* the cut. Stripping first and cutting second leaves the space in place
/// whenever it sits at the boundary, which is exactly the case a long declaration hits.
///
/// The cut is by bytes, and Git does not retreat to a character boundary: `def_ff` `memcpy`s the
/// truncated byte count and the renderer writes those bytes through. A multi-byte character that
/// straddles the cap is therefore emitted in part, and reproducing that is what keeps the header
/// byte-identical. The lossy conversion is safe for that reason — it is not a text operation but a
/// byte copy whose result happens to travel through a `String`.
fn truncate_heading(line: &str) -> &str {
    let mut cut = line.len().min(MAX_HEADING_LEN);
    // A byte slice must land on a character boundary; when the cap falls inside a character the
    // whole character is dropped, which matches Git's 78-`a` measurement on a line whose 79th byte
    // opens a three-byte character.
    while cut > 0 && !line.is_char_boundary(cut) {
        cut -= 1;
    }
    line[..cut].trim_end()
}

/// Counts inserted and deleted lines for one comparison.
///
/// A side that is absent from the comparison is counted as zero lines rather than as an empty file.
/// Counting an empty file makes a pure deletion look like "delete everything, add nothing", and a
/// pure addition look like it also removed the file's previous content; both inflate the totals in a
/// way a reader cannot reconcile with the patch text.
fn count_changes(comparison: &FileComparison) -> (usize, usize) {
    match (&comparison.old_text, &comparison.new_text) {
        (Some(old), Some(new)) => {
            let old_lossy = String::from_utf8_lossy(old);
            let new_lossy = String::from_utf8_lossy(new);
            let patch = PatchGenerator::generate_patch_ref_with_context(
                "stat",
                &old_lossy,
                &new_lossy,
                STAT_CONTEXT,
            );
            let mut added = 0usize;
            let mut removed = 0usize;
            for hunk in &patch.hunks {
                for line in &hunk.lines {
                    match line {
                        PatchLineRef::Addition(_) => added += 1,
                        PatchLineRef::Deletion(_) => removed += 1,
                        PatchLineRef::Context(_) => {}
                    }
                }
            }
            (added, removed)
        }
        (None, Some(new)) => (String::from_utf8_lossy(new).lines().count(), 0),
        (Some(old), None) => (0, String::from_utf8_lossy(old).lines().count()),
        (None, None) => (0, 0),
    }
}

/// Writes one `--stat` row: `<path> | <total> <bar>`.
///
/// The trailing space before the bar is conditional, matching Git's writer: a row whose change count
/// is zero prints `| 0` and stops. Emitting the space unconditionally leaves an invisible trailing
/// blank on every rename and every binary row, which is a byte-level difference even though the
/// visible text looks the same.
fn write_stat_line(
    sink: &mut impl std::io::Write,
    comparison: &FileComparison,
    layout: StatLayout,
    nul_terminated: bool,
) {
    let (added, removed) = count_changes(comparison);
    let total = added + removed;
    let name = truncate_stat_name(&stat_label(comparison), layout.name_width);
    let padding = " ".repeat(layout.name_width.saturating_sub(name.chars().count()));
    let separator = if total == 0 { "" } else { " " };
    let _ = super::status_cmd::write_record(
        sink,
        &format!(
            " {name}{padding} | {:>width$}{separator}{}",
            total,
            stat_graph(added, removed, layout),
            width = layout.number_width
        ),
        nul_terminated,
    );
}

/// The column widths one `--stat` block uses, derived from every row at once.
///
/// Git sizes the three columns from the whole file set, not per row (`show_stats` in `diff.c`): the
/// name column is the longest name, the number column is the width of the largest change count, and
/// the bar is scaled against that same maximum so bars are comparable across rows. Rendering each row
/// independently would give every line its own widths and produce a block Git never emits.
#[derive(Debug, Clone, Copy)]
pub(crate) struct StatLayout {
    /// Width of the change-count field.
    pub(crate) number_width: usize,
    /// Width of the bar field; a change count is scaled into it.
    pub(crate) graph_width: usize,
    /// Width of the path field, before truncation.
    pub(crate) name_width: usize,
    /// Largest change count in the block, which the bar is scaled against.
    pub(crate) max_change: usize,
}

impl StatLayout {
    /// Measures the widths Git's `show_stats` would choose for `comparisons`.
    ///
    /// The terminal is assumed to be 80 columns when `COLUMNS` is unset, which is Git's own fallback
    /// (`diff.c`: `width = options->stat_width ? options->stat_width : 80`). The shrink rules below
    /// are copied from the same function: the bar may take at most three eighths of the width, and
    /// the name column absorbs the remainder.
    pub(crate) fn measure(comparisons: &[FileComparison], columns: usize) -> Self {
        let mut max_change = 0usize;
        let mut max_name = 0usize;
        for comparison in comparisons {
            let (added, removed) = count_changes(comparison);
            max_change = max_change.max(added + removed);
            max_name = max_name.max(stat_label(comparison).chars().count());
        }
        let width = columns.max(16 + 6 + decimal_width(max_change));
        let number_width = decimal_width(max_change);
        let mut graph_width = max_change;
        let mut name_width = max_name;
        if name_width + number_width + 6 + graph_width > width {
            let ceiling = width * 3 / 8;
            if graph_width + number_width + 6 > ceiling {
                graph_width = ceiling.saturating_sub(number_width + 6).max(6);
            }
            let remaining = width - number_width - 6;
            if name_width > remaining.saturating_sub(graph_width) {
                name_width = remaining.saturating_sub(graph_width);
            } else {
                graph_width = remaining - name_width;
            }
        }
        Self {
            number_width,
            graph_width,
            name_width,
            max_change,
        }
    }
}

/// Returns the width `--stat` should lay out against.
///
/// `COLUMNS` wins when it holds a usable number, then the real terminal width, then 80. Git reads the
/// same three sources in the same order (`term_columns` in `column.c` plus its 80-column fallback in
/// `show_stats`), and honouring only the terminal would make output differ whenever a caller sets
/// `COLUMNS` — which build scripts do precisely to pin the layout.
fn terminal_columns() -> usize {
    if let Some(text) = std::env::var_os("COLUMNS") {
        if let Some(width) = text.to_str().and_then(|value| value.trim().parse().ok()) {
            return width;
        }
    }
    80
}

/// Number of decimal digits a count needs, with zero counted as one digit.
fn decimal_width(value: usize) -> usize {
    match value {
        0 => 1,
        other => (other.ilog10() as usize) + 1,
    }
}

/// Scales a change count into the bar field, matching `scale_linear` in `diff.c`.
///
/// The formula is `1 + count * (width - 1) / max`, not a rounded proportion: it reserves one column
/// so any change at all prints at least one character. A proportional split would render a
/// one-line change in a 759-line diff as an empty bar.
fn scale_linear(count: usize, width: usize, max_change: usize) -> usize {
    if count == 0 || max_change == 0 {
        return 0;
    }
    1 + count * (width.saturating_sub(1)) / max_change
}

/// Builds the `+`/`-` bar for one row.
///
/// When both sides changed, the total is scaled first and then split, so a row with one addition and
/// one deletion still shows both characters — Git's `if (total < 2 && add && del) total = 2` guard.
fn stat_graph(added: usize, removed: usize, layout: StatLayout) -> String {
    if layout.graph_width > layout.max_change {
        return format!("{}{}", "+".repeat(added), "-".repeat(removed));
    }
    let total = added + removed;
    let mut scaled = scale_linear(total, layout.graph_width, layout.max_change);
    if scaled < 2 && added > 0 && removed > 0 {
        scaled = 2;
    }
    let (plus, minus) = match added < removed {
        true => {
            let plus = scale_linear(added, layout.graph_width, layout.max_change);
            (plus, scaled.saturating_sub(plus))
        }
        false => {
            let minus = scale_linear(removed, layout.graph_width, layout.max_change);
            (scaled.saturating_sub(minus), minus)
        }
    };
    format!("{}{}", "+".repeat(plus), "-".repeat(minus))
}

/// Shortens a name that does not fit, keeping its tail behind a `...` marker.
///
/// Git drops leading characters until the remainder fits and then retreats to the next `/`, so the
/// shortened name always starts at a path component boundary. Cutting at an arbitrary offset instead
/// yields names like `...references/praxis-client-and-diff-topology.md` — which is what Git prints,
/// but for a different reason: it cut at a slash that happened to be there. The boundary rule is what
/// makes the result stable when the column width changes by one.
fn truncate_stat_name(name: &str, name_width: usize) -> String {
    let length = name.chars().count();
    if length <= name_width {
        return name.to_string();
    }
    let keep = name_width.saturating_sub(3);
    let trimmed: String = name.chars().skip(length - keep).collect();
    match trimmed.find('/') {
        Some(slash) => format!("...{}", &trimmed[slash..]),
        None => format!("...{trimmed}"),
    }
}

/// Renders the path column of a `--stat` row.
///
/// A rename is abbreviated to its changed middle, the way Git's `pprint_rename` does: the shared
/// directory prefix and the shared tail are printed once around `{old => new}`. Spelling both full
/// paths would make a directory-wide move repeat the same prefix on every row and push the counts
/// off the right edge.
fn stat_label(comparison: &FileComparison) -> String {
    match comparison.score {
        Some(_) if comparison.old_path != comparison.new_path => {
            pprint_rename(&comparison.old_path, &comparison.new_path)
        }
        _ => comparison.path().to_string(),
    }
}

/// Abbreviates a rename to `pfx{old => new}sfx`, matching Git's `pprint_rename`.
///
/// The prefix only counts up to a separator, and the suffix likewise, so the braces always enclose
/// whole path components. A prefix that stopped mid-component would produce `dir{x => y}` for
/// `dirx` and `diry`, which reads as a rename inside a directory that does not exist.
pub(crate) fn pprint_rename(old: &str, new: &str) -> String {
    let old_bytes = old.as_bytes();
    let new_bytes = new.as_bytes();
    let mut prefix = 0usize;
    let mut cursor = 0usize;
    while cursor < old_bytes.len()
        && cursor < new_bytes.len()
        && old_bytes[cursor] == new_bytes[cursor]
    {
        if old_bytes[cursor] == b'/' {
            prefix = cursor + 1;
        }
        cursor += 1;
    }
    let suffix = shared_suffix_len(old_bytes, new_bytes, prefix);
    let old_middle = old_bytes.len().saturating_sub(prefix + suffix);
    let new_middle = new_bytes.len().saturating_sub(prefix + suffix);
    let mut rendered = String::with_capacity(old.len() + new.len() + 7);
    if prefix + suffix > 0 {
        rendered.push_str(&old[..prefix]);
        rendered.push('{');
    }
    rendered.push_str(&old[prefix..prefix + old_middle]);
    rendered.push_str(" => ");
    rendered.push_str(&new[prefix..prefix + new_middle]);
    if prefix + suffix > 0 {
        rendered.push('}');
        rendered.push_str(&old[old.len() - suffix..]);
    }
    rendered
}

/// Returns the length of the shared path-component suffix, in bytes.
///
/// With a prefix, the walk is allowed to step one byte into it so both sides see the same separating
/// slash; without one, stepping back would run off the front of the string.
fn shared_suffix_len(old: &[u8], new: &[u8], prefix: usize) -> usize {
    let adjust = usize::from(prefix > 0);
    let floor = prefix.saturating_sub(adjust);
    let mut suffix = 0usize;
    let mut back = 0usize;
    while floor + back < old.len() && floor + back < new.len() {
        let byte = old[old.len() - 1 - back];
        if byte != new[new.len() - 1 - back] {
            break;
        }
        if byte == b'/' {
            suffix = back + 1;
        }
        back += 1;
    }
    suffix
}

/// Writes the trailing summary of files and line counts.
///
/// Both the file noun and the two line nouns are pluralized independently, and a zero count is
/// spelled out rather than omitted. Git's rule is asymmetric on purpose — `insertions` is printed
/// when it is non-zero *or* when there are no deletions, and vice versa — which is what makes
/// `1 file changed, 0 insertions(+), 0 deletions(-)` appear for a pure rename instead of the bare
/// `1 file changed` a naive "skip zeroes" rule would print.
fn write_stat_summary(
    sink: &mut impl std::io::Write,
    comparisons: &[FileComparison],
    nul_terminated: bool,
) {
    let mut added = 0usize;
    let mut removed = 0usize;
    for comparison in comparisons {
        let (file_added, file_removed) = count_changes(comparison);
        added += file_added;
        removed += file_removed;
    }
    let files = comparisons.len();
    let file_noun = if files == 1 { "file" } else { "files" };
    let mut summary = format!(" {files} {file_noun} changed");
    if added > 0 || removed == 0 {
        let noun = if added == 1 {
            "insertion(+)"
        } else {
            "insertions(+)"
        };
        summary.push_str(&format!(", {added} {noun}"));
    }
    if removed > 0 || added == 0 {
        let noun = if removed == 1 {
            "deletion(-)"
        } else {
            "deletions(-)"
        };
        summary.push_str(&format!(", {removed} {noun}"));
    }
    let _ = super::status_cmd::write_record(sink, &summary, nul_terminated);
}

/// Renders the JSON form of the patch.
pub(crate) fn report_json(view: &RepoView, request: &DiffRequest, comparisons: &[FileComparison]) {
    let files: Vec<serde_json::Value> = comparisons
        .iter()
        .map(|comparison| {
            serde_json::json!({
                "path": comparison.path(),
                "old_path": comparison.old_path,
                "new_path": comparison.new_path,
                "binary": comparison.is_binary(),
                "old_size": comparison.old_text.as_ref().map(Vec::len),
                "new_size": comparison.new_text.as_ref().map(Vec::len),
                "score": comparison.score,
            })
        })
        .collect();
    let payload = serde_json::json!({
        "engine": "taxis",
        "operation": "diff",
        "git_dir": view.git_dir().display().to_string(),
        "scope": match request.scope {
            DiffScope::Worktree => "worktree",
            DiffScope::Staged => "staged",
            DiffScope::CommitToWorktree => "commit-to-worktree",
            DiffScope::CommitToIndex => "commit-to-index",
            DiffScope::Revisions => "revisions",
        },
        "context": request.context,
        "file_count": files.len(),
        "files": files,
    });
    print_json(&payload);
}

#[cfg(test)]
mod tests {
    use super::{
        decimal_width, heading_search_start, hunk_section_heading, pprint_rename, scale_linear,
        truncate_stat_name, MAX_HEADING_LEN,
    };

    /// Renders the heading of the hunk that starts at 1-based line `start`, using the same
    /// arithmetic `report_text` does: `s1` is the 0-based first old line and the search begins one
    /// line above it.
    fn heading_at(lines: &[&str], start: usize) -> Option<String> {
        let s1 = heading_search_start(start, 1);
        hunk_section_heading(lines, s1 - 1, -1).map(str::to_string)
    }

    #[test]
    fn the_section_heading_is_the_nearest_declaration_above_the_hunk() {
        let lines = ["use std::fs;", "fn main() {", "    body();", "}", ""];
        assert_eq!(heading_at(&lines, 3).as_deref(), Some("fn main() {"));
    }

    #[test]
    fn a_hunk_starting_at_the_first_line_has_no_heading() {
        let lines = ["fn main() {"];
        assert_eq!(heading_at(&lines, 1), None);
    }

    #[test]
    fn a_semicolon_terminated_line_still_provides_a_heading() {
        // `use std::collections::BTreeMap;` is the heading Git prints for hunks in Rust files, so a
        // trailing semicolon must not disqualify a line. Verified against `git diff` output on this
        // repository, where that exact line appears after `@@ -21,11 +21,11 @@`.
        let lines = ["let x = 1;", "", "body();"];
        assert_eq!(heading_at(&lines, 3).as_deref(), Some("let x = 1;"));
    }

    #[test]
    fn a_heading_is_truncated_to_the_measured_ceiling() {
        let long = "Write-Host \"".to_string() + &"=".repeat(65) + "\" -ForegroundColor Cyan";
        let lines = [long.as_str()];
        // `start = 2` means the hunk begins on the second line, so line 1 is the candidate heading.
        // Passing 1 would search before the first line and find nothing.
        let heading = heading_at(&lines, 2).expect("heading");
        assert_eq!(heading.len(), MAX_HEADING_LEN);
    }

    #[test]
    fn a_space_at_the_ceiling_is_removed_after_the_cut() {
        // Git copies 80 bytes and only then strips trailing whitespace. A line whose 80th byte is a
        // space therefore loses it; stripping before cutting would leave the space in place and the
        // header would carry one byte Git never prints. This is the exact shape that produced a
        // trailing space on `export async function scanAndRender(...) ` before the fix.
        let candidate = "a".repeat(79) + " tail";
        let lines = [candidate.as_str()];
        let heading = heading_at(&lines, 2).expect("heading");
        assert_eq!(heading.len(), 79);
        assert!(!heading.ends_with(' '), "{heading:?}");
    }

    #[test]
    fn a_heading_whose_cap_splits_a_character_drops_the_character() {
        // 78 `a` plus a three-byte character starting at byte 78: the cap at 80 falls inside it, and
        // Git's byte copy stops at 78. Measured against `git show` on a file built for this case.
        let candidate = "a".repeat(78) + "\u{4E2D}tail";
        let lines = [candidate.as_str()];
        let heading = heading_at(&lines, 2).expect("heading");
        assert_eq!(heading, "a".repeat(78));
    }

    #[test]
    fn a_heading_is_not_reused_from_beyond_the_previous_hunk() {
        // The second hunk's search must stop at the first hunk's start, not walk to the file top.
        // Git threads that bound through `funclineprev`; without it a file whose hunks are far apart
        // repeats the first hunk's heading, which is what the sweep flagged.
        let lines = ["fn-only", "}", "}", "}", "}", "}", "}", "}"];
        // First hunk starts at line 4, second at line 8. The second must find nothing between them.
        let first_bound = heading_search_start(4, 1);
        assert_eq!(
            hunk_section_heading(&lines, first_bound - 1, -1),
            Some("fn-only")
        );
        let second_bound = heading_search_start(8, 1);
        assert_eq!(
            hunk_section_heading(&lines, second_bound - 1, first_bound - 1),
            None
        );
    }

    #[test]
    fn a_rename_inside_one_directory_shows_only_the_changed_component() {
        // Measured: `git show --stat` prints `WebGames/config/domains/{account.json =>
        // account/core.json}` for a file moved into a subdirectory of the same name.
        assert_eq!(
            pprint_rename(
                "WebGames/config/domains/account.json",
                "WebGames/config/domains/account/core.json"
            ),
            "WebGames/config/domains/{account.json => account/core.json}"
        );
    }

    #[test]
    fn a_rename_across_directories_keeps_the_shared_tail_outside_the_braces() {
        assert_eq!(
            pprint_rename("src/a/mod.rs", "lib/a/mod.rs"),
            "{src => lib}/a/mod.rs"
        );
    }

    #[test]
    fn a_rename_with_no_shared_component_spells_both_paths() {
        assert_eq!(
            pprint_rename("alpha.txt", "beta.txt"),
            "alpha.txt => beta.txt"
        );
    }

    #[test]
    fn a_count_field_is_sized_by_its_largest_value() {
        assert_eq!(decimal_width(0), 1);
        assert_eq!(decimal_width(9), 1);
        assert_eq!(decimal_width(10), 2);
        assert_eq!(decimal_width(759), 3);
    }

    #[test]
    fn scaling_reserves_one_column_for_any_change() {
        // A single change in a 759-line diff still has to print one character, which is what the
        // `1 +` in `scale_linear` exists for.
        assert_eq!(scale_linear(1, 21, 759), 1);
        assert_eq!(scale_linear(759, 21, 759), 21);
        assert_eq!(scale_linear(0, 21, 759), 0);
    }

    #[test]
    fn a_name_that_fits_is_returned_unchanged() {
        assert_eq!(truncate_stat_name("src/a.rs", 20), "src/a.rs");
    }

    #[test]
    fn a_long_name_is_cut_at_a_component_boundary() {
        // Git drops leading characters and then retreats to the next slash, so the shortened name
        // always starts at a whole component. The expected value is the one `git diff --stat`
        // prints for this repository at 80 columns.
        assert_eq!(
            truncate_stat_name(
                ".agents/skills/auto-refactor-dev/references/praxis-client-and-diff-topology.md",
                50
            ),
            ".../references/praxis-client-and-diff-topology.md"
        );
    }
}
