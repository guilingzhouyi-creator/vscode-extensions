use napi_derive::napi;

#[napi(object)]
pub struct NativePatternMatch {
    pub pattern: String,
    pub line: u32,
    pub column: u32,
    pub match_text: String,
}

pub fn run_fast_pattern_match(source_text: &str, patterns: &[String]) -> Vec<NativePatternMatch> {
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
                results.push(NativePatternMatch {
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
