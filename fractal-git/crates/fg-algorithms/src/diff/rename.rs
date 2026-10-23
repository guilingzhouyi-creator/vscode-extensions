//! Module: fg-algorithms::diff::rename — Rename Detection
//! File Path: crates/fg-algorithms/src/diff/rename.rs
//! Architecture Role: Decides which deletions and creations in a tree comparison are the same file
//!   under a new path, and how similar the two sides are.
//! Dependencies & Triggers: Called by `taxis diff` and `taxis show` after the path maps are built and
//!   before any patch text is rendered.
//! Responsibilities: Score every deletion/creation pair the way Git does, and report the winning
//!   pairings with their similarity.
//! Exit Semantics & Design Rationale:
//!   - The engine is pure: it takes already-read payloads and returns pairings. Rename detection is
//!     the only part of a diff that compares *unrelated* files, so keeping the object reads outside
//!     it means the algorithm can be tested against hand-written buffers with no repository.
//!   - The scoring is a port of `diffcore-delta.c`, not an approximation of it. A score that is off
//!     by one flips the printed percentage and the `-M50%` threshold decision at the same time, and
//!     neither is observable without matching the chunking exactly.
//!   - Two passes mirror Git: an exact pass pairs identical blobs by object id, and only what is left
//!     enters the quadratic similarity matrix. Doing the exact pass first is not an optimisation —
//!     it also decides *which* pairing wins when a blob appears at several paths.
//!   - The basename shortcut is kept because it changes results, not just speed: it pairs files with
//!     equal names at a 75% floor before the matrix runs, so a same-named pair that scores 70% is
//!     still reported as a rename.

use std::collections::HashMap;

use fg_core::models::{FileMode, Oid};

/// Git's similarity scale: a score of this value means the two sides are identical.
pub const MAX_SCORE: u32 = 60_000;

/// Minimum similarity Git uses for a rename when no `-M<n>` is given (50%).
pub const DEFAULT_RENAME_SCORE: u32 = 30_000;

/// Ceiling on `sources × destinations` before the quadratic matrix is abandoned.
///
/// Git's `diff.renameLimit` defaults to 1000 and the check is on the product, so a tree with 2000
/// deletions and 2000 creations silently loses inexact detection. The limit is reproduced rather
/// than removed because exceeding it changes the output, and a caller diffing against `git diff`
/// would see renames Git declined to report.
const RENAME_LIMIT: usize = 1000;

/// How many source candidates are kept per destination before the matrix is ranked.
const NUM_CANDIDATE_PER_DST: usize = 4;

/// Bytes Git sniffs for a NUL before calling a payload binary (`FIRST_FEW_BYTES`).
const BINARY_SNIFF_LEN: usize = 8000;

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
    /// Similarity on Git's 0..=[`MAX_SCORE`] scale.
    pub score: u32,
}

/// Pairs deletions with creations.
///
/// The returned vector is indexed by destination, so a `None` entry means that creation is genuinely
/// new. Sources are never reported twice, which is what makes the result usable as a rewrite of the
/// caller's pair list: each hit moves one deletion onto one creation.
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
    match_by_basename(sources, dests, &mut hits, &mut used, &remaining);

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
    match_by_matrix(sources, dests, &mut hits, &mut used, &remaining, &open);
    hits
}

/// Returns the indices whose `used` flag is still clear, in ascending order.
fn unused(used: &[bool]) -> Vec<usize> {
    (0..used.len()).filter(|index| !used[*index]).collect()
}

/// Finds a source holding byte-identical content, preferring one whose basename matches.
///
/// A used source is skipped outright: this build detects renames only, never copies, and Git makes
/// the same exclusion (`rename_used && detect_rename != DIFF_DETECT_COPY`). Allowing reuse would
/// turn one deletion into two renames and change the file count in the summary.
fn identical_source(sources: &[BlobRef<'_>], used: &[bool], dest: &BlobRef<'_>) -> Option<usize> {
    let mut best: Option<(usize, u32)> = None;
    for (index, source) in sources.iter().enumerate() {
        if used[index] || source.oid != dest.oid {
            continue;
        }
        // A symlink and a regular file can share a blob payload, but they are not the same entry
        // renamed. Git only relaxes the mode check for two regular files.
        if (!is_regular(source.mode) || !is_regular(dest.mode)) && source.mode != dest.mode {
            continue;
        }
        let score = 1 + basename_same(source.path, dest.path);
        let better = match best {
            None => true,
            Some((_, best_score)) => score > best_score,
        };
        if better {
            best = Some((index, score));
            if score == 2 {
                break;
            }
        }
    }
    best.map(|(index, _)| index)
}

/// Pairs the files whose basenames are unique on both sides and that score at least the basename
/// floor.
///
/// The floor is halfway between the rename minimum and a perfect match (`minimum + 0.5 * (MAX -
/// minimum)`), so this pass is stricter than the matrix. Git applies it first because moving a file
/// between directories is the common rename and the basename is a strong hint; a pair that fails the
/// floor here still gets a chance in the matrix.
fn match_by_basename(
    sources: &[BlobRef<'_>],
    dests: &[BlobRef<'_>],
    hits: &mut [Option<RenameHit>],
    used: &mut [bool],
    remaining: &[usize],
) {
    let floor = DEFAULT_RENAME_SCORE + (MAX_SCORE - DEFAULT_RENAME_SCORE) / 2;
    let source_index =
        unique_basenames(remaining.iter().map(|index| (*index, sources[*index].path)));
    let open_dests: Vec<usize> = (0..dests.len())
        .filter(|index| hits[*index].is_none())
        .collect();
    let dest_index = unique_basenames(open_dests.iter().map(|index| (*index, dests[*index].path)));

    for &source in remaining {
        let base = basename(sources[source].path);
        if source_index.get(base) != Some(&Some(source)) {
            continue;
        }
        let dest = match dest_index.get(base) {
            Some(Some(index)) => *index,
            _ => continue,
        };
        if hits[dest].is_some() {
            continue;
        }
        let score = estimate_similarity(&sources[source], &dests[dest], floor);
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

/// Ranks every remaining source against every remaining destination.
///
/// Only the best [`NUM_CANDIDATE_PER_DST`] sources per destination survive, because the global
/// ranking that follows must not let a weak pair steal a source that a stronger pair needs. The
/// final sweep is greedy over the ranked pairs, which is what makes a rename assignment unique
/// rather than depending on iteration order.
fn match_by_matrix(
    sources: &[BlobRef<'_>],
    dests: &[BlobRef<'_>],
    hits: &mut [Option<RenameHit>],
    used: &mut [bool],
    remaining: &[usize],
    open: &[usize],
) {
    let mut ranked: Vec<Ranked> = Vec::new();
    let mut candidates: Vec<Ranked> = Vec::with_capacity(remaining.len());
    for &dest in open {
        candidates.clear();
        for &source in remaining {
            let score = estimate_similarity(&sources[source], &dests[dest], DEFAULT_RENAME_SCORE);
            candidates.push(Ranked {
                source,
                dest,
                score,
                name_score: basename_same(sources[source].path, dests[dest].path),
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

/// Orders pairs most-similar first, breaking ties by basename agreement.
///
/// The basename tiebreak is what keeps `a/x.json` pairing with `b/x.json` instead of an equally
/// similar sibling, and it is the same ordering Git's `score_compare` applies.
fn compare_ranked(left: &Ranked, right: &Ranked) -> std::cmp::Ordering {
    right
        .score
        .cmp(&left.score)
        .then_with(|| right.name_score.cmp(&left.name_score))
        .then_with(|| left.dest.cmp(&right.dest))
        .then_with(|| left.source.cmp(&right.source))
}

/// Scores how much of `dest` came from `source`, on Git's scale.
///
/// The size pre-check is not a shortcut for the same result: Git refuses a pair whose sizes differ
/// by more than the score could possibly tolerate *before* reading either payload, so a pair can be
/// rejected on size alone even though its chunk counts would have scored above the floor.
fn estimate_similarity(source: &BlobRef<'_>, dest: &BlobRef<'_>, minimum: u32) -> u32 {
    // Symlinks are only ever renamed exactly. Git states the restriction directly: the similarity
    // matrix deals with regular files, because a link's payload is a path and its "content" is not
    // comparable material.
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
    // An empty destination cannot have copied anything, and the division below would be undefined.
    if dest_size == 0 {
        return 0;
    }
    let copied = copied_bytes(source, dest);
    (copied * u64::from(MAX_SCORE) / max_size) as u32
}

/// Counts the destination bytes that also appear in the source, by Git's chunk hashing.
///
/// Chunks are cut at a newline or at 64 bytes, whichever comes first, and only the *counts* are
/// kept — the chunk contents are not stored. Two files that reuse material in a different order
/// therefore still score high, which is the intended approximation: a reordered file was copied, and
/// a line-based comparison would report it as a rewrite.
fn copied_bytes(source: &BlobRef<'_>, dest: &BlobRef<'_>) -> u64 {
    let source_spans = span_hashes(source.payload, !is_binary(source.payload));
    let dest_spans = span_hashes(dest.payload, !is_binary(dest.payload));
    merge_span_counts(&source_spans, &dest_spans)
}

/// Merges two sorted span tables, returning the destination bytes also present in the source.
///
/// A hash bucket stands for a run of bytes, so a bucket present in both files counts as copied only
/// up to the smaller count. The excess on the destination side is new material; the excess on the
/// source side is simply material the destination dropped.
fn merge_span_counts(source: &[(u32, u32)], dest: &[(u32, u32)]) -> u64 {
    let mut copied = 0u64;
    let mut dest_cursor = 0usize;
    for (source_hash, source_count) in source {
        while let Some((dest_hash, dest_count)) = dest.get(dest_cursor) {
            if dest_hash >= source_hash {
                break;
            }
            dest_cursor += 1;
            let _ = dest_count;
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
///
/// The accumulator is Git's two-word rolling hash over 32-bit words: the low bit patterns of both
/// words are shifted in together so a one-byte change perturbs the whole bucket. Reproducing the
/// wrapping arithmetic exactly is required, because the score is a ratio of counts and a single
/// differing bucket changes it.
fn span_hashes(payload: &[u8], is_text: bool) -> Vec<(u32, u32)> {
    /// Prime bucket count between 2^16 and 2^17.
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
        // A CR that only introduces a newline is dropped for text, so converting line endings does
        // not read as a content change. Binary payloads keep every byte, because there the CR may
        // carry data.
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
    let mut spans: Vec<(u32, u32)> = counts.into_iter().collect();
    spans.sort_unstable_by_key(|(bucket, _)| *bucket);
    spans
}

/// Reports whether a payload is binary by Git's rule: a NUL in the first
/// [`BINARY_SNIFF_LEN`] bytes.
fn is_binary(payload: &[u8]) -> bool {
    payload[..payload.len().min(BINARY_SNIFF_LEN)].contains(&0)
}

/// Reports whether a mode is an ordinary file, which is what `S_ISREG` tests.
fn is_regular(mode: FileMode) -> bool {
    matches!(mode, FileMode::RegularFile | FileMode::ExecutableFile)
}

/// Returns the part of a path after the last separator.
fn basename(path: &str) -> &str {
    match path.rfind('/') {
        Some(slash) => &path[slash + 1..],
        None => path,
    }
}

/// Reports whether two paths end in the same basename, walking in from the right.
///
/// The walk stops at a separator on both sides at once, so `a/x.json` and `b/x.json` agree even
/// though the shared tail is longer than the basename. Comparing the whole path would make every
/// move into a new directory look unrelated.
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

    /// Builds a reference to a payload under a fixed path and mode.
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
        // Both sides hold the same bytes, but a link and a file are different kinds of entry. Git
        // only skips the mode comparison when both sides are regular.
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
        // Ten lines, one of them changed: 90% of the material survives, well above the floor.
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
        // Both sources hold the same bytes, so only the name can break the tie.
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
        // `ax.json` and `x.json` share a tail but not a basename: the walk stops mid-token.
        assert_eq!(basename_same("a/ax.json", "b/x.json"), 0);
    }

    #[test]
    fn an_empty_file_renames_onto_another_empty_file() {
        // Git keeps empty blobs in rename detection (`rename_empty` defaults to 1), so deleting one
        // empty file and creating another is a rename, not a delete plus a create. Measured against
        // `git diff --cached -M` on a repository built for this case.
        let sources = [reference("empty1.txt", b"", FileMode::RegularFile)];
        let dests = [reference("empty2.txt", b"", FileMode::RegularFile)];
        assert_eq!(
            detect_renames(&sources, &dests)[0].map(|hit| hit.score),
            Some(MAX_SCORE)
        );
    }

    #[test]
    fn an_empty_source_does_not_rename_onto_a_populated_destination() {
        // The reverse direction must not fire: a zero-size source copied nothing, and the size
        // pre-check has to reject the pair before the division by `max_size`.
        let sources = [reference("empty.txt", b"", FileMode::RegularFile)];
        let dests = [reference("full.txt", b"material\n", FileMode::RegularFile)];
        assert!(detect_renames(&sources, &dests)[0].is_none());
    }
}
