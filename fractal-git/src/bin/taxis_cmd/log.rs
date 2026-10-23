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

use fg_core::error::{FractalError, FractalResult};
use fractal_git::constants::cli::CliTag;

use super::commit_walk::{walk_commits, CommitRecord};
use super::common::{print_json, reject, CliContext};
use super::diff;
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
enum ShowPart {
    /// Header plus unified patch.
    Patch,
    /// Header plus `--stat` summary.
    Stat,
    /// Header only.
    HeaderOnly,
}

/// Dispatches `taxis log`.
pub fn handle_log(ctx: &CliContext) {
    let request = match LogRequest::parse(&ctx.args) {
        Ok(parsed) => parsed,
        Err(reason) => reject(CliTag::ERROR, reason),
    };
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };

    let start = match view.resolve(&request.revision) {
        Ok(oid) => oid,
        Err(resolve_err) => {
            eprintln!("{} {}", CliTag::ERROR, resolve_err);
            std::process::exit(EXIT_NO_MATCH);
        }
    };
    let records = match walk_commits(&view, &[start]) {
        Ok(walked) => walked,
        Err(walk_err) => reject(CliTag::ERROR, walk_err),
    };
    let shown = &records[..records.len().min(request.limit)];
    // The width is a property of the repository, not of the request, so it is resolved once and
    // threaded to every renderer. Recomputing it per record would be correct but would also let one
    // renderer forget it.
    let width = abbrev_width(&view);

    if ctx.json_mode {
        report_log_json(shown, &request);
        return;
    }
    for (index, record) in shown.iter().enumerate() {
        match request.format.as_deref() {
            Some(template) => match render_format(template, record, width) {
                Ok(text) => println!("{text}"),
                Err(format_err) => reject(CliTag::ERROR, format_err),
            },
            None if request.oneline => {
                println!("{} {}", short_oid(&record.oid, width), record.subject())
            }
            None => {
                // Git's separator is a blank line *between* entries, not after each one: the output
                // ends on the last line of the message. Printing a trailing blank after every entry
                // adds one newline to the whole command, which is invisible in a terminal but makes
                // the output differ from `git log` by a byte.
                if index > 0 {
                    println!();
                }
                print_full_entry(record, width);
            }
        }
    }
}

/// One parsed `log` invocation.
struct LogRequest {
    revision: String,
    limit: usize,
    oneline: bool,
    format: Option<String>,
}

impl LogRequest {
    /// Parses flags and the optional revision.
    fn parse(args: &[String]) -> Result<Self, String> {
        let mut request = Self {
            revision: "HEAD".to_string(),
            limit: DEFAULT_LOG_LIMIT,
            oneline: false,
            format: None,
        };
        let mut cursor = 0usize;
        while cursor < args.len() {
            let argument = args[cursor].as_str();
            cursor += 1;
            match argument {
                "--oneline" => request.oneline = true,
                "--all" => request.limit = usize::MAX,
                "--format" | "--pretty" => {
                    let value = args
                        .get(cursor)
                        .ok_or_else(|| format!("{argument} requires a format string"))?;
                    request.format = Some(value.clone());
                    cursor += 1;
                }
                other if other.starts_with("--format=") => {
                    request.format = Some(other["--format=".len()..].to_string());
                }
                other if other.starts_with("--pretty=") => {
                    request.format = Some(other["--pretty=".len()..].to_string());
                }
                other
                    if other.starts_with('-')
                        && other.len() > 1
                        && other[1..]
                            .chars()
                            .all(|character| character.is_ascii_digit()) =>
                {
                    request.limit = other[1..]
                        .parse()
                        .map_err(|parse_err| format!("'-{other}' is not a count: {parse_err}"))?;
                }
                other if other.starts_with('-') => {
                    return Err(format!("log does not support the flag '{other}'"));
                }
                other => request.revision = other.to_string(),
            }
        }
        Ok(request)
    }
}

/// Prints one commit in Git's default multi-line form.
fn print_full_entry(record: &CommitRecord, width: usize) {
    println!("commit {}", record.oid.to_hex());
    if record.parents.len() >= 2 {
        println!(
            "Merge: {}",
            record
                .parents
                .iter()
                .map(|parent| short_oid(parent, width))
                .collect::<Vec<String>>()
                .join(" ")
        );
    }
    println!("Author: {} <{}>", record.author_name, record.author_mailbox);
    println!(
        "Date:   {}",
        format_date(record.author_time, record.author_offset_minutes)
    );
    println!();
    for line in record.message.trim_end().lines() {
        println!("    {line}");
    }
}

/// Renders one `--format` template.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] naming an unknown placeholder, so a typo fails instead of
/// printing a blank column.
fn render_format(template: &str, record: &CommitRecord, width: usize) -> FractalResult<String> {
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
            // `%%` is an escaped percent, and a lone trailing `%` is literal. Git collapses the
            // escaped form to one character; pushing `%` without consuming the second one leaves
            // `100%%` in the output where Git prints `100%`.
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

/// Resolves one `%`-placeholder.
fn resolve_placeholder(key: &str, record: &CommitRecord, width: usize) -> FractalResult<String> {
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

/// Width of an abbreviated object id in this repository's output.
///
/// Git derives the width from the object count and the resulting collision risk. A constant is
/// wrong for every repository whose count crosses a power of four: the same binary would print eight
/// characters in a 20k-object store and seven in a small one, and a caller comparing against
/// `git log --abbrev-commit` would see a difference on every line.
fn abbrev_width(view: &RepoView) -> usize {
    super::abbrev::abbreviation_width(view.approximate_object_count())
}

/// Returns the leading hex characters of `oid` at `width`.
fn short_oid(oid: &fg_core::models::Oid, width: usize) -> String {
    super::abbrev::abbreviate(oid, width)
}

/// Renders `seconds` in the recorded zone as `Thu Oct 22 21:33:52 2026 +0800`.
///
/// The conversion is pure integer arithmetic on the recorded offset. A timezone database would be
/// needed to name a zone, but the offset is what the commit actually stores, and inventing a zone
/// name from an offset is wrong for every zone that observes daylight saving.
fn format_date(seconds: i64, offset_minutes: i32) -> String {
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

/// Renders `seconds` in the recorded zone as ISO 8601: `2026-10-22T21:33:52+08:00`.
fn format_iso(seconds: i64, offset_minutes: i32) -> String {
    let (year, month, day, hour, minute, second, _) =
        civil_from_unix(seconds + i64::from(offset_minutes) * 60);
    let offset = offset_text(offset_minutes);
    let colon = format!("{}:{}", &offset[..3], &offset[3..]);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}{colon}")
}

/// Renders an offset in minutes as `±HHMM`.
fn offset_text(offset_minutes: i32) -> String {
    let sign = if offset_minutes < 0 { '-' } else { '+' };
    let total = offset_minutes.abs();
    format!("{sign}{:02}{:02}", total / 60, total % 60)
}

/// Converts a Unix timestamp to `(year, month, day, hour, minute, second, weekday)` in UTC.
///
/// This is Howard Hinnant's civil-from-days algorithm. It is used instead of a calendar crate
/// because the workspace dependency set does not include one for this crate, and the algorithm is
/// exact for every representable timestamp: it has no leap-second branch, which is deliberate —
/// Unix time does not count leap seconds either.
fn civil_from_unix(seconds: i64) -> (i64, u32, u32, u32, u32, u32, u32) {
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let hour = (seconds_of_day / 3600) as u32;
    let minute = ((seconds_of_day % 3600) / 60) as u32;
    let second = (seconds_of_day % 60) as u32;

    // 1970-01-01 was a Thursday, which is index 0 in a week starting at Thursday.
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

/// Dispatches `taxis show`.
pub fn handle_show(ctx: &CliContext) {
    let mut revision = "HEAD".to_string();
    let mut part = ShowPart::Patch;
    let mut context = 3usize;
    let mut unknown: Vec<String> = Vec::new();

    let mut cursor = 0usize;
    while cursor < ctx.args.len() {
        let argument = ctx.args[cursor].as_str();
        cursor += 1;
        match argument {
            "--stat" => part = ShowPart::Stat,
            "-s" | "--no-patch" => part = ShowPart::HeaderOnly,
            "--format" | "--pretty" => {
                if let Some(value) = ctx.args.get(cursor) {
                    let _ = value;
                    cursor += 1;
                }
            }
            other if other.starts_with("--format=") || other.starts_with("--pretty=") => {}
            other if other.starts_with("-U") && other.len() > 2 => {
                context = other[2..].parse().unwrap_or(3);
            }
            other if other.starts_with('-') => unknown.push(other.to_string()),
            other => revision = other.to_string(),
        }
    }
    if let Some(flag) = unknown.first() {
        reject(
            CliTag::ERROR,
            format!("show does not support the flag '{flag}'"),
        );
    }

    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };
    let commit = match view.resolve(&revision) {
        Ok(oid) => oid,
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };
    let records = match walk_commits(&view, &[commit]) {
        Ok(walked) => walked,
        Err(walk_err) => reject(CliTag::ERROR, walk_err),
    };
    let record = match records.first() {
        Some(found) => found,
        None => reject(CliTag::ERROR, "show resolved no commit"),
    };

    if ctx.json_mode {
        report_show_json(record, part);
        return;
    }

    println!("commit {}", record.oid.to_hex());
    if record.parents.len() >= 2 {
        println!(
            "Merge: {}",
            record
                .parents
                .iter()
                .map(|parent| short_oid(parent, abbrev_width(&view)))
                .collect::<Vec<String>>()
                .join(" ")
        );
    }
    println!("Author: {} <{}>", record.author_name, record.author_mailbox);
    println!(
        "Date:   {}",
        format_date(record.author_time, record.author_offset_minutes)
    );
    println!();
    for line in record.message.trim_end().lines() {
        println!("    {line}");
    }
    println!();

    if part == ShowPart::HeaderOnly {
        return;
    }
    // A merge commit has no single patch: what it "changed" depends on which parent it is read
    // against, and Git therefore prints no patch for one by default. Printing the first-parent diff
    // instead would attribute the second branch's whole contribution to the merge, and a reader
    // comparing the output with `git show` would see files that the merge never touched. `--stat`
    // is the exception: Git does report first-parent statistics there, because a summary has to pick
    // one baseline and the first parent is the branch that was merged into.
    if record.parents.len() >= 2 && part == ShowPart::Patch {
        return;
    }
    let parent = record.parents.first().map(|oid| oid.to_hex());
    let args = match part {
        ShowPart::Stat => vec!["--stat".to_string()],
        _ => vec![format!("-U{context}")],
    };
    // A root commit has no parent, so its left side is the empty tree. Passing the commit's own
    // tree as the left side would compare the tree against itself and print nothing, which reads as
    // "this commit changed nothing" — the opposite of what a root commit did.
    let left = parent.unwrap_or_else(|| diff::EMPTY_TREE_MARKER.to_string());
    let outcome = diff::run_revision_diff(&view, &left, &record.oid.to_hex(), &args);
    match outcome {
        Ok(()) => {}
        Err(diff_err) => reject(CliTag::ERROR, diff_err),
    }
}

/// Renders `log` output as JSON.
fn report_log_json(records: &[CommitRecord], request: &LogRequest) {
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

/// Renders `show` output as JSON.
fn report_show_json(record: &CommitRecord, part: ShowPart) {
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
        assert!(LogRequest::parse(&["--graph".to_string()]).is_err());
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
