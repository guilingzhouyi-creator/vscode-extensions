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
}
