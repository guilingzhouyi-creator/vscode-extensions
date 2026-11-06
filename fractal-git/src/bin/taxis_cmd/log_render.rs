//! Module: taxis_cmd::log_render — Commit History Output and Formatting Engine
//! File Path: src/bin/taxis_cmd/log_render.rs
//! Architecture Role: Formats and prints commit logs, tree graphs, user-specified format
//!   strings, date representations, and JSON structured payloads for `log` and `show`.
//! Dependencies & Triggers: Dispatched by `taxis_cmd::log`.
//! Responsibilities: Output rendering, civil time conversion, and terminal formatting.
//! Exit Semantics & Design Rationale:
//!   - Isolates formatting and string allocation away from commit walk traversal.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage engine content-addressable storage guard

use fg_core::error::{FractalError, FractalResult};
use fractal_git::constants::cli::CliTag;

use super::commit_walk::CommitRecord;
use super::common::{print_json, reject};
use super::diff;
use super::log::{GraphRenderer, LogDiffMode, LogRequest, ShowPart, ShowRequest};
use super::repo_view::RepoView;

pub(crate) fn render_log_entries(view: &RepoView, shown: &[CommitRecord], request: &LogRequest) {
    let width = abbrev_width(view);
    let mut graph_renderer = request.graph.then(GraphRenderer::new);
    let diff_args = log_diff_args(request.diff_mode);

    for (index, record) in shown.iter().enumerate() {
        let (glyph, cont) = match &mut graph_renderer {
            Some(gr) => gr.next_prefix(record),
            None => (String::new(), String::new()),
        };
        render_single_log_commit(record, request, width, index, &glyph, &cont);
        if request.diff_mode.is_some() {
            render_log_commit_diff(view, record, &diff_args);
        }
    }
}

pub(crate) fn log_diff_args(diff_mode: Option<LogDiffMode>) -> Vec<String> {
    match diff_mode {
        Some(LogDiffMode::Stat) => vec!["--stat".into()],
        Some(LogDiffMode::NameOnly) => vec!["--name-only".into()],
        Some(LogDiffMode::NameStatus) => vec!["--name-status".into()],
        None => Vec::new(),
    }
}

pub(crate) fn render_single_log_commit(
    record: &CommitRecord,
    request: &LogRequest,
    width: usize,
    index: usize,
    glyph: &str,
    cont: &str,
) {
    match request.format.as_deref() {
        Some(template) => match render_format(template, record, width) {
            Ok(text) => println!("{glyph}{text}"),
            Err(format_err) => reject(CliTag::ERROR, format_err),
        },
        None if request.oneline => {
            println!(
                "{glyph}{} {}",
                short_oid(&record.oid, width),
                record.subject()
            )
        }
        None => {
            if index > 0 && !request.graph {
                println!();
            }
            print_full_entry_with_prefix(record, width, glyph, cont);
        }
    }
}

pub(crate) fn render_log_commit_diff(view: &RepoView, record: &CommitRecord, diff_args: &[String]) {
    let left_holder;
    let left = match record.parents.first() {
        Some(p_oid) => {
            left_holder = p_oid.to_hex();
            left_holder.as_str()
        }
        None => diff::EMPTY_TREE_MARKER,
    };
    let right = record.oid.to_hex();
    let _ = diff::run_revision_diff(view, left, &right, diff_args);
}

pub(crate) fn print_full_entry_with_prefix(
    record: &CommitRecord,
    width: usize,
    glyph: &str,
    cont: &str,
) {
    println!("{glyph}commit {}", record.oid.to_hex());
    if record.parents.len() >= 2 {
        println!(
            "{cont}Merge: {}",
            record
                .parents
                .iter()
                .map(|parent| short_oid(parent, width))
                .collect::<Vec<String>>()
                .join(" ")
        );
    }
    println!(
        "{cont}Author: {} <{}>",
        record.author_name, record.author_mailbox
    );
    println!(
        "{cont}Date:   {}",
        format_date(record.author_time, record.author_offset_minutes)
    );
    println!("{cont}");
    for line in record.message.trim_end().lines() {
        println!("{cont}    {line}");
    }
}

pub(crate) fn render_format(
    template: &str,
    record: &CommitRecord,
    width: usize,
) -> FractalResult<String> {
    let mut rendered = String::with_capacity(template.len() + 64);
    let mut cursor = 0usize;
    while let Some(start) = template[cursor..].find('%') {
        let start = cursor + start;
        rendered.push_str(&template[cursor..start]);
        let mut end = start + 1;
        let bytes = template.as_bytes();
        while end < bytes.len() && bytes[end].is_ascii_alphabetic() {
            end += 1;
        }
        let key = &template[start + 1..end];
        if key.is_empty() {
            if template[start + 1..].starts_with('%') {
                rendered.push('%');
                cursor = start + 2;
            } else {
                rendered.push('%');
                cursor = start + 1;
            }
            continue;
        }
        rendered.push_str(&resolve_placeholder(key, record, width)?);
        cursor = end;
    }
    rendered.push_str(&template[cursor..]);
    Ok(rendered)
}

pub(crate) fn resolve_placeholder(
    key: &str,
    record: &CommitRecord,
    width: usize,
) -> FractalResult<String> {
    let value = match key {
        "H" => record.oid.to_hex(),
        "h" => short_oid(&record.oid, width),
        "T" => record.tree.to_hex(),
        "P" => record
            .parents
            .iter()
            .map(|oid| oid.to_hex())
            .collect::<Vec<String>>()
            .join(" "),
        "an" => record.author_name.clone(),
        "ae" => record.author_mailbox.clone(),
        "at" => record.author_time.to_string(),
        "aI" => format_iso(record.author_time, record.author_offset_minutes),
        "ad" => format_date(record.author_time, record.author_offset_minutes),
        "cn" => record.committer_name.clone(),
        "ce" => record.committer_mailbox.clone(),
        "ct" => record.committer_time.to_string(),
        "cI" => format_iso(record.committer_time, record.committer_offset_minutes),
        "s" => record.subject().to_string(),
        "B" => record.message.clone(),
        "n" => "\n".to_string(),
        other => {
            return Err(FractalError::ObjectCodec(format!(
                "unknown log format placeholder '%{other}'; supported: %H %h %T %P %an %ae %at %aI \
                 %ad %cn %ce %ct %cI %s %B %n"
            )))
        }
    };
    Ok(value)
}

pub(crate) fn abbrev_width(view: &RepoView) -> usize {
    super::abbrev::abbreviation_width(view.approximate_object_count())
}

pub(crate) fn short_oid(oid: &fg_core::models::Oid, width: usize) -> String {
    super::abbrev::abbreviate(oid, width)
}

pub(crate) fn format_date(seconds: i64, offset_minutes: i32) -> String {
    let (year, month, day, hour, minute, second, weekday) =
        civil_from_unix(seconds + i64::from(offset_minutes) * 60);
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const WEEKDAYS: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    let month_name = MONTHS.get((month - 1) as usize).copied().unwrap_or("---");
    let weekday_name = WEEKDAYS.get(weekday as usize).copied().unwrap_or("---");
    format!(
        "{weekday_name} {month_name} {day} {hour:02}:{minute:02}:{second:02} {year} {}",
        offset_text(offset_minutes)
    )
}

pub(crate) fn format_iso(seconds: i64, offset_minutes: i32) -> String {
    let (year, month, day, hour, minute, second, _) =
        civil_from_unix(seconds + i64::from(offset_minutes) * 60);
    let offset = offset_text(offset_minutes);
    let colon = format!("{}:{}", &offset[..3], &offset[3..]);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}{colon}")
}

pub(crate) fn offset_text(offset_minutes: i32) -> String {
    let sign = if offset_minutes < 0 { '-' } else { '+' };
    let total = offset_minutes.abs();
    format!("{sign}{:02}{:02}", total / 60, total % 60)
}

pub(crate) fn civil_from_unix(seconds: i64) -> (i64, u32, u32, u32, u32, u32, u32) {
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let hour = (seconds_of_day / 3600) as u32;
    let minute = ((seconds_of_day % 3600) / 60) as u32;
    let second = (seconds_of_day % 60) as u32;

    let weekday = days.rem_euclid(7) as u32;

    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if month <= 2 { year + 1 } else { year };
    (year, month, day, hour, minute, second, weekday)
}

pub(crate) fn render_show_commit(view: &RepoView, record: &CommitRecord, request: &ShowRequest) {
    print_full_entry_with_prefix(record, abbrev_width(view), "", "");
    println!();
    if request.part == ShowPart::HeaderOnly
        || (record.parents.len() >= 2 && request.part == ShowPart::Patch)
    {
        return;
    }
    let parent = record.parents.first().map(|oid| oid.to_hex());
    let args = match request.part {
        ShowPart::Stat => vec!["--stat".to_string()],
        _ => vec![format!("-U{}", request.context)],
    };
    let left = parent.unwrap_or_else(|| diff::EMPTY_TREE_MARKER.to_string());
    if let Err(diff_err) = diff::run_revision_diff(view, &left, &record.oid.to_hex(), &args) {
        reject(CliTag::ERROR, diff_err);
    }
}

pub(crate) fn report_log_json(records: &[CommitRecord], request: &LogRequest) {
    let entries: Vec<serde_json::Value> = records
        .iter()
        .map(|record| {
            serde_json::json!({
                "oid": record.oid.to_hex(),
                "tree": record.tree.to_hex(),
                "parents": record.parents.iter().map(|oid| oid.to_hex()).collect::<Vec<String>>(),
                "author": {
                    "name": record.author_name,
                    "email": record.author_mailbox,
                    "time": record.author_time,
                    "offset": offset_text(record.author_offset_minutes),
                },
                "committer": {
                    "name": record.committer_name,
                    "email": record.committer_mailbox,
                    "time": record.committer_time,
                    "offset": offset_text(record.committer_offset_minutes),
                },
                "subject": record.subject(),
                "message": record.message,
                "agent_authored": record.is_agent_authored(),
            })
        })
        .collect();
    let payload = serde_json::json!({
        "engine": "taxis",
        "operation": "log",
        "revision": request.revision,
        "entry_count": entries.len(),
        "commits": entries,
    });
    print_json(&payload);
}

pub(crate) fn report_show_json(record: &CommitRecord, part: ShowPart) {
    let payload = serde_json::json!({
        "engine": "taxis",
        "operation": "show",
        "oid": record.oid.to_hex(),
        "tree": record.tree.to_hex(),
        "parents": record.parents.iter().map(|oid| oid.to_hex()).collect::<Vec<String>>(),
        "author": {
            "name": record.author_name,
            "email": record.author_mailbox,
            "time": record.author_time,
            "offset": offset_text(record.author_offset_minutes),
        },
        "committer": {
            "name": record.committer_name,
            "email": record.committer_mailbox,
            "time": record.committer_time,
            "offset": offset_text(record.committer_offset_minutes),
        },
        "subject": record.subject(),
        "message": record.message,
        "patch": matches!(part, ShowPart::Patch),
        "stat": matches!(part, ShowPart::Stat),
    });
    print_json(&payload);
}
