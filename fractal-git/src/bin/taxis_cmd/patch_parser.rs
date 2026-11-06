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
    /// Creates an empty file patch with optional old and new file paths.
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

    for line in text.lines() {
        if apply_patch_header_line(
            line,
            strip_prefix,
            &mut patches,
            &mut current_patch,
            &mut current_hunk,
        ) {
            continue;
        }
        if let Some(hunk) = &mut current_hunk {
            append_hunk_line(hunk, line, reverse);
            if is_hunk_complete(hunk) {
                flush_hunk(&mut current_patch, &mut current_hunk);
            }
        }
    }

    flush_patch(&mut patches, &mut current_patch, &mut current_hunk);
    Ok(patches)
}

fn flush_hunk(current_patch: &mut Option<FilePatch>, current_hunk: &mut Option<DiffHunk>) {
    if let Some(hunk) = current_hunk.take() {
        if let Some(patch) = current_patch {
            patch.hunks.push(hunk);
        }
    }
}

fn flush_patch(
    patches: &mut Vec<FilePatch>,
    current_patch: &mut Option<FilePatch>,
    current_hunk: &mut Option<DiffHunk>,
) {
    flush_hunk(current_patch, current_hunk);
    if let Some(patch) = current_patch.take() {
        patches.push(patch);
    }
}

fn apply_patch_header_line(
    line: &str,
    strip_prefix: usize,
    patches: &mut Vec<FilePatch>,
    current_patch: &mut Option<FilePatch>,
    current_hunk: &mut Option<DiffHunk>,
) -> bool {
    if let Some(rest) = line.strip_prefix("diff --git ") {
        flush_patch(patches, current_patch, current_hunk);
        let parts: Vec<&str> = rest.split_whitespace().collect();
        let old_p = parts.first().map(|s| strip_path_prefix(s, strip_prefix));
        let new_p = parts.get(1).map(|s| strip_path_prefix(s, strip_prefix));
        *current_patch = Some(FilePatch::new_empty(old_p, new_p));
        return true;
    }
    if let Some(rest) = line.strip_prefix("--- ") {
        apply_old_file_header(rest.trim(), strip_prefix, current_patch);
        return true;
    }
    if let Some(rest) = line.strip_prefix("+++ ") {
        apply_new_file_header(rest.trim(), strip_prefix, current_patch);
        return true;
    }
    if line.starts_with("@@ ") {
        flush_hunk(current_patch, current_hunk);
        *current_hunk = parse_hunk_header(line);
        return true;
    }
    if line == "-- " || line == "--" {
        flush_patch(patches, current_patch, current_hunk);
        return true;
    }
    false
}

fn apply_old_file_header(
    path_str: &str,
    strip_prefix: usize,
    current_patch: &mut Option<FilePatch>,
) {
    if path_str == "/dev/null" {
        if let Some(p) = current_patch {
            p.is_new = true;
            p.old_path = None;
        }
    } else if let Some(p) = current_patch {
        p.old_path = Some(strip_path_prefix(path_str, strip_prefix));
    } else {
        *current_patch = Some(FilePatch::new_empty(
            Some(strip_path_prefix(path_str, strip_prefix)),
            None,
        ));
    }
}

fn apply_new_file_header(
    path_str: &str,
    strip_prefix: usize,
    current_patch: &mut Option<FilePatch>,
) {
    let Some(p) = current_patch else {
        return;
    };
    if path_str == "/dev/null" {
        p.is_deleted = true;
        p.new_path = None;
    } else {
        p.new_path = Some(strip_path_prefix(path_str, strip_prefix));
    }
}

fn append_hunk_line(hunk: &mut DiffHunk, line: &str, reverse: bool) {
    let Some(first_char) = line.chars().next() else {
        return;
    };
    match first_char {
        ' ' => hunk.lines.push(HunkLine::Context(line[1..].to_string())),
        '+' => {
            let content = line[1..].to_string();
            let entry = if reverse {
                HunkLine::Deletion(content)
            } else {
                HunkLine::Addition(content)
            };
            hunk.lines.push(entry);
        }
        '-' => {
            let content = line[1..].to_string();
            let entry = if reverse {
                HunkLine::Addition(content)
            } else {
                HunkLine::Deletion(content)
            };
            hunk.lines.push(entry);
        }
        _ => {}
    }
}

fn is_hunk_complete(hunk: &DiffHunk) -> bool {
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
    old_seen >= hunk.old_count && new_seen >= hunk.new_count
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

/// Strips leading path components from a relative path string up to the specified count.
pub fn strip_path_prefix(path_str: &str, count: usize) -> String {
    let clean = path_str.trim().trim_matches('"');
    if count == 0 || clean.is_empty() {
        return clean.to_string();
    }
    let mut parts: Vec<&str> = clean.split('/').collect();
    if parts.len() > count {
        parts.drain(0..count);
        parts.join("/")
    } else {
        clean.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_patch_new_empty() {
        let patch = FilePatch::new_empty(Some("a/foo.rs".into()), Some("b/foo.rs".into()));
        assert_eq!(patch.old_path.as_deref(), Some("a/foo.rs"));
        assert_eq!(patch.new_path.as_deref(), Some("b/foo.rs"));
        assert!(!patch.is_new);
        assert!(!patch.is_deleted);
        assert!(patch.hunks.is_empty());
    }

    #[test]
    fn test_strip_path_prefix() {
        assert_eq!(strip_path_prefix("a/b/c.txt", 0), "a/b/c.txt");
        assert_eq!(strip_path_prefix("a/b/c.txt", 1), "b/c.txt");
        assert_eq!(strip_path_prefix("a/b/c.txt", 2), "c.txt");
        assert_eq!(strip_path_prefix("a/b/c.txt", 5), "a/b/c.txt");
        assert_eq!(strip_path_prefix("", 1), "");
    }
}
