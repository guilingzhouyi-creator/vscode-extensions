//! Module: taxis_cmd::blame — Native Line Attribution Command Dispatcher
//! File Path: src/bin/taxis_cmd/blame.rs
//! Architecture Role: Dispatches `taxis blame`, calculating historical authorship and commit origin
//!   for every line in a file using the BlameEngine and DAG history walking.
//! Dependencies & Triggers: Dispatched by `taxis blame`.
//! Responsibilities: Parse file arguments and line ranges, compute line attributions, and format output.
//! Exit Semantics & Design Rationale:
//!   - Supports Git-compatible standard porcelain layout and machine JSON output.
//!   - Supports optional `-L start,end` line slice filtering.

use fg_algorithms::blame::{BlameEngine, BlameLine};
use fg_algorithms::diff::split_lines;
use fg_core::models::Oid;
use fractal_git::constants::cli::CliTag;

use super::commit_walk::{parse_commit_record, CommitRecord};
use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::tree_view::flatten_commit_tree;

/// Options for `taxis blame`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct BlameOptions {
    file_path: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
    revision: Option<String>,
}

/// Mutable state across commit steps in `run_blame_walk`.
struct BlameWalkState<'a> {
    lines: &'a [String],
    attributions: Vec<Option<BlameLine>>,
    unattributed: usize,
    current_commit: Oid,
    current_content: String,
    active_mapping: Vec<Option<usize>>,
}

/// Dispatches `taxis blame`.
pub fn handle_blame(ctx: &CliContext) {
    let opts = parse_blame_options(&ctx.args);
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let target_rev = opts.revision.as_deref().unwrap_or("HEAD");
    let target_commit_oid = view.resolve(target_rev).unwrap_or_else(|err| {
        reject(
            CliTag::ERROR,
            format!("resolve revision '{target_rev}': {err}"),
        )
    });
    let head_files = flatten_commit_tree(&view, &target_commit_oid).unwrap_or_else(|err| {
        reject(
            CliTag::ERROR,
            format!("read tree for '{target_rev}': {err}"),
        )
    });
    let target_entry = head_files.get(&opts.file_path).unwrap_or_else(|| {
        reject(
            CliTag::ERROR,
            format!("fatal: no such path '{}' in {target_rev}", opts.file_path),
        )
    });
    let target_payload = view
        .blob_payload(&target_entry.oid)
        .unwrap_or_else(|err| reject(CliTag::ERROR, format!("read blob: {err}")));

    let target_text = String::from_utf8_lossy(&target_payload).to_string();
    let lines: Vec<String> = split_lines(&target_text)
        .into_iter()
        .map(str::to_string)
        .collect();
    if lines.is_empty() {
        if ctx.json_mode {
            print_json(&serde_json::json!({
                "path": opts.file_path,
                "lines": [],
                "hunks": []
            }));
        }
        return;
    }

    let line_attributions = run_blame_walk(
        (&view, &opts.file_path),
        target_commit_oid,
        (&target_text, &lines),
    );
    let filtered_lines: Vec<BlameLine> = line_attributions
        .into_iter()
        .filter(|bl| line_within_range(bl.line_no, opts.start_line, opts.end_line))
        .collect();
    let hunks = BlameEngine::aggregate_hunks(&filtered_lines);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "path": opts.file_path,
            "revision": target_rev,
            "total_lines": filtered_lines.len(),
            "lines": filtered_lines,
            "hunks": hunks,
        }));
    } else {
        for bl in &filtered_lines {
            let short_sha = &bl.commit_oid.to_hex()[..8];
            println!(
                "{} ({:<12} {:>4}) {}",
                short_sha, bl.author_name, bl.line_no, bl.content
            );
        }
    }
}

/// Checks whether a 1-based line number falls within `[start_line, end_line]`.
fn line_within_range(line_no: usize, start_line: Option<usize>, end_line: Option<usize>) -> bool {
    start_line.is_none_or(|start| line_no >= start) && end_line.is_none_or(|end| line_no <= end)
}

/// Walks parent commits along the first-parent chain to attribute each line of `file_path`.
fn run_blame_walk(
    view_and_path: (&RepoView, &str),
    start_commit: Oid,
    content_and_lines: (&str, &[String]),
) -> Vec<BlameLine> {
    let (view, file_path) = view_and_path;
    let (start_content, lines) = content_and_lines;
    let mut state = BlameWalkState {
        lines,
        attributions: vec![None; lines.len()],
        unattributed: lines.len(),
        current_commit: start_commit,
        current_content: start_content.to_string(),
        active_mapping: (0..lines.len()).map(Some).collect(),
    };
    let mut visited = std::collections::HashSet::new();

    while state.unattributed > 0 && visited.insert(state.current_commit) {
        let Ok(commit_obj) = view.object(&state.current_commit) else {
            break;
        };
        let Ok(commit_record) = parse_commit_record(state.current_commit, &commit_obj.payload)
        else {
            break;
        };
        if !step_blame_commit(view, file_path, (&commit_record, &mut state)) {
            break;
        }
    }

    state
        .attributions
        .into_iter()
        .enumerate()
        .map(|(idx, opt)| {
            opt.unwrap_or_else(|| BlameLine {
                line_no: idx + 1,
                commit_oid: start_commit,
                author_name: "unknown".into(),
                commit_time: 0,
                content: lines[idx].clone(),
            })
        })
        .collect()
}

/// Processes one commit step in the blame walk; returns `false` when the walk terminates.
fn step_blame_commit(
    view: &RepoView,
    file_path: &str,
    record_and_state: (&CommitRecord, &mut BlameWalkState<'_>),
) -> bool {
    let (commit_record, state) = record_and_state;
    let Some(parent_oid) = commit_record.parents.first().copied() else {
        attribute_remaining_lines(commit_record, state);
        return false;
    };
    let parent_files = flatten_commit_tree(view, &parent_oid).unwrap_or_default();
    let Some(parent_entry) = parent_files.get(file_path) else {
        attribute_remaining_lines(commit_record, state);
        return false;
    };

    let parent_bytes = view.blob_payload(&parent_entry.oid).unwrap_or_default();
    let parent_content = String::from_utf8_lossy(&parent_bytes).to_string();
    let line_map = BlameEngine::compute_line_mapping(&parent_content, &state.current_content);
    let mut next_mapping = vec![None; parent_content.lines().count()];

    for (cur_idx, &opt_parent_idx) in line_map.iter().enumerate() {
        let Some(orig_idx) = state.active_mapping.get(cur_idx).copied().flatten() else {
            continue;
        };
        match opt_parent_idx {
            Some(p_idx) if p_idx < next_mapping.len() => {
                next_mapping[p_idx] = Some(orig_idx);
            }
            None if state.attributions[orig_idx].is_none() => {
                state.attributions[orig_idx] =
                    Some(make_blame_line(orig_idx, commit_record, state.lines));
                state.unattributed -= 1;
            }
            _ => {}
        }
    }

    state.current_commit = parent_oid;
    state.current_content = parent_content;
    state.active_mapping = next_mapping;
    true
}

/// Attributes all remaining unattributed lines to `commit_record`.
fn attribute_remaining_lines(commit_record: &CommitRecord, state: &mut BlameWalkState<'_>) {
    for (orig_idx, slot) in state.attributions.iter_mut().enumerate() {
        if slot.is_none() {
            *slot = Some(make_blame_line(orig_idx, commit_record, state.lines));
        }
    }
    state.unattributed = 0;
}

/// Builds a [`BlameLine`] for original 0-based line index `orig_idx`.
fn make_blame_line(orig_idx: usize, record: &CommitRecord, lines: &[String]) -> BlameLine {
    BlameLine {
        line_no: orig_idx + 1,
        commit_oid: record.oid,
        author_name: record.author_name.clone(),
        commit_time: record.author_time,
        content: lines[orig_idx].clone(),
    }
}

fn parse_blame_options(args: &[String]) -> BlameOptions {
    let mut file_path = String::new();
    let mut start_line = None;
    let mut end_line = None;
    let mut revision = None;

    let mut cursor = 0;
    while cursor < args.len() {
        let arg = &args[cursor];
        if (arg == "-L" || arg == "--line-range") && cursor + 1 < args.len() {
            let range_str = &args[cursor + 1];
            if let Some((s, e)) = range_str.split_once(',') {
                start_line = s.trim().parse::<usize>().ok();
                end_line = e.trim().parse::<usize>().ok();
            } else if let Ok(s) = range_str.trim().parse::<usize>() {
                start_line = Some(s);
            }
            cursor += 2;
            continue;
        } else if (arg == "-r" || arg == "--revision") && cursor + 1 < args.len() {
            revision = Some(args[cursor + 1].clone());
            cursor += 2;
            continue;
        } else if !arg.starts_with('-') && file_path.is_empty() {
            file_path = arg.clone();
        }
        cursor += 1;
    }

    if file_path.is_empty() {
        reject(
            CliTag::ERROR,
            "usage: taxis blame <file> [-L <start>,<end>] [--revision <rev>]",
        );
    }

    BlameOptions {
        file_path,
        start_line,
        end_line,
        revision,
    }
}
