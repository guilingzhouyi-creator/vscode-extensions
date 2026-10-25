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

use super::commit_walk::parse_commit_record;
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

/// Dispatches `taxis blame`.
pub fn handle_blame(ctx: &CliContext) {
    let opts = parse_blame_options(&ctx.args);
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let target_rev = opts.revision.as_deref().unwrap_or("HEAD");
    let target_commit_oid = match view.resolve(target_rev) {
        Ok(oid) => oid,
        Err(err) => reject(
            CliTag::ERROR,
            format!("resolve revision '{target_rev}': {err}"),
        ),
    };

    let head_files = match flatten_commit_tree(&view, &target_commit_oid) {
        Ok(files) => files,
        Err(err) => reject(
            CliTag::ERROR,
            format!("read tree for '{target_rev}': {err}"),
        ),
    };

    let target_entry = match head_files.get(&opts.file_path) {
        Some(entry) => entry,
        None => reject(
            CliTag::ERROR,
            format!("fatal: no such path '{}' in {target_rev}", opts.file_path),
        ),
    };

    let target_payload = match view.blob_payload(&target_entry.oid) {
        Ok(bytes) => bytes,
        Err(err) => reject(CliTag::ERROR, format!("read blob: {err}")),
    };

    let target_text = String::from_utf8_lossy(&target_payload).to_string();
    let lines: Vec<String> = split_lines(&target_text)
        .into_iter()
        .map(|s| s.to_string())
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
        &view,
        &opts.file_path,
        target_commit_oid,
        &target_text,
        &lines,
    );

    // Apply -L line range filtering if specified
    let filtered_lines: Vec<BlameLine> = line_attributions
        .into_iter()
        .filter(|bl| {
            if let Some(start) = opts.start_line {
                if bl.line_no < start {
                    return false;
                }
            }
            if let Some(end) = opts.end_line {
                if bl.line_no > end {
                    return false;
                }
            }
            true
        })
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

fn run_blame_walk(
    view: &RepoView,
    file_path: &str,
    start_commit: Oid,
    start_content: &str,
    lines: &[String],
) -> Vec<BlameLine> {
    let mut attributions: Vec<Option<BlameLine>> = vec![None; lines.len()];
    let mut current_unattributed = lines.len();

    let mut current_commit = start_commit;
    let mut current_content = start_content.to_string();

    // Map from current_content line index (0-based) to original file line index (0-based)
    let mut active_mapping: Vec<Option<usize>> = (0..lines.len()).map(Some).collect();

    let mut visited = std::collections::HashSet::new();

    while current_unattributed > 0 && !visited.contains(&current_commit) {
        visited.insert(current_commit);

        let commit_obj = match view.object(&current_commit) {
            Ok(obj) => obj,
            Err(_) => break,
        };
        let commit_record = match parse_commit_record(current_commit, &commit_obj.payload) {
            Ok(rec) => rec,
            Err(_) => break,
        };

        let parent_oid = commit_record.parents.first().copied();

        match parent_oid {
            Some(p_oid) => {
                let parent_files = flatten_commit_tree(view, &p_oid).unwrap_or_default();
                let parent_blob_oid = parent_files.get(file_path).map(|e| e.oid);

                match parent_blob_oid {
                    Some(b_oid) => {
                        let parent_bytes = view.blob_payload(&b_oid).unwrap_or_default();
                        let parent_content = String::from_utf8_lossy(&parent_bytes).to_string();

                        let line_map =
                            BlameEngine::compute_line_mapping(&parent_content, &current_content);

                        let mut next_mapping = vec![None; parent_content.lines().count()];

                        for (cur_idx, &opt_parent_idx) in line_map.iter().enumerate() {
                            if let Some(orig_idx) = active_mapping.get(cur_idx).copied().flatten() {
                                match opt_parent_idx {
                                    Some(p_idx) => {
                                        // Line came from parent
                                        if p_idx < next_mapping.len() {
                                            next_mapping[p_idx] = Some(orig_idx);
                                        }
                                    }
                                    None => {
                                        // Line was introduced in current_commit!
                                        if attributions[orig_idx].is_none() {
                                            attributions[orig_idx] = Some(BlameLine {
                                                line_no: orig_idx + 1,
                                                commit_oid: current_commit,
                                                author_name: commit_record.author_name.clone(),
                                                commit_time: commit_record.author_time,
                                                content: lines[orig_idx].clone(),
                                            });
                                            current_unattributed -= 1;
                                        }
                                    }
                                }
                            }
                        }

                        current_commit = p_oid;
                        current_content = parent_content;
                        active_mapping = next_mapping;
                    }
                    None => {
                        // File was created in current_commit! All remaining unattributed lines belong to current_commit
                        for (orig_idx, slot) in attributions.iter_mut().enumerate() {
                            if slot.is_none() {
                                *slot = Some(BlameLine {
                                    line_no: orig_idx + 1,
                                    commit_oid: current_commit,
                                    author_name: commit_record.author_name.clone(),
                                    commit_time: commit_record.author_time,
                                    content: lines[orig_idx].clone(),
                                });
                            }
                        }
                        break;
                    }
                }
            }
            None => {
                // Root commit: all remaining lines belong to root commit
                for (orig_idx, slot) in attributions.iter_mut().enumerate() {
                    if slot.is_none() {
                        *slot = Some(BlameLine {
                            line_no: orig_idx + 1,
                            commit_oid: current_commit,
                            author_name: commit_record.author_name.clone(),
                            commit_time: commit_record.author_time,
                            content: lines[orig_idx].clone(),
                        });
                    }
                }
                break;
            }
        }
    }

    // Default any remaining fallback to start_commit
    attributions
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
