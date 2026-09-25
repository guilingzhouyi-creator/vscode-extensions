use napi_derive::napi;

#[napi]
pub const VERSION: &str = "0.4.0-rust-native";

#[napi(object)]
pub struct NativeDiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<String>,
}

impl From<ops_diff::DiffHunk> for NativeDiffHunk {
    fn from(h: ops_diff::DiffHunk) -> Self {
        Self {
            old_start: h.old_start,
            old_lines: h.old_lines,
            new_start: h.new_start,
            new_lines: h.new_lines,
            lines: h.lines,
        }
    }
}

#[napi(object)]
pub struct NativeGraphAnalysis {
    pub cycles: Vec<Vec<String>>,
    pub topological_order: Vec<String>,
    pub strongly_connected_components: Vec<Vec<String>>,
    pub is_acyclic: bool,
}

impl From<ops_graph::GraphAnalysis> for NativeGraphAnalysis {
    fn from(g: ops_graph::GraphAnalysis) -> Self {
        Self {
            cycles: g.cycles,
            topological_order: g.topological_order,
            strongly_connected_components: g.strongly_connected_components,
            is_acyclic: g.is_acyclic,
        }
    }
}

#[napi(object)]
pub struct NativePatternMatch {
    pub pattern: String,
    pub line: u32,
    pub column: u32,
    pub match_text: String,
}

impl From<ops_pattern::PatternMatch> for NativePatternMatch {
    fn from(p: ops_pattern::PatternMatch) -> Self {
        Self {
            pattern: p.pattern,
            line: p.line,
            column: p.column,
            match_text: p.match_text,
        }
    }
}

#[napi(object)]
pub struct NativeMaskConfig {
    pub line_comment: String,
    pub block_comment_open: Option<String>,
    pub block_comment_close: Option<String>,
    pub quote_chars: String,
    pub multiline_templates: Option<bool>,
    pub regex_literals: Option<bool>,
}

#[napi(object)]
pub struct NativeMaskedSource {
    pub raw: Vec<String>,
    pub masked: Vec<String>,
    pub lines: u32,
    pub non_blank_lines: u32,
}

impl From<NativeMaskConfig> for ops_mask::MaskConfig {
    fn from(c: NativeMaskConfig) -> Self {
        let block_comment = match (c.block_comment_open, c.block_comment_close) {
            (Some(o), Some(cl)) if !o.is_empty() && !cl.is_empty() => Some((o, cl)),
            _ => None,
        };
        Self {
            line_comment: c.line_comment,
            block_comment,
            quote_chars: c.quote_chars,
            multiline_templates: c.multiline_templates.unwrap_or(false),
            regex_literals: c.regex_literals.unwrap_or(false),
        }
    }
}

impl From<ops_mask::MaskResult> for NativeMaskedSource {
    fn from(r: ops_mask::MaskResult) -> Self {
        Self {
            raw: r.raw,
            masked: r.masked,
            lines: r.lines,
            non_blank_lines: r.non_blank_lines,
        }
    }
}

#[napi]
pub fn compute_histogram_diff(old_content: String, new_content: String) -> Vec<NativeDiffHunk> {
    ops_diff::run_histogram_diff(&old_content, &new_content)
        .into_iter()
        .map(Into::into)
        .collect()
}

#[napi]
pub fn analyze_dependency_graph(edges: Vec<Vec<String>>) -> NativeGraphAnalysis {
    ops_graph::run_analyze_dependency_graph(&edges).into()
}

#[napi]
pub fn fast_pattern_match(source_text: String, patterns: Vec<String>) -> Vec<NativePatternMatch> {
    ops_pattern::run_fast_pattern_match(&source_text, &patterns)
        .into_iter()
        .map(Into::into)
        .collect()
}

#[napi]
pub fn mask_source_code(content: String, config: NativeMaskConfig) -> NativeMaskedSource {
    let mask_config: ops_mask::MaskConfig = config.into();
    ops_mask::mask_source_code(&content, &mask_config).into()
}

#[napi(object)]
pub struct NativeCloneBlock {
    pub start_line: u32,
    pub original_line: u32,
    pub line_span: u32,
}

impl From<ops_clone::CloneBlock> for NativeCloneBlock {
    fn from(b: ops_clone::CloneBlock) -> Self {
        Self {
            start_line: b.start_line,
            original_line: b.original_line,
            line_span: b.line_span,
        }
    }
}

#[napi(object)]
pub struct NativeClonePair {
    pub file_a: u32,
    pub file_b: u32,
    pub similarity: f64,
}

impl From<ops_clone::ClonePair> for NativeClonePair {
    fn from(p: ops_clone::ClonePair) -> Self {
        Self {
            file_a: p.file_a,
            file_b: p.file_b,
            similarity: p.similarity,
        }
    }
}

#[napi]
pub fn count_duplicate_lines(content: String) -> u32 {
    ops_clone::count_duplicate_lines(&content)
}

#[napi]
pub fn detect_clone_blocks(content: String, min_clone_lines: u32) -> Vec<NativeCloneBlock> {
    ops_clone::detect_clone_blocks(&content, min_clone_lines)
        .into_iter()
        .map(Into::into)
        .collect()
}

#[napi(js_name = "computeMinHash")]
pub fn compute_minhash(content: String, num_perm: Option<u32>) -> Vec<u32> {
    let k = num_perm.unwrap_or(64) as usize;
    ops_clone::compute_minhash(&content, k)
}

#[napi]
pub fn find_clone_pairs(signatures: Vec<Vec<u32>>, threshold: f64) -> Vec<NativeClonePair> {
    ops_clone::find_clone_pairs(&signatures, threshold)
        .into_iter()
        .map(Into::into)
        .collect()
}

