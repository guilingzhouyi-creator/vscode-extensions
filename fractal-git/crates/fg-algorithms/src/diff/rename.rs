//! Module: fg-algorithms::diff::rename — Rename Detection
//! File Path: crates/fg-algorithms/src/diff/rename.rs
//! Architecture Role: Decides which deletions and creations in a tree comparison are the same file
//!   under a new path, and how similar the two sides are.
//! Dependencies & Triggers: Called by `taxis diff` and `taxis show` after the path maps are built and
//!   before any patch text is rendered.
//! Responsibilities: Score every deletion/creation pair the way Git does, and report the winning
//!   pairings with their similarity.
//! Exit Semantics & Design Rationale:
//!   - The scoring is a faithful port of Git's `diffcore-delta.c`: exact OID pass first, unique
//!     basename shortcut at 75% floor second, and bounded quadratic similarity matrix third.
//!   - Sorted `(bucket, byte_count)` span sketches are memoized lazily per source/destination blob
//!     outside the `D * S` matrix loop, eliminating repeated sliding-window `HashMap` allocations
//!     inside `estimate_similarity` (`FGT-PRF-001`).

use std::collections::HashMap;

use fg_core::models::{FileMode, Oid};

/// Git's similarity scale: a score of this value means the two sides are identical.
pub const MAX_SCORE: u32 = 60_000;

/// Minimum similarity Git uses for a rename when no `-M<n>` is given (50%).
pub const DEFAULT_RENAME_SCORE: u32 = 30_000;

/// Ceiling on `sources * destinations` before the quadratic matrix is abandoned.
const RENAME_LIMIT: usize = 1000;

/// How many source candidates are kept per destination before the matrix is ranked.
const NUM_CANDIDATE_PER_DST: usize = 4;

/// Bytes Git sniffs for a NUL before calling a payload binary (`FIRST_FEW_BYTES`).
const BINARY_SNIFF_LEN: usize = 8000;

type SpanSketch = Vec<(u32, u32)>;

/// One side of a potential rename: everything the scoring needs, borrowed from the caller.
pub struct BlobRef<'a> {
    /// Path as recorded in the tree, with no `a/` or `b/` prefix.
    pub path: &'a str,
    /// Mode the tree records for this entry.
    pub mode: FileMode,
    /// Object id of the payload, used by the exact pass.
    pub oid: Oid,
    /// Raw payload bytes.
    pub payload: &'a [u8],
}

/// A destination paired with the source it came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RenameHit {
    /// Index into the source slice the caller passed in.
    pub source: usize,
    /// Similarity on Git's `0..=MAX_SCORE` scale.
    pub score: u32,
}

struct SimilarityScratch<'a> {
    sources: &'a [BlobRef<'a>],
    dests: &'a [BlobRef<'a>],
    source_sketches: Vec<Option<SpanSketch>>,
    dest_sketches: Vec<Option<SpanSketch>>,
}

impl<'a> SimilarityScratch<'a> {
    fn new(sources: &'a [BlobRef<'a>], dests: &'a [BlobRef<'a>]) -> Self {
        Self {
            sources,
            dests,
            source_sketches: vec![None; sources.len()],
            dest_sketches: vec![None; dests.len()],
        }
    }

    fn estimate(&mut self, source_idx: usize, dest_idx: usize, minimum: u32) -> u32 {
        let source = &self.sources[source_idx];
        let dest = &self.dests[dest_idx];
        if !is_regular(source.mode) || !is_regular(dest.mode) {
            return 0;
        }
        let source_size = source.payload.len() as u64;
        let dest_size = dest.payload.len() as u64;
        let max_size = source_size.max(dest_size);
        let delta_size = max_size - source_size.min(dest_size);
        if max_size * u64::from(MAX_SCORE - minimum) < delta_size * u64::from(MAX_SCORE) {
            return 0;
        }
        if dest_size == 0 {
            return 0;
        }

        let source_spans = self.source_sketches[source_idx]
            .get_or_insert_with(|| span_hashes(source.payload, !is_binary(source.payload)));
        let dest_spans = self.dest_sketches[dest_idx]
            .get_or_insert_with(|| span_hashes(dest.payload, !is_binary(dest.payload)));

        let copied = merge_span_counts(source_spans, dest_spans);
        (copied * u64::from(MAX_SCORE) / max_size) as u32
    }
}

/// Pairs deletions with creations.
pub fn detect_renames(sources: &[BlobRef<'_>], dests: &[BlobRef<'_>]) -> Vec<Option<RenameHit>> {
    let mut hits: Vec<Option<RenameHit>> = vec![None; dests.len()];
    if sources.is_empty() || dests.is_empty() {
        return hits;
    }
    let mut used = vec![false; sources.len()];

    for (dest_index, dest) in dests.iter().enumerate() {
        if let Some(source) = identical_source(sources, &used, dest) {
            used[source] = true;
            hits[dest_index] = Some(RenameHit {
                source,
                score: MAX_SCORE,
            });
        }
    }

    let remaining = unused(&used);
    if remaining.is_empty() {
        return hits;
    }

    let mut scratch = SimilarityScratch::new(sources, dests);
    match_by_basename(&mut scratch, &mut hits, &mut used, &remaining);

    let remaining = unused(&used);
    let open: Vec<usize> = (0..dests.len())
        .filter(|index| hits[*index].is_none())
        .collect();
    if remaining.is_empty() || open.is_empty() {
        return hits;
    }
    if remaining.len().saturating_mul(open.len()) > RENAME_LIMIT.saturating_mul(RENAME_LIMIT) {
        return hits;
    }
    match_by_matrix(&mut scratch, &mut hits, &mut used, &remaining, &open);
    hits
}

/// Returns the indices whose `used` flag is still clear, in ascending order.
fn unused(used: &[bool]) -> Vec<usize> {
    (0..used.len()).filter(|index| !used[*index]).collect()
}

/// Finds a source holding byte-identical content, preferring one whose basename matches.
fn identical_source(sources: &[BlobRef<'_>], used: &[bool], dest: &BlobRef<'_>) -> Option<usize> {
    let mut best: Option<(usize, u32)> = None;
    for (index, source) in sources.iter().enumerate() {
        if used[index] || source.oid != dest.oid {
            continue;
        }
        if (!is_regular(source.mode) || !is_regular(dest.mode)) && source.mode != dest.mode {
            continue;
        }
        let score = 1 + basename_same(source.path, dest.path);
        let better = best.is_none_or(|(_, best_score)| score > best_score);
        if better {
            best = Some((index, score));
            if score == 2 {
                break;
            }
        }
    }
    best.map(|(index, _)| index)
}

/// Pairs files whose basenames are unique on both sides and that score at least the basename floor.
fn match_by_basename(
    scratch: &mut SimilarityScratch<'_>,
    hits: &mut [Option<RenameHit>],
    used: &mut [bool],
    remaining: &[usize],
) {
    let floor = DEFAULT_RENAME_SCORE + (MAX_SCORE - DEFAULT_RENAME_SCORE) / 2;
    let source_index = unique_basenames(
        remaining
            .iter()
            .map(|index| (*index, scratch.sources[*index].path)),
    );
    let open_dests: Vec<usize> = (0..scratch.dests.len())
        .filter(|index| hits[*index].is_none())
        .collect();
    let dest_index = unique_basenames(
        open_dests
            .iter()
            .map(|index| (*index, scratch.dests[*index].path)),
    );

    for &source in remaining {
        let base = basename(scratch.sources[source].path);
        if source_index.get(base) != Some(&Some(source)) {
            continue;
        }
        let Some(Some(dest)) = dest_index.get(base).copied() else {
            continue;
        };
        if hits[dest].is_some() {
            continue;
        }
        let score = scratch.estimate(source, dest, floor);
        if score < floor {
            continue;
        }
        hits[dest] = Some(RenameHit { source, score });
        used[source] = true;
    }
}

/// Maps each basename to the single index that carries it, or to `None` when several do.
fn unique_basenames<'a>(
    entries: impl Iterator<Item = (usize, &'a str)>,
) -> HashMap<&'a str, Option<usize>> {
    let mut index: HashMap<&'a str, Option<usize>> = HashMap::new();
    for (position, path) in entries {
        match index.get_mut(basename(path)) {
            Some(slot) => *slot = None,
            None => {
                index.insert(basename(path), Some(position));
            }
        }
    }
    index
}

/// Ranks every remaining source against every remaining destination using memoized span sketches.
fn match_by_matrix(
    scratch: &mut SimilarityScratch<'_>,
    hits: &mut [Option<RenameHit>],
    used: &mut [bool],
    remaining: &[usize],
    open: &[usize],
) {
    let mut ranked: Vec<Ranked> = Vec::with_capacity(open.len() * NUM_CANDIDATE_PER_DST);
    let mut candidates: Vec<Ranked> = Vec::with_capacity(remaining.len());
    for &dest in open {
        candidates.clear();
        let dest_path = scratch.dests[dest].path;
        for &source in remaining {
            let score = scratch.estimate(source, dest, DEFAULT_RENAME_SCORE);
            candidates.push(Ranked {
                source,
                dest,
                score,
                name_score: basename_same(scratch.sources[source].path, dest_path),
            });
        }
        candidates.sort_by(compare_ranked);
        candidates.truncate(NUM_CANDIDATE_PER_DST);
        ranked.extend(candidates.iter().copied());
    }
    ranked.sort_by(compare_ranked);

    for candidate in ranked {
        if candidate.score < DEFAULT_RENAME_SCORE {
            break;
        }
        if hits[candidate.dest].is_some() || used[candidate.source] {
            continue;
        }
        hits[candidate.dest] = Some(RenameHit {
            source: candidate.source,
            score: candidate.score,
        });
        used[candidate.source] = true;
    }
}

/// One scored source/destination pair awaiting assignment.
#[derive(Clone, Copy)]
struct Ranked {
    source: usize,
    dest: usize,
    score: u32,
    name_score: u32,
}

/// Orders pairs most-similar first, breaking ties by basename agreement (`score_compare`).
fn compare_ranked(left: &Ranked, right: &Ranked) -> std::cmp::Ordering {
    right
        .score
        .cmp(&left.score)
        .then_with(|| right.name_score.cmp(&left.name_score))
        .then_with(|| left.dest.cmp(&right.dest))
        .then_with(|| left.source.cmp(&right.source))
}

/// Merges two sorted span tables, returning the destination bytes also present in the source.
fn merge_span_counts(source: &[(u32, u32)], dest: &[(u32, u32)]) -> u64 {
    let mut copied = 0u64;
    let mut dest_cursor = 0usize;
    for (source_hash, source_count) in source {
        while let Some((dest_hash, _)) = dest.get(dest_cursor) {
            if dest_hash >= source_hash {
                break;
            }
            dest_cursor += 1;
        }
        let dest_count = match dest.get(dest_cursor) {
            Some((dest_hash, count)) if dest_hash == source_hash => {
                dest_cursor += 1;
                *count
            }
            _ => 0,
        };
        copied += u64::from((*source_count).min(dest_count));
    }
    copied
}

/// Hashes a payload into `(bucket, byte count)` pairs sorted by bucket.
fn span_hashes(payload: &[u8], is_text: bool) -> SpanSketch {
    const HASHBASE: u32 = 107_927;
    let mut counts: HashMap<u32, u32> = HashMap::new();
    let mut accum1: u32 = 0;
    let mut accum2: u32 = 0;
    let mut run: u32 = 0;
    let mut cursor = 0usize;
    while cursor < payload.len() {
        let byte = u32::from(payload[cursor]);
        cursor += 1;
        let previous = accum1;
        if is_text && byte == u32::from(b'\r') && cursor < payload.len() && payload[cursor] == b'\n'
        {
            continue;
        }
        accum1 = (accum1 << 7) ^ (accum2 >> 25);
        accum2 = (accum2 << 7) ^ (previous >> 25);
        accum1 = accum1.wrapping_add(byte);
        run += 1;
        if run < 64 && byte != u32::from(b'\n') {
            continue;
        }
        let bucket = accum1.wrapping_add(accum2.wrapping_mul(0x61)) % HASHBASE;
        *counts.entry(bucket).or_insert(0) += run;
        run = 0;
        accum1 = 0;
        accum2 = 0;
    }
    if run > 0 {
        let bucket = accum1.wrapping_add(accum2.wrapping_mul(0x61)) % HASHBASE;
        *counts.entry(bucket).or_insert(0) += run;
    }
    let mut spans: SpanSketch = counts.into_iter().collect();
    spans.sort_unstable_by_key(|(bucket, _)| *bucket);
    spans
}

fn is_binary(payload: &[u8]) -> bool {
    payload[..payload.len().min(BINARY_SNIFF_LEN)].contains(&0)
}

fn is_regular(mode: FileMode) -> bool {
    matches!(mode, FileMode::RegularFile | FileMode::ExecutableFile)
}

fn basename(path: &str) -> &str {
    match path.rfind('/') {
        Some(slash) => &path[slash + 1..],
        None => path,
    }
}

fn basename_same(left: &str, right: &str) -> u32 {
    let left_bytes = left.as_bytes();
    let right_bytes = right.as_bytes();
    let mut left_len = left_bytes.len();
    let mut right_len = right_bytes.len();
    while left_len > 0 && right_len > 0 {
        left_len -= 1;
        right_len -= 1;
        let left_byte = left_bytes[left_len];
        if left_byte != right_bytes[right_len] {
            return 0;
        }
        if left_byte == b'/' {
            return 1;
        }
    }
    let left_boundary = left_len == 0 || left_bytes[left_len - 1] == b'/';
    let right_boundary = right_len == 0 || right_bytes[right_len - 1] == b'/';
    u32::from(left_boundary && right_boundary)
}

#[cfg(test)]
mod tests {
    use super::{
        basename_same, detect_renames, span_hashes, BlobRef, DEFAULT_RENAME_SCORE, MAX_SCORE,
    };
    use fg_core::models::FileMode;

    fn reference<'a>(path: &'a str, payload: &'a [u8], mode: FileMode) -> BlobRef<'a> {
        BlobRef {
            path,
            mode,
            oid: fg_core::models::compute_object_oid(fg_core::models::ObjectKind::Blob, payload),
            payload,
        }
    }

    #[test]
    fn identical_content_at_a_new_path_is_an_exact_rename() {
        let body = b"alpha\nbeta\n";
        let sources = [reference("old.txt", body, FileMode::RegularFile)];
        let dests = [reference("dir/new.txt", body, FileMode::RegularFile)];
        let hits = detect_renames(&sources, &dests);
        assert_eq!(hits[0].map(|hit| hit.score), Some(MAX_SCORE));
        assert_eq!(hits[0].map(|hit| hit.source), Some(0));
    }

    #[test]
    fn a_symlink_is_not_renamed_onto_a_regular_file_with_the_same_payload() {
        let body = b"target";
        let sources = [reference("link", body, FileMode::Symlink)];
        let dests = [reference("file", body, FileMode::RegularFile)];
        assert!(detect_renames(&sources, &dests)[0].is_none());
    }

    #[test]
    fn a_symlink_renamed_onto_a_symlink_is_exact() {
        let body = b"target";
        let sources = [reference("a/link", body, FileMode::Symlink)];
        let dests = [reference("b/link", body, FileMode::Symlink)];
        assert_eq!(
            detect_renames(&sources, &dests)[0].map(|hit| hit.score),
            Some(MAX_SCORE)
        );
    }

    #[test]
    fn a_small_edit_still_counts_as_a_rename() {
        let mut edited = Vec::new();
        for index in 0..10 {
            edited.extend_from_slice(format!("line {index}\n").as_bytes());
        }
        let mut changed = edited.clone();
        let position = changed
            .windows(6)
            .position(|window| window == b"line 4")
            .expect("line 4 present");
        changed[position + 5] = b'9';
        let sources = [reference("a.txt", &edited, FileMode::RegularFile)];
        let dests = [reference("b.txt", &changed, FileMode::RegularFile)];
        let hit = detect_renames(&sources, &dests)[0].expect("rename");
        assert!(hit.score >= DEFAULT_RENAME_SCORE, "score {}", hit.score);
        assert!(hit.score < MAX_SCORE, "score {}", hit.score);
    }

    #[test]
    fn unrelated_content_is_not_a_rename() {
        let sources = [reference("a.txt", b"alpha\nbeta\n", FileMode::RegularFile)];
        let dests = [reference(
            "b.txt",
            b"zzzzzzzzzzzzzzzz\n",
            FileMode::RegularFile,
        )];
        assert!(detect_renames(&sources, &dests)[0].is_none());
    }

    #[test]
    fn a_used_source_is_not_offered_to_a_second_destination() {
        let body = b"shared\n";
        let sources = [reference("one.txt", body, FileMode::RegularFile)];
        let dests = [
            reference("two.txt", body, FileMode::RegularFile),
            reference("three.txt", body, FileMode::RegularFile),
        ];
        let hits = detect_renames(&sources, &dests);
        assert!(hits[0].is_some());
        assert!(hits[1].is_none(), "one deletion cannot become two renames");
    }

    #[test]
    fn the_basename_decides_between_two_identical_sources() {
        let body = b"same\n";
        let sources = [
            reference("dir/x.json", body, FileMode::RegularFile),
            reference("dir/y.json", body, FileMode::RegularFile),
        ];
        let dests = [reference("other/y.json", body, FileMode::RegularFile)];
        assert_eq!(
            detect_renames(&sources, &dests)[0].map(|hit| hit.source),
            Some(1)
        );
    }

    #[test]
    fn span_hashes_are_sorted_and_cover_every_byte() {
        let spans = span_hashes(b"alpha\nbeta\n", true);
        assert!(!spans.is_empty());
        let total: u32 = spans.iter().map(|(_, count)| *count).sum();
        assert_eq!(total as usize, b"alpha\nbeta\n".len());
        assert!(spans.windows(2).all(|pair| pair[0].0 < pair[1].0));
    }

    #[test]
    fn a_crlf_payload_hashes_like_its_lf_form() {
        assert_eq!(
            span_hashes(b"alpha\r\nbeta\r\n", true),
            span_hashes(b"alpha\nbeta\n", true)
        );
    }

    #[test]
    fn basenames_agree_only_at_a_separator() {
        assert_eq!(basename_same("a/x.json", "b/x.json"), 1);
        assert_eq!(basename_same("x.json", "x.json"), 1);
        assert_eq!(basename_same("a/x.json", "b/y.json"), 0);
        assert_eq!(basename_same("a/ax.json", "b/x.json"), 0);
    }

    #[test]
    fn an_empty_file_renames_onto_another_empty_file() {
        let sources = [reference("empty1.txt", b"", FileMode::RegularFile)];
        let dests = [reference("empty2.txt", b"", FileMode::RegularFile)];
        assert_eq!(
            detect_renames(&sources, &dests)[0].map(|hit| hit.score),
            Some(MAX_SCORE)
        );
    }

    #[test]
    fn an_empty_source_does_not_rename_onto_a_populated_destination() {
        let sources = [reference("empty.txt", b"", FileMode::RegularFile)];
        let dests = [reference("full.txt", b"material\n", FileMode::RegularFile)];
        assert!(detect_renames(&sources, &dests)[0].is_none());
    }
}
