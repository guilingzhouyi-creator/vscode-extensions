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

    for (line_idx, line) in source_text.lines().enumerate() {
        let line_num = (line_idx + 1) as u32;
        for pattern in patterns {
            if pattern.is_empty() {
                continue;
            }
            let mut start_idx = 0;
            while let Some(pos) = line[start_idx..].find(pattern) {
                let actual_col = (start_idx + pos + 1) as u32;
                results.push(PatternMatch {
                    pattern: pattern.clone(),
                    line: line_num,
                    column: actual_col,
                    match_text: pattern.clone(),
                });
                start_idx += pos + pattern.len().max(1);
                if start_idx >= line.len() {
                    break;
                }
            }
        }
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
}
