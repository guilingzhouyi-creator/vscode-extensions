//! Module: taxis_cmd::daemon_scheduler — Zero-Alloc Semantic Line Scanner
//! File Path: src/bin/taxis_cmd/daemon_scheduler/eloc_scan.rs
//! Architecture Role: Scans raw UTF-8 byte slices forward and backward for non-blank,
//!   non-comment semantic code lines without allocating intermediate `Vec` or `String` buffers.
//! Dependencies & Triggers: Called by `eloc_diff.rs`.
//! Responsibilities: Provide deterministic semantic line tokenization over borrowed slices.
//! Exit Semantics & Design Rationale: Pure slice arithmetic preserves zero loop allocation.

pub(super) fn count_semantic_lines(bytes: &[u8]) -> usize {
    let mut count = 0usize;
    let mut pos = 0usize;
    while next_semantic_line_fwd(bytes, &mut pos, bytes.len()).is_some() {
        count += 1;
    }
    count
}

pub(super) fn next_semantic_line_fwd<'a>(
    bytes: &'a [u8],
    pos: &mut usize,
    limit: usize,
) -> Option<&'a [u8]> {
    while *pos < limit {
        let start = *pos;
        let rel_end = bytes[start..limit].iter().position(|&b| b == b'\n');
        let line_end = rel_end.map_or(limit, |idx| start + idx);
        *pos = if rel_end.is_some() {
            line_end + 1
        } else {
            limit
        };
        let trimmed = trim_ascii_slice(&bytes[start..line_end]);
        if !is_non_semantic_line(trimmed) {
            return Some(trimmed);
        }
    }
    None
}

pub(super) fn prev_semantic_line_bwd<'a>(
    bytes: &'a [u8],
    end: &mut usize,
    min_start: usize,
) -> Option<&'a [u8]> {
    while *end > min_start {
        let mut slice_end = *end;
        if bytes[min_start..slice_end].last().copied() == Some(b'\n') {
            slice_end -= 1;
        }
        let sub = &bytes[min_start..slice_end];
        let start = sub
            .iter()
            .rposition(|&b| b == b'\n')
            .map_or(min_start, |idx| min_start + idx + 1);
        *end = if start > min_start {
            start - 1
        } else {
            min_start
        };
        let trimmed = trim_ascii_slice(&bytes[start..slice_end]);
        if !is_non_semantic_line(trimmed) {
            return Some(trimmed);
        }
    }
    None
}

fn trim_ascii_slice(slice: &[u8]) -> &[u8] {
    let start = slice
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(slice.len());
    let rest = &slice[start..];
    let end = rest
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .map_or(0, |idx| idx + 1);
    &rest[..end]
}

fn is_non_semantic_line(trimmed: &[u8]) -> bool {
    trimmed.is_empty()
        || trimmed.starts_with(b"//")
        || trimmed.starts_with(b"#")
        || trimmed.starts_with(b"/*")
        || trimmed.starts_with(b"*")
        || trimmed == b"*/"
}
