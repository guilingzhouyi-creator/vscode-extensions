//! Module: taxis_cmd::patch_parser — Unified Diff Patch Parser
//! File Path: src/bin/taxis_cmd/patch_parser.rs
//! Architecture Role: Pure data structures and parser for unified diff patches and hunks.
//! Dependencies & Triggers: Consumed by `apply.rs` and `am.rs`.
//! Responsibilities: Parse unified diff byte streams into structured FilePatch and DiffHunk representations.
//! Exit Semantics & Design Rationale: Pure functional parser returning FractalResult.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-ALG-001`: Unified patch generation and application

use fg_core::error::FractalResult;

/// A parsed unified diff file change.
#[derive(Debug, Clone)]
pub struct FilePatch {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub is_new: bool,
    pub is_deleted: bool,
    pub hunks: Vec<DiffHunk>,
}

impl FilePatch {
    pub fn new_empty(old_path: Option<String>, new_path: Option<String>) -> Self {
        Self {
            old_path,
            new_path,
            is_new: false,
            is_deleted: false,
            hunks: Vec::new(),
        }
    }
}

/// A single hunk inside a unified diff.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct DiffHunk {
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
    pub lines: Vec<HunkLine>,
}

/// A line within a hunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HunkLine {
    Context(String),
    Addition(String),
    Deletion(String),
}

/// Parses unified diff bytes into structured file patches.
pub fn parse_unified_diff(
    bytes: &[u8],
    strip_prefix: usize,
    reverse: bool,
) -> FractalResult<Vec<FilePatch>> {
    let text = String::from_utf8_lossy(bytes);
    let mut patches = Vec::new();
    let mut current_patch: Option<FilePatch> = None;
    let mut current_hunk: Option<DiffHunk> = None;

    let lines: Vec<&str> = text.lines().collect();
    let mut idx = 0;

    while idx < lines.len() {
        let line = lines[idx];

        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some(hunk) = current_hunk.take() {
                if let Some(p) = &mut current_patch {
                    p.hunks.push(hunk);
                }
            }
            if let Some(p) = current_patch.take() {
                patches.push(p);
            }

            let parts: Vec<&str> = rest.split_whitespace().collect();
            let old_p = parts.first().map(|s| strip_path_prefix(s, strip_prefix));
            let new_p = parts.get(1).map(|s| strip_path_prefix(s, strip_prefix));

            current_patch = Some(FilePatch::new_empty(old_p, new_p));
            idx += 1;
            continue;
        }

        if let Some(rest) = line.strip_prefix("--- ") {
            let path_str = rest.trim();
            if path_str == "/dev/null" {
                if let Some(p) = &mut current_patch {
                    p.is_new = true;
                    p.old_path = None;
                }
            } else if current_patch.is_none() {
                current_patch = Some(FilePatch::new_empty(
                    Some(strip_path_prefix(path_str, strip_prefix)),
                    None,
                ));
            } else if let Some(p) = &mut current_patch {
                p.old_path = Some(strip_path_prefix(path_str, strip_prefix));
            }
            idx += 1;
            continue;
        }

        if let Some(rest) = line.strip_prefix("+++ ") {
            let path_str = rest.trim();
            if path_str == "/dev/null" {
                if let Some(p) = &mut current_patch {
                    p.is_deleted = true;
                    p.new_path = None;
                }
            } else if let Some(p) = &mut current_patch {
                p.new_path = Some(strip_path_prefix(path_str, strip_prefix));
            }
            idx += 1;
            continue;
        }

        if line.starts_with("@@ ") {
            if let Some(hunk) = current_hunk.take() {
                if let Some(p) = &mut current_patch {
                    p.hunks.push(hunk);
                }
            }
            if let Some(parsed_hunk) = parse_hunk_header(line) {
                current_hunk = Some(parsed_hunk);
            }
            idx += 1;
            continue;
        }

        if line == "-- " || line == "--" {
            if let Some(hunk) = current_hunk.take() {
                if let Some(p) = &mut current_patch {
                    p.hunks.push(hunk);
                }
            }
            if let Some(p) = current_patch.take() {
                patches.push(p);
            }
            idx += 1;
            continue;
        }

        if let Some(hunk) = &mut current_hunk {
            if let Some(first_char) = line.chars().next() {
                match first_char {
                    ' ' => hunk.lines.push(HunkLine::Context(line[1..].to_string())),
                    '+' => {
                        let content = line[1..].to_string();
                        if reverse {
                            hunk.lines.push(HunkLine::Deletion(content));
                        } else {
                            hunk.lines.push(HunkLine::Addition(content));
                        }
                    }
                    '-' => {
                        let content = line[1..].to_string();
                        if reverse {
                            hunk.lines.push(HunkLine::Addition(content));
                        } else {
                            hunk.lines.push(HunkLine::Deletion(content));
                        }
                    }
                    '\\' => {
                        // "\ No newline at end of file"
                    }
                    _ => {}
                }
            }

            let mut old_seen = 0;
            let mut new_seen = 0;
            for hl in &hunk.lines {
                match hl {
                    HunkLine::Context(_) => {
                        old_seen += 1;
                        new_seen += 1;
                    }
                    HunkLine::Deletion(_) => old_seen += 1,
                    HunkLine::Addition(_) => new_seen += 1,
                }
            }
            if old_seen >= hunk.old_count && new_seen >= hunk.new_count {
                if let Some(finished_hunk) = current_hunk.take() {
                    if let Some(p) = &mut current_patch {
                        p.hunks.push(finished_hunk);
                    }
                }
            }
        }

        idx += 1;
    }

    if let Some(hunk) = current_hunk.take() {
        if let Some(p) = &mut current_patch {
            p.hunks.push(hunk);
        }
    }
    if let Some(p) = current_patch.take() {
        patches.push(p);
    }

    Ok(patches)
}

/// Parses `@@ -old_start,old_count +new_start,new_count @@`.
fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
    let trimmed = line.trim();
    if !trimmed.starts_with("@@ ") {
        return None;
    }
    let after_start = &trimmed[3..];
    let end_idx = after_start.find(" @@")?;
    let ranges_str = &after_start[..end_idx];

    let parts: Vec<&str> = ranges_str.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }

    let (old_start, old_count) = parse_range_part(parts[0].strip_prefix('-')?)?;
    let (new_start, new_count) = parse_range_part(parts[1].strip_prefix('+')?)?;

    Some(DiffHunk {
        old_start,
        old_count,
        new_start,
        new_count,
        lines: Vec::new(),
    })
}

fn parse_range_part(part: &str) -> Option<(usize, usize)> {
    if let Some((start, count)) = part.split_once(',') {
        Some((start.parse().ok()?, count.parse().ok()?))
    } else {
        Some((part.parse().ok()?, 1))
    }
}

pub fn strip_path_prefix(path_str: &str, count: usize) -> String {
    let clean = path_str.trim().trim_matches('"');
    let mut parts: Vec<&str> = clean.split('/').collect();
    if parts.len() > count {
        parts.drain(0..count);
        parts.join("/")
    } else {
        clean.to_string()
    }
}
