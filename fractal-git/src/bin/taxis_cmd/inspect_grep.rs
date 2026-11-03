//! Module: taxis_cmd::inspect_grep — Tracked Content Search Command
//! File Path: src/bin/taxis_cmd/inspect_grep.rs
//! Architecture Role: Implements `taxis grep`, searching tracked index file contents for patterns.
//! Dependencies & Triggers: Dispatched by `taxis grep`, re-exported by `inspect.rs`.
//! Responsibilities: Search indexed object payloads, support case-insensitive matching and pathspec filtering.
//! Exit Semantics & Design Rationale:
//!   - Exits 0 on match found.
//!   - Exits 1 (EXIT_NO_MATCH) when nothing matched, matching Git behavior.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use fg_core::models::Oid;

use super::common::{fail_usage, print_json, CliContext};
use super::repo_view::RepoView;

/// Exit status Git uses when a search found nothing.
pub const EXIT_NO_MATCH: i32 = 1;

/// Prints usage for `taxis grep`.
pub fn print_grep_help() {
    println!(
        "Usage: taxis grep [-i] [-n] <pattern> [-- <path>...]\n\n\
         Search tracked file contents for a literal string.\n\n\
         Options:\n\
           -i, --ignore-case   Case-insensitive match\n\
           -n, --line-number   Prefix each match with its line number (default)\n\
           -h, --help          Show this help message\n\n\
         Exits 1 when nothing matched and 0 when something did, like git."
    );
}

/// Dispatches `taxis grep`.
pub fn handle_grep(ctx: &CliContext) {
    let mut ignore_case = false;
    let mut pattern: Option<String> = None;
    let mut pathspecs: Vec<String> = Vec::new();
    let mut after_separator = false;

    for argument in &ctx.args {
        if after_separator {
            pathspecs.push(argument.clone());
            continue;
        }
        match argument.as_str() {
            "-h" | "--help" => {
                print_grep_help();
                return;
            }
            "--" => after_separator = true,
            "-i" | "--ignore-case" => ignore_case = true,
            "-n" | "--line-number" => {}
            other if other.starts_with('-') && other.len() > 1 => {
                fail_usage(format!("grep: unknown option '{other}'"));
            }
            other if pattern.is_none() => pattern = Some(other.to_string()),
            other => pathspecs.push(other.to_string()),
        }
    }

    let Some(pattern) = pattern else {
        fail_usage("grep requires a pattern");
    };

    let view = RepoView::open_or_exit(ctx);
    let needle = if ignore_case {
        pattern.to_lowercase()
    } else {
        pattern.clone()
    };

    let entries = super::checkout::load_index_entries(view.git_dir());
    let indexed: Vec<(String, Oid)> = entries
        .into_iter()
        .map(|(path, entry)| (path, entry.oid))
        .collect();

    let mut matched_any = false;
    let mut json_hits: Vec<serde_json::Value> = Vec::new();
    let mut ordered: Vec<(String, Oid)> = indexed;
    ordered.sort_by(|left, right| left.0.cmp(&right.0));

    for (path, oid) in ordered {
        if !pathspecs.is_empty() && !pathspecs.iter().any(|spec| path_matches(&path, spec)) {
            continue;
        }
        let Ok(object) = view.object(&oid) else {
            continue;
        };
        let Ok(text) = String::from_utf8(object.payload.clone()) else {
            continue;
        };
        for (line_index, line) in text.lines().enumerate() {
            let haystack = if ignore_case {
                line.to_lowercase()
            } else {
                line.to_string()
            };
            if !haystack.contains(&needle) {
                continue;
            }
            matched_any = true;
            if ctx.json_mode {
                json_hits.push(serde_json::json!({
                    "path": path,
                    "line": line_index + 1,
                    "text": line,
                }));
            } else {
                println!("{path}:{}:{}", line_index + 1, line);
            }
        }
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "grep",
            "pattern": pattern,
            "matches": json_hits,
        }));
    }

    std::process::exit(if matched_any { 0 } else { EXIT_NO_MATCH });
}

/// Reports whether `path` equals `spec` or lives below it.
fn path_matches(path: &str, spec: &str) -> bool {
    let normalized = spec.replace('\\', "/");
    let trimmed = normalized.trim_start_matches("./").trim_end_matches('/');
    path == trimmed || path.starts_with(&format!("{trimmed}/"))
}
