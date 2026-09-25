mod diff;
mod graph;
mod pattern;

pub use diff::NativeDiffHunk;
pub use graph::NativeGraphAnalysis;
pub use pattern::NativePatternMatch;

use napi_derive::napi;

#[napi]
pub const VERSION: &str = "0.4.0-rust-native";

#[napi]
pub fn compute_histogram_diff(old_content: String, new_content: String) -> Vec<NativeDiffHunk> {
    diff::run_histogram_diff(&old_content, &new_content)
}

#[napi]
pub fn analyze_dependency_graph(edges: Vec<Vec<String>>) -> NativeGraphAnalysis {
    graph::run_analyze_dependency_graph(&edges)
}

#[napi]
pub fn fast_pattern_match(source_text: String, patterns: Vec<String>) -> Vec<NativePatternMatch> {
    pattern::run_fast_pattern_match(&source_text, &patterns)
}
