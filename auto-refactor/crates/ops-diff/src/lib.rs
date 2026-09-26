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

fn compute_diff(old: &[&str], new: &[&str]) -> Vec<DiffOp> {
    let n = old.len();
    let m = new.len();

    let mut prefix = 0;
    while prefix < n && prefix < m && old[prefix] == new[prefix] {
        prefix += 1;
    }

    let mut suffix = 0;
    while suffix < (n - prefix)
        && suffix < (m - prefix)
        && old[n - 1 - suffix] == new[m - 1 - suffix]
    {
        suffix += 1;
    }

    let old_mid = &old[prefix..n - suffix];
    let new_mid = &new[prefix..m - suffix];

    let mid_ops = myers_diff(old_mid, new_mid, prefix);

    let mut all_ops = Vec::with_capacity(n + m);
    for i in 0..prefix {
        all_ops.push(DiffOp::Equal(i, i));
    }
    all_ops.extend(mid_ops);
    for i in 0..suffix {
        let old_idx = n - suffix + i;
        let new_idx = m - suffix + i;
        all_ops.push(DiffOp::Equal(old_idx, new_idx));
    }

    all_ops
}

fn myers_diff(old: &[&str], new: &[&str], offset: usize) -> Vec<DiffOp> {
    let n = old.len();
    let m = new.len();

    if n == 0 {
        return (0..m).map(|j| DiffOp::Insert(offset + j)).collect();
    }
    if m == 0 {
        return (0..n).map(|i| DiffOp::Delete(offset + i)).collect();
    }

    let max = n + m;
    let mut v: HashMap<isize, usize> = HashMap::new();
    v.insert(1, 0);

    let mut trace: Vec<HashMap<isize, usize>> = Vec::new();

    for d in 0..=(max as isize) {
        trace.push(v.clone());
        let mut k = -d;
        while k <= d {
            let mut x = if k == -d
                || (k != d
                    && v.get(&(k - 1)).copied().unwrap_or(0)
                        < v.get(&(k + 1)).copied().unwrap_or(0))
            {
                v.get(&(k + 1)).copied().unwrap_or(0)
            } else {
                v.get(&(k - 1)).copied().unwrap_or(0) + 1
            };
            let mut y = (x as isize - k) as usize;

            while x < n && y < m && old[x] == new[y] {
                x += 1;
                y += 1;
            }

            v.insert(k, x);

            if x >= n && y >= m {
                return backtrack(&trace, old, new, offset, d);
            }

            k += 2;
        }
    }

    let mut fallback = Vec::new();
    for i in 0..n {
        fallback.push(DiffOp::Delete(offset + i));
    }
    for j in 0..m {
        fallback.push(DiffOp::Insert(offset + j));
    }
    fallback
}

fn backtrack(
    trace: &[HashMap<isize, usize>],
    _old: &[&str],
    _new: &[&str],
    offset: usize,
    d: isize,
) -> Vec<DiffOp> {
    let mut ops = Vec::new();

    let mut curr_x = _old.len();
    let mut curr_y = _new.len();

    for step in (1..=d as usize).rev() {
        let v = &trace[step];
        let k = curr_x as isize - curr_y as isize;

        let prev_k = if k == -(step as isize)
            || (k != (step as isize)
                && v.get(&(k - 1)).copied().unwrap_or(0) < v.get(&(k + 1)).copied().unwrap_or(0))
        {
            k + 1
        } else {
            k - 1
        };

        let prev_x = v.get(&prev_k).copied().unwrap_or(0);
        let prev_y = (prev_x as isize - prev_k) as usize;

        while curr_x > prev_x && curr_y > prev_y {
            curr_x -= 1;
            curr_y -= 1;
            ops.push(DiffOp::Equal(offset + curr_x, offset + curr_y));
        }

        if curr_x > prev_x {
            curr_x -= 1;
            ops.push(DiffOp::Delete(offset + curr_x));
        } else if curr_y > prev_y {
            curr_y -= 1;
            ops.push(DiffOp::Insert(offset + curr_y));
        }
    }

    while curr_x > 0 && curr_y > 0 {
        curr_x -= 1;
        curr_y -= 1;
        ops.push(DiffOp::Equal(offset + curr_x, offset + curr_y));
    }

    ops.reverse();
    ops
}

fn assemble_hunks(
    ops: &[DiffOp],
    old_lines: &[&str],
    new_lines: &[&str],
    context: usize,
) -> Vec<DiffHunk> {
    let mut hunks = Vec::new();
    let len = ops.len();
    let mut i = 0;

    while i < len {
        while i < len {
            if !matches!(ops[i], DiffOp::Equal(_, _)) {
                break;
            }
            i += 1;
        }

        if i >= len {
            break;
        }

        let hunk_start = i.saturating_sub(context);
        let mut hunk_end = i;

        while hunk_end < len {
            if !matches!(ops[hunk_end], DiffOp::Equal(_, _)) {
                hunk_end += 1;
            } else {
                let mut eq_count = 0;
                let mut peek = hunk_end;
                while peek < len && matches!(ops[peek], DiffOp::Equal(_, _)) {
                    eq_count += 1;
                    peek += 1;
                }

                if eq_count <= context * 2 && peek < len {
                    hunk_end = peek;
                } else {
                    hunk_end = (hunk_end + context).min(len);
                    break;
                }
            }
        }

        let mut lines = Vec::new();
        let mut old_start = 0;
        let mut old_lines_count = 0;
        let mut new_start = 0;
        let mut new_lines_count = 0;

        for op in &ops[hunk_start..hunk_end] {
            match *op {
                DiffOp::Equal(o, n) => {
                    if old_start == 0 {
                        old_start = o + 1;
                    }
                    if new_start == 0 {
                        new_start = n + 1;
                    }
                    old_lines_count += 1;
                    new_lines_count += 1;
                    let text = old_lines.get(o).copied().unwrap_or("");
                    lines.push(format!(" {text}"));
                }
                DiffOp::Delete(o) => {
                    if old_start == 0 {
                        old_start = o + 1;
                    }
                    if old_lines_count == 0 && old_start == 0 {
                        old_start = o + 1;
                    }
                    old_lines_count += 1;
                    let text = old_lines.get(o).copied().unwrap_or("");
                    lines.push(format!("-{text}"));
                }
                DiffOp::Insert(n) => {
                    if new_start == 0 {
                        new_start = n + 1;
                    }
                    if new_lines_count == 0 && new_start == 0 {
                        new_start = n + 1;
                    }
                    new_lines_count += 1;
                    let text = new_lines.get(n).copied().unwrap_or("");
                    lines.push(format!("+{text}"));
                }
            }
        }

        hunks.push(DiffHunk {
            old_start: old_start.max(1) as u32,
            old_lines: old_lines_count as u32,
            new_start: new_start.max(1) as u32,
            new_lines: new_lines_count as u32,
            lines,
        });

        i = hunk_end;
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
}
