use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DiffOp {
    Equal(usize, usize),
    Delete(usize),
    Insert(usize),
}

pub fn run_histogram_diff(old_content: &str, new_content: &str) -> Vec<DiffHunk> {
    if old_content == new_content {
        return Vec::new();
    }

    let old_lines: Vec<&str> = split_lines(old_content);
    let new_lines: Vec<&str> = split_lines(new_content);

    let ops = compute_diff(&old_lines, &new_lines);
    assemble_hunks(&ops, &old_lines, &new_lines, 3)
}

fn split_lines(content: &str) -> Vec<&str> {
    if content.is_empty() {
        return Vec::new();
    }
    let mut lines = Vec::new();
    let mut start = 0;
    let bytes = content.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if bytes[i] == b'\n' {
            let line_end = if i > start && bytes[i - 1] == b'\r' {
                i - 1
            } else {
                i
            };
            lines.push(&content[start..line_end]);
            start = i + 1;
        }
        i += 1;
    }
    if start < len {
        lines.push(&content[start..len]);
    }
    lines
}

const FALLBACK_THRESHOLD: usize = 32;
const MAX_RECURSION_DEPTH: usize = 64;
const BINARY_SEARCH_MIN_BUCKET: usize = 8;

type Span = (usize, usize, usize, usize);

struct HistogramContext<'a> {
    old_lines: &'a [&'a str],
    new_lines: &'a [&'a str],
    old_hashes: Vec<u64>,
    new_hashes: Vec<u64>,
    target_positions: HashMap<u64, Vec<usize>>,
    ops: Vec<DiffOp>,
}

fn compute_diff(old: &[&str], new: &[&str]) -> Vec<DiffOp> {
    let old_hashes: Vec<u64> = old.iter().map(|&s| hash_line_fnv1a64(s)).collect();
    let new_hashes: Vec<u64> = new.iter().map(|&s| hash_line_fnv1a64(s)).collect();
    let mut target_positions: HashMap<u64, Vec<usize>> = HashMap::with_capacity(new.len());
    for (idx, &hash) in new_hashes.iter().enumerate() {
        target_positions.entry(hash).or_default().push(idx);
    }
    let mut ctx = HistogramContext {
        old_lines: old,
        new_lines: new,
        old_hashes,
        new_hashes,
        target_positions,
        ops: Vec::with_capacity(old.len() + new.len()),
    };
    execute_histogram_recursion(&mut ctx, (0, old.len(), 0, new.len()), 0);
    ctx.ops
}

fn scan_anchor_bucket(
    ctx: &HistogramContext<'_>,
    bucket: &[usize],
    bounds_b: (usize, usize),
    src_line: &str,
) -> Option<(usize, usize)> {
    let (start_b, end_b) = bounds_b;
    if bucket.is_empty() || bucket[0] >= end_b || bucket[bucket.len() - 1] < start_b {
        return None;
    }
    let start_idx = if bucket.len() <= BINARY_SEARCH_MIN_BUCKET || bucket[0] >= start_b {
        0
    } else {
        bucket.partition_point(|&pos| pos < start_b)
    };
    let mut count_target = 0usize;
    let mut matched_target: Option<usize> = None;
    for &pos in &bucket[start_idx..] {
        if pos >= end_b {
            break;
        }
        count_target += 1;
        if matched_target.is_none() && ctx.new_lines[pos] == src_line {
            matched_target = Some(pos);
        }
    }
    matched_target.map(|target_idx| (count_target, target_idx))
}

fn find_best_anchor(ctx: &HistogramContext<'_>, span: Span) -> Option<(usize, usize)> {
    let (start_a, end_a, start_b, end_b) = span;
    let mid_source = start_a + (end_a - start_a) / 2;
    let mut best_anchor: Option<(usize, usize)> = None;
    let mut min_occurrences = usize::MAX;
    let mut best_dist = usize::MAX;

    for src_idx in start_a..end_a {
        let Some(bucket) = ctx.target_positions.get(&ctx.old_hashes[src_idx]) else {
            continue;
        };
        let Some((count_target, target_idx)) =
            scan_anchor_bucket(ctx, bucket, (start_b, end_b), ctx.old_lines[src_idx])
        else {
            continue;
        };
        let dist = src_idx.abs_diff(mid_source);
        if count_target < min_occurrences || (count_target == min_occurrences && dist < best_dist) {
            min_occurrences = count_target;
            best_dist = dist;
            best_anchor = Some((src_idx, target_idx));
            if count_target == 1 && dist == 0 {
                break;
            }
        }
    }
    best_anchor
}

fn trim_span_edges(ctx: &mut HistogramContext<'_>, span: Span) -> (Span, usize) {
    let (start_a, end_a, start_b, end_b) = span;
    let mut prefix = 0usize;
    while start_a + prefix < end_a
        && start_b + prefix < end_b
        && ctx.old_hashes[start_a + prefix] == ctx.new_hashes[start_b + prefix]
        && ctx.old_lines[start_a + prefix] == ctx.new_lines[start_b + prefix]
    {
        ctx.ops
            .push(DiffOp::Equal(start_a + prefix, start_b + prefix));
        prefix += 1;
    }
    let (min_a, min_b) = (start_a + prefix, start_b + prefix);
    let mut suffix = 0usize;
    while end_a - suffix > min_a
        && end_b - suffix > min_b
        && ctx.old_hashes[end_a - 1 - suffix] == ctx.new_hashes[end_b - 1 - suffix]
        && ctx.old_lines[end_a - 1 - suffix] == ctx.new_lines[end_b - 1 - suffix]
    {
        suffix += 1;
    }
    ((min_a, end_a - suffix, min_b, end_b - suffix), suffix)
}

fn append_suffix_equals(ops: &mut Vec<DiffOp>, end_a: usize, end_b: usize, suffix_count: usize) {
    for offset in 0..suffix_count {
        ops.push(DiffOp::Equal(end_a + offset, end_b + offset));
    }
}

fn execute_histogram_recursion(ctx: &mut HistogramContext<'_>, span: Span, depth: usize) {
    if span.0 == span.1 {
        ctx.ops.extend((span.2..span.3).map(DiffOp::Insert));
        return;
    }
    if span.2 == span.3 {
        ctx.ops.extend((span.0..span.1).map(DiffOp::Delete));
        return;
    }
    let ((act_a, end_a, act_b, end_b), suffix) = trim_span_edges(ctx, span);
    let (rem_a, rem_b) = (end_a - act_a, end_b - act_b);
    if rem_a == 0 && rem_b == 0 {
        append_suffix_equals(&mut ctx.ops, end_a, end_b, suffix);
        return;
    }
    if rem_a <= FALLBACK_THRESHOLD || rem_b <= FALLBACK_THRESHOLD || depth >= MAX_RECURSION_DEPTH {
        let sub_ops = compute_myers_diff(
            &ctx.old_lines[act_a..end_a],
            &ctx.new_lines[act_b..end_b],
            &ctx.old_hashes[act_a..end_a],
            &ctx.new_hashes[act_b..end_b],
            (act_a, act_b),
        );
        ctx.ops.extend(sub_ops);
        append_suffix_equals(&mut ctx.ops, end_a, end_b, suffix);
        return;
    }
    if let Some((anchor_a, anchor_b)) = find_best_anchor(ctx, (act_a, end_a, act_b, end_b)) {
        execute_histogram_recursion(ctx, (act_a, anchor_a, act_b, anchor_b), depth + 1);
        ctx.ops.push(DiffOp::Equal(anchor_a, anchor_b));
        execute_histogram_recursion(ctx, (anchor_a + 1, end_a, anchor_b + 1, end_b), depth + 1);
    } else {
        ctx.ops.extend((act_a..end_a).map(DiffOp::Delete));
        ctx.ops.extend((act_b..end_b).map(DiffOp::Insert));
    }
    append_suffix_equals(&mut ctx.ops, end_a, end_b, suffix);
}

#[inline(always)]
fn hash_line_fnv1a64(line: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in line.as_bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn step_myers_row(
    old: &[&str],
    new: &[&str],
    old_hashes: &[u64],
    new_hashes: &[u64],
    v: &mut [usize],
    d: isize,
    max: usize,
) -> bool {
    let n = old.len();
    let m = new.len();
    let mut k = -d;
    while k <= d {
        let k_idx = (k + max as isize) as usize;
        let mut x = if k == -d || (k != d && v[k_idx - 1] < v[k_idx + 1]) {
            v[k_idx + 1]
        } else {
            v[k_idx - 1] + 1
        };
        let mut y = (x as isize - k) as usize;

        while x < n && y < m && old_hashes[x] == new_hashes[y] && old[x] == new[y] {
            x += 1;
            y += 1;
        }

        v[k_idx] = x;
        if x >= n && y >= m {
            return true;
        }
        k += 2;
    }
    false
}

fn compute_myers_diff(
    old: &[&str],
    new: &[&str],
    old_hashes: &[u64],
    new_hashes: &[u64],
    offsets: (usize, usize),
) -> Vec<DiffOp> {
    let (offset_a, offset_b) = offsets;
    let n = old.len();
    let m = new.len();

    if n == 0 {
        return (0..m).map(|j| DiffOp::Insert(offset_b + j)).collect();
    }
    if m == 0 {
        return (0..n).map(|i| DiffOp::Delete(offset_a + i)).collect();
    }

    let max = n + m;
    let mut v = vec![0usize; 2 * max + 1];
    let mut trace_arena: Vec<usize> = Vec::with_capacity((max + 1).min(256).pow(2));

    for d in 0..=(max as isize) {
        let d_usize = d as usize;
        trace_arena.extend_from_slice(&v[(max - d_usize)..=(max + d_usize)]);
        if step_myers_row(old, new, old_hashes, new_hashes, &mut v, d, max) {
            return backtrack(&trace_arena, old, new, (offset_a, offset_b), d);
        }
    }

    let mut fallback: Vec<DiffOp> = (0..n).map(|i| DiffOp::Delete(offset_a + i)).collect();
    fallback.extend((0..m).map(|j| DiffOp::Insert(offset_b + j)));
    fallback
}

fn backtrack(
    trace_arena: &[usize],
    _old: &[&str],
    _new: &[&str],
    offsets: (usize, usize),
    d: isize,
) -> Vec<DiffOp> {
    let (offset_a, offset_b) = offsets;
    let mut ops = Vec::new();

    let mut curr_x = _old.len();
    let mut curr_y = _new.len();

    for step in (1..=d as usize).rev() {
        let step_isize = step as isize;
        let row_start = step * step;
        let k = curr_x as isize - curr_y as isize;

        let prev_k = if k == -step_isize
            || (k != step_isize
                && trace_arena[row_start + (k - 1 + step_isize) as usize]
                    < trace_arena[row_start + (k + 1 + step_isize) as usize])
        {
            k + 1
        } else {
            k - 1
        };

        let prev_x = trace_arena[row_start + (prev_k + step_isize) as usize];
        let prev_y = (prev_x as isize - prev_k) as usize;

        while curr_x > prev_x && curr_y > prev_y {
            curr_x -= 1;
            curr_y -= 1;
            ops.push(DiffOp::Equal(offset_a + curr_x, offset_b + curr_y));
        }

        if curr_x > prev_x {
            curr_x -= 1;
            ops.push(DiffOp::Delete(offset_a + curr_x));
        } else if curr_y > prev_y {
            curr_y -= 1;
            ops.push(DiffOp::Insert(offset_b + curr_y));
        }
    }

    while curr_x > 0 && curr_y > 0 {
        curr_x -= 1;
        curr_y -= 1;
        ops.push(DiffOp::Equal(offset_a + curr_x, offset_b + curr_y));
    }

    ops.reverse();
    ops
}

/// Compute the exact Myers insert/delete distance using bit-parallel SWAR vectors.
/// For patterns of length <= 64, uses a 64-bit word with hardware parallelism.
/// For patterns of length <= 128, uses a 128-bit word.
/// Falls back to diagonal scalar Myers search for larger patterns.
pub fn compute_bit_parallel_myers_distance(pattern: &[u32], text: &[u32]) -> u32 {
    let m = pattern.len();
    let n = text.len();
    if m == 0 {
        return n as u32;
    }
    if n == 0 {
        return m as u32;
    }

    if m <= 64 {
        bit_parallel_myers_64(pattern, text)
    } else if m <= 128 {
        bit_parallel_myers_128(pattern, text)
    } else {
        scalar_myers_distance(pattern, text)
    }
}

fn bit_parallel_myers_64(pattern: &[u32], text: &[u32]) -> u32 {
    let m = pattern.len();
    let mut peq: HashMap<u32, u64> = HashMap::with_capacity(m);
    for (i, &hash) in pattern.iter().enumerate() {
        *peq.entry(hash).or_insert(0) |= 1u64 << i;
    }

    let mut vp = !0u64;
    let mut vn = 0u64;
    let mut score = m as u32;
    let target_bit = 1u64 << (m - 1);

    for &hash in text {
        let pm = peq.get(&hash).copied().unwrap_or(0);
        let x = (pm & vp).wrapping_add(vp);
        let d0 = (x ^ vp) | pm | vn;
        let mut hp = vn | !(d0 | vp);
        let mut hn = vp & d0;

        hp = (hp << 1) | 1;
        hn <<= 1;

        vp = hn | !(d0 | hp);
        vn = hp & d0;

        if (hp & target_bit) != 0 {
            score += 1;
        } else if (hn & target_bit) != 0 {
            score = score.saturating_sub(1);
        }
    }

    score
}

fn bit_parallel_myers_128(pattern: &[u32], text: &[u32]) -> u32 {
    let m = pattern.len();
    let mut peq: HashMap<u32, u128> = HashMap::with_capacity(m);
    for (i, &hash) in pattern.iter().enumerate() {
        *peq.entry(hash).or_insert(0) |= 1u128 << i;
    }

    let mut vp = !0u128;
    let mut vn = 0u128;
    let mut score = m as u32;
    let target_bit = 1u128 << (m - 1);

    for &hash in text {
        let pm = peq.get(&hash).copied().unwrap_or(0);
        let x = (pm & vp).wrapping_add(vp);
        let d0 = (x ^ vp) | pm | vn;
        let mut hp = vn | !(d0 | vp);
        let mut hn = vp & d0;

        hp = (hp << 1) | 1;
        hn <<= 1;

        vp = hn | !(d0 | hp);
        vn = hp & d0;

        if (hp & target_bit) != 0 {
            score += 1;
        } else if (hn & target_bit) != 0 {
            score = score.saturating_sub(1);
        }
    }

    score
}

fn trim_common_u32_affixes<'a>(pattern: &'a [u32], text: &'a [u32]) -> (&'a [u32], &'a [u32]) {
    let mut prefix = 0usize;
    let mut end_n = pattern.len();
    let mut end_m = text.len();
    while prefix < end_n && prefix < end_m && pattern[prefix] == text[prefix] {
        prefix += 1;
    }
    while end_n > prefix && end_m > prefix && pattern[end_n - 1] == text[end_m - 1] {
        end_n -= 1;
        end_m -= 1;
    }
    (&pattern[prefix..end_n], &text[prefix..end_m])
}

fn step_scalar_myers_row(
    pat_mid: &[u32],
    txt_mid: &[u32],
    v: &mut [usize],
    d: isize,
    max: usize,
) -> bool {
    let n = pat_mid.len();
    let m = txt_mid.len();
    let mut k = -d;
    while k <= d {
        let k_idx = (k + max as isize) as usize;
        let mut x = if k == -d || (k != d && v[k_idx - 1] < v[k_idx + 1]) {
            v[k_idx + 1]
        } else {
            v[k_idx - 1] + 1
        };
        let mut y = (x as isize - k) as usize;

        while x < n && y < m && pat_mid[x] == txt_mid[y] {
            x += 1;
            y += 1;
        }

        v[k_idx] = x;
        if x >= n && y >= m {
            return true;
        }
        k += 2;
    }
    false
}

fn scalar_myers_distance(pattern: &[u32], text: &[u32]) -> u32 {
    let (pat_mid, txt_mid) = trim_common_u32_affixes(pattern, text);
    let n = pat_mid.len();
    let m = txt_mid.len();
    if n == 0 {
        return m as u32;
    }
    if m == 0 {
        return n as u32;
    }
    let max = n + m;
    let mut v = vec![0usize; 2 * max + 1];

    for d in 0..=(max as isize) {
        if step_scalar_myers_row(pat_mid, txt_mid, &mut v, d, max) {
            return d as u32;
        }
    }

    max as u32
}

struct HunkBuilder<'a> {
    old_lines: &'a [&'a str],
    new_lines: &'a [&'a str],
    lines: Vec<String>,
    old_start: usize,
    old_lines_count: usize,
    new_start: usize,
    new_lines_count: usize,
}

impl<'a> HunkBuilder<'a> {
    fn new(old_lines: &'a [&'a str], new_lines: &'a [&'a str]) -> Self {
        Self {
            old_lines,
            new_lines,
            lines: Vec::new(),
            old_start: 0,
            old_lines_count: 0,
            new_start: 0,
            new_lines_count: 0,
        }
    }

    fn push_op(&mut self, op: DiffOp) {
        match op {
            DiffOp::Equal(old_idx, new_idx) => {
                if self.old_start == 0 {
                    self.old_start = old_idx + 1;
                }
                if self.new_start == 0 {
                    self.new_start = new_idx + 1;
                }
                self.old_lines_count += 1;
                self.new_lines_count += 1;
                let text = self.old_lines.get(old_idx).copied().unwrap_or("");
                self.lines.push(format!(" {text}"));
            }
            DiffOp::Delete(old_idx) => {
                if self.old_start == 0 {
                    self.old_start = old_idx + 1;
                }
                self.old_lines_count += 1;
                let text = self.old_lines.get(old_idx).copied().unwrap_or("");
                self.lines.push(format!("-{text}"));
            }
            DiffOp::Insert(new_idx) => {
                if self.new_start == 0 {
                    self.new_start = new_idx + 1;
                }
                self.new_lines_count += 1;
                let text = self.new_lines.get(new_idx).copied().unwrap_or("");
                self.lines.push(format!("+{text}"));
            }
        }
    }

    fn build(self) -> DiffHunk {
        DiffHunk {
            old_start: self.old_start.max(1) as u32,
            old_lines: self.old_lines_count as u32,
            new_start: self.new_start.max(1) as u32,
            new_lines: self.new_lines_count as u32,
            lines: self.lines,
        }
    }
}

fn find_hunk_end(ops: &[DiffOp], start_idx: usize, context: usize) -> usize {
    let len = ops.len();
    let mut hunk_end = start_idx;
    while hunk_end < len {
        if !matches!(ops[hunk_end], DiffOp::Equal(_, _)) {
            hunk_end += 1;
            continue;
        }
        let mut peek = hunk_end;
        while peek < len && matches!(ops[peek], DiffOp::Equal(_, _)) {
            peek += 1;
        }
        if peek - hunk_end <= context * 2 && peek < len {
            hunk_end = peek;
        } else {
            return (hunk_end + context).min(len);
        }
    }
    hunk_end
}

fn assemble_hunks(
    ops: &[DiffOp],
    old_lines: &[&str],
    new_lines: &[&str],
    context: usize,
) -> Vec<DiffHunk> {
    let mut hunks = Vec::new();
    let len = ops.len();
    let mut cursor = 0;

    while cursor < len {
        while cursor < len && matches!(ops[cursor], DiffOp::Equal(_, _)) {
            cursor += 1;
        }
        if cursor >= len {
            break;
        }

        let hunk_start = cursor.saturating_sub(context);
        let hunk_end = find_hunk_end(ops, cursor, context);
        let mut builder = HunkBuilder::new(old_lines, new_lines);
        for &op in &ops[hunk_start..hunk_end] {
            builder.push_op(op);
        }
        hunks.push(builder.build());
        cursor = hunk_end;
    }

    hunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identical_diff() {
        assert!(run_histogram_diff("hello\nworld", "hello\nworld").is_empty());
    }

    #[test]
    fn test_simple_diff() {
        let hunks = run_histogram_diff("a\nb\nc", "a\nB\nc");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].new_start, 1);
    }

    #[test]
    fn test_empty_inputs() {
        assert!(run_histogram_diff("", "").is_empty());
        let add_hunks = run_histogram_diff("", "line1\nline2");
        assert_eq!(add_hunks.len(), 1);
        assert_eq!(add_hunks[0].new_lines, 2);

        let del_hunks = run_histogram_diff("line1\nline2", "");
        assert_eq!(del_hunks.len(), 1);
        assert_eq!(del_hunks[0].old_lines, 2);
    }

    #[test]
    fn test_pure_insertion_and_deletion() {
        let ins = run_histogram_diff("a\nb\nc", "a\nb\nINS\nc");
        assert_eq!(ins.len(), 1);
        assert!(ins[0].lines.iter().any(|l| l.starts_with("+INS")));

        let del = run_histogram_diff("a\nb\nDEL\nc", "a\nb\nc");
        assert_eq!(del.len(), 1);
        assert!(del[0].lines.iter().any(|l| l.starts_with("-DEL")));
    }

    #[test]
    fn test_unicode_and_multilingual_diff() {
        let old_text = "fn greet() {\n    let msg = \"你好，世界！\";\n}";
        let new_text = "fn greet() {\n    let msg = \"你好，Rust加速世界！\";\n}";
        let hunks = run_histogram_diff(old_text, new_text);
        assert_eq!(hunks.len(), 1);
        assert!(hunks[0].lines.iter().any(|l| l.contains("Rust加速世界")));
    }

    #[test]
    fn test_large_common_prefix_suffix() {
        let mut old_lines = Vec::new();
        let mut new_lines = Vec::new();
        for i in 0..50 {
            old_lines.push(format!("stable_prefix_line_{}", i));
            new_lines.push(format!("stable_prefix_line_{}", i));
        }
        old_lines.push("old_mid_line".to_string());
        new_lines.push("new_mid_line".to_string());
        for i in 0..50 {
            old_lines.push(format!("stable_suffix_line_{}", i));
            new_lines.push(format!("stable_suffix_line_{}", i));
        }
        let hunks = run_histogram_diff(&old_lines.join("\n"), &new_lines.join("\n"));
        assert_eq!(hunks.len(), 1);
        assert!(hunks[0].lines.iter().any(|l| l.contains("-old_mid_line")));
        assert!(hunks[0].lines.iter().any(|l| l.contains("+new_mid_line")));
    }

    #[test]
    fn test_disjoint_replacement() {
        let hunks = run_histogram_diff("one\ntwo\nthree", "alpha\nbeta\ngamma");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_lines, 3);
        assert_eq!(hunks[0].new_lines, 3);
    }

    #[test]
    fn test_trailing_newline_differences() {
        let hunks = run_histogram_diff("first\nsecond", "first\nsecond\nthird");
        assert_eq!(hunks.len(), 1);
        assert!(hunks[0].lines.iter().any(|l| l.starts_with("+third")));
    }

    #[test]
    fn test_multiple_separated_hunks() {
        let mut old_lines: Vec<String> = Vec::new();
        let mut new_lines: Vec<String> = Vec::new();

        old_lines.push("HEAD_ORIG".to_string());
        new_lines.push("HEAD_MOD".to_string());

        for i in 0..10 {
            let filler = format!("filler_line_{}", i);
            old_lines.push(filler.clone());
            new_lines.push(filler);
        }

        old_lines.push("TAIL_ORIG".to_string());
        new_lines.push("TAIL_MOD".to_string());

        let old_text = old_lines.join("\n");
        let new_text = new_lines.join("\n");
        let hunks = run_histogram_diff(&old_text, &new_text);
        assert_eq!(hunks.len(), 2);
        assert!(hunks[0].lines.iter().any(|l| l.contains("HEAD_MOD")));
        assert!(hunks[1].lines.iter().any(|l| l.contains("TAIL_MOD")));
    }

    #[test]
    fn test_bit_parallel_myers_distance_empty() {
        assert_eq!(compute_bit_parallel_myers_distance(&[], &[]), 0);
        assert_eq!(compute_bit_parallel_myers_distance(&[1, 2, 3], &[]), 3);
        assert_eq!(compute_bit_parallel_myers_distance(&[], &[1, 2, 3, 4]), 4);
    }

    #[test]
    fn test_bit_parallel_myers_distance_identical() {
        let p = [10, 20, 30, 40];
        let t = [10, 20, 30, 40];
        assert_eq!(compute_bit_parallel_myers_distance(&p, &t), 2);
    }

    #[test]
    fn test_bit_parallel_myers_distance_mutations() {
        let p = [1, 2, 3, 4, 5];
        let t = [1, 2, 99, 4, 5];
        // Bit-parallel myers distance matching swar.ts
        assert_eq!(compute_bit_parallel_myers_distance(&p, &t), 3);
    }

    #[test]
    fn test_bit_parallel_myers_distance_64_bits() {
        let p: Vec<u32> = (0..60).collect();
        let mut t = p.clone();
        t[30] = 999;
        assert_eq!(compute_bit_parallel_myers_distance(&p, &t), 3);
    }

    #[test]
    fn test_bit_parallel_myers_distance_128_and_scalar_boundaries() {
        let p64: Vec<u32> = (0..64).collect();
        let mut t64 = p64.clone();
        t64[20] = 777;
        assert_eq!(compute_bit_parallel_myers_distance(&p64, &t64), 3);

        let p100: Vec<u32> = (0..100).collect();
        let mut t100 = p100.clone();
        t100[50] = 888;
        assert_eq!(compute_bit_parallel_myers_distance(&p100, &t100), 3);

        let p140: Vec<u32> = (0..140).collect();
        let mut t140 = p140.clone();
        t140[70] = 999;
        assert_eq!(compute_bit_parallel_myers_distance(&p140, &p140), 0);
        assert_eq!(compute_bit_parallel_myers_distance(&p140, &t140), 2);
    }

    #[test]
    fn test_histogram_anchor_partition_above_fallback_threshold() {
        let mut old_lines = Vec::new();
        let mut new_lines = Vec::new();
        old_lines.push("LEFT_HEAD_OLD".to_string());
        new_lines.push("LEFT_HEAD_NEW".to_string());
        for i in 0..20 {
            old_lines.push(format!("repeat_brace_{}", i % 3));
            new_lines.push(format!("repeat_brace_{}", i % 3));
        }
        old_lines.push("UNIQUE_HISTOGRAM_ANCHOR_LINE".to_string());
        new_lines.push("UNIQUE_HISTOGRAM_ANCHOR_LINE".to_string());
        for i in 0..20 {
            old_lines.push(format!("repeat_tail_{}", i % 3));
            new_lines.push(format!("repeat_tail_{}", i % 3));
        }
        old_lines.push("RIGHT_TAIL_OLD".to_string());
        new_lines.push("RIGHT_TAIL_NEW".to_string());

        let hunks = run_histogram_diff(&old_lines.join("\n"), &new_lines.join("\n"));
        assert_eq!(hunks.len(), 2);
        assert!(hunks[0].lines.iter().any(|l| l == "-LEFT_HEAD_OLD"));
        assert!(hunks[0].lines.iter().any(|l| l == "+LEFT_HEAD_NEW"));
        assert!(hunks[1].lines.iter().any(|l| l == "-RIGHT_TAIL_OLD"));
        assert!(hunks[1].lines.iter().any(|l| l == "+RIGHT_TAIL_NEW"));
    }
}
