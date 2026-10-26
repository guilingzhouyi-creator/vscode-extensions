//! Module: auto-refactor-engine — Pure Rust AST Review & Analysis Engine
//! File Path: crates/auto-refactor-engine/src/lib.rs
//! Architecture Role: Pure Rust (rlib) unified domain engine for Praxis kernel callers, providing
//!   microsecond AST diffing, source masking, lexical pattern matching, and graph/entropy analysis
//!   without Node/NAPI dependencies or foreign runtime overhead.
//! Dependencies & Triggers: Aggregates ops-diff, ops-graph, ops-pattern, ops-mask, ops-clone,
//!   ops-math, ops-vector, and ops-scope. Consumed by Praxis kernel nodes and native Rust subagents.
//! Responsibilities: Expose clean pure-Rust traits, zero-copy review primitives, and unified facades.
//! Exit Semantics & Design Rationale: Provides physical isolation between core algorithmic evaluation
//!   and NAPI/Node runtime bindings, enabling direct rlib linking in high-performance Rust pipelines.

pub use ops_clone;
pub use ops_diff;
pub use ops_graph;
pub use ops_mask;
pub use ops_math;
pub use ops_pattern;
pub use ops_scope;
pub use ops_vector;

pub mod recipe;

/// Core trait defining the native AST review and static analysis interface.
pub trait NativeAstReviewEngine: Send + Sync {
    /// Computes unified histogram diff hunks between old and new source code strings.
    fn compute_diff_slices(&self, old_src: &str, new_src: &str) -> Vec<ops_diff::DiffHunk>;

    /// Masks comments and string literals according to the provided language configuration.
    fn evaluate_mask(
        &self,
        source_code: &str,
        config: &ops_mask::MaskConfig,
    ) -> ops_mask::MaskResult;

    /// Computes Shannon Information Entropy H(X) in bits from code or token streams.
    fn compute_entropy(&self, text: &str) -> f64;

    /// Analyzes dependency graph for cycles, topological sort, and strongly connected components.
    fn analyze_graph_cycles(&self, edges: &[(String, String)]) -> ops_graph::GraphAnalysis;

    /// Creates an interner for high-throughput symbol indexing.
    fn create_symbol_interner(&self) -> ops_scope::SymbolInterner;
}

/// Default pure-Rust implementation of the NativeAstReviewEngine trait.
#[derive(Debug, Default, Clone, Copy)]
pub struct DefaultAstReviewEngine;

impl DefaultAstReviewEngine {
    /// Constructs a new instance of DefaultAstReviewEngine.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl NativeAstReviewEngine for DefaultAstReviewEngine {
    fn compute_diff_slices(&self, old_src: &str, new_src: &str) -> Vec<ops_diff::DiffHunk> {
        ops_diff::run_histogram_diff(old_src, new_src)
    }

    fn evaluate_mask(
        &self,
        source_code: &str,
        config: &ops_mask::MaskConfig,
    ) -> ops_mask::MaskResult {
        ops_mask::mask_source_code(source_code, config)
    }

    fn compute_entropy(&self, text: &str) -> f64 {
        ops_math::compute_shannon_entropy(text)
    }

    fn analyze_graph_cycles(&self, edges: &[(String, String)]) -> ops_graph::GraphAnalysis {
        let edge_vecs: Vec<Vec<String>> = edges
            .iter()
            .map(|(a, b)| vec![a.clone(), b.clone()])
            .collect();
        ops_graph::run_analyze_dependency_graph(&edge_vecs)
    }

    fn create_symbol_interner(&self) -> ops_scope::SymbolInterner {
        ops_scope::SymbolInterner::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_native_engine_diff_slices() {
        let engine = DefaultAstReviewEngine::new();
        let old_src = "fn main() {\n    println!(\"hello\");\n}\n";
        let new_src = "fn main() {\n    println!(\"world\");\n}\n";

        let hunks = engine.compute_diff_slices(old_src, new_src);
        assert!(!hunks.is_empty());
        assert_eq!(hunks[0].old_lines, 3);
        assert_eq!(hunks[0].new_lines, 3);
    }

    #[test]
    fn test_native_engine_entropy() {
        let engine = DefaultAstReviewEngine::new();
        let entropy_low = engine.compute_entropy("aaaaaaa");
        let entropy_high = engine.compute_entropy("abcdefg12345!@#$");

        assert!(entropy_low < entropy_high);
        assert_eq!(entropy_low, 0.0);
    }

    #[test]
    fn test_native_engine_graph_cycles() {
        let engine = DefaultAstReviewEngine::new();
        let edges = vec![
            ("A".to_string(), "B".to_string()),
            ("B".to_string(), "C".to_string()),
            ("C".to_string(), "A".to_string()),
        ];

        let analysis = engine.analyze_graph_cycles(&edges);
        assert!(!analysis.is_acyclic);
        assert!(!analysis.cycles.is_empty());
    }

    #[test]
    fn test_native_engine_symbol_interner() {
        let engine = DefaultAstReviewEngine::new();
        let mut interner = engine.create_symbol_interner();

        let id1 = interner.intern("foo");
        let id2 = interner.intern("bar");
        let id3 = interner.intern("foo");

        assert_eq!(id1, id3);
        assert_ne!(id1, id2);
        assert_eq!(interner.resolve(id1), Some("foo"));
    }
}
