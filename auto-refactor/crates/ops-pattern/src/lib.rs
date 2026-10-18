//! Module: Native Acceleration Kernel — Multi-Pattern Search
//! Crate: ops-pattern
//! Architecture Role: Fast line-aware multi-pattern search operator
//! for forbidden tokens, imports, and AST pattern anchors.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatternMatch {
    pub pattern: String,
    pub line: u32,
    pub column: u32,
    pub match_text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BumpyRoadResult {
    pub bumpy_score: f64,
    pub is_bumpy: bool,
    pub mean_depth: f64,
    pub variance_depth: f64,
    pub spikes_count: u32,
}

pub fn run_fast_pattern_match(source_text: &str, patterns: &[String]) -> Vec<PatternMatch> {
    let mut results = Vec::new();
    if source_text.is_empty() || patterns.is_empty() {
        return results;
    }

    if patterns.len() == 1 {
        match_single_pattern(source_text, &patterns[0], &mut results);
    } else {
        match_multi_patterns(source_text, patterns, &mut results);
    }

    if patterns.len() > 1 {
        results.sort_by(|a, b| {
            a.line
                .cmp(&b.line)
                .then_with(|| a.column.cmp(&b.column))
                .then_with(|| a.pattern.cmp(&b.pattern))
        });
    }

    results
}

fn match_single_pattern(source_text: &str, pattern: &str, results: &mut Vec<PatternMatch>) {
    if pattern.is_empty() {
        return;
    }
    let pat_len = pattern.len().max(1);
    for (line_idx, line) in source_text.lines().enumerate() {
        let line_num = (line_idx + 1) as u32;
        let mut start_idx = 0;
        while let Some(pos) = line[start_idx..].find(pattern) {
            let actual_col = (start_idx + pos + 1) as u32;
            results.push(PatternMatch {
                pattern: pattern.to_string(),
                line: line_num,
                column: actual_col,
                match_text: pattern.to_string(),
            });
            start_idx += pos + pat_len;
            if start_idx >= line.len() {
                break;
            }
        }
    }
}

struct PatternCandidate<'a> {
    pattern: &'a String,
    bytes: &'a [u8],
    needle_byte: u8,
    needle_offset: usize,
    min_len: usize,
}

#[inline(always)]
fn byte_rarity(b: u8) -> u8 {
    match b {
        b'z' | b'Z' | b'q' | b'Q' | b'x' | b'X' | b'j' | b'J' => 1,
        b'k' | b'K' | b'v' | b'V' | b'w' | b'W' => 5,
        b'b' | b'B' | b'y' | b'Y' | b'p' | b'P' => 10,
        b'f' | b'F' | b'g' | b'G' | b'm' | b'M' | b'h' | b'H' => 20,
        b'u' | b'U' | b'c' | b'C' | b'd' | b'D' | b'l' | b'L' => 30,
        b'r' | b'R' | b'n' | b'N' | b's' | b'S' => 45,
        b'o' | b'O' | b'i' | b'I' | b'a' | b'A' => 60,
        b't' | b'T' | b'e' | b'E' => 75,
        b'0'..=b'9' => 25,
        b'_' | b'$' | b'@' | b'#' | b'~' | b'`' | b'%' | b'^' | b'&' | b'|' => 15,
        b'-' | b'+' | b'/' | b'*' | b'=' | b'<' | b'>' | b'!' | b'?' | b':' => 50,
        b'.' | b',' | b';' | b'(' | b')' | b'[' | b']' | b'{' | b'}' => 85,
        b' ' | b'\t' | b'\r' | b'\n' | b'"' | b'\'' => 100,
        _ => 2,
    }
}

fn select_rarest_byte(bytes: &[u8]) -> (u8, usize) {
    let mut min_rarity = u8::MAX;
    let mut best_byte = bytes[0];
    let mut best_idx = 0;
    for (i, &b) in bytes.iter().enumerate() {
        let rarity = byte_rarity(b);
        if rarity < min_rarity {
            min_rarity = rarity;
            best_byte = b;
            best_idx = i;
        }
    }
    (best_byte, best_idx)
}

#[inline(always)]
fn has_any_candidate_byte(bytes: &[u8], mask: &[bool; 256]) -> bool {
    let mut i = 0;
    while i + 8 <= bytes.len() {
        if mask[bytes[i] as usize]
            || mask[bytes[i + 1] as usize]
            || mask[bytes[i + 2] as usize]
            || mask[bytes[i + 3] as usize]
            || mask[bytes[i + 4] as usize]
            || mask[bytes[i + 5] as usize]
            || mask[bytes[i + 6] as usize]
            || mask[bytes[i + 7] as usize]
        {
            return true;
        }
        i += 8;
    }
    while i < bytes.len() {
        if mask[bytes[i] as usize] {
            return true;
        }
        i += 1;
    }
    false
}

fn match_multi_patterns(source_text: &str, patterns: &[String], results: &mut Vec<PatternMatch>) {
    let candidates: Vec<PatternCandidate> = patterns
        .iter()
        .filter(|p| !p.is_empty())
        .map(|p| {
            let bytes = p.as_bytes();
            let (needle_byte, needle_offset) = select_rarest_byte(bytes);
            PatternCandidate {
                pattern: p,
                bytes,
                needle_byte,
                needle_offset,
                min_len: bytes.len(),
            }
        })
        .collect();

    if candidates.is_empty() {
        return;
    }

    let mut needle_mask = [false; 256];
    let mut min_pat_len = usize::MAX;
    for cand in &candidates {
        needle_mask[cand.needle_byte as usize] = true;
        if cand.min_len < min_pat_len {
            min_pat_len = cand.min_len;
        }
    }

    let mut next_allowed = vec![0usize; candidates.len()];

    for (line_idx, line) in source_text.lines().enumerate() {
        let line_len = line.len();
        if line_len < min_pat_len {
            continue;
        }

        let line_bytes = line.as_bytes();

        // Fast candidate presence probe with rarest-byte mask
        if !has_any_candidate_byte(line_bytes, &needle_mask) {
            continue;
        }

        let line_num = (line_idx + 1) as u32;
        next_allowed.fill(0);

        let mut col = 0;

        while col < line_len {
            // ripgrep SWAR 8-byte block skip: fast forward if next 8 bytes contain zero candidate needle-bytes
            if col + 8 <= line_len
                && !needle_mask[line_bytes[col] as usize]
                && !needle_mask[line_bytes[col + 1] as usize]
                && !needle_mask[line_bytes[col + 2] as usize]
                && !needle_mask[line_bytes[col + 3] as usize]
                && !needle_mask[line_bytes[col + 4] as usize]
                && !needle_mask[line_bytes[col + 5] as usize]
                && !needle_mask[line_bytes[col + 6] as usize]
                && !needle_mask[line_bytes[col + 7] as usize]
            {
                col += 8;
                continue;
            }

            let b = line_bytes[col];
            if !needle_mask[b as usize] {
                col += 1;
                continue;
            }

            for (idx, cand) in candidates.iter().enumerate() {
                if cand.needle_byte == b && col >= cand.needle_offset {
                    let start_col = col - cand.needle_offset;
                    if start_col >= next_allowed[idx]
                        && line_len - start_col >= cand.min_len
                        && &line_bytes[start_col..start_col + cand.min_len] == cand.bytes
                    {
                        results.push(PatternMatch {
                            pattern: cand.pattern.clone(),
                            line: line_num,
                            column: (start_col + 1) as u32,
                            match_text: cand.pattern.clone(),
                        });
                        next_allowed[idx] = start_col + cand.min_len.max(1);
                    }
                }
            }

            col += 1;
        }
    }
}

/// 64-bit SWAR (SIMD Within A Register) fast newline detector.
/// Scans 8-byte words for 0x0A (\n) using bit-manipulation magic:
/// `has_zero_byte(w ^ 0x0A0A0A0A0A0A0A0A)`
#[inline(always)]
pub fn has_newline_swar(word: u64) -> bool {
    let xor = word ^ 0x0A0A0A0A0A0A0A0A;
    (xor.wrapping_sub(0x0101010101010101)) & (!xor) & 0x8080808080808080 != 0
}

/// Computes all newline byte offsets within a source buffer using 64-bit SWAR block skips.
pub fn find_newline_offsets(bytes: &[u8]) -> Vec<usize> {
    let mut offsets = Vec::new();
    let mut i = 0;
    while i + 8 <= bytes.len() {
        let chunk: [u8; 8] = [
            bytes[i],
            bytes[i + 1],
            bytes[i + 2],
            bytes[i + 3],
            bytes[i + 4],
            bytes[i + 5],
            bytes[i + 6],
            bytes[i + 7],
        ];
        let word = u64::from_le_bytes(chunk);
        if has_newline_swar(word) {
            for j in 0..8 {
                if bytes[i + j] == b'\n' {
                    offsets.push(i + j);
                }
            }
        }
        i += 8;
    }
    while i < bytes.len() {
        if bytes[i] == b'\n' {
            offsets.push(i);
        }
        i += 1;
    }
    offsets
}

/// Fast line counter using 64-bit SWAR skipping.
pub fn count_lines_swar(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }
    let mut count = 1;
    let mut i = 0;
    while i + 8 <= bytes.len() {
        let chunk: [u8; 8] = [
            bytes[i],
            bytes[i + 1],
            bytes[i + 2],
            bytes[i + 3],
            bytes[i + 4],
            bytes[i + 5],
            bytes[i + 6],
            bytes[i + 7],
        ];
        let word = u64::from_le_bytes(chunk);
        if has_newline_swar(word) {
            for j in 0..8 {
                if bytes[i + j] == b'\n' {
                    count += 1;
                }
            }
        }
        i += 8;
    }
    while i < bytes.len() {
        if bytes[i] == b'\n' {
            count += 1;
        }
        i += 1;
    }
    count
}

/// Calculates effective indentation level of a single source line (1 unit = 4 spaces or 1 tab).
pub fn measure_line_indent_level(line: &str) -> u32 {
    let mut spaces = 0;
    for b in line.bytes() {
        if b == b' ' {
            spaces += 1;
        } else if b == b'\t' {
            spaces += 4;
        } else {
            break;
        }
    }
    spaces / 4
}

/// Evaluates Bumpy Road structural irregularity and spatial depth variance across a line span.
pub fn evaluate_bumpy_road(lines: &[String], start_line: u32, end_line: u32) -> BumpyRoadResult {
    const MIN_BUMPY_LINE_SPAN: usize = 20;
    const MIN_BUMPY_SCORE_THRESHOLD: f64 = 12.0;

    let total_lines = if end_line >= start_line {
        (end_line - start_line + 1) as usize
    } else {
        0
    };

    if lines.is_empty()
        || total_lines < MIN_BUMPY_LINE_SPAN
        || start_line < 1
        || (end_line as usize) > lines.len()
    {
        return BumpyRoadResult {
            bumpy_score: 0.0,
            is_bumpy: false,
            mean_depth: 0.0,
            variance_depth: 0.0,
            spikes_count: 0,
        };
    }

    let start_idx = (start_line - 1) as usize;
    let end_idx = (end_line - 1) as usize;

    let mut non_blank_count = 0usize;
    let mut depth_sum = 0i64;
    let mut base_indent: Option<i32> = None;

    // First pass: compute base indent, depth sum, non-blank count
    for line in &lines[start_idx..=end_idx] {
        if line.trim().is_empty() {
            continue;
        }
        let depth = measure_line_indent_level(line) as i32;
        if base_indent.is_none() {
            base_indent = Some(depth);
        }
        let rel_depth = (depth - base_indent.unwrap()).max(0);
        depth_sum += rel_depth as i64;
        non_blank_count += 1;
    }

    if non_blank_count < MIN_BUMPY_LINE_SPAN {
        return BumpyRoadResult {
            bumpy_score: 0.0,
            is_bumpy: false,
            mean_depth: 0.0,
            variance_depth: 0.0,
            spikes_count: 0,
        };
    }

    let base = base_indent.unwrap_or(0);
    let mean_depth = (depth_sum as f64) / (non_blank_count as f64);
    let mut variance_sum = 0.0f64;
    let mut spikes_count = 0u32;
    let mut prev_depth = 0i32;

    // Second pass: compute variance and alternating spikes
    for line in &lines[start_idx..=end_idx] {
        if line.trim().is_empty() {
            continue;
        }
        let rel_depth = (measure_line_indent_level(line) as i32 - base).max(0);
        let diff = (rel_depth as f64) - mean_depth;
        variance_sum += diff * diff;

        let delta = (rel_depth - prev_depth).abs();
        if delta >= 2 {
            spikes_count += 1;
        }
        prev_depth = rel_depth;
    }

    let variance_depth = ((variance_sum / (non_blank_count as f64)) * 100.0).round() / 100.0;
    let mean_depth_rounded = (mean_depth * 100.0).round() / 100.0;
    let raw_score = (spikes_count as f64) * variance_depth * mean_depth.max(1.0);
    let bumpy_score = ((raw_score.min(100.0)) * 10.0).round() / 10.0;
    let is_bumpy = bumpy_score >= MIN_BUMPY_SCORE_THRESHOLD && spikes_count >= 3;

    BumpyRoadResult {
        bumpy_score,
        is_bumpy,
        mean_depth: mean_depth_rounded,
        variance_depth,
        spikes_count,
    }
}

/// Fast vectorized batch probe testing multiple trigger groups against target content.
///
/// Uses a 256-LUT initial-byte table for fast filtering, followed by substring probing.
/// Empty trigger groups return true (safe fallback contract).
/// Empty content returns false when groups have non-empty triggers.
pub fn batch_probe_triggers(content: &str, trigger_groups: &[Vec<String>]) -> Vec<bool> {
    if content.is_empty() {
        return trigger_groups.iter().map(|g| g.is_empty()).collect();
    }

    let content_bytes = content.as_bytes();
    let mut results = Vec::with_capacity(trigger_groups.len());

    for group in trigger_groups {
        if group.is_empty() {
            results.push(true);
            continue;
        }

        // Build 256-LUT for the first byte of non-empty triggers
        let mut lut = [0u8; 256];
        let mut has_valid_trigger = false;
        for trigger in group {
            if let Some(&first_byte) = trigger.as_bytes().first() {
                lut[first_byte as usize] = 1;
                has_valid_trigger = true;
            }
        }

        if !has_valid_trigger {
            results.push(true);
            continue;
        }

        // Fast screen: probe if any initial byte exists in content
        let mut initial_byte_found = false;
        for &b in content_bytes {
            if lut[b as usize] == 1 {
                initial_byte_found = true;
                break;
            }
        }

        if !initial_byte_found {
            results.push(false);
            continue;
        }

        // Substring probe: check if any trigger occurs in content
        let mut matched = false;
        for trigger in group {
            if !trigger.is_empty() && content.contains(trigger.as_str()) {
                matched = true;
                break;
            }
        }
        results.push(matched);
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pattern_match() {
        let text = "const foo = 1;\nconst bar = foo + 1;";
        let matches = run_fast_pattern_match(text, &["foo".to_string()]);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].line, 1);
        assert_eq!(matches[0].column, 7);
        assert_eq!(matches[1].line, 2);
        assert_eq!(matches[1].column, 13);
    }

    #[test]
    fn test_empty_inputs() {
        assert!(run_fast_pattern_match("", &["foo".to_string()]).is_empty());
        assert!(run_fast_pattern_match("const x = 1;", &[]).is_empty());
        assert!(run_fast_pattern_match("const x = 1;", &["".to_string()]).is_empty());
    }

    #[test]
    fn test_multiple_patterns_same_line() {
        let text = "const foo = bar + baz;";
        let matches = run_fast_pattern_match(
            text,
            &["foo".to_string(), "bar".to_string(), "baz".to_string()],
        );
        assert_eq!(matches.len(), 3);
        assert!(matches.iter().any(|m| m.pattern == "foo" && m.column == 7));
        assert!(matches.iter().any(|m| m.pattern == "bar" && m.column == 13));
        assert!(matches.iter().any(|m| m.pattern == "baz" && m.column == 19));
    }

    #[test]
    fn test_unicode_and_cjk_match() {
        let text = "let 用户名 = \"管理员\"; // 用户名校验";
        let matches = run_fast_pattern_match(text, &["用户名".to_string(), "管理员".to_string()]);
        assert_eq!(matches.len(), 3);
    }

    #[test]
    fn test_repeated_matches_in_single_line() {
        let text = "aaa bbb aaa ccc aaa";
        let matches = run_fast_pattern_match(text, &["aaa".to_string()]);
        assert_eq!(matches.len(), 3);
        assert_eq!(matches[0].column, 1);
        assert_eq!(matches[1].column, 9);
        assert_eq!(matches[2].column, 17);
    }

    #[test]
    fn test_no_matches() {
        let text = "function calculate() { return 42; }";
        let matches = run_fast_pattern_match(text, &["eval".to_string(), "exec".to_string()]);
        assert!(matches.is_empty());
    }

    #[test]
    fn test_pattern_longer_than_line_and_newlines() {
        let text = "short\nline\n";
        let matches = run_fast_pattern_match(
            text,
            &[
                "this_pattern_is_longer_than_line".to_string(),
                "short".to_string(),
            ],
        );
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].line, 1);
        assert_eq!(matches[0].match_text, "short");
    }

    #[test]
    fn test_swar_newline_indexing() {
        let text = "alpha\nbeta\r\ngamma\ndelta";
        let offsets = find_newline_offsets(text.as_bytes());
        assert_eq!(offsets, vec![5, 11, 17]);

        let line_count = count_lines_swar(text.as_bytes());
        assert_eq!(line_count, 4);

        let empty_offsets = find_newline_offsets(b"");
        assert!(empty_offsets.is_empty());
        assert_eq!(count_lines_swar(b""), 0);

        let single_line = b"single line without newline";
        assert!(find_newline_offsets(single_line).is_empty());
        assert_eq!(count_lines_swar(single_line), 1);
    }

    #[test]
    fn test_indent_level_and_bumpy_road() {
        assert_eq!(measure_line_indent_level("no indent"), 0);
        assert_eq!(measure_line_indent_level("    four spaces"), 1);
        assert_eq!(measure_line_indent_level("        eight spaces"), 2);
        assert_eq!(measure_line_indent_level("\tone tab"), 1);
        assert_eq!(measure_line_indent_level("\t    tab plus four spaces"), 2);

        // Under 20 lines -> empty result
        let short_lines: Vec<String> = (0..10).map(|i| format!("line {}", i)).collect();
        let short_res = evaluate_bumpy_road(&short_lines, 1, 10);
        assert_eq!(short_res.bumpy_score, 0.0);
        assert!(!short_res.is_bumpy);

        // 25 alternating lines (jumping by depth 2 every other line)
        let mut bumpy_lines = Vec::new();
        for i in 0..25 {
            if i % 2 == 0 {
                bumpy_lines.push("    even line".to_string());
            } else {
                bumpy_lines.push("            odd line deeply indented".to_string());
            }
        }
        let bumpy_res = evaluate_bumpy_road(&bumpy_lines, 1, 25);
        assert!(bumpy_res.spikes_count >= 10);
        assert!(bumpy_res.variance_depth > 0.0);
        assert!(bumpy_res.is_bumpy);
        assert!(bumpy_res.bumpy_score >= 12.0);
    }

    #[test]
    fn test_batch_probe_triggers() {
        let content = "function processData(items) {\n    for (const item of items) {\n        console.log(item);\n    }\n}";
        let groups = vec![
            vec!["for".to_string(), "while".to_string()], // loops: matches
            vec!["password".to_string(), "api_key".to_string()], // secrets: no match
            vec!["class".to_string(), "interface".to_string()], // class: no match
            vec!["console".to_string()],                  // console: matches
            vec![], // empty group: matches (safe fallback contract)
        ];

        let results = batch_probe_triggers(content, &groups);
        assert_eq!(results, vec![true, false, false, true, true]);

        let empty_results = batch_probe_triggers("", &groups);
        assert_eq!(empty_results, vec![false, false, false, false, true]);
    }
}
