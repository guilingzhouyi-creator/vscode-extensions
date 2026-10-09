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
    first_byte: u8,
    min_len: usize,
}

fn match_multi_patterns(source_text: &str, patterns: &[String], results: &mut Vec<PatternMatch>) {
    let candidates: Vec<PatternCandidate> = patterns
        .iter()
        .filter(|p| !p.is_empty())
        .map(|p| {
            let bytes = p.as_bytes();
            PatternCandidate {
                pattern: p,
                bytes,
                first_byte: bytes[0],
                min_len: bytes.len(),
            }
        })
        .collect();

    if candidates.is_empty() {
        return;
    }

    let mut first_byte_mask = [false; 256];
    let mut min_pat_len = usize::MAX;
    for cand in &candidates {
        first_byte_mask[cand.first_byte as usize] = true;
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

        // Fast candidate presence probe: skip line early if no candidate first bytes exist
        if !line_bytes.iter().any(|&b| first_byte_mask[b as usize]) {
            continue;
        }

        let line_num = (line_idx + 1) as u32;
        next_allowed.fill(0);

        let mut col = 0;
        let limit = line_len.saturating_sub(min_pat_len);

        while col <= limit {
            let b = line_bytes[col];
            if !first_byte_mask[b as usize] {
                col += 1;
                continue;
            }

            for (idx, cand) in candidates.iter().enumerate() {
                if cand.first_byte == b
                    && col >= next_allowed[idx]
                    && line_len - col >= cand.min_len
                    && &line_bytes[col..col + cand.min_len] == cand.bytes
                {
                    results.push(PatternMatch {
                        pattern: cand.pattern.clone(),
                        line: line_num,
                        column: (col + 1) as u32,
                        match_text: cand.pattern.clone(),
                    });
                    next_allowed[idx] = col + cand.min_len.max(1);
                }
            }

            col += 1;
        }
    }
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
}
